// ============================================================
// G.K.IO — Chamadas de voz/vídeo + compartilhamento de tela
// Migrado de WebRTC "cru" (RTCPeerConnection + sinalização manual
// via Firestore) para o LiveKit — um SFU (Selective Forwarding
// Unit) hospedado. Isso resolve dois problemas do modelo anterior:
//
//   1. Sem STUN/TURN público não dava pra atravessar NAT restritivo
//      (CGNAT, redes móveis) — ninguém ouvia ninguém e a tela ficava
//      preta quando os dois lados estavam em redes diferentes. O
//      LiveKit já inclui relay de mídia na própria infraestrutura,
//      então isso deixa de depender de STUN/TURN configurado por nós.
//   2. Canal de voz em malha P2P não escalava além de ~5 pessoas —
//      com um SFU, cada participante manda mídia só pra UM lugar (o
//      servidor), que redistribui — escala bem mais.
//
// Autenticação: o navegador NUNCA fala direto com a "API secret" do
// LiveKit. Ele pede um token pro nosso Cloudflare Worker (ver
// cloudflare-worker/token-server.js), mandando o próprio ID token do
// Firebase Auth — o Worker confere que esse ID token é legítimo e
// só então devolve um token do LiveKit com identity = uid confirmado.
//
// O Firestore continua em uso só para o "toca / não toca" da chamada
// de DM (o convite, tocando, aceitar/recusar) — depois que os dois
// lados entram na mesma sala do LiveKit, toda a troca de mídia em si
// passa a ser gerenciada pelo SDK do LiveKit, sem mais nenhuma troca
// manual de offer/answer/ICE candidates.
// ============================================================
import { Room, RoomEvent, Track, LocalVideoTrack } from 'https://esm.sh/livekit-client@2';
import {
  auth, db, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, serverTimestamp,
  callsCol, callDoc, userDoc,
} from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { getMediaPrefs } from './prefs.js';
import { livekitConfig } from './livekit-config.js';
import { isNativeAndroid, startCallAudioMode, stopCallAudioMode, startNativeScreenCapture, stopNativeScreenCapture } from './native-bridge.js';

let room = null;               // instância única do LiveKit Room — só uma chamada ativa por vez
let unsubIncoming = null;
let unsubCurrentCall = null;

// Estado da tela cheia de chamada (DM) — cronômetro
let callTimerInterval = null;
let callStartedAt = null;

// ============================================================
// Token do LiveKit — pedido ao Cloudflare Worker a cada conexão
// (o token expira em 6h, então pedimos um novo por chamada em vez
// de tentar reaproveitar/cachear).
// ============================================================

async function fetchLiveKitToken({ room: roomName, name, metadata }) {
  if (!livekitConfig.tokenEndpoint || livekitConfig.tokenEndpoint.startsWith('COLE_AQUI')) {
    throw new Error('LiveKit não configurado — preencha js/livekit-config.js.');
  }
  const idToken = await auth.currentUser.getIdToken();
  const res = await fetch(livekitConfig.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${idToken}` },
    body: JSON.stringify({ room: roomName, name, metadata: metadata ? JSON.stringify(metadata) : undefined }),
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(errBody.error || 'Não foi possível obter acesso à chamada.');
  }
  return res.json(); // { token, url }
}

function captureDefaults() {
  const prefs = getMediaPrefs();
  return {
    audioCaptureDefaults: {
      deviceId: prefs.micId || undefined,
      echoCancellation: prefs.echoCancellation,
      noiseSuppression: prefs.noiseSuppression,
      autoGainControl: prefs.autoGainControl,
    },
    videoCaptureDefaults: {
      deviceId: prefs.camId || undefined,
    },
  };
}

// Conecta na sala do LiveKit (usada tanto por chamadas de DM quanto
// por canais de voz — a diferença de comportamento entre os dois
// fica nos handlers de evento, que consultam state.activeCall.kind).
async function connectToRoom({ roomName, withVideo, metadata }) {
  const { audioCaptureDefaults, videoCaptureDefaults } = captureDefaults();
  room = new Room({ adaptiveStream: true, dynacast: true, audioCaptureDefaults, videoCaptureDefaults });
  wireRoomEvents(room);

  const name = state.user.displayName || state.user.username;
  const { token, url } = await fetchLiveKitToken({ room: roomName, name, metadata });
  await room.connect(url, token);

  // Se já tinha alguém na sala quando entramos (ex: numa DM, o outro lado
  // costuma entrar primeiro, antes de "tocar"), o RoomEvent.ParticipantConnected
  // NUNCA dispara pra essa pessoa — esse evento só é emitido pra quem entra
  // DEPOIS de nós. Sem isso, a tela de quem atende uma chamada de DM ficava
  // presa em "Conectando..." pra sempre, mesmo com a mídia já fluindo normal.
  if (state.activeCall?.kind === 'dm' && room.remoteParticipants.size > 0) {
    onDmCallConnected();
  }

  await room.localParticipant.setMicrophoneEnabled(true, audioCaptureDefaults);
  if (withVideo) await room.localParticipant.setCameraEnabled(true, videoCaptureDefaults);

  const prefs = getMediaPrefs();
  if (prefs.speakerId && room.switchActiveDevice) {
    room.switchActiveDevice('audiooutput', prefs.speakerId).catch(() => {});
  }
  return room;
}

// Encontra a publicação de uma fonte específica (câmera, microfone,
// tela...) de um participante — evita depender de getters de
// conveniência cujo nome pode variar entre versões do SDK.
function findPublication(participant, source) {
  if (!participant) return null;
  for (const pub of participant.trackPublications.values()) {
    if (pub.source === source) return pub;
  }
  return null;
}
function isSourceOn(participant, source) {
  const pub = findPublication(participant, source);
  return !!(pub && pub.track && !pub.isMuted);
}

// ============================================================
// Eventos da sala — central única que atualiza a UI conforme
// participantes entram/saem e tracks são publicadas/assinadas.
// O comportamento muda conforme state.activeCall.kind ('dm' ou
// 'voiceChannel'), consultado dentro de cada handler.
// ============================================================

function wireRoomEvents(r) {
  r.on(RoomEvent.TrackSubscribed, (track, publication, participant) => handleTrackSubscribed(track, participant));
  r.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => handleTrackUnsubscribed(track, participant));
  r.on(RoomEvent.TrackMuted, (publication, participant) => {
    if (publication.source === Track.Source.Microphone) setTileMuted(participant.identity, true);
  });
  r.on(RoomEvent.TrackUnmuted, (publication, participant) => {
    if (publication.source === Track.Source.Microphone) setTileMuted(participant.identity, false);
  });
  r.on(RoomEvent.LocalTrackPublished, (publication) => handleLocalTrackPublished(publication));
  r.on(RoomEvent.LocalTrackUnpublished, (publication) => handleLocalTrackUnpublished(publication));
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    if (!state.activeCall) return;
    const speakingIds = new Set(speakers.map((p) => p.identity));
    const known = new Set([auth.currentUser.uid, ...Array.from(r.remoteParticipants.keys())]);
    known.forEach((uid) => setTileSpeaking(uid, speakingIds.has(uid)));
  });
  r.on(RoomEvent.ParticipantConnected, (participant) => onParticipantJoined(participant));
  r.on(RoomEvent.ParticipantDisconnected, (participant) => onParticipantLeft(participant));
  r.on(RoomEvent.Disconnected, () => {
    // A sala caiu (rede, kick, servidor) — garante que a UI local também limpe.
    if (state.activeCall) endCall(false);
  });
}

function handleTrackSubscribed(track, participant) {
  const otherUid = participant.identity;

  if (track.kind === Track.Kind.Audio) {
    if (track.source === Track.Source.ScreenShareAudio) {
      track.attach(); // áudio da tela compartilhada do outro lado — toca em segundo plano
      return;
    }
    const isVoiceChannel = state.activeCall?.kind === 'voiceChannel';
    const audioId = isVoiceChannel ? `gk-voice-audio-${otherUid}` : 'gk-remote-dm-audio';
    let audioEl = document.getElementById(audioId);
    if (!audioEl) {
      audioEl = track.attach();
      audioEl.id = audioId;
      audioEl.autoplay = true;
      document.body.appendChild(audioEl);
    } else {
      track.attach(audioEl);
    }
    return;
  }

  // Vídeo: distinguimos câmera de tela compartilhada pelo `track.source`
  // (o LiveKit já anuncia isso — nada de heurística por ordem de chegada).
  if (track.source === Track.Source.ScreenShare) {
    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.playsInline = true;
    track.attach(videoEl);
    const memberData = state.activeCall?.kind === 'voiceChannel'
      ? state.activeCall.participants.get(otherUid)
      : { displayName: state.activeCall?.peer?.displayName };
    renderRemoteScreenTile(otherUid, videoEl, memberData);
    return;
  }

  if (track.source === Track.Source.Camera) {
    if (state.activeCall?.kind === 'dm') {
      const grid = document.getElementById('gk-call-video-grid');
      let videoEl = document.getElementById('gk-remote-video');
      if (!videoEl) {
        videoEl = document.createElement('video');
        videoEl.id = 'gk-remote-video';
        videoEl.autoplay = true;
        videoEl.playsInline = true;
        grid.appendChild(videoEl);
        grid.classList.add('gk-open');
        setCallLayout('video');
      }
      track.attach(videoEl);
    } else if (state.activeCall?.kind === 'voiceChannel') {
      updateRemoteCameraTile(otherUid, track);
    }
  }
}

function handleTrackUnsubscribed(track, participant) {
  const otherUid = participant.identity;
  track.detach().forEach((elNode) => elNode.remove());
  if (track.source === Track.Source.ScreenShare) {
    removeRemoteScreenTile(otherUid);
  } else if (track.source === Track.Source.Camera) {
    clearRemoteCameraTile(otherUid);
  }
}

function handleLocalTrackPublished(pub) {
  if (pub.source === Track.Source.ScreenShare) {
    renderLocalScreenTile(pub.track);
    state.activeCall && (state.activeCall.screenSharing = true);
    markTileSharing(auth.currentUser.uid, true);
    updateScreenShareButton(true);
  } else if (pub.source === Track.Source.Camera) {
    attachLocalCameraTrack(pub.track);
    updateCameraButtons(true);
  }
}
function handleLocalTrackUnpublished(pub) {
  if (pub.source === Track.Source.ScreenShare) {
    removeLocalScreenTile();
    state.activeCall && (state.activeCall.screenSharing = false);
    markTileSharing(auth.currentUser.uid, false);
    updateScreenShareButton(false);
    if (isNativeAndroid()) stopNativeScreenCapture();
  } else if (pub.source === Track.Source.Camera) {
    detachLocalCameraTrack();
    updateCameraButtons(false);
  }
}

function onParticipantJoined(participant) {
  if (!state.activeCall) return;
  if (state.activeCall.kind === 'dm') {
    onDmCallConnected();
  } else if (state.activeCall.kind === 'voiceChannel') {
    upsertVoiceParticipant(participant);
  }
}
function onParticipantLeft(participant) {
  if (!state.activeCall) return;
  if (state.activeCall.kind === 'dm') {
    toast('Chamada encerrada.');
    endCall(true);
  } else if (state.activeCall.kind === 'voiceChannel') {
    removeVoiceParticipant(participant.identity);
  }
}

function setTileMuted(uid, muted) {
  document.getElementById(`gk-calltile-${uid}`)?.classList.toggle('gk-muted', muted);
  document.getElementById(`gk-voice-member-${uid}`)?.classList.toggle('gk-muted', muted);
  if (state.activeCall?.kind === 'voiceChannel' && state.activeCall.participants.has(uid)) {
    state.activeCall.participants.get(uid).muted = muted;
  }
}
function setTileSpeaking(uid, speaking) {
  document.getElementById(`gk-calltile-${uid}`)?.classList.toggle('gk-speaking', speaking);
  document.getElementById(`gk-voice-member-${uid}`)?.classList.toggle('gk-speaking', speaking);
}

// ============================================================
// Chamadas de DM (1:1) — o Firestore só cuida do "convite"
// (tocando / aceitar / recusar); a mídia em si é 100% LiveKit.
// ============================================================

export async function startDmCall(withVideo = false) {
  if (!state.currentDmId) { toast('Abra uma conversa antes de ligar.'); return; }
  if (state.activeCall) { toast('Você já está em uma chamada.'); return; }

  const dm = state.dms.get(state.currentDmId);
  if (!dm || !dm.other) return;

  const roomName = `dm-${state.currentDmId}`;
  const peer = { uid: dm.other.uid, displayName: dm.other.displayName || dm.other.username, avatarUrl: dm.other.avatarUrl || '' };
  state.activeCall = { kind: 'dm', id: null, dmId: state.currentDmId, remoteUid: dm.other.uid, withVideo, screenSharing: false, peer, roomName };

  openCallScreen({ peer, withVideo, statusText: 'Chamando...' });

  try {
    await connectToRoom({
      roomName, withVideo,
      metadata: { displayName: state.user.displayName || state.user.username, avatarUrl: state.user.avatarUrl || '' },
    });
  } catch (e) {
    toast(e.message || 'Não foi possível iniciar a chamada.', 'danger');
    endCall(true);
    return;
  }

  const callRef = await addDoc(callsCol(), {
    kind: 'dm', dmId: state.currentDmId,
    callerId: auth.currentUser.uid, calleeId: dm.other.uid,
    status: 'ringing', withVideo, roomName,
    createdAt: serverTimestamp(),
  });
  state.activeCall.id = callRef.id;
  listenCallDoc(callRef.id);
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
  const peer = { uid: call.callerId, displayName: caller.displayName || caller.username, avatarUrl: caller.avatarUrl || '' };
  state.activeCall = { kind: 'dm', id: call.id, dmId: call.dmId, remoteUid: call.callerId, withVideo: call.withVideo, screenSharing: false, peer, roomName: call.roomName };

  openCallScreen({ peer, withVideo: call.withVideo, statusText: 'Conectando...' });

  try {
    await connectToRoom({
      roomName: call.roomName, withVideo: call.withVideo,
      metadata: { displayName: state.user.displayName || state.user.username, avatarUrl: state.user.avatarUrl || '' },
    });
  } catch (e) {
    toast(e.message || 'Não foi possível entrar na chamada.', 'danger');
    endCall(true);
    return;
  }

  await updateDoc(callDoc(call.id), { status: 'accepted' }).catch(() => {});
  listenCallDoc(call.id);
}

async function declineIncomingCall(call) {
  document.getElementById('gk-incoming-call-overlay').classList.remove('gk-open');
  await updateDoc(callDoc(call.id), { status: 'declined' });
}

// Só precisa mais observar "recusou" ou "encerrou" enquanto ainda
// estamos tocando — depois que os dois lados entram na sala do
// LiveKit, quem detecta o fim da chamada é o próprio evento
// ParticipantDisconnected (ver onParticipantLeft acima).
function listenCallDoc(callId) {
  if (unsubCurrentCall) unsubCurrentCall();
  unsubCurrentCall = onSnapshot(callDoc(callId), (snap) => {
    const data = snap.data();
    if (!data) return;
    if (data.status === 'declined' || data.status === 'ended') {
      toast(data.status === 'declined' ? 'Chamada recusada.' : 'Chamada encerrada.');
      endCall(true);
    }
  });
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

function endCall(disconnectRoom) {
  stopCallAudioMode();
  if (disconnectRoom && room) { try { room.disconnect(); } catch (e) {} }
  room = null;
  if (unsubCurrentCall) { unsubCurrentCall(); unsubCurrentCall = null; }
  document.getElementById('gk-remote-dm-audio')?.remove();
  state.activeCall = null;
  stopCallTimer();
  closeCallScreen();
  hideCallBar();
}

// ============================================================
// Canais de voz de servidor — mesma sala do LiveKit, só que com N
// participantes em vez de 2. A lista de "quem está na sala" agora
// vem diretamente dos participantes do LiveKit (participant.metadata
// carrega displayName/avatarUrl/role — definido ao gerar o token),
// sem precisar mais de uma coleção própria no Firestore para isso.
// ============================================================

export async function joinVoiceChannel(serverId, channelId, name) {
  if (state.activeCall) await hangupCall();

  const roomName = `server-${serverId}-channel-${channelId}`;
  state.activeCall = {
    kind: 'voiceChannel', id: channelId, serverId, channelLabel: name, roomName,
    participants: new Map(),        // uid -> { displayName, avatarUrl, role, muted }
    remoteCameraStreams: new Map(), // uid -> Track (câmera) de cada participante
    screenSharingUids: new Set(),
    screenSharing: false,
  };

  showCallBar(`Sala de voz: ${name}`);

  try {
    await connectToRoom({
      roomName, withVideo: false,
      metadata: {
        displayName: state.user.displayName || state.user.username,
        avatarUrl: state.user.avatarUrl || '',
        role: state.user.role || 'free',
      },
    });
  } catch (e) {
    toast(e.message || 'Não foi possível entrar na sala de voz.', 'danger');
    state.activeCall = null;
    hideCallBar();
    return;
  }

  startCallAudioMode();
  upsertVoiceParticipant(room.localParticipant);
  room.remoteParticipants.forEach((p) => upsertVoiceParticipant(p));
}

function upsertVoiceParticipant(participant) {
  if (!state.activeCall || state.activeCall.kind !== 'voiceChannel') return;
  let meta = {};
  try { meta = participant.metadata ? JSON.parse(participant.metadata) : {}; } catch (e) { /* metadata malformado — segue com o padrão */ }
  state.activeCall.participants.set(participant.identity, {
    displayName: meta.displayName || participant.name || 'Membro',
    avatarUrl: meta.avatarUrl || '',
    role: meta.role || 'free',
    muted: !isSourceOn(participant, Track.Source.Microphone),
  });
  refreshVoiceUI();
}
function removeVoiceParticipant(uid) {
  if (!state.activeCall || state.activeCall.kind !== 'voiceChannel') return;
  state.activeCall.participants.delete(uid);
  state.activeCall.remoteCameraStreams.delete(uid);
  document.getElementById(`gk-voice-member-${uid}`)?.remove();
  document.getElementById(`gk-calltile-${uid}`)?.remove();
  document.getElementById(`gk-voice-audio-${uid}`)?.remove();
  removeRemoteScreenTile(uid);
  refreshVoiceUI();
}
function refreshVoiceUI() {
  if (!state.activeCall || state.activeCall.kind !== 'voiceChannel') return;
  renderVoiceMembersList(state.activeCall.id, state.activeCall.participants);
  renderParticipantsGridFromParticipants(state.activeCall.participants);
}

function renderVoiceMembersList(channelId, participantsMap) {
  const box = document.getElementById(`gk-voice-members-${channelId}`);
  if (!box) return;
  box.innerHTML = '';
  participantsMap.forEach((m, uid) => {
    box.appendChild(el('div', {
      class: 'gk-voice-member' + (m.muted ? ' gk-muted' : ''),
      id: `gk-voice-member-${uid}`,
      'data-role': m.role || 'free',
    }, [
      el('img', { src: m.avatarUrl || fallbackAvatar(m.displayName) }),
      el('span', {}, m.displayName),
      m.muted ? el('span', { class: 'gk-voice-member-mic-off', title: 'Mutado' }, '🔇') : null,
    ]));
  });
}

// ---------- Grid de participantes (tela cheia expandida, estilo Discord) ----------

function renderParticipantsGridFromParticipants(participantsMap) {
  const grid = document.getElementById('gk-call-participants-grid');
  if (!grid || !state.activeCall) return;
  const uid = auth.currentUser.uid;

  grid.innerHTML = '';
  participantsMap.forEach((data, otherUid) => {
    const isSelf = otherUid === uid;
    const cameraTrack = state.activeCall.remoteCameraStreams.get(otherUid);

    const tile = el('div', {
      class: 'gk-call-tile' + (cameraTrack ? ' gk-camera-on' : '') + (data.muted ? ' gk-muted' : ''),
      id: `gk-calltile-${otherUid}`,
    }, [
      el('video', { class: 'gk-call-tile-video', autoplay: 'true', playsinline: 'true', muted: isSelf ? 'true' : null }),
      el('div', { class: 'gk-call-tile-avatar-wrap' }, [el('img', { src: data.avatarUrl || fallbackAvatar(data.displayName) })]),
      el('div', { class: 'gk-call-tile-name' }, data.displayName || 'Membro'),
      el('div', { class: 'gk-call-tile-sharing-badge' }, 'Compartilhando tela'),
      el('div', { class: 'gk-call-tile-mic-off', title: 'Mutado' }, '🔇'),
      isSelf ? el('div', { class: 'gk-call-tile-you-badge' }, 'Você') : null,
    ]);
    grid.appendChild(tile);
    if (cameraTrack) cameraTrack.attach(tile.querySelector('.gk-call-tile-video'));
    if (state.activeCall.screenSharingUids?.has(otherUid)) tile.classList.add('gk-sharing');
  });
  syncScreenshareSpotlightClass();
}

function markTileSharing(targetUid, sharing) {
  if (state.activeCall) {
    if (!state.activeCall.screenSharingUids) state.activeCall.screenSharingUids = new Set();
    if (sharing) state.activeCall.screenSharingUids.add(targetUid);
    else state.activeCall.screenSharingUids.delete(targetUid);
  }
  document.getElementById(`gk-calltile-${targetUid}`)?.classList.toggle('gk-sharing', sharing);
}

function attachLocalCameraTrack(track) {
  if (state.activeCall?.kind === 'dm') {
    track.attach(document.getElementById('gk-call-self-video'));
    document.getElementById('gk-call-self-pip').style.display = 'block';
    setCallLayout('video');
  } else if (state.activeCall?.kind === 'voiceChannel') {
    const uid = auth.currentUser.uid;
    const tile = document.getElementById(`gk-calltile-${uid}`);
    if (tile) {
      tile.classList.add('gk-camera-on');
      track.attach(tile.querySelector('.gk-call-tile-video'));
    }
  }
}
function detachLocalCameraTrack() {
  if (state.activeCall?.kind === 'dm') {
    const v = document.getElementById('gk-call-self-video');
    if (v) v.srcObject = null;
    document.getElementById('gk-call-self-pip').style.display = 'none';
  } else if (state.activeCall?.kind === 'voiceChannel') {
    const uid = auth.currentUser.uid;
    const tile = document.getElementById(`gk-calltile-${uid}`);
    if (!tile) return;
    tile.classList.remove('gk-camera-on');
    const v = tile.querySelector('.gk-call-tile-video');
    if (v) v.srcObject = null;
  }
}

function updateRemoteCameraTile(otherUid, track) {
  if (state.activeCall) state.activeCall.remoteCameraStreams.set(otherUid, track);
  const tile = document.getElementById(`gk-calltile-${otherUid}`);
  if (!tile) return;
  tile.classList.add('gk-camera-on');
  track.attach(tile.querySelector('.gk-call-tile-video'));
}
function clearRemoteCameraTile(otherUid) {
  if (state.activeCall) state.activeCall.remoteCameraStreams.delete(otherUid);
  const tile = document.getElementById(`gk-calltile-${otherUid}`);
  if (!tile) return;
  tile.classList.remove('gk-camera-on');
  const video = tile.querySelector('.gk-call-tile-video');
  if (video) video.srcObject = null;
}

export async function leaveVoiceChannel() {
  if (!state.activeCall || state.activeCall.kind !== 'voiceChannel') return;
  const uid = auth.currentUser.uid;

  // Limpa a UI imediatamente, sem esperar o round-trip de desconexão
  // (evita a sala mostrar por alguns instantes que ainda estamos nela).
  document.getElementById(`gk-voice-member-${uid}`)?.remove();
  document.getElementById(`gk-calltile-${uid}`)?.remove();

  if (room) { try { await room.disconnect(); } catch (e) {} }
  room = null;
  endCall(false);
}

// ============================================================
// Compartilhamento de tela
// ============================================================

export function isScreenSharing() {
  return !!(room && isSourceOn(room.localParticipant, Track.Source.ScreenShare));
}

export async function startScreenShare() {
  if (!state.activeCall || !room) { toast('Entre em uma chamada ou canal de voz antes de compartilhar a tela.'); return; }
  if (isScreenSharing()) return;

  // Navegadores de celular (Chrome Android, Safari iOS) não implementam a
  // API que captura a tela (getDisplayMedia) — é uma limitação da própria
  // plataforma, não algo que dê pra contornar por código no navegador.
  // Só funciona em desktop ou dentro do app nativo Android (ver isNativeAndroid).
  if (!isNativeAndroid() && !navigator.mediaDevices?.getDisplayMedia) {
    toast('Compartilhar tela não é possível pelo navegador do celular — funciona no computador ou no app nativo.', 'danger');
    return;
  }

  try {
    if (isNativeAndroid()) {
      // Android (WebView) não tem getDisplayMedia() — usa o plugin nativo
      // de captura de tela (MediaProjection) via ponte de canvas, e
      // publica a track resultante manualmente na sala.
      const stream = await startNativeScreenCapture(12);
      const videoTrack = stream.getVideoTracks()[0];
      videoTrack.onended = () => stopScreenShare();
      const localTrack = new LocalVideoTrack(videoTrack);
      await room.localParticipant.publishTrack(localTrack, { source: Track.Source.ScreenShare, name: 'screen' });
    } else {
      await room.localParticipant.setScreenShareEnabled(true, { audio: true });
      const pub = findPublication(room.localParticipant, Track.Source.ScreenShare);
      if (pub?.track?.mediaStreamTrack) pub.track.mediaStreamTrack.onended = () => stopScreenShare();
    }
    toast('Compartilhamento de tela iniciado.');
  } catch (e) {
    // usuário cancelou o seletor de tela/janela ou negou a permissão — sem erro pro usuário
  }
}

export async function stopScreenShare(showToast = true) {
  if (!room || !isScreenSharing()) return;
  if (isNativeAndroid()) {
    const pub = findPublication(room.localParticipant, Track.Source.ScreenShare);
    if (pub) await room.localParticipant.unpublishTrack(pub.track, true);
  } else {
    await room.localParticipant.setScreenShareEnabled(false);
  }
  if (showToast) toast('Compartilhamento de tela encerrado.');
}

function renderLocalScreenTile(track) {
  const grid = document.getElementById('gk-screenshare-grid');
  grid.classList.add('gk-open');
  let tile = document.getElementById('gk-screenshare-local');
  if (!tile) {
    const videoEl = document.createElement('video');
    videoEl.autoplay = true;
    videoEl.muted = true;
    videoEl.playsInline = true;
    tile = el('div', { class: 'gk-screenshare-tile', id: 'gk-screenshare-local' }, [
      videoEl,
      el('span', { class: 'gk-screenshare-label' }, 'Sua tela'),
    ]);
    grid.appendChild(tile);
  }
  track.attach(tile.querySelector('video'));
  syncScreenshareSpotlightClass();
}
function removeLocalScreenTile() {
  document.getElementById('gk-screenshare-local')?.remove();
  maybeHideScreenGrid();
}
function renderRemoteScreenTile(otherUid, videoEl, userData) {
  const grid = document.getElementById('gk-screenshare-grid');
  grid.classList.add('gk-open');
  let tile = document.getElementById(`gk-screenshare-${otherUid}`);
  if (!tile) {
    tile = el('div', { class: 'gk-screenshare-tile', id: `gk-screenshare-${otherUid}` }, [
      videoEl,
      el('span', { class: 'gk-screenshare-label' }, `Tela de ${userData?.displayName || userData?.username || 'alguém'}`),
    ]);
    grid.appendChild(tile);
  }
  markTileSharing(otherUid, true);
  syncScreenshareSpotlightClass();
}
function removeRemoteScreenTile(otherUid) {
  document.getElementById(`gk-screenshare-${otherUid}`)?.remove();
  markTileSharing(otherUid, false);
  maybeHideScreenGrid();
}
function maybeHideScreenGrid() {
  const grid = document.getElementById('gk-screenshare-grid');
  if (grid && !grid.children.length) grid.classList.remove('gk-open');
  syncScreenshareSpotlightClass();
}
function syncScreenshareSpotlightClass() {
  const grid = document.getElementById('gk-screenshare-grid');
  const participantsGrid = document.getElementById('gk-call-participants-grid');
  if (!grid || !participantsGrid) return;
  const expanded = document.getElementById('gk-call-screen').classList.contains('gk-open');
  const isVoiceGrid = state.activeCall && state.activeCall.kind === 'voiceChannel';
  const inCallScreen = expanded && isVoiceGrid;
  grid.classList.toggle('gk-in-callscreen', inCallScreen);
  participantsGrid.classList.toggle('gk-has-spotlight', inCallScreen && grid.children.length > 0);
}
// Compartilhar tela só é possível no app nativo Android ou em navegadores
// desktop — em navegador de celular (Chrome Android, Safari iOS) a própria
// plataforma não oferece a API de captura de tela, então nem mostramos o
// botão nesse caso, pra não parecer uma função quebrada.
function screenShareSupported() {
  return isNativeAndroid() || !!navigator.mediaDevices?.getDisplayMedia;
}
function updateScreenShareButton(active) {
  const supported = screenShareSupported();
  ['gk-call-screenshare-btn', 'gk-call-bar-screenshare-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.style.display = supported ? '' : 'none';
    btn.classList.toggle('gk-active', active);
    btn.title = active ? 'Parar compartilhamento de tela' : 'Compartilhar tela';
  });
}

// ============================================================
// UI compartilhada de chamada
// ============================================================

function openCallScreen({ peer, withVideo, statusText }) {
  const avatarSrc = peer.avatarUrl || fallbackAvatar(peer.displayName || peer.username);
  document.getElementById('gk-call-avatar-img').src = avatarSrc;
  document.getElementById('gk-call-peer-name').textContent = peer.displayName || peer.username || 'Chamada';
  document.getElementById('gk-call-screen-bg').style.backgroundImage = `url(${avatarSrc})`;
  setCallStatusText(statusText);

  document.getElementById('gk-call-self-pip').style.display = 'none';
  setCallLayout(withVideo ? 'video' : 'audio');

  updateMuteButtons(false);
  updateCameraButtons(withVideo);
  updateScreenShareButton(false);

  document.getElementById('gk-call-bar').classList.remove('gk-open');
  document.getElementById('gk-call-screen').classList.add('gk-open');
}

function onDmCallConnected() {
  if (!state.activeCall || state.activeCall.kind !== 'dm') return;
  if (callStartedAt) return; // já conectado — evita reiniciar o cronômetro numa reconexão
  startCallTimer();
  renderCallBar(state.activeCall.peer?.displayName || 'alguém');
  startCallAudioMode();
}

function setCallLayout(mode) {
  const audioView = document.getElementById('gk-call-audio-view');
  const videoGrid = document.getElementById('gk-call-video-grid');
  const participantsGrid = document.getElementById('gk-call-participants-grid');
  if (!audioView || !videoGrid || !participantsGrid) return;
  audioView.style.display = mode === 'audio' ? 'flex' : 'none';
  videoGrid.classList.toggle('gk-open', mode === 'video');
  participantsGrid.classList.toggle('gk-open', mode === 'grid');
}

// ---------- Tela cheia de chamada de canal de voz (grid de participantes, estilo Discord) ----------

function openVoiceChannelCallScreen(name) {
  document.getElementById('gk-call-screen-bg').style.backgroundImage = '';
  setCallStatusText(`Sala de voz: ${name}`);
  document.getElementById('gk-call-self-pip').style.display = 'none';
  setCallLayout('grid');
  renderParticipantsGridFromParticipants(state.activeCall?.participants || new Map());

  updateMuteButtons(room ? !isSourceOn(room.localParticipant, Track.Source.Microphone) : false);
  updateCameraButtons(room ? isSourceOn(room.localParticipant, Track.Source.Camera) : false);
  updateScreenShareButton(isScreenSharing());

  document.getElementById('gk-call-bar').classList.remove('gk-open');
  document.getElementById('gk-call-screen').classList.add('gk-open');
  syncScreenshareSpotlightClass();
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
  if (!state.activeCall) return;
  document.getElementById('gk-call-screen').classList.remove('gk-open');
  syncScreenshareSpotlightClass();
  if (state.activeCall.kind === 'dm') {
    showCallBar(`Em chamada com ${state.activeCall.peer?.displayName || 'alguém'}`);
  } else {
    showCallBar(`Sala de voz: ${state.activeCall.channelLabel || ''}`);
  }
}

function expandCallScreen() {
  if (!state.activeCall) return;
  document.getElementById('gk-call-bar').classList.remove('gk-open');
  if (state.activeCall.kind === 'voiceChannel') {
    openVoiceChannelCallScreen(state.activeCall.channelLabel || 'Sala de voz');
  } else {
    document.getElementById('gk-call-screen').classList.add('gk-open');
  }
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
  btn.style.display = state.activeCall ? 'flex' : 'none';
  btn.textContent = on ? '🎥' : '📷';
  btn.title = on ? 'Desativar câmera' : 'Ativar câmera';
  btn.classList.toggle('gk-active', !!on);
}

async function toggleCameraInCall() {
  if (!room) return;
  const next = !isSourceOn(room.localParticipant, Track.Source.Camera);
  try {
    await room.localParticipant.setCameraEnabled(next, captureDefaults().videoCaptureDefaults);
  } catch (e) {
    toast('Não foi possível acessar a câmera.', 'danger');
  }
}

function showCallBar(label) {
  const bar = document.getElementById('gk-call-bar');
  document.getElementById('gk-call-bar-label').textContent = label;
  bar.classList.add('gk-open');
  const expandBtn = document.getElementById('gk-call-bar-expand-btn');
  if (expandBtn) expandBtn.style.display = 'inline-flex';
  updateScreenShareButton(isScreenSharing());
}
function renderCallBar(label) {
  const labelEl = document.getElementById('gk-call-bar-label');
  if (labelEl) labelEl.textContent = `Em chamada com ${label}`;
}
function hideCallBar() {
  document.getElementById('gk-call-bar').classList.remove('gk-open');
  document.getElementById('gk-call-video-grid').classList.remove('gk-open');
  document.getElementById('gk-call-video-grid').innerHTML = '';
  document.getElementById('gk-call-participants-grid').classList.remove('gk-open', 'gk-has-spotlight');
  document.getElementById('gk-call-participants-grid').innerHTML = '';
  document.getElementById('gk-remote-dm-audio')?.remove();
  document.getElementById('gk-remote-video')?.remove();
  document.getElementById('gk-screenshare-grid').classList.remove('gk-open', 'gk-in-callscreen');
  document.getElementById('gk-screenshare-grid').innerHTML = '';
  document.getElementById('gk-call-camera-btn').style.display = 'none';
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

async function toggleMute() {
  if (!room) return;
  const next = !isSourceOn(room.localParticipant, Track.Source.Microphone);
  await room.localParticipant.setMicrophoneEnabled(next, captureDefaults().audioCaptureDefaults);
  updateMuteButtons(!next);
  if (state.activeCall && state.activeCall.kind === 'voiceChannel') setTileMuted(auth.currentUser.uid, !next);
}
function toggleScreenShareBtn() {
  if (isScreenSharing()) stopScreenShare(); else startScreenShare();
}
