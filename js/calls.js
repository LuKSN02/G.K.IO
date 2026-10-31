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
import { Room, RoomEvent, Track, LocalVideoTrack, ConnectionQuality } from 'https://esm.sh/livekit-client@2';
import {
  auth, db, doc, addDoc, updateDoc, deleteDoc, getDoc,
  onSnapshot, query, where, serverTimestamp,
  callsCol, callDoc, userDoc,
} from './db.js';
import { state, el, toast, fallbackAvatar } from './state.js';
import { getMediaPrefs, setMediaPrefs, getHotkeyPrefs, screenShareOptions, SCREEN_QUALITIES } from './prefs.js';
import { applyMicProcessing, applyVideoFx, applyPersonVolume, setPersonVolume, getPersonVolume, openVolumePopover, VIDEO_EFFECTS, videoFxSupported } from './voice-fx.js';
import { CallStage, showRecordingModal, recordingSupported } from './call-stage.js';
import { initVoiceExtras, toggleExtrasPanel, resetVoiceExtras } from './voice-extras.js';
import { livekitConfig } from './livekit-config.js';
import { isNativeAndroid, startCallAudioMode, stopCallAudioMode, startNativeScreenCapture, stopNativeScreenCapture } from './native-bridge.js';
import { icon, iconHtml } from './icons.js';

let room = null;               // instância única do LiveKit Room — só uma chamada ativa por vez
// Ensurdecer: silencia TODO áudio recebido, e o microfone junto — mesmo
// comportamento do Discord. Desligar o ensurdecer não desmuta o
// microfone sozinho (precisa desmutar na mão); mas desmutar o microfone
// manualmente enquanto ensurdecido desliga o ensurdecer junto (ver
// toggleMute), porque não faz sentido falar sem conseguir ouvir.
let isDeafened = false;
let unsubIncoming = null;
let unsubCurrentCall = null;

// Estado da tela cheia de chamada (DM) — cronômetro
let callTimerInterval = null;
let callStartedAt = null;

// ============================================================
// Palco da chamada (js/call-stage.js) — grade de tiles:
// rostos, câmeras e transmissões de tela, com foco, hiperfoco, zoom,
// girar/espelhar, PiP, tela cheia, gravação, clip de 30 s e estatísticas.
// O palco só desenha; aqui ficam os "ganchos" que falam com o LiveKit.
// ============================================================
let stage = null;
const videoTracks = new Map();   // 'cam:uid' | 'scr:uid' -> Track de vídeo (LiveKit)
const audioTracks = new Map();   // 'cam:uid' | 'scr:uid' -> Track de áudio (microfone / áudio da tela)
const screenAudioEls = new Map(); // uid -> <audio> do áudio da tela compartilhada
const statPrev = new Map();

const volKey = (key) => (key.startsWith('scr:') ? `screen:${key.slice(4)}` : key.slice(4));
function audioElFor(key) {
  if (key.startsWith('scr:')) return screenAudioEls.get(key.slice(4)) || null;
  const uid = key.slice(4);
  return document.getElementById(`gk-voice-audio-${uid}`) || (state.activeCall?.remoteUid === uid ? document.getElementById('gk-remote-dm-audio') : null);
}

function ensureStage() {
  if (stage) return stage;
  const root = document.getElementById('gk-call-stage');
  if (!root) return null;
  stage = new CallStage(root, {
    getVolume: (key) => getPersonVolume(volKey(key)),
    setVolume: (key, pct) => setPersonVolume(volKey(key), pct, audioElFor(key)),
    getStream: (key) => {
      const tracks = [videoTracks.get(key), audioTracks.get(key)].filter(Boolean).map((t) => t.mediaStreamTrack).filter(Boolean);
      return tracks.length ? new MediaStream(tracks) : null;
    },
    getStats: statsFor,
    setWatching: (key, on) => setWatchingScreen(key.slice(4), on),
    onError: (m) => toast(m, 'danger'),
    onInfo: (m) => toast(m),
    onRecordingNotice: () => sendCallData('gk-rec', { on: true }),
    onLayout: () => syncDock(),
  });
  return stage;
}
function resetStage() {
  videoTracks.clear(); audioTracks.clear(); statPrev.clear();
  screenAudioEls.forEach((a) => { try { a.pause(); } catch (e) { /* ok */ } a.remove(); });
  screenAudioEls.clear();
  stage?.clear();
}

function setWatchingScreen(uid, on) {
  const p = room?.remoteParticipants?.get(uid);
  if (!p) return;
  for (const pub of p.trackPublications.values()) {
    if (pub.source === Track.Source.ScreenShare || pub.source === Track.Source.ScreenShareAudio) {
      try { pub.setSubscribed(on); } catch (e) { /* ok */ }
    }
  }
}

// Estatísticas de um tile (a partir do RTCStatsReport da track, quando o SDK oferece).
async function statsFor(key) {
  const track = videoTracks.get(key);
  if (!track?.getRTCStatsReport) return null;
  const report = await track.getRTCStatsReport();
  if (!report) return null;
  let rtp = null; let pair = null; const codecs = new Map(); const cands = new Map();
  report.forEach((r) => {
    if ((r.type === 'inbound-rtp' || r.type === 'outbound-rtp') && (r.kind === 'video' || r.mediaType === 'video')) rtp = rtp || r;
    else if (r.type === 'candidate-pair' && (r.nominated || r.state === 'succeeded') && r.currentRoundTripTime != null) pair = r;
    else if (r.type === 'codec') codecs.set(r.id, r);
    else if (r.type === 'local-candidate' || r.type === 'remote-candidate') cands.set(r.id, r);
  });
  if (!rtp) return null;
  const bytes = rtp.bytesReceived ?? rtp.bytesSent ?? 0;
  const now = performance.now();
  const prev = statPrev.get(key);
  statPrev.set(key, { bytes, now });
  const kbps = prev && now > prev.now ? ((bytes - prev.bytes) * 8) / (now - prev.now) : null;
  const lost = rtp.packetsLost ?? 0; const recv = rtp.packetsReceived ?? rtp.packetsSent ?? 0;
  const lc = pair && cands.get(pair.localCandidateId); const rc = pair && cands.get(pair.remoteCandidateId);
  const relayed = lc?.candidateType === 'relay' || rc?.candidateType === 'relay';
  return {
    fps: rtp.framesPerSecond ?? null,
    kbps,
    codec: codecs.get(rtp.codecId)?.mimeType?.replace('video/', '') || null,
    lossPct: recv + lost > 0 ? (lost / (recv + lost)) * 100 : 0,
    rttMs: pair?.currentRoundTripTime != null ? pair.currentRoundTripTime * 1000 : null,
    route: pair ? (relayed ? 'Via relay (TURN/SFU)' : 'Direta') : null,
  };
}

// ---- Mini-player: a transmissão em foco, flutuando quando a chamada está minimizada ----
let dockKey = null;
let dockTrack = null;
function syncDock() {
  const dock = document.getElementById('gkc-dock');
  if (!dock) return;
  const screenOpen = document.getElementById('gk-call-screen')?.classList.contains('gk-open');
  const prim = (!screenOpen && state.activeCall) ? stage?.primaryStream() : null;
  const track = prim ? videoTracks.get(prim.key) : null;
  if (!prim || !track) {
    if (dockTrack) { try { dockTrack.detach(document.getElementById('gkc-dock-video')); } catch (e) { /* ok */ } }
    dockTrack = null; dockKey = null;
    dock.classList.remove('gk-open');
    return;
  }
  const v = document.getElementById('gkc-dock-video');
  if (dockTrack !== track) {
    if (dockTrack) { try { dockTrack.detach(v); } catch (e) { /* ok */ } }
    track.attach(v); dockTrack = track; dockKey = prim.key;
  }
  document.getElementById('gkc-dock-label').textContent = prim.label || '';
  dock.classList.add('gk-open');
}
function wireDock() {
  const dock = document.getElementById('gkc-dock');
  if (!dock || dock._wired) return;
  dock._wired = true;
  let drag = null;
  dock.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return;
    const r = dock.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top, x: e.clientX, y: e.clientY, moved: false };
    dock.setPointerCapture(e.pointerId);
  });
  dock.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (Math.hypot(e.clientX - drag.x, e.clientY - drag.y) > 5) drag.moved = true;
    if (!drag.moved) return;
    dock.style.left = `${Math.max(8, Math.min(window.innerWidth - dock.offsetWidth - 8, e.clientX - drag.dx))}px`;
    dock.style.top = `${Math.max(8, Math.min(window.innerHeight - dock.offsetHeight - 8, e.clientY - drag.dy))}px`;
    dock.style.right = 'auto'; dock.style.bottom = 'auto';
  });
  dock.addEventListener('pointerup', () => { const moved = drag?.moved; drag = null; if (!moved) expandCallScreen(); });
  document.getElementById('gkc-dock-open')?.addEventListener('click', (e) => { e.stopPropagation(); expandCallScreen(); });
}

// Sincroniza TODAS as pessoas da sala no palco (nome, avatar, mic).
function personInfo(participant, isSelf) {
  let meta = {};
  try { meta = participant.metadata ? JSON.parse(participant.metadata) : {}; } catch (e) { /* metadata malformado */ }
  const peer = state.activeCall?.peer;
  const fallbackName = isSelf ? (state.user?.displayName || state.user?.username) : (peer && peer.uid === participant.identity ? peer.displayName : null);
  return {
    name: meta.displayName || participant.name || fallbackName || 'Membro',
    avatarUrl: meta.avatarUrl || (isSelf ? state.user?.avatarUrl : (peer && peer.uid === participant.identity ? peer.avatarUrl : '')) || '',
    isSelf,
    micMuted: !isSourceOn(participant, Track.Source.Microphone),
  };
}
function syncStagePeople() {
  if (!room || !ensureStage()) return;
  const me = auth.currentUser.uid;
  stage.upsertPerson(me, personInfo(room.localParticipant, true));
  room.remoteParticipants.forEach((p) => {
    stage.upsertPerson(p.identity, { ...personInfo(p, false), ringing: false });
    stage.setStatusLine(p.identity, '');
  });
}
// Antes do outro lado atender: o rosto dele já aparece, "tocando".
function seedDmPeer(peer, ringing) {
  if (!ensureStage()) return;
  stage.upsertPerson(auth.currentUser.uid, { name: state.user.displayName || state.user.username, avatarUrl: state.user.avatarUrl || '', isSelf: true, micMuted: false });
  stage.upsertPerson(peer.uid, { name: peer.displayName || peer.username || 'Chamada', avatarUrl: peer.avatarUrl || '', isSelf: false, micMuted: false, ringing });
  stage.setStatusLine(peer.uid, ringing ? 'Chamando...' : '');
}

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
      // Com a IA (RNNoise) ligada, a do navegador sai de cena para não filtrar duas vezes.
      noiseSuppression: prefs.noiseMode === 'browser' ? prefs.noiseSuppression : false,
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

  // No Android, o modo de áudio de chamada precisa estar ligado ANTES do
  // microfone começar a capturar — nos dois lados (quem liga e quem atende).
  // Antes, quem ligava abria o mic primeiro e o modo só entrava quando o
  // outro atendia, o que podia deixar o mic dessa pessoa mudo.
  await startCallAudioMode();
  await room.connect(url, token);

  // Política de autoplay dos navegadores: os <audio>/<video> criados por
  // track.attach() (em handleTrackSubscribed, mais abaixo) nascem depois
  // que essa Promise resolve — ou seja, já fora da pilha de chamada síncrona
  // do clique que iniciou/aceitou a chamada. Sem isso, o navegador bloqueia
  // o play() silenciosamente: a pessoa publica e recebe os tracks normalmente,
  // mas nenhum áudio realmente toca — em NENHUM dos dois lados. startAudio()
  // é o método do próprio LiveKit pra (re)tentar destravar isso; se ainda
  // assim falhar (Safari costuma ser mais estrito), o listener de
  // AudioPlaybackStatusChanged em wireRoomEvents cobre o resto pedindo um
  // clique extra.
  try { await room.startAudio(); } catch (e) { /* seguimos — o listener abaixo lida com isso */ }

  // Se já tinha alguém na sala quando entramos (ex: numa DM, o outro lado
  // costuma entrar primeiro, antes de "tocar"), o RoomEvent.ParticipantConnected
  // NUNCA dispara pra essa pessoa — esse evento só é emitido pra quem entra
  // DEPOIS de nós. Sem isso, a tela de quem atende uma chamada de DM ficava
  // presa em "Conectando..." pra sempre, mesmo com a mídia já fluindo normal.
  if (state.activeCall?.kind === 'dm' && room.remoteParticipants.size > 0) {
    onDmCallConnected();
  }

  syncStagePeople();
  await room.localParticipant.setMicrophoneEnabled(true, audioCaptureDefaults);
  await applyMicProcessing(room, Track, (m) => toast(m)); // supressão de ruído por IA, se escolhida
  // Push-to-talk ligado: entra com o microfone fechado até segurar a tecla.
  const hk = getHotkeyPrefs();
  if (hk.pttEnabled && hk.ptt) {
    await room.localParticipant.setMicrophoneEnabled(false, audioCaptureDefaults);
    updateMuteButtons(true);
  }
  if (withVideo) {
    await room.localParticipant.setCameraEnabled(true, videoCaptureDefaults);
    await applyVideoFx(room, Track, (m) => toast(m));
  }

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
  r.on(RoomEvent.TrackSubscribed, (track, publication, participant) => handleTrackSubscribed(track, participant, publication));
  r.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => handleTrackUnsubscribed(track, participant));
  r.on(RoomEvent.TrackPublished, (publication, participant) => {
    // A tela de alguém apareceu: já abre o tile (carregando) antes do vídeo chegar.
    if (publication.source === Track.Source.ScreenShare && ensureStage()) {
      stage.setScreen(participant.identity, null, { local: false });
    }
  });
  r.on(RoomEvent.TrackUnpublished, (publication, participant) => {
    if (publication.source === Track.Source.ScreenShare) { removeRemoteScreenTile(participant.identity); }
  });
  r.on(RoomEvent.TrackMuted, (publication, participant) => {
    if (publication.source === Track.Source.Microphone) setTileMuted(participant.identity, true);
    if (publication.source === Track.Source.Camera) stage?.setCamera(participant.identity, null);
  });
  r.on(RoomEvent.TrackUnmuted, (publication, participant) => {
    if (publication.source === Track.Source.Microphone) setTileMuted(participant.identity, false);
    if (publication.source === Track.Source.Camera && publication.track) {
      stage?.setCamera(participant.identity, publication.track);
    }
  });
  r.on(RoomEvent.LocalTrackPublished, (publication) => handleLocalTrackPublished(publication));
  r.on(RoomEvent.LocalTrackUnpublished, (publication) => handleLocalTrackUnpublished(publication));
  r.on(RoomEvent.ParticipantMetadataChanged, () => syncStagePeople());
  r.on(RoomEvent.ConnectionQualityChanged, (quality, participant) => {
    if (participant?.identity !== auth.currentUser?.uid) return;
    const box = document.getElementById('gk-call-quality');
    if (!box) return;
    const q = quality === ConnectionQuality.Lost ? 'lost' : (quality === ConnectionQuality.Poor ? 'poor' : 'good');
    box.dataset.q = q;
    box.querySelector('span').textContent = q === 'lost' ? 'Sem sinal' : q === 'poor' ? 'Instável' : (quality === ConnectionQuality.Excellent ? 'Excelente' : 'Boa');
  });
  r.on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
    if (!state.activeCall) return;
    const speakingIds = new Set(speakers.map((p) => p.identity));
    const known = new Set([auth.currentUser.uid, ...Array.from(r.remoteParticipants.keys())]);
    known.forEach((uid) => setTileSpeaking(uid, speakingIds.has(uid)));
  });
  // Canal de dados (soundboard, dados, jogos): quem mandou vem da conexão, não do conteúdo.
  r.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
    const fns = dataHandlers.get(topic);
    if (!fns || !participant) return;
    let msg = null;
    try { if (payload.byteLength <= 4096) msg = JSON.parse(new TextDecoder().decode(payload)); } catch (e) { return; }
    fns.forEach((fn) => { try { fn(msg, participant.identity); } catch (e) { console.warn('[chamada] handler de dados falhou', e); } });
  });
  r.on(RoomEvent.ParticipantConnected, (participant) => onParticipantJoined(participant));
  r.on(RoomEvent.ParticipantDisconnected, (participant) => onParticipantLeft(participant));
  r.on(RoomEvent.Disconnected, () => {
    // A sala caiu (rede, kick, servidor) — garante que a UI local também limpe.
    if (state.activeCall) endCall(false);
  });
  // Se o navegador bloqueou o autoplay do áudio remoto (mesmo depois do
  // startAudio() em connectToRoom — acontece principalmente no Safari),
  // avisa a pessoa e destrava no próximo clique em qualquer lugar da tela.
  r.on(RoomEvent.AudioPlaybackStatusChanged, () => {
    if (r.canPlaybackAudio) return;
    promptEnableAudioPlayback(r);
  });
}

let audioUnlockArmed = false;
function promptEnableAudioPlayback(r) {
  if (audioUnlockArmed) return;
  audioUnlockArmed = true;
  toast('Toque na tela para ativar o áudio da chamada.');
  const unlock = async () => {
    audioUnlockArmed = false;
    document.removeEventListener('click', unlock);
    try { await r.startAudio(); } catch (e) { /* tenta de novo no próximo clique, se ainda bloqueado */ }
  };
  document.addEventListener('click', unlock, { once: true });
}

function handleTrackSubscribed(track, participant, publication) {
  const otherUid = participant.identity;

  if (track.kind === Track.Kind.Audio) {
    if (track.source === Track.Source.ScreenShareAudio) {
      // Áudio da tela do outro lado: <audio> próprio, com volume/ganho independente (ver tile da tela).
      let a = screenAudioEls.get(otherUid);
      if (!a) { a = track.attach(); a.autoplay = true; screenAudioEls.set(otherUid, a); }
      else track.attach(a);
      a.muted = isDeafened;
      applyPersonVolume(a, `screen:${otherUid}`);
      audioTracks.set(`scr:${otherUid}`, track);
      a.play?.().catch(() => {});
      return;
    }
    audioTracks.set(`cam:${otherUid}`, track);
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
    audioEl.muted = isDeafened; // entra já mudo se a pessoa já estava ensurdecida
    applyPersonVolume(audioEl, otherUid); // volume que você ajustou para essa pessoa
    // Reforço além do autoplay: se o navegador rejeitar o play() aqui
    // (autoplay bloqueado), o listener de AudioPlaybackStatusChanged em
    // wireRoomEvents entra em ação e pede um clique pra destravar.
    audioEl.play?.().catch(() => {});
    return;
  }

  // Vídeo: distinguimos câmera de tela compartilhada pelo `track.source`
  // (o LiveKit já anuncia isso — nada de heurística por ordem de chegada).
  if (!ensureStage()) return;
  if (track.source === Track.Source.ScreenShare) {
    videoTracks.set(`scr:${otherUid}`, track);
    if (!stage.hasPerson(otherUid)) stage.upsertPerson(otherUid, { name: participant.name || 'Membro' });
    stage.setScreen(otherUid, track, { local: false, watching: true });
    return;
  }
  if (track.source === Track.Source.Camera) {
    videoTracks.set(`cam:${otherUid}`, track);
    if (!stage.hasPerson(otherUid)) syncStagePeople();
    if (!publication?.isMuted) stage.setCamera(otherUid, track);
    if (state.activeCall?.kind === 'voiceChannel') state.activeCall.remoteCameraStreams.set(otherUid, track);
  }
}

function handleTrackUnsubscribed(track, participant) {
  const otherUid = participant.identity;
  if (track.kind === Track.Kind.Audio) {
    if (track.source === Track.Source.ScreenShareAudio) {
      const a = screenAudioEls.get(otherUid);
      if (a) { track.detach(a); a.remove(); screenAudioEls.delete(otherUid); }
      audioTracks.delete(`scr:${otherUid}`);
    } else {
      audioTracks.delete(`cam:${otherUid}`);
      track.detach().forEach((n) => n.remove());
    }
    return;
  }
  if (track.source === Track.Source.ScreenShare) {
    videoTracks.delete(`scr:${otherUid}`);
    stage?.setScreen(otherUid, null); // o tile fica (placeholder) se foi você quem parou de assistir
    markTileSharing(otherUid, true);
  } else if (track.source === Track.Source.Camera) {
    videoTracks.delete(`cam:${otherUid}`);
    stage?.setCamera(otherUid, null);
    state.activeCall?.remoteCameraStreams?.delete(otherUid);
  }
}

function handleLocalTrackPublished(pub) {
  const me = auth.currentUser.uid;
  if (pub.source === Track.Source.ScreenShare) {
    if (ensureStage()) {
      if (!stage.hasPerson(me)) syncStagePeople();
      videoTracks.set(`scr:${me}`, pub.track);
      stage.setScreen(me, pub.track, { local: true, watching: true });
    }
    state.activeCall && (state.activeCall.screenSharing = true);
    markTileSharing(me, true);
    updateScreenShareButton(true);
  } else if (pub.source === Track.Source.Camera) {
    if (ensureStage()) {
      if (!stage.hasPerson(me)) syncStagePeople();
      videoTracks.set(`cam:${me}`, pub.track);
      stage.setCamera(me, pub.track);
    }
    updateCameraButtons(true);
  }
}
function handleLocalTrackUnpublished(pub) {
  const me = auth.currentUser.uid;
  if (pub.source === Track.Source.ScreenShare) {
    videoTracks.delete(`scr:${me}`);
    stage?.removeScreen(me);
    state.activeCall && (state.activeCall.screenSharing = false);
    markTileSharing(me, false);
    updateScreenShareButton(false);
    if (isNativeAndroid()) stopNativeScreenCapture();
  } else if (pub.source === Track.Source.Camera) {
    videoTracks.delete(`cam:${me}`);
    stage?.setCamera(me, null);
    updateCameraButtons(false);
  }
}

function onParticipantJoined(participant) {
  if (!state.activeCall) return;
  if (state.activeCall.kind === 'dm') {
    syncStagePeople();
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
  stage?.setMicMuted(uid, muted);
  document.getElementById(`gk-voice-member-${uid}`)?.classList.toggle('gk-muted', muted);
  if (state.activeCall?.kind === 'voiceChannel' && state.activeCall.participants.has(uid)) {
    state.activeCall.participants.get(uid).muted = muted;
  }
}
function setTileSpeaking(uid, speaking) {
  stage?.setSpeaking(uid, speaking);
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
  seedDmPeer(peer, true);

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
      } else if (change.type === 'removed') {
        // Quem ligou desistiu (ou outro aparelho atendeu): para de tocar.
        stopRingtone();
        document.getElementById('gk-incoming-call-overlay')?.classList.remove('gk-open');
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
      el('button', { class: 'gk-incoming-call-btn gk-incoming-decline', title: 'Recusar', onclick: () => declineIncomingCall(call) }, [icon('phoneEnd', { size: 20 })]),
      el('button', { class: 'gk-incoming-call-btn gk-incoming-accept', title: 'Atender', onclick: () => acceptIncomingCall(call, caller) }, [icon(call.withVideo ? 'videoCall' : 'phoneCall', { size: 20 })]),
    ]));
    overlay.classList.add('gk-open');
    startRingtone();
  });
}

async function acceptIncomingCall(call, caller) {
  stopRingtone();
  document.getElementById('gk-incoming-call-overlay').classList.remove('gk-open');
  const peer = { uid: call.callerId, displayName: caller.displayName || caller.username, avatarUrl: caller.avatarUrl || '' };
  state.activeCall = { kind: 'dm', id: call.id, dmId: call.dmId, remoteUid: call.callerId, withVideo: call.withVideo, screenSharing: false, peer, roomName: call.roomName };

  openCallScreen({ peer, withVideo: call.withVideo, statusText: 'Conectando...' });
  seedDmPeer(peer, false);

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
  stopRingtone();
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
  resetVoiceExtras();
  stopCallAudioMode();
  if (disconnectRoom && room) { try { room.disconnect(); } catch (e) {} }
  room = null;
  if (unsubCurrentCall) { unsubCurrentCall(); unsubCurrentCall = null; }
  document.getElementById('gk-remote-dm-audio')?.remove();
  document.querySelectorAll('audio[id^="gk-voice-audio-"]').forEach((n) => n.remove());
  isDeafened = false;
  updateDeafenButtons(false);
  state.activeCall = null;
  stopCallTimer();
  closeCallScreen();
  hideCallBar();
  stopCallRecording(true);
  resetStage();
  closeReactBar(); closeSettingsPanel();
  syncDock();
  stopRingtone();
  window.dispatchEvent(new CustomEvent('gkio-call-ended'));
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
    stopCallAudioMode();
    state.activeCall = null;
    hideCallBar();
    return;
  }

  try { await room.startAudio(); } catch (e) { /* listener de AudioPlaybackStatusChanged cobre o resto */ }
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
  stage?.removePerson(uid);
  videoTracks.delete(`cam:${uid}`); audioTracks.delete(`cam:${uid}`);
  document.getElementById(`gk-voice-audio-${uid}`)?.remove();
  removeRemoteScreenTile(uid);
  refreshVoiceUI();
}
function refreshVoiceUI() {
  if (!state.activeCall || state.activeCall.kind !== 'voiceChannel') return;
  renderVoiceMembersList(state.activeCall.id, state.activeCall.participants);
  syncStagePeople();
}

function renderVoiceMembersList(channelId, participantsMap) {
  const box = document.getElementById(`gk-voice-members-${channelId}`);
  if (!box) return;
  box.innerHTML = '';
  participantsMap.forEach((m, uid) => {
    const isMe = uid === auth.currentUser?.uid;
    box.appendChild(el('div', {
      class: 'gk-voice-member' + (m.muted ? ' gk-muted' : ''),
      id: `gk-voice-member-${uid}`,
      'data-role': m.role || 'free',
      title: isMe ? '' : 'Clique com o botão direito para ajustar o volume',
      oncontextmenu: isMe ? null : (e) => { e.preventDefault(); openVolumePopover(e.currentTarget, uid, m.displayName || 'Membro'); },
    }, [
      el('img', { src: m.avatarUrl || fallbackAvatar(m.displayName) }),
      el('span', {}, m.displayName),
      m.muted ? el('span', { class: 'gk-voice-member-mic-off', title: 'Mutado' }, [icon('micOff', { size: 12 })]) : null,
    ]));
  });
}

function markTileSharing(targetUid, sharing) {
  if (!state.activeCall) return;
  if (!state.activeCall.screenSharingUids) state.activeCall.screenSharingUids = new Set();
  if (sharing) state.activeCall.screenSharingUids.add(targetUid);
  else state.activeCall.screenSharingUids.delete(targetUid);
}

export async function leaveVoiceChannel() {
  if (!state.activeCall || state.activeCall.kind !== 'voiceChannel') return;
  const uid = auth.currentUser.uid;

  // Limpa a UI imediatamente, sem esperar o round-trip de desconexão
  // (evita a sala mostrar por alguns instantes que ainda estamos nela).
  document.getElementById(`gk-voice-member-${uid}`)?.remove();
  stage?.removePerson(uid);

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
      const { capture, publish } = screenShareOptions();
      await room.localParticipant.setScreenShareEnabled(true, { audio: true, ...capture }, publish);
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

function removeRemoteScreenTile(otherUid) {
  videoTracks.delete(`scr:${otherUid}`);
  stage?.removeScreen(otherUid);
  markTileSharing(otherUid, false);
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
  document.getElementById('gk-call-peer-name').textContent = peer.displayName || peer.username || 'Chamada';
  document.getElementById('gk-call-screen-bg').style.backgroundImage = `url(${avatarSrc})`;
  setCallStatusText(statusText);
  ensureStage()?.clear();
  wireDock();

  updateMuteButtons(false);
  updateCameraButtons(withVideo);
  updateScreenShareButton(false);

  document.getElementById('gk-call-bar').classList.remove('gk-open');
  document.getElementById('gk-call-screen').classList.add('gk-open');
  syncDock();
  stage?.layout();
}

function onDmCallConnected() {
  if (!state.activeCall || state.activeCall.kind !== 'dm') return;
  if (callStartedAt) return; // já conectado — evita reiniciar o cronômetro numa reconexão
  startCallTimer();
  renderCallBar(state.activeCall.peer?.displayName || 'alguém');
  startCallAudioMode();
  stopRingtone();
}

// ---------- Tela cheia de chamada de canal de voz (palco com todos os participantes) ----------

function openVoiceChannelCallScreen(name) {
  document.getElementById('gk-call-screen-bg').style.backgroundImage = '';
  document.getElementById('gk-call-peer-name').textContent = name;
  setCallStatusText(`Sala de voz`);
  ensureStage();
  wireDock();
  syncStagePeople();

  updateMuteButtons(room ? !isSourceOn(room.localParticipant, Track.Source.Microphone) : false);
  updateCameraButtons(room ? isSourceOn(room.localParticipant, Track.Source.Camera) : false);
  updateScreenShareButton(isScreenSharing());

  document.getElementById('gk-call-bar').classList.remove('gk-open');
  document.getElementById('gk-call-screen').classList.add('gk-open');
  syncDock();
  stage?.layout();
}

function setCallStatusText(text) {
  const top = document.getElementById('gk-call-screen-status');
  if (top) top.textContent = text;
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
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
}

function minimizeCallScreen() {
  if (!state.activeCall) return;
  if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  document.getElementById('gk-call-screen').classList.remove('gk-open');
  closeReactBar(); closeSettingsPanel();
  if (state.activeCall.kind === 'dm') {
    showCallBar(`Em chamada com ${state.activeCall.peer?.displayName || 'alguém'}`);
  } else {
    showCallBar(`Sala de voz: ${state.activeCall.channelLabel || ''}`);
  }
  syncDock();
}

export function expandCallScreen() {
  if (!state.activeCall) return;
  document.getElementById('gk-call-bar').classList.remove('gk-open');
  if (state.activeCall.kind === 'voiceChannel') {
    openVoiceChannelCallScreen(state.activeCall.channelLabel || 'Sala de voz');
  } else {
    document.getElementById('gk-call-screen').classList.add('gk-open');
    syncDock();
    stage?.layout();
  }
}

function updateMuteButtons(muted) {
  window.dispatchEvent(new CustomEvent('gkio-mic-state', { detail: { muted } }));
  const html = iconHtml(muted ? 'micOff' : 'mic');
  ['gk-call-mute-btn', 'gk-call-bar-mute-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) { btn.innerHTML = html; btn.classList.toggle('gkc-off', !!muted); }
  });
}

function updateDeafenButtons(deafened) {
  window.dispatchEvent(new CustomEvent('gkio-deafen-state', { detail: { deafened } }));
  const html = iconHtml(deafened ? 'headphonesOff' : 'headphones');
  ['gk-call-deafen-btn', 'gk-call-bar-deafen-btn'].forEach((id) => {
    const btn = document.getElementById(id);
    if (!btn) return;
    btn.innerHTML = html;
    btn.classList.toggle('gkc-off', !!deafened);
    btn.title = deafened ? 'Parar de ensurdecer' : 'Ensurdecer (silencia tudo)';
  });
}

// Muta/desmuta todo áudio já tocando na chamada atual — tanto o de uma
// DM (um elemento) quanto o de uma sala de voz (um por participante).
function applyDeafenToAudioEls(deafened) {
  const dmAudio = document.getElementById('gk-remote-dm-audio');
  if (dmAudio) dmAudio.muted = deafened;
  document.querySelectorAll('audio[id^="gk-voice-audio-"]').forEach((elAudio) => { elAudio.muted = deafened; });
  screenAudioEls.forEach((a) => { a.muted = deafened; });
}

export async function toggleDeafen() {
  if (!room) return;
  isDeafened = !isDeafened;
  applyDeafenToAudioEls(isDeafened);
  updateDeafenButtons(isDeafened);

  if (isDeafened && isSourceOn(room.localParticipant, Track.Source.Microphone)) {
    // Ensurdecer também muta o microfone — igual ao Discord.
    await room.localParticipant.setMicrophoneEnabled(false, captureDefaults().audioCaptureDefaults);
    updateMuteButtons(true);
    if (state.activeCall?.kind === 'voiceChannel') setTileMuted(auth.currentUser.uid, true);
  }
  // Desligar o ensurdecer NÃO desmuta o microfone sozinho — precisa
  // desmutar na mão, do mesmo jeito que no Discord.
}

function updateCameraButtons(on) {
  const btn = document.getElementById('gk-call-camera-btn');
  if (!btn) return;
  btn.style.display = state.activeCall ? 'flex' : 'none';
  btn.innerHTML = iconHtml(on ? 'videoCall' : 'camera');
  btn.title = on ? 'Desativar câmera' : 'Ativar câmera';
  btn.classList.toggle('gk-active', !!on);
}

async function toggleCameraInCall() {
  if (!room) return;
  const next = !isSourceOn(room.localParticipant, Track.Source.Camera);
  try {
    await room.localParticipant.setCameraEnabled(next, captureDefaults().videoCaptureDefaults);
    if (next) await applyVideoFx(room, Track, (m) => toast(m));
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
  document.getElementById('gk-remote-dm-audio')?.remove();
  document.getElementById('gk-call-camera-btn').style.display = 'none';
}

export function wireCallBar() {
  document.getElementById('gk-call-hangup-btn').addEventListener('click', hangupCall);
  document.getElementById('gk-call-bar-hangup-btn').addEventListener('click', hangupCall);

  document.getElementById('gk-call-mute-btn').addEventListener('click', toggleMute);
  document.getElementById('gk-call-bar-mute-btn').addEventListener('click', toggleMute);
  document.getElementById('gk-call-deafen-btn').addEventListener('click', toggleDeafen);
  document.getElementById('gk-call-bar-deafen-btn').addEventListener('click', toggleDeafen);
  document.getElementById('gk-call-deafen-btn').addEventListener('click', toggleDeafen);
  document.getElementById('gk-call-bar-deafen-btn').addEventListener('click', toggleDeafen);

  document.getElementById('gk-call-camera-btn').addEventListener('click', toggleCameraInCall);
  initVoiceExtras();
  document.getElementById('gk-call-extras-btn')?.addEventListener('click', () => toggleExtrasPanel());
  document.getElementById('gk-call-bar-extras-btn')?.addEventListener('click', () => toggleExtrasPanel());

  wireCallExtras();

  document.getElementById('gk-call-screenshare-btn').addEventListener('click', toggleScreenShareBtn);
  document.getElementById('gk-call-bar-screenshare-btn').addEventListener('click', toggleScreenShareBtn);

  document.getElementById('gk-call-minimize-btn').addEventListener('click', minimizeCallScreen);
  document.getElementById('gk-call-bar-expand-btn').addEventListener('click', expandCallScreen);
  // Toque no texto da faixa também abre a chamada (alvo grande, bom no celular).
  document.getElementById('gk-call-bar-label').addEventListener('click', expandCallScreen);

  // Marca o <html> enquanto a faixa de chamada está visível: no celular o CSS
  // reserva espaço pra ela (nada fica escondido atrás). Observar a classe
  // cobre todos os pontos que mostram/escondem a faixa.
  const callBar = document.getElementById('gk-call-bar');
  const syncCallBarSpace = () => document.documentElement.classList.toggle('gk-call-bar-on', callBar.classList.contains('gk-open'));
  new MutationObserver(syncCallBarSpace).observe(callBar, { attributes: true, attributeFilter: ['class'] });
  syncCallBarSpace();

  document.getElementById('gk-call-btn').addEventListener('click', () => startDmCall(false));
  document.getElementById('gk-video-call-btn').addEventListener('click', () => startDmCall(true));
}

// Mudou ruído ou efeito de vídeo nas configurações com uma chamada aberta: reaplica na hora.
window.addEventListener('gkio-media-prefs-changed', (e) => {
  if (!room) return;
  const d = e.detail || {};
  if ('noiseMode' in d || 'aiStrength' in d) applyMicProcessing(room, Track, (m) => toast(m));
  if ('videoFx' in d) applyVideoFx(room, Track, (m) => toast(m));
});

// ---------- Canal de dados da chamada (usado por voice-extras.js) ----------
const dataHandlers = new Map(); // topic -> Set<fn(msg, fromUid)>
export function onCallData(topic, fn) {
  if (!dataHandlers.has(topic)) dataHandlers.set(topic, new Set());
  dataHandlers.get(topic).add(fn);
}
export async function sendCallData(topic, obj) {
  if (!room) return false;
  try {
    await room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(obj)), { reliable: true, topic });
    return true;
  } catch (e) { toast('Não foi possível enviar para a chamada.', 'danger'); return false; }
}
export const isInCall = () => !!(room && state.activeCall);
/** Quem está na chamada agora (você incluído): [{ uid, name }] */
export function callParticipantList() {
  if (!room) return [];
  const names = state.activeCall?.participants;
  const nm = (uid, p) => (names?.get?.(uid)?.displayName) || p?.name || 'Membro';
  const me = auth.currentUser?.uid;
  const list = [{ uid: me, name: 'Você' }];
  room.remoteParticipants?.forEach?.((p, id) => list.push({ uid: p.identity || id, name: nm(p.identity || id, p) }));
  return list;
}

export function hasActiveCall() { return !!(room && state.activeCall); }

export async function setMicEnabled(next) {
  if (!room) return;
  await room.localParticipant.setMicrophoneEnabled(next, captureDefaults().audioCaptureDefaults);
  if (next) await applyMicProcessing(room, Track, (m) => toast(m));
  updateMuteButtons(!next);
  if (state.activeCall && state.activeCall.kind === 'voiceChannel') setTileMuted(auth.currentUser.uid, !next);
  // Desmutar o microfone na mão enquanto ensurdecido também desliga o
  // ensurdecer — não faz sentido falar sem conseguir ouvir ninguém.
  if (next && isDeafened) {
    isDeafened = false;
    applyDeafenToAudioEls(false);
    updateDeafenButtons(false);
  }
}
export async function toggleMute() {
  if (!room) return;
  return setMicEnabled(!isSourceOn(room.localParticipant, Track.Source.Microphone));
}
function toggleScreenShareBtn() {
  if (isScreenSharing()) stopScreenShare(); else startScreenShare();
}

// ============================================================
// Extras da tela de chamada reações, mão levantada,
// gravação da chamada, ajustes rápidos e toque de chamada recebida.
// Tudo viaja pelo canal de dados do LiveKit — nenhum servidor novo.
// ============================================================
const REACTIONS = ['👍', '👏', '😂', '❤️', '😮', '🎉', '🔥', '😢'];
let myHand = false;
let reactionsWired = false;

function nameOf(uid) {
  return callParticipantList().find((p) => p.uid === uid)?.name || 'Alguém';
}

function closeReactBar() { document.getElementById('gkc-react-bar')?.classList.remove('gk-open'); }
function closeSettingsPanel() { document.getElementById('gkc-settings')?.classList.remove('gk-open'); }

function wireCallExtras() {
  if (reactionsWired) return;
  reactionsWired = true;

  // --- reações ---
  const bar = document.getElementById('gkc-react-bar');
  REACTIONS.forEach((emoji) => {
    bar.appendChild(el('button', {
      type: 'button', title: emoji, 'aria-label': `Reagir com ${emoji}`,
      onclick: () => { stage?.showReaction(auth.currentUser.uid, emoji); sendCallData('gk-react', { e: emoji }); },
    }, emoji));
  });
  document.getElementById('gk-call-react-btn').addEventListener('click', () => {
    closeSettingsPanel();
    bar.classList.toggle('gk-open');
  });
  onCallData('gk-react', (msg, uid) => {
    if (typeof msg?.e === 'string' && REACTIONS.includes(msg.e)) stage?.showReaction(uid, msg.e);
  });

  // --- mão levantada ---
  const handBtn = document.getElementById('gk-call-hand-btn');
  handBtn.addEventListener('click', () => {
    myHand = !myHand;
    handBtn.classList.toggle('gkc-hand-on', myHand);
    handBtn.title = myHand ? 'Abaixar a mão' : 'Levantar a mão';
    stage?.setHand(auth.currentUser.uid, myHand);
    sendCallData('gk-hand', { up: myHand });
  });
  onCallData('gk-hand', (msg, uid) => {
    stage?.setHand(uid, !!msg?.up);
    if (msg?.up) toast(`${nameOf(uid)} levantou a mão ✋`);
  });

  // --- gravação da chamada (áudio de todo mundo misturado) ---
  const recBtn = document.getElementById('gk-call-record-btn');
  if (!recordingSupported()) recBtn.style.display = 'none';
  recBtn.addEventListener('click', toggleCallRecording);
  onCallData('gk-rec', (msg, uid) => {
    toast(msg?.on ? `${nameOf(uid)} está gravando.` : `${nameOf(uid)} parou de gravar.`);
  });

  // --- ajustes rápidos ---
  document.getElementById('gk-call-settings-btn').addEventListener('click', () => {
    closeReactBar();
    const panel = document.getElementById('gkc-settings');
    if (!panel.classList.contains('gk-open')) buildSettingsPanel(panel);
    panel.classList.toggle('gk-open');
  });
  document.addEventListener('pointerdown', (e) => {
    if (!e.target.closest('#gkc-react-bar, #gk-call-react-btn')) closeReactBar();
    if (!e.target.closest('#gkc-settings, #gk-call-settings-btn')) closeSettingsPanel();
  });
  window.addEventListener('gkio-call-ended', () => {
    myHand = false;
    document.getElementById('gk-call-hand-btn')?.classList.remove('gkc-hand-on');
  });
}

function buildSettingsPanel(panel) {
  const prefs = getMediaPrefs();
  const select = (label, value, options, onChange) => {
    const s = el('select', {}, options.map(([v, t]) => el('option', { value: v }, t)));
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    return el('label', {}, [label, s]);
  };
  const noiseVal = prefs.noiseMode === 'ai' ? (prefs.aiStrength === 'strong' ? 'ai-strong' : 'ai') : (prefs.noiseMode || 'browser');
  panel.replaceChildren(
    el('h4', {}, 'Ajustes da chamada'),
    select('Cancelamento de ruído do microfone', noiseVal, [['browser', 'Do navegador'], ['ai', 'IA (RNNoise)'], ['ai-strong', 'IA — forte'], ['off', 'Desligado']],
      (v) => setMediaPrefs(v === 'ai' ? { noiseMode: 'ai', aiStrength: 'standard' } : v === 'ai-strong' ? { noiseMode: 'ai', aiStrength: 'strong' } : { noiseMode: v })),
    select('Efeito da câmera', VIDEO_EFFECTS.some((f) => f.id === prefs.videoFx) ? prefs.videoFx : 'none',
      VIDEO_EFFECTS.map((f) => [f.id, f.label]), (v) => setMediaPrefs({ videoFx: v })),
    select('Qualidade da transmissão de tela (próxima transmissão)', prefs.screenQuality in SCREEN_QUALITIES ? prefs.screenQuality : 'fluid',
      Object.entries(SCREEN_QUALITIES).map(([id, q]) => [id, q.label]), (v) => { setMediaPrefs({ screenQuality: v }); if (isScreenSharing()) toast('Vale a partir da próxima transmissão.'); }),
  );
  if (!videoFxSupported()) panel.querySelectorAll('select')[1].disabled = true;
}

// ---- gravação da chamada ----
let callRec = null;
async function toggleCallRecording() {
  if (callRec) { stopCallRecording(false); return; }
  if (!room) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const dest = ctx.createMediaStreamDestination();
    const add = (track) => { if (track?.mediaStreamTrack) ctx.createMediaStreamSource(new MediaStream([track.mediaStreamTrack])).connect(dest); };
    add(room.localParticipant.getTrackPublication(Track.Source.Microphone)?.track);
    audioTracks.forEach((t) => add(t));
    const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported(m));
    const rec = new MediaRecorder(dest.stream, mime ? { mimeType: mime } : undefined);
    const chunks = []; const started = Date.now();
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = () => {
      ctx.close().catch(() => {});
      const discard = callRec?.discard;
      callRec = null;
      document.getElementById('gk-call-record-btn')?.classList.remove('gkc-rec-on');
      sendCallData('gk-rec', { on: false });
      if (!discard && chunks.length) {
        showRecordingModal({ blob: new Blob(chunks, { type: rec.mimeType || 'audio/webm' }), durationMs: Date.now() - started, name: 'chamada', kind: 'rec' });
      }
    };
    rec.start(1000);
    callRec = { rec, discard: false };
    document.getElementById('gk-call-record-btn').classList.add('gkc-rec-on');
    sendCallData('gk-rec', { on: true });
    toast('Gravando o áudio da chamada. Quem entrar depois não entra na gravação.');
  } catch (e) { toast('Não foi possível gravar a chamada neste navegador.', 'danger'); }
}
function stopCallRecording(discard) {
  if (!callRec) return;
  callRec.discard = !!discard;
  try { callRec.rec.stop(); } catch (e) { callRec = null; }
}

// ---- toque de chamada recebida (sintetizado, sem arquivo) ----
let ringCtx = null; let ringTimer = null;
function startRingtone() {
  stopRingtone();
  try {
    ringCtx = ringCtx || new (window.AudioContext || window.webkitAudioContext)();
    if (ringCtx.state === 'suspended') ringCtx.resume().catch(() => {});
    const beep = () => {
      const t = ringCtx.currentTime;
      [[523.25, 0], [659.25, 0.22], [783.99, 0.44]].forEach(([f, d]) => {
        const o = ringCtx.createOscillator(); const g = ringCtx.createGain();
        o.type = 'sine'; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t + d); g.gain.exponentialRampToValueAtTime(0.16, t + d + 0.03); g.gain.exponentialRampToValueAtTime(0.0001, t + d + 0.34);
        o.connect(g).connect(ringCtx.destination); o.start(t + d); o.stop(t + d + 0.4);
      });
    };
    beep(); ringTimer = setInterval(beep, 2600);
    setTimeout(stopRingtone, 45_000); // desiste sozinho
  } catch (e) { /* sem áudio — o cartão continua visível */ }
}
function stopRingtone() { if (ringTimer) { clearInterval(ringTimer); ringTimer = null; } }
