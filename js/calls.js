// ============================================================
// G.K.IO — Chamadas de voz/vídeo (WebRTC) + compartilhamento de tela
// Sinalização via Firestore. Usa apenas servidores STUN públicos —
// funciona na maioria das redes; para redes com NAT simétrico/
// firewalls restritivos, um servidor TURN precisa ser adicionado
// em produção (ver README.md, seção "Escalando as chamadas").
//
// Compartilhamento de tela: cada tela compartilhada vira uma NOVA
// track de vídeo adicionada à RTCPeerConnection já existente
// (pc.addTrack), o que dispara "onnegotiationneeded". Um pequeno
// protocolo de renegociação (campos renego* no doc de sinalização)
// troca um novo offer/answer sem derrubar a chamada em andamento.
// Funciona tanto para chamadas de DM quanto para canais de voz
// (malha P2P).
// ============================================================
import {
  auth, db, doc, collection, addDoc, setDoc, updateDoc, deleteDoc, getDoc, getDocs,
  onSnapshot, query, where, serverTimestamp,
  callsCol, callDoc, voicePresenceCol, userDoc,
} from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { getMediaPrefs } from './prefs.js';

const ICE_SERVERS = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
  ],
};

let localStream = null;
let screenStream = null;
let unsubIncoming = null;
let unsubCurrentCall = null;
let unsubVoicePresence = null;
const voicePeers = new Map(); // uid -> RTCPeerConnection (canal de voz, mesh)
const voiceUnsubs = new Map();
let dmCameraTrackId = null; // id da track de vídeo "câmera" na chamada de DM atual (para distinguir de telas)

// Estado da tela cheia de chamada (DM) — cronômetro e se está minimizada
let callTimerInterval = null;
let callStartedAt = null;

// ============================================================
// Utilitário: getUserMedia respeitando as preferências salvas
// ============================================================

async function getLocalStream(withVideo) {
  const prefs = getMediaPrefs();
  const audioConstraints = {
    deviceId: prefs.micId ? { exact: prefs.micId } : undefined,
    echoCancellation: prefs.echoCancellation,
    noiseSuppression: prefs.noiseSuppression,
    autoGainControl: prefs.autoGainControl,
  };
  const videoConstraints = withVideo
    ? { deviceId: prefs.camId ? { exact: prefs.camId } : undefined }
    : false;
  try {
    return await navigator.mediaDevices.getUserMedia({ audio: audioConstraints, video: videoConstraints });
  } catch (err) {
    toast('Não foi possível acessar microfone/câmera.', 'danger');
    throw err;
  }
}

// ============================================================
// Renegociação genérica (usada por chamadas de DM e canais de voz)
// ============================================================

function attachRenegotiation(pc, { onOffer }) {
  pc.onnegotiationneeded = async () => {
    try {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await onOffer({ type: offer.type, sdp: offer.sdp });
    } catch (e) { /* pode falhar em corridas de renegociação simultâneas — ignorado no MVP */ }
  };
}

async function handleRenegoSnapshot(pc, data, myUid, applyAnswer) {
  if (data.renegoOffer && data.renegoBy && data.renegoBy !== myUid) {
    const sdp = data.renegoOffer.sdp;
    if (sdp !== pc._lastRemoteRenegoSdp) {
      pc._lastRemoteRenegoSdp = sdp;
      await pc.setRemoteDescription(new RTCSessionDescription(data.renegoOffer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await applyAnswer({ type: answer.type, sdp: answer.sdp }, data.renegoBy);
    }
  }
  if (data.renegoAnswer && data.renegoAnswerFor === myUid && pc.signalingState === 'have-local-offer') {
    await pc.setRemoteDescription(new RTCSessionDescription(data.renegoAnswer));
  }
}

// ============================================================
// Chamadas de DM (1:1)
// ============================================================

export async function startDmCall(withVideo = false) {
  if (!state.currentDmId) { toast('Abra uma conversa antes de ligar.'); return; }
  if (state.activeCall) { toast('Você já está em uma chamada.'); return; }

  const dm = state.dms.get(state.currentDmId);
  if (!dm || !dm.other) return;

  localStream = await getLocalStream(withVideo);
  dmCameraTrackId = withVideo ? localStream.getVideoTracks()[0]?.id || null : null;
  const pc = new RTCPeerConnection(ICE_SERVERS);
  const peer = { uid: dm.other.uid, displayName: dm.other.displayName || dm.other.username, avatarUrl: dm.other.avatarUrl || '' };
  state.activeCall = { kind: 'dm', id: null, pc, dmId: state.currentDmId, remoteUid: dm.other.uid, withVideo, screenSharing: false, peer };
  wirePeerConnection(pc, onDmCallConnected);

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  // IMPORTANTE: pc.onicecandidate precisa ser atribuído ANTES de
  // setLocalDescription(offer) — a geração de candidatos ICE começa assim
  // que a descrição local é aplicada, e um handler atribuído depois disso
  // perde os candidatos que já dispararam (não há "replay" de eventos).
  // Como ainda não sabemos o id da chamada (só existe depois do addDoc
  // abaixo), bufferizamos os candidatos localmente e escrevemos no
  // Firestore assim que o id estiver disponível.
  const pendingCandidates = [];
  let candidatesColRef = null;
  pc.onicecandidate = (e) => {
    if (!e.candidate) return;
    const payload = { senderId: auth.currentUser.uid, candidate: e.candidate.toJSON() };
    if (candidatesColRef) addDoc(candidatesColRef, payload);
    else pendingCandidates.push(payload);
  };

  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);

  const callRef = await addDoc(callsCol(), {
    kind: 'dm', dmId: state.currentDmId,
    callerId: auth.currentUser.uid, calleeId: dm.other.uid,
    status: 'ringing', withVideo,
    offer: { type: offer.type, sdp: offer.sdp },
    createdAt: serverTimestamp(),
  });
  state.activeCall.id = callRef.id;

  candidatesColRef = collection(db, 'calls', callRef.id, 'candidates');
  pendingCandidates.forEach((payload) => addDoc(candidatesColRef, payload));
  pendingCandidates.length = 0;

  attachRenegotiation(pc, {
    onOffer: (offerDesc) => updateDoc(callDoc(callRef.id), { renegoOffer: offerDesc, renegoBy: auth.currentUser.uid }),
  });

  listenCallDoc(callRef.id, pc);
  openCallScreen({ peer, withVideo, statusText: 'Chamando...' });
}

export function joinDmCall() { /* alias usado pelo cartão de perfil */ return startDmCall(false); }

export function listenIncomingCalls() {
  if (!auth.currentUser) return;
  if (unsubIncoming) unsubIncoming();
  const q = query(callsCol(), where('calleeId', '==', auth.currentUser.uid), where('status', '==', 'ringing'));
  unsubIncoming = onSnapshot(q, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'added' && !state.activeCall) {
        promptIncomingCall({ id: change.doc.id, ...change.doc.data() });
      }
    });
  });
}

function promptIncomingCall(call) {
  getDoc(userDoc(call.callerId)).then((snap) => {
    const caller = snap.exists() ? { uid: call.callerId, ...snap.data() } : { uid: call.callerId, username: 'alguém' };
    const overlay = document.getElementById('gk-incoming-call-overlay');
    const card = document.getElementById('gk-incoming-call-card');
    card.innerHTML = '';
    card.appendChild(el('div', { class: 'gk-incoming-call-avatar-wrap' }, [
      el('div', { class: 'gk-incoming-call-ring' }),
      el('img', { src: caller.avatarUrl || fallbackAvatar(caller.username) }),
    ]));
    card.appendChild(el('div', { class: 'gk-incoming-call-info' }, [
      el('div', { class: 'gk-incoming-call-name' }, caller.displayName || caller.username),
      el('div', { class: 'gk-incoming-call-sub' }, call.withVideo ? 'Chamada de vídeo recebida' : 'Chamada de voz recebida'),
    ]));
    card.appendChild(el('div', { class: 'gk-incoming-call-actions' }, [
      el('button', { class: 'gk-incoming-call-btn gk-incoming-decline', title: 'Recusar', onclick: () => declineIncomingCall(call) }, '☎'),
      el('button', { class: 'gk-incoming-call-btn gk-incoming-accept', title: 'Atender', onclick: () => acceptIncomingCall(call, caller) }, call.withVideo ? '🎥' : '📞'),
    ]));
    overlay.classList.add('gk-open');
  });
}

async function acceptIncomingCall(call, caller) {
  document.getElementById('gk-incoming-call-overlay').classList.remove('gk-open');
  localStream = await getLocalStream(call.withVideo);
  dmCameraTrackId = call.withVideo ? localStream.getVideoTracks()[0]?.id || null : null;
  const pc = new RTCPeerConnection(ICE_SERVERS);
  const peer = { uid: call.callerId, displayName: caller.displayName || caller.username, avatarUrl: caller.avatarUrl || '' };
  state.activeCall = { kind: 'dm', id: call.id, pc, dmId: call.dmId, remoteUid: call.callerId, withVideo: call.withVideo, screenSharing: false, peer };
  wirePeerConnection(pc, onDmCallConnected);

  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  // Mesma correção do lado de quem liga: registra o envio de candidatos
  // ICE ANTES de criar a resposta. Aqui já sabemos o id da chamada (é o
  // doc que o outro lado criou), então não precisa buffer.
  const candidatesColRef = collection(db, 'calls', call.id, 'candidates');
  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(candidatesColRef, { senderId: auth.currentUser.uid, candidate: e.candidate.toJSON() });
  };

  await pc.setRemoteDescription(new RTCSessionDescription(call.offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);
  await updateDoc(callDoc(call.id), { status: 'accepted', answer: { type: answer.type, sdp: answer.sdp } });

  attachRenegotiation(pc, {
    onOffer: (offerDesc) => updateDoc(callDoc(call.id), { renegoOffer: offerDesc, renegoBy: auth.currentUser.uid }),
  });

  listenCallDoc(call.id, pc);
  openCallScreen({ peer, withVideo: call.withVideo, statusText: 'Conectando...' });
}

async function declineIncomingCall(call) {
  document.getElementById('gk-incoming-call-overlay').classList.remove('gk-open');
  await updateDoc(callDoc(call.id), { status: 'declined' });
}

function listenCallDoc(callId, pc) {
  if (unsubCurrentCall) unsubCurrentCall();
  const candidatesCol = collection(db, 'calls', callId, 'candidates');
  unsubCurrentCall = onSnapshot(callDoc(callId), async (snap) => {
    const data = snap.data();
    if (!data) return;
    if (data.status === 'accepted' && data.answer && pc.signalingState !== 'stable' && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
    if (data.status === 'declined' || data.status === 'ended') {
      toast(data.status === 'declined' ? 'Chamada recusada.' : 'Chamada encerrada.');
      endCall(false);
      return;
    }
    await handleRenegoSnapshot(pc, data, auth.currentUser.uid, (answerDesc, answerFor) =>
      updateDoc(callDoc(callId), { renegoAnswer: answerDesc, renegoAnswerFor: answerFor }));
  });

  onSnapshot(candidatesCol, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const c = change.doc.data();
        if (c.senderId !== auth.currentUser.uid) {
          pc.addIceCandidate(new RTCIceCandidate(c.candidate)).catch(() => {});
        }
      }
    });
  });

  // O envio de candidatos locais (pc.onicecandidate) agora é montado em
  // startDmCall/acceptIncomingCall, antes da oferta/resposta ser criada —
  // ver comentário lá. Aqui só ficamos responsáveis por RECEBER os
  // candidatos remotos (acima).
}

export async function hangupCall() {
  if (!state.activeCall) return;
  if (state.activeCall.kind === 'dm' && state.activeCall.id) {
    await updateDoc(callDoc(state.activeCall.id), { status: 'ended' }).catch(() => {});
  } else if (state.activeCall.kind === 'voiceChannel') {
    await leaveVoiceChannel();
    return;
  }
  endCall(true);
}

function endCall(closeConnection) {
  stopScreenShare(false);
  if (state.activeCall && closeConnection && state.activeCall.pc) {
    try { state.activeCall.pc.close(); } catch (e) {}
  }
  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  if (unsubCurrentCall) { unsubCurrentCall(); unsubCurrentCall = null; }
  dmCameraTrackId = null;
  const wasDm = !!(state.activeCall && state.activeCall.kind === 'dm');
  state.activeCall = null;
  stopCallTimer();
  if (wasDm) closeCallScreen();
  hideCallBar();
}

// ============================================================
// Canais de voz (mesh simples — adequado para grupos pequenos)
// ============================================================

export async function joinVoiceChannel(serverId, channelId, name) {
  if (state.activeCall) await hangupCall();
  localStream = await getLocalStream(false);
  const uid = auth.currentUser.uid;
  state.activeCall = { kind: 'voiceChannel', id: channelId, serverId, remoteStreams: new Map(), screenSharing: false };

  await setDoc(doc(db, 'servers', serverId, 'channels', channelId, 'voicePresence', uid), {
    displayName: state.user.displayName || state.user.username,
    avatarUrl: state.user.avatarUrl || '',
    joinedAt: serverTimestamp(),
    muted: false,
  });

  showCallBar(`Sala de voz: ${name}`);

  const presenceQ = voicePresenceCol(serverId, channelId);
  unsubVoicePresence = onSnapshot(presenceQ, (snap) => {
    const presentUids = new Set();
    snap.forEach((d) => presentUids.add(d.id));
    renderVoiceMembersList(channelId, snap);

    // Conecta com novos peers presentes (o uid "menor" inicia a oferta, evitando ofertas duplicadas)
    presentUids.forEach((otherUid) => {
      if (otherUid === uid || voicePeers.has(otherUid)) return;
      const iInitiate = uid < otherUid;
      connectVoicePeer(serverId, channelId, otherUid, iInitiate);
    });
    // Remove peers que saíram
    voicePeers.forEach((pc, otherUid) => {
      if (!presentUids.has(otherUid)) disconnectVoicePeer(otherUid);
    });
  });
}

function connectVoicePeer(serverId, channelId, otherUid, iInitiate) {
  const uid = auth.currentUser.uid;
  const pairId = [uid, otherUid].sort().join('_');
  const sigDoc = doc(db, 'servers', serverId, 'channels', channelId, 'voiceSignaling', pairId);

  const pc = new RTCPeerConnection(ICE_SERVERS);
  voicePeers.set(otherUid, pc);
  localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));

  pc.ontrack = (e) => {
    if (e.track.kind === 'audio') {
      let audioEl = document.getElementById(`gk-voice-audio-${otherUid}`);
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = `gk-voice-audio-${otherUid}`;
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = e.streams[0];
    } else if (e.track.kind === 'video') {
      // Em canais de voz não há câmera — qualquer track de vídeo é uma tela compartilhada.
      const memberData = state.serverMembersCache.get(serverId)?.get(otherUid)?.user;
      renderRemoteScreenTile(otherUid, e.streams[0], memberData);
      e.track.onended = () => removeRemoteScreenTile(otherUid);
    }
  };

  const candCol = collection(db, sigDoc.path, 'candidates');
  pc.onicecandidate = (e) => {
    if (e.candidate) addDoc(candCol, { senderId: uid, candidate: e.candidate.toJSON() });
  };

  attachRenegotiation(pc, {
    onOffer: (offerDesc) => setDoc(sigDoc, { renegoOffer: offerDesc, renegoBy: uid }, { merge: true }),
  });

  const unsubSig = onSnapshot(sigDoc, async (snap) => {
    const data = snap.data();
    if (!data) return;
    if (!iInitiate && data.offer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.offer));
      const answer = await pc.createAnswer();
      await pc.setLocalDescription(answer);
      await updateDoc(sigDoc, { answer: { type: answer.type, sdp: answer.sdp } });
    }
    if (iInitiate && data.answer && !pc.currentRemoteDescription) {
      await pc.setRemoteDescription(new RTCSessionDescription(data.answer));
    }
    await handleRenegoSnapshot(pc, data, uid, (answerDesc, answerFor) =>
      updateDoc(sigDoc, { renegoAnswer: answerDesc, renegoAnswerFor: answerFor }));
  });
  const unsubCand = onSnapshot(candCol, (snap) => {
    snap.docChanges().forEach((change) => {
      if (change.type === 'added') {
        const c = change.doc.data();
        if (c.senderId !== uid) pc.addIceCandidate(new RTCIceCandidate(c.candidate)).catch(() => {});
      }
    });
  });
  voiceUnsubs.set(otherUid, () => { unsubSig(); unsubCand(); });

  if (iInitiate) {
    (async () => {
      await setDoc(sigDoc, { offerBy: uid }, { merge: true });
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      await updateDoc(sigDoc, { offer: { type: offer.type, sdp: offer.sdp } });
    })();
  }
}

function disconnectVoicePeer(otherUid) {
  const pc = voicePeers.get(otherUid);
  if (pc) { try { pc.close(); } catch (e) {} voicePeers.delete(otherUid); }
  const unsub = voiceUnsubs.get(otherUid);
  if (unsub) { unsub(); voiceUnsubs.delete(otherUid); }
  document.getElementById(`gk-voice-audio-${otherUid}`)?.remove();
  removeRemoteScreenTile(otherUid);
}

function renderVoiceMembersList(channelId, snap) {
  const box = document.getElementById(`gk-voice-members-${channelId}`);
  if (!box) return;
  box.innerHTML = '';
  snap.forEach((d) => {
    const m = d.data();
    box.appendChild(el('div', { class: 'gk-voice-member', id: `gk-voice-member-${d.id}` }, [
      el('img', { src: m.avatarUrl || fallbackAvatar(m.displayName) }),
      el('span', {}, m.displayName),
    ]));
  });
}

export async function leaveVoiceChannel() {
  if (!state.activeCall || state.activeCall.kind !== 'voiceChannel') return;
  stopScreenShare(false);
  const { serverId, id: channelId } = state.activeCall;
  const uid = auth.currentUser.uid;
  voicePeers.forEach((_, otherUid) => disconnectVoicePeer(otherUid));

  // Remove o próprio doc de presença ANTES de desligar o listener, para que
  // o onSnapshot ainda capture essa mudança e re-renderize a lista sem nós.
  await deleteDoc(doc(db, 'servers', serverId, 'channels', channelId, 'voicePresence', uid)).catch(() => {});
  if (unsubVoicePresence) { unsubVoicePresence(); unsubVoicePresence = null; }

  // Limpa a UI imediatamente também, sem depender do round-trip do Firestore
  // (evita a sala mostrar por alguns instantes/indefinidamente que ainda estamos nela).
  document.getElementById(`gk-voice-member-${uid}`)?.remove();

  if (localStream) { localStream.getTracks().forEach((t) => t.stop()); localStream = null; }
  endCall(false);
}

// ============================================================
// Compartilhamento de tela
// ============================================================

export function isScreenSharing() {
  return !!screenStream;
}

export async function startScreenShare() {
  if (!state.activeCall) { toast('Entre em uma chamada ou canal de voz antes de compartilhar a tela.'); return; }
  if (screenStream) return;
  try {
    screenStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 30 }, audio: true });
  } catch (e) {
    return; // usuário cancelou o seletor de tela/janela
  }
  const screenTrack = screenStream.getVideoTracks()[0];
  screenTrack.onended = () => stopScreenShare();

  const pcs = state.activeCall.kind === 'dm' ? [state.activeCall.pc] : [...voicePeers.values()];
  for (const pc of pcs) {
    screenStream.getTracks().forEach((t) => pc.addTrack(t, screenStream));
  }

  state.activeCall.screenSharing = true;
  renderLocalScreenTile(screenStream);
  updateScreenShareButton(true);
  toast('Compartilhamento de tela iniciado.');
}

export function stopScreenShare(showToast = true) {
  if (!screenStream) return;
  screenStream.getTracks().forEach((t) => t.stop());
  const pcs = state.activeCall && state.activeCall.kind === 'dm' ? [state.activeCall.pc] : [...voicePeers.values()];
  const trackIds = new Set(screenStream.getTracks().map((t) => t.id));
  for (const pc of pcs) {
    pc.getSenders().forEach((sender) => {
      if (sender.track && trackIds.has(sender.track.id)) pc.removeTrack(sender);
    });
  }
  screenStream = null;
  if (state.activeCall) state.activeCall.screenSharing = false;
  removeLocalScreenTile();
  updateScreenShareButton(false);
  if (showToast) toast('Compartilhamento de tela encerrado.');
}

function renderLocalScreenTile(stream) {
  const grid = document.getElementById('gk-screenshare-grid');
  grid.classList.add('gk-open');
  let tile = document.getElementById('gk-screenshare-local');
  if (!tile) {
    tile = el('div', { class: 'gk-screenshare-tile', id: 'gk-screenshare-local' }, [
      el('video', { autoplay: 'true', muted: 'true', playsinline: 'true' }),
      el('span', { class: 'gk-screenshare-label' }, 'Sua tela'),
    ]);
    grid.appendChild(tile);
  }
  tile.querySelector('video').srcObject = stream;
}
function removeLocalScreenTile() {
  document.getElementById('gk-screenshare-local')?.remove();
  maybeHideScreenGrid();
}
function renderRemoteScreenTile(otherUid, stream, userData) {
  const grid = document.getElementById('gk-screenshare-grid');
  grid.classList.add('gk-open');
  let tile = document.getElementById(`gk-screenshare-${otherUid}`);
  if (!tile) {
    tile = el('div', { class: 'gk-screenshare-tile', id: `gk-screenshare-${otherUid}` }, [
      el('video', { autoplay: 'true', playsinline: 'true' }),
      el('span', { class: 'gk-screenshare-label' }, `Tela de ${userData?.displayName || userData?.username || 'alguém'}`),
    ]);
    grid.appendChild(tile);
  }
  tile.querySelector('video').srcObject = stream;
}
function removeRemoteScreenTile(otherUid) {
  document.getElementById(`gk-screenshare-${otherUid}`)?.remove();
  maybeHideScreenGrid();
}
function maybeHideScreenGrid() {
  const grid = document.getElementById('gk-screenshare-grid');
  if (grid && !grid.children.length) grid.classList.remove('gk-open');
}
function updateScreenShareButton(active) {
  ['gk-call-screenshare-btn', 'gk-call-bar-screenshare-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.classList.toggle('gk-active', active);
    btn.title = active ? 'Parar compartilhamento de tela' : 'Compartilhar tela';
  });
}

// ============================================================
// UI compartilhada de chamada
// ============================================================

function wirePeerConnection(pc, onConnected) {
  pc.ontrack = (e) => {
    if (e.track.kind === 'audio') {
      let audioEl = document.getElementById('gk-remote-dm-audio');
      if (!audioEl) {
        audioEl = document.createElement('audio');
        audioEl.id = 'gk-remote-dm-audio';
        audioEl.autoplay = true;
        document.body.appendChild(audioEl);
      }
      audioEl.srcObject = e.streams[0];
      return;
    }
    // Vídeo: o primeiro que chega é tratado como "principal" (câmera, se a chamada tiver vídeo);
    // qualquer vídeo adicional é compartilhamento de tela do outro lado.
    const grid = document.getElementById('gk-call-video-grid');
    if (!document.getElementById('gk-remote-video')) {
      const videoEl = document.createElement('video');
      videoEl.id = 'gk-remote-video';
      videoEl.autoplay = true;
      videoEl.playsInline = true;
      grid.appendChild(videoEl);
      videoEl.srcObject = e.streams[0];
      grid.classList.add('gk-open');
      // O outro lado ligou a câmera (ou a chamada já era de vídeo) — troca
      // a visão de avatar pulsando pela grade de vídeo, como no Discord.
      setCallLayout('video');
    } else {
      const label = state.activeCall?.peer?.displayName || 'alguém';
      renderRemoteScreenTile(state.activeCall?.remoteUid || 'peer', e.streams[0], { displayName: label });
      e.track.onended = () => removeRemoteScreenTile(state.activeCall?.remoteUid || 'peer');
    }
  };
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'connected') onConnected && onConnected();
  };
}

// ---------- Tela cheia de chamada de DM (estilo Discord/Skype) ----------

function openCallScreen({ peer, withVideo, statusText }) {
  const avatarSrc = peer.avatarUrl || fallbackAvatar(peer.displayName || peer.username);
  document.getElementById('gk-call-avatar-img').src = avatarSrc;
  document.getElementById('gk-call-peer-name').textContent = peer.displayName || peer.username || 'Chamada';
  document.getElementById('gk-call-screen-bg').style.backgroundImage = `url(${avatarSrc})`;
  setCallStatusText(statusText);

  const selfVideo = document.getElementById('gk-call-self-video');
  selfVideo.srcObject = localStream;
  document.getElementById('gk-call-self-pip').style.display = withVideo ? 'block' : 'none';
  setCallLayout(withVideo ? 'video' : 'audio');

  updateMuteButtons(false);
  updateCameraButtons(withVideo);
  updateScreenShareButton(false);

  document.getElementById('gk-call-bar').classList.remove('gk-open');
  document.getElementById('gk-call-screen').classList.add('gk-open');
}

function onDmCallConnected() {
  if (!state.activeCall) return;
  startCallTimer();
  renderCallBar(state.activeCall.peer?.displayName || 'alguém');
}

function setCallLayout(mode) {
  const audioView = document.getElementById('gk-call-audio-view');
  const videoGrid = document.getElementById('gk-call-video-grid');
  if (!audioView || !videoGrid) return;
  if (mode === 'video') {
    audioView.style.display = 'none';
    videoGrid.classList.add('gk-open');
  } else {
    audioView.style.display = 'flex';
    videoGrid.classList.remove('gk-open');
  }
}

function setCallStatusText(text) {
  const top = document.getElementById('gk-call-screen-status');
  if (top) top.textContent = text;
  const sub = document.getElementById('gk-call-peer-sub');
  if (sub) sub.textContent = text;
}

function startCallTimer() {
  callStartedAt = Date.now();
  stopCallTimer();
  setCallStatusText('00:00');
  callTimerInterval = setInterval(() => {
    const secs = Math.floor((Date.now() - callStartedAt) / 1000);
    const mm = String(Math.floor(secs / 60)).padStart(2, '0');
    const ss = String(secs % 60).padStart(2, '0');
    setCallStatusText(`${mm}:${ss}`);
  }, 1000);
}
function stopCallTimer() {
  if (callTimerInterval) { clearInterval(callTimerInterval); callTimerInterval = null; }
  callStartedAt = null;
}

function closeCallScreen() {
  document.getElementById('gk-call-screen').classList.remove('gk-open');
  const selfVideo = document.getElementById('gk-call-self-video');
  if (selfVideo) selfVideo.srcObject = null;
  document.getElementById('gk-call-self-pip').style.display = 'none';
}

function minimizeCallScreen() {
  if (!state.activeCall || state.activeCall.kind !== 'dm') return;
  document.getElementById('gk-call-screen').classList.remove('gk-open');
  showCallBar(`Em chamada com ${state.activeCall.peer?.displayName || 'alguém'}`);
}

function expandCallScreen() {
  if (!state.activeCall || state.activeCall.kind !== 'dm') return;
  document.getElementById('gk-call-bar').classList.remove('gk-open');
  document.getElementById('gk-call-screen').classList.add('gk-open');
}

function updateMuteButtons(muted) {
  const icon = muted ? '🔇' : '🎤';
  ['gk-call-mute-btn', 'gk-call-bar-mute-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.textContent = icon;
  });
}

function updateCameraButtons(on) {
  const btn = document.getElementById('gk-call-camera-btn');
  if (!btn) return;
  const isDm = state.activeCall?.kind === 'dm';
  btn.style.display = isDm ? 'flex' : 'none';
  btn.textContent = on ? '🎥' : '📷';
  btn.title = on ? 'Desativar câmera' : 'Ativar câmera';
  btn.classList.toggle('gk-active', !!on);
}

async function toggleCameraInCall() {
  if (!state.activeCall || state.activeCall.kind !== 'dm' || !localStream) return;
  let videoTrack = localStream.getVideoTracks()[0];

  if (videoTrack) {
    // Já existe uma track de câmera nesta chamada — apenas ativa/desativa.
    videoTrack.enabled = !videoTrack.enabled;
    updateCameraButtons(videoTrack.enabled);
    document.getElementById('gk-call-self-pip').style.display = videoTrack.enabled ? 'block' : 'none';
    setCallLayout(videoTrack.enabled ? 'video' : (document.getElementById('gk-remote-video') ? 'video' : 'audio'));
    return;
  }

  // Chamada começou só de voz — pede a câmera agora e "sobe de nível" para
  // vídeo, adicionando a nova track à conexão já existente (isso dispara
  // a renegociação automática configurada em attachRenegotiation).
  try {
    const prefs = getMediaPrefs();
    const camStream = await navigator.mediaDevices.getUserMedia({
      video: prefs.camId ? { deviceId: { exact: prefs.camId } } : true,
    });
    videoTrack = camStream.getVideoTracks()[0];
    localStream.addTrack(videoTrack);
    dmCameraTrackId = videoTrack.id;
    if (state.activeCall.pc) state.activeCall.pc.addTrack(videoTrack, localStream);
    state.activeCall.withVideo = true;

    document.getElementById('gk-call-self-video').srcObject = localStream;
    document.getElementById('gk-call-self-pip').style.display = 'block';
    setCallLayout('video');
    updateCameraButtons(true);
  } catch (e) {
    toast('Não foi possível acessar a câmera.', 'danger');
  }
}

function showCallBar(label) {
  const bar = document.getElementById('gk-call-bar');
  document.getElementById('gk-call-bar-label').textContent = label;
  bar.classList.add('gk-open');
  const expandBtn = document.getElementById('gk-call-bar-expand-btn');
  if (expandBtn) expandBtn.style.display = state.activeCall?.kind === 'dm' ? 'inline-flex' : 'none';
  updateScreenShareButton(false);
}
function renderCallBar(label) {
  // Mantém o texto da barra minimizada atualizado mesmo enquanto ela está
  // escondida (tela cheia aberta) — assim, ao minimizar, o texto já está certo.
  const labelEl = document.getElementById('gk-call-bar-label');
  if (labelEl) labelEl.textContent = `Em chamada com ${label}`;
}
function hideCallBar() {
  document.getElementById('gk-call-bar').classList.remove('gk-open');
  document.getElementById('gk-call-video-grid').classList.remove('gk-open');
  document.getElementById('gk-call-video-grid').innerHTML = '';
  document.getElementById('gk-remote-dm-audio')?.remove();
  document.getElementById('gk-remote-video')?.remove();
  document.getElementById('gk-screenshare-grid').classList.remove('gk-open');
  document.getElementById('gk-screenshare-grid').innerHTML = '';
}

export function wireCallBar() {
  document.getElementById('gk-call-hangup-btn').addEventListener('click', hangupCall);
  document.getElementById('gk-call-bar-hangup-btn').addEventListener('click', hangupCall);

  document.getElementById('gk-call-mute-btn').addEventListener('click', toggleMute);
  document.getElementById('gk-call-bar-mute-btn').addEventListener('click', toggleMute);

  document.getElementById('gk-call-camera-btn').addEventListener('click', toggleCameraInCall);

  document.getElementById('gk-call-screenshare-btn').addEventListener('click', toggleScreenShareBtn);
  document.getElementById('gk-call-bar-screenshare-btn').addEventListener('click', toggleScreenShareBtn);

  document.getElementById('gk-call-minimize-btn').addEventListener('click', minimizeCallScreen);
  document.getElementById('gk-call-bar-expand-btn').addEventListener('click', expandCallScreen);

  document.getElementById('gk-call-btn').addEventListener('click', () => startDmCall(false));
  document.getElementById('gk-video-call-btn').addEventListener('click', () => startDmCall(true));
}

function toggleMute() {
  if (!localStream) return;
  const track = localStream.getAudioTracks()[0];
  if (!track) return;
  track.enabled = !track.enabled;
  updateMuteButtons(!track.enabled);
}
function toggleScreenShareBtn() {
  if (isScreenSharing()) stopScreenShare(); else startScreenShare();
}
