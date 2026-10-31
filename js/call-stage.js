// ============================================================
// G.K.IO — Palco da chamada (call-stage)
//
// A tela de chamada: uma grade de "tiles" (transmissões e rostos), com
// foco, tela única, zoom, girar/espelhar,
// PiP, tela cheia, gravação, "clip dos últimos 30 s", estatísticas da
// conexão, reações e mão levantada.
//
// Este módulo só desenha e organiza — ele NÃO conhece LiveKit nem Firebase.
// Quem fala com a sala (calls.js) entrega "fontes" (qualquer coisa com
// attach(el)/detach(el), como uma Track do LiveKit, ou um MediaStream) e
// recebe de volta, por `hooks`, os pedidos do usuário (volume, qualidade,
// parar de assistir...).
//
// Por que todos os tiles ficam irmãos no mesmo contêiner e são posicionados
// por JS (position:absolute): mover um <video> de pai no DOM pausa a
// reprodução. Assim a transmissão nunca pisca ao mudar de grade para foco.
// ============================================================
import { icon } from './icons.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const TILE_ASPECT = 16 / 9;
export const MIN_TILE_WIDTH = 200;
const GAP = 12;
const FS_IDLE_MS = 3000;

// ---------- utilitários ----------
function h(tag, props = {}, kids = []) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') n.className = v;
    else if (k === 'text') n.textContent = v;
    else if (k === 'html') n.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') n.addEventListener(k.slice(2), v);
    else n.setAttribute(k, v === true ? '' : v);
  }
  for (const c of [].concat(kids)) {
    if (c === null || c === undefined || c === false) continue;
    n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  }
  return n;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const fmtDur = (ms) => {
  const s = Math.floor(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
};

/**
 * Escolhe quantas colunas usar para os tiles 16:9 ficarem o maior possível
 * dentro do painel. Devolve { cols, rows, tileWidth } ou null sem medidas.
 */
export function planTileGrid(tileCount, paneWidth, paneHeight, gap = GAP) {
  if (tileCount <= 0 || paneWidth <= 0 || paneHeight <= 0) return null;
  const options = [];
  for (let cols = 1; cols <= tileCount; cols += 1) {
    const rows = Math.ceil(tileCount / cols);
    const byWidth = (paneWidth - gap * (cols - 1)) / cols;
    const byHeight = ((paneHeight - gap * (rows - 1)) / rows) * TILE_ASPECT;
    const tileWidth = Math.floor(Math.min(byWidth, byHeight));
    if (tileWidth > 0) options.push({ cols, rows, tileWidth });
  }
  if (!options.length) return { cols: 1, rows: tileCount, tileWidth: MIN_TILE_WIDTH };
  // maior tile vence; empate fica com menos colunas (opções já vêm em ordem crescente)
  const best = options.reduce((a, o) => (o.tileWidth > a.tileWidth ? o : a));
  return { ...best, tileWidth: Math.max(MIN_TILE_WIDTH, best.tileWidth) };
}

// Fila de pop-overs: só um aberto por vez, fecha ao clicar fora / Esc.
let openPop = null;
function closePop() { if (openPop) { openPop.close(); openPop = null; } }
function popHost() { return document.fullscreenElement || document.body; }
function openPopover(anchor, content, { onClose } = {}) {
  closePop();
  const pop = h('div', { class: 'gkc-pop', role: 'dialog' }, content);
  popHost().appendChild(pop);
  const place = () => {
    const r = anchor.getBoundingClientRect();
    const pw = pop.offsetWidth || 220;
    const ph = pop.offsetHeight || 120;
    pop.style.left = `${clamp(r.right - pw, 8, window.innerWidth - pw - 8)}px`;
    const below = r.bottom + 8;
    pop.style.top = `${below + ph > window.innerHeight - 8 ? Math.max(8, r.top - ph - 8) : below}px`;
  };
  place();
  const onDown = (e) => { if (!pop.contains(e.target) && !anchor.contains(e.target)) closePop(); };
  const onKey = (e) => { if (e.key === 'Escape') closePop(); };
  setTimeout(() => { document.addEventListener('pointerdown', onDown, true); document.addEventListener('keydown', onKey, true); }, 0);
  const ctl = {
    el: pop,
    close() {
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      pop.remove();
      onClose?.();
    },
  };
  openPop = ctl;
  return ctl;
}

// ---------- Clip dos últimos 30 s ----------
// Um MediaRecorder só gera arquivo tocável a partir do começo da gravação.
// Para "voltar 30 s" mantemos dois gravadores em revezamento: cada um vive
// 45 s e é reiniciado, com 22,5 s de defasagem entre eles. Assim sempre
// existe um com pelo menos ~22 s e no máximo 45 s; ao salvar, paramos o
// mais antigo e entregamos o arquivo.
function pickMime(hasAudio) {
  const video = ['video/mp4;codecs=avc1.640028', 'video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  const withAudio = ['video/mp4;codecs=avc1.640028,mp4a.40.2', 'video/mp4;codecs=avc1,mp4a', 'video/mp4', 'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'];
  return (hasAudio ? withAudio : video).find((t) => window.MediaRecorder && MediaRecorder.isTypeSupported(t));
}
export const recordingSupported = () => typeof window !== 'undefined' && !!window.MediaRecorder;

const CLIP_LIFE_MS = 45_000;
class ClipBuffer {
  constructor(stream) {
    this.stream = stream;
    this.mime = pickMime(stream.getAudioTracks().length > 0);
    this.slots = [];
    this.closed = false;
    this._spawn();
    this._second = setTimeout(() => this._spawn(), CLIP_LIFE_MS / 2);
  }
  _spawn() {
    if (this.closed) return null;
    let rec;
    try { rec = new MediaRecorder(this.stream, { mimeType: this.mime, videoBitsPerSecond: 2_500_000 }); }
    catch (e) { return null; }
    const slot = { rec, parts: [], since: Date.now(), timer: 0 };
    rec.ondataavailable = (e) => { if (e.data && e.data.size) slot.parts.push(e.data); };
    rec.start(1000);
    // ao fim da vida, este slot é trocado por um novo
    slot.timer = setTimeout(() => this._retire(slot, true), CLIP_LIFE_MS);
    this.slots.push(slot);
    return slot;
  }
  _retire(slot, respawn) {
    clearTimeout(slot.timer);
    this.slots = this.slots.filter((s) => s !== slot);
    try { slot.rec.stop(); } catch (e) { /* já parado */ }
    if (respawn) this._spawn();
  }
  bufferedMs() { return this.slots.length ? Date.now() - this.slots[0].since : 0; }
  clip() {
    const slot = this.slots[0];
    if (!slot) return Promise.resolve(null);
    return new Promise((resolve) => {
      slot.rec.onstop = () => {
        const blob = new Blob(slot.parts, { type: this.mime || 'video/webm' });
        resolve(blob.size ? { blob, durationMs: Date.now() - slot.since } : null);
      };
      clearTimeout(slot.timer);
      this.slots = this.slots.filter((s) => s !== slot);
      try { slot.rec.requestData(); slot.rec.stop(); } catch (e) { resolve(null); }
      this._spawn();
    });
  }
  dispose() {
    this.closed = true;
    clearTimeout(this._second);
    [...this.slots].forEach((s) => this._retire(s, false));
  }
}

export function showRecordingModal({ blob, durationMs, name, kind }) {
  const url = URL.createObjectURL(blob);
  const ext = blob.type.includes('mp4') ? 'mp4' : 'webm';
  const fileName = `${(name || 'gkio').replace(/[^\w-]+/g, '_')}-${kind === 'clip' ? 'clip' : 'gravacao'}-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.${ext}`;
  const close = () => { URL.revokeObjectURL(url); overlay.remove(); };
  const overlay = h('div', { class: 'gkc-modal-overlay', onclick: (e) => { if (e.target === overlay) close(); } }, [
    h('div', { class: 'gkc-modal', role: 'dialog', 'aria-label': 'Gravação pronta' }, [
      h('div', { class: 'gkc-modal-title' }, [kind === 'clip' ? 'Clip pronto' : 'Gravação pronta', h('span', { class: 'gkc-modal-sub', text: ` · ${fmtDur(durationMs)} · ${(blob.size / 1048576).toFixed(1)} MB` })]),
      h('video', { class: 'gkc-modal-video', src: url, controls: true, playsinline: true }),
      h('div', { class: 'gkc-modal-actions' }, [
        h('button', { class: 'gkc-btn', type: 'button', onclick: close, text: 'Descartar' }),
        h('a', { class: 'gkc-btn gkc-btn-primary', href: url, download: fileName, onclick: () => setTimeout(close, 400), text: 'Baixar' }),
      ]),
    ]),
  ]);
  popHost().appendChild(overlay);
}

// ============================================================
// CallStage
// ============================================================
export class CallStage {
  /**
   * @param {HTMLElement} root  contêiner vazio onde o palco é montado
   * @param {object} hooks  { getVolume(key), setVolume(key, pct), getStream(key),
   *                          getStats(key), setQuality(key, q), setWatching(key, bool),
   *                          onLayout(info) }
   */
  constructor(root, hooks = {}) {
    this.root = root;
    this.hooks = hooks;
    this.tiles = new Map();      // key -> tile
    this.people = new Map();     // uid -> { name, avatarUrl, isSelf, micMuted, speaking, hand, ringing }
    this.focusKey = null;
    this.dismissed = new Set();  // tiles que o usuário tirou do foco de propósito
    this.hyper = false;
    this.size = { w: 0, h: 0 };
    this.pane = h('div', { class: 'gkc-pane' });
    this.canvas = h('div', { class: 'gkc-canvas' });
    this.moreBadge = h('div', { class: 'gkc-more', hidden: true });
    this.canvas.appendChild(this.moreBadge);
    this.pane.appendChild(this.canvas);
    root.classList.add('gkc-stage');
    root.appendChild(this.pane);

    this._raf = 0;
    this._resizeTimer = 0;
    this._ro = new ResizeObserver(() => {
      this.pane.classList.add('gkc-resizing');
      clearTimeout(this._resizeTimer);
      this._resizeTimer = setTimeout(() => this.pane.classList.remove('gkc-resizing'), 160);
      this.layout();
    });
    this._ro.observe(this.pane);
    this._onFs = () => {
      this.tiles.forEach((t) => this._syncFullscreen(t));
      closePop();
      this.layout();
    };
    document.addEventListener('fullscreenchange', this._onFs);
    this._onPip = () => this.tiles.forEach((t) => this._syncControls(t));
    document.addEventListener('enterpictureinpicture', this._onPip, true);
    document.addEventListener('leavepictureinpicture', this._onPip, true);
  }

  // ---------------------------------------------------------- pessoas
  upsertPerson(uid, info = {}) {
    const prev = this.people.get(uid) || { name: 'Membro', avatarUrl: '', isSelf: false, micMuted: false, speaking: false, hand: false, ringing: false };
    const next = { ...prev, ...info };
    this.people.set(uid, next);
    let t = this.tiles.get(`cam:${uid}`);
    if (!t) t = this._createTile(`cam:${uid}`, 'cam', uid);
    this._renderPerson(t);
    // Rótulo/avatar dos tiles de tela dessa pessoa também acompanham.
    const s = this.tiles.get(`scr:${uid}`);
    if (s) this._renderPerson(s);
    this.layout();
  }
  removePerson(uid) {
    this.people.delete(uid);
    this._destroyTile(`cam:${uid}`);
    this._destroyTile(`scr:${uid}`);
    this.layout();
  }
  setSpeaking(uid, on) {
    const p = this.people.get(uid); if (!p || p.speaking === on) return;
    p.speaking = on;
    this.tiles.get(`cam:${uid}`)?.el.classList.toggle('gkc-speaking', on);
  }
  setMicMuted(uid, muted) {
    const p = this.people.get(uid); if (!p) return;
    p.micMuted = muted;
    const t = this.tiles.get(`cam:${uid}`); if (t) this._renderPerson(t);
  }
  setRinging(uid, on) {
    const p = this.people.get(uid); if (!p) return;
    p.ringing = on;
    this.tiles.get(`cam:${uid}`)?.el.classList.toggle('gkc-ringing', on);
  }
  setHand(uid, on) {
    const p = this.people.get(uid); if (!p) return;
    p.hand = on;
    const t = this.tiles.get(`cam:${uid}`); if (t) this._renderPerson(t);
  }
  setStatusLine(uid, text) {
    const t = this.tiles.get(`cam:${uid}`); if (!t) return;
    t.status.textContent = text || '';
    t.status.hidden = !text;
  }
  hasPerson(uid) { return this.people.has(uid); }
  personCount() { return this.people.size; }

  // ---------------------------------------------------------- vídeo
  setCamera(uid, source, opts = {}) {
    const t = this.tiles.get(`cam:${uid}`); if (!t) return;
    this._setSource(t, source, opts);
    if (source && this.people.get(uid)?.isSelf && t.flipX === undefined) t.flipX = true; // selfie espelhado
    if (!source) { t.flipX = undefined; }
    this._applyTransform(t);
    this.layout();
  }
  /** Cria/atualiza o tile de tela de `uid`. source=null mostra o carregando/placeholder. */
  setScreen(uid, source, opts = {}) {
    let t = this.tiles.get(`scr:${uid}`);
    if (!t) { t = this._createTile(`scr:${uid}`, 'screen', uid); t.local = !!opts.local; }
    this._setSource(t, source, opts);
    this._renderPerson(t);
    this.layout();
  }
  removeScreen(uid) {
    const key = `scr:${uid}`;
    if (this.focusKey === key) this.focusKey = null;
    this.dismissed.delete(key);
    this._destroyTile(key);
    this.layout();
  }
  hasScreen(uid) { return this.tiles.has(`scr:${uid}`); }
  showReaction(uid, emoji) {
    const t = this.tiles.get(`cam:${uid}`) || this.tiles.get(`scr:${uid}`); if (!t) return;
    const f = h('span', { class: 'gkc-float', text: emoji });
    f.style.setProperty('--x', `${Math.round((Math.random() - 0.5) * 70)}px`);
    t.floats.appendChild(f);
    setTimeout(() => f.remove(), 2600);
  }
  /** O vídeo que o mini-player (dock) deve espelhar quando a chamada é minimizada. */
  primaryStream() {
    const k = this._focusTile() || [...this.tiles.values()].find((t) => t.kind === 'screen' && t.hasVideo)
      || [...this.tiles.values()].find((t) => t.hasVideo);
    return k ? { stream: k.video.srcObject, label: this._labelOf(k), key: k.key } : null;
  }
  anyVideo() { return [...this.tiles.values()].some((t) => t.hasVideo); }

  clear() {
    closePop();
    [...this.tiles.keys()].forEach((k) => this._destroyTile(k));
    this.people.clear();
    this.focusKey = null; this.dismissed.clear(); this.hyper = false;
    this.layout();
  }
  destroy() {
    this.clear();
    this._ro.disconnect();
    document.removeEventListener('fullscreenchange', this._onFs);
    document.removeEventListener('enterpictureinpicture', this._onPip, true);
    document.removeEventListener('leavepictureinpicture', this._onPip, true);
    this.root.classList.remove('gkc-stage');
    this.pane.remove();
  }

  // ---------------------------------------------------------- tiles
  _createTile(key, kind, uid) {
    const video = h('video', { class: 'gkc-video', autoplay: true, playsinline: true });
    const media = h('div', { class: 'gkc-media' }, video);
    const avatar = h('img', { class: 'gkc-avatar', alt: '' });
    const faceName = h('span', { class: 'gkc-face-name' });
    const status = h('span', { class: 'gkc-face-status', hidden: true });
    const face = h('div', { class: 'gkc-face' }, [
      h('span', { class: 'gkc-avatar-wrap' }, [h('span', { class: 'gkc-ring' }), avatar, h('span', { class: 'gkc-mic-badge' })]),
      faceName, status,
    ]);
    const spinner = h('div', { class: 'gkc-spinner' });
    const placeholder = h('div', { class: 'gkc-placeholder', hidden: true });
    const floats = h('div', { class: 'gkc-floats' });
    const recBorder = h('div', { class: 'gkc-rec-border' });
    const nameEl = h('span', { class: 'gkc-name' });
    const bottom = h('div', { class: 'gkc-bottom' }, nameEl);
    const controls = h('div', { class: 'gkc-controls', 'data-tile-controls': '' });
    const zoomReset = h('button', { class: 'gkc-zoomreset', type: 'button', hidden: true, text: 'Restaurar zoom' });
    const statsBox = h('div', { class: 'gkc-stats', hidden: true });
    const el = h('div', { class: `gkc-tile gkc-${kind}`, 'data-key': key }, [
      media, face, spinner, placeholder, recBorder, floats, bottom, controls, zoomReset, statsBox,
    ]);
    const t = {
      key, kind, uid, el, media, video, avatar, faceName, status, face, spinner, placeholder, floats, nameEl, bottom, controls, zoomReset, statsBox,
      hasVideo: false, local: false, watching: true, source: null,
      zoom: 1, rot: 0, flipX: undefined, flipY: false, panX: 0, panY: 0,
      recorder: null, recStart: 0, recTimer: 0, clipBuf: null, statsOn: false, statsTimer: 0,
      fsIdle: 0, controlsRendered: '', rect: null,
    };
    this._wireTile(t);
    this.tiles.set(key, t);
    this.canvas.appendChild(el);
    return t;
  }

  _destroyTile(key) {
    const t = this.tiles.get(key); if (!t) return;
    if (document.fullscreenElement === t.el) document.exitFullscreen?.().catch(() => {});
    this._stopRecording(t, true);
    t.clipBuf?.dispose();
    clearInterval(t.statsTimer);
    clearTimeout(t.fsIdle);
    this._detach(t);
    t.el.remove();
    this.tiles.delete(key);
    if (this.hyper && this.focusKey === key) this.hyper = false;
    this.hooks.onTileGone?.(key);
  }

  _detach(t) {
    if (t.source?.detach) { try { t.source.detach(t.video); } catch (e) { /* ok */ } }
    try { t.video.pause(); } catch (e) { /* ok */ }
    t.video.srcObject = null;
    t.source = null;
  }

  _setSource(t, source, opts = {}) {
    if (opts.local !== undefined) t.local = !!opts.local;
    if (opts.watching !== undefined) t.watching = !!opts.watching;
    if (t.source && t.source !== source) this._detach(t);
    if (source && t.watching) {
      t.source = source;
      if (source.attach) source.attach(t.video);
      else if (typeof MediaStream !== 'undefined' && source instanceof MediaStream) t.video.srcObject = source;
      t.video.muted = true; // o áudio da transmissão toca por <audio> próprio (calls.js), com volume/ganho
      t.video.play?.().catch(() => {});
      t.hasVideo = true;
      t.el.classList.add('gkc-has-video');
      t.el.classList.toggle('gkc-loading', t.video.readyState < 2);
    } else {
      t.hasVideo = false;
      t.el.classList.remove('gkc-has-video', 'gkc-loading');
      if (t.zoom !== 1 || t.rot || t.panX || t.panY) { t.zoom = 1; t.rot = 0; t.panX = t.panY = 0; }
      this._stopRecording(t, true);
      if (t.clipBuf) { t.clipBuf.dispose(); t.clipBuf = null; }
      if (t.recorder == null) t.el.classList.remove('gkc-recording');
      if (document.fullscreenElement === t.el && t.kind === 'cam') document.exitFullscreen?.().catch(() => {});
    }
    t.el.classList.toggle('gkc-stopped', !t.watching && t.kind === 'screen');
    this._renderPlaceholder(t);
    this._syncControls(t);
  }

  _renderPlaceholder(t) {
    const show = t.kind === 'screen' && !t.watching;
    t.placeholder.hidden = !show;
    if (!show) { t.placeholder.replaceChildren(); return; }
    const p = this.people.get(t.uid);
    t.placeholder.replaceChildren(
      icon('eyeOff', { size: 26 }),
      h('p', { text: `Você parou de assistir à tela de ${p?.name || 'alguém'}.` }),
      h('button', { class: 'gkc-btn gkc-btn-primary', type: 'button', text: 'Voltar a assistir', onclick: () => this._setWatching(t, true) }),
    );
  }

  _setWatching(t, on) {
    t.watching = on;
    t.el.classList.toggle('gkc-stopped', !on);
    if (!on) {
      this._detach(t);
      t.hasVideo = false;
      t.el.classList.remove('gkc-has-video', 'gkc-loading');
      this._stopRecording(t, true);
      if (this.focusKey === t.key) this.focusKey = null;
    } else {
      t.el.classList.add('gkc-loading');
    }
    this._renderPlaceholder(t);
    this._syncControls(t);
    this.hooks.setWatching?.(t.key, on);
    this.layout();
  }

  _labelOf(t) {
    const p = this.people.get(t.uid);
    const name = p?.isSelf ? 'Você' : (p?.name || 'Membro');
    if (t.kind === 'screen') return p?.isSelf ? 'Sua tela' : `Tela de ${name}`;
    return name;
  }

  _renderPerson(t) {
    const p = this.people.get(t.uid) || {};
    const label = this._labelOf(t);
    const src = p.avatarUrl || fallbackAvatarUrl(p.name);
    if (t.avatar.getAttribute('src') !== src) t.avatar.src = src;
    t.faceName.textContent = p.isSelf ? `${p.name || 'Você'} (você)` : (p.name || 'Membro');
    t.nameEl.replaceChildren();
    if (t.kind === 'screen') t.nameEl.append(h('span', { class: 'gkc-live', text: 'Transmitindo' }), label);
    else {
      if (p.micMuted) t.nameEl.append(h('span', { class: 'gkc-name-mic' }, icon('micOff', { size: 13 })));
      t.nameEl.append(label);
      if (p.hand) t.nameEl.append(h('span', { class: 'gkc-hand', title: 'Mão levantada', text: '✋' }));
    }
    t.el.classList.toggle('gkc-muted', !!p.micMuted);
    t.el.classList.toggle('gkc-self', !!p.isSelf);
    t.el.classList.toggle('gkc-hand-up', !!p.hand);
    t.el.classList.toggle('gkc-speaking', t.kind === 'cam' && !!p.speaking);
    t.el.classList.toggle('gkc-ringing', t.kind === 'cam' && !!p.ringing);
    // Selo do microfone no avatar (modo rosto)
    const badge = t.face.querySelector('.gkc-mic-badge');
    if (badge) { badge.replaceChildren(icon('micOff', { size: 14 })); badge.hidden = !p.micMuted; }
    t.nameEl.title = label;
    this._syncControls(t);
  }

  // ---------------------------------------------------------- eventos do tile
  _wireTile(t) {
    const v = t.video;
    const ready = () => { t.el.classList.remove('gkc-loading'); this._updateZoomReset(t); };
    ['loadeddata', 'loadedmetadata', 'canplay', 'playing'].forEach((ev) => v.addEventListener(ev, ready));
    v.addEventListener('dblclick', () => { if (t.hasVideo) this._toggleFullscreen(t); });

    // Toque: mostra/esconde os controles (celular não tem hover)
    t.el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse') return;
      if (e.target.closest('[data-tile-controls], button, input')) { this._touchReveal(t); return; }
      t.el.classList.toggle('gkc-touch-on');
      this._touchReveal(t, t.el.classList.contains('gkc-touch-on'));
    });

    // Zoom com a roda + arrastar para mover (quando ampliado) + pinça
    t.el.addEventListener('wheel', (e) => {
      if (!t.hasVideo) return;
      if (t.zoom === 1 && !e.ctrlKey && !this._isMain(t) && document.fullscreenElement !== t.el) return; // não rouba a rolagem da página à toa
      e.preventDefault();
      this._zoomBy(t, e.deltaY < 0 ? 1.12 : 1 / 1.12, e);
    }, { passive: false });

    const pointers = new Map();
    let dragStart = null; let pinchStart = null;
    t.media.addEventListener('pointerdown', (e) => {
      if (!t.hasVideo) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 1 && t.zoom > 1) { dragStart = { x: e.clientX, y: e.clientY, px: t.panX, py: t.panY }; t.media.setPointerCapture(e.pointerId); t.el.classList.add('gkc-grabbing'); }
      if (pointers.size === 2) { const [a, b] = [...pointers.values()]; pinchStart = { d: Math.hypot(a.x - b.x, a.y - b.y), z: t.zoom }; }
    });
    t.media.addEventListener('pointermove', (e) => {
      if (!pointers.has(e.pointerId)) return;
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pointers.size === 2 && pinchStart) {
        const [a, b] = [...pointers.values()];
        t.zoom = clamp(pinchStart.z * (Math.hypot(a.x - b.x, a.y - b.y) / pinchStart.d), 1, 6);
        this._applyTransform(t);
      } else if (dragStart && pointers.size === 1) {
        t.panX = dragStart.px + (e.clientX - dragStart.x);
        t.panY = dragStart.py + (e.clientY - dragStart.y);
        this._applyTransform(t);
      }
    });
    const end = (e) => {
      pointers.delete(e.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (!pointers.size) { dragStart = null; t.el.classList.remove('gkc-grabbing'); }
    };
    t.media.addEventListener('pointerup', end);
    t.media.addEventListener('pointercancel', end);

    t.zoomReset.addEventListener('click', () => this._resetView(t));

    // Tela cheia: controles somem depois de 3 s sem mexer o mouse
    t.el.addEventListener('mousemove', () => {
      if (document.fullscreenElement !== t.el) return;
      t.el.classList.add('gkc-fs-active');
      clearTimeout(t.fsIdle);
      t.fsIdle = setTimeout(() => t.el.classList.remove('gkc-fs-active'), FS_IDLE_MS);
    });
  }

  _touchReveal(t, on = true) {
    clearTimeout(t._touchT);
    if (on) t._touchT = setTimeout(() => t.el.classList.remove('gkc-touch-on'), 3500);
  }

  _isMain(t) { return this._focusTile() === t; }

  _zoomBy(t, f, evt) {
    const next = clamp(t.zoom * f, 1, 6);
    if (next === t.zoom) return;
    // mantém o ponto sob o cursor parado enquanto amplia
    if (evt) {
      const r = t.el.getBoundingClientRect();
      const cx = evt.clientX - (r.left + r.width / 2);
      const cy = evt.clientY - (r.top + r.height / 2);
      t.panX = cx - (cx - t.panX) * (next / t.zoom);
      t.panY = cy - (cy - t.panY) * (next / t.zoom);
    }
    t.zoom = next;
    if (t.zoom === 1) { t.panX = 0; t.panY = 0; }
    this._applyTransform(t);
  }

  _resetView(t) {
    t.zoom = 1; t.rot = 0; t.panX = t.panY = 0; t.flipX = (this.people.get(t.uid)?.isSelf && t.kind === 'cam') ? true : undefined; t.flipY = false;
    this._applyTransform(t);
  }

  _applyTransform(t) {
    const w = t.el.clientWidth || 1; const hh = t.el.clientHeight || 1;
    const odd = Math.abs(t.rot % 180) === 90;
    const fit = odd ? Math.min(w / hh, hh / w) : 1;
    const fx = t.flipX ? -1 : 1; const fy = t.flipY ? -1 : 1;
    // Limita o arrasto para a imagem nunca sair toda da moldura.
    const maxX = (w * (t.zoom - 1)) / 2; const maxY = (hh * (t.zoom - 1)) / 2;
    t.panX = clamp(t.panX, -maxX, maxX); t.panY = clamp(t.panY, -maxY, maxY);
    t.media.style.transform = `translate(${t.panX}px, ${t.panY}px) scale(${t.zoom * fit}) rotate(${t.rot}deg) scale(${fx}, ${fy})`;
    this._updateZoomReset(t);
  }
  _updateZoomReset(t) {
    const defFlipX = !!(this.people.get(t.uid)?.isSelf && t.kind === 'cam');
    const changed = t.zoom !== 1 || t.rot !== 0 || t.flipY || !!t.flipX !== defFlipX;
    t.zoomReset.hidden = !(t.hasVideo && changed);
  }

  // ---------------------------------------------------------- controles
  _controlSpec(t) {
    const p = this.people.get(t.uid) || {};
    const self = !!p.isSelf;
    const hasVideo = t.hasVideo;
    return {
      volume: !self && (t.kind === 'screen' ? t.watching && hasVideo : true),
      video: hasVideo,
      stats: hasVideo && !!this.hooks.getStats,
      quality: hasVideo && t.kind === 'screen' && !self && !!this.hooks.setQuality,
      stop: t.kind === 'screen' && !self && t.watching && !!this.hooks.setWatching,
      self,
    };
  }

  _syncControls(t) {
    const spec = this._controlSpec(t);
    const fs = document.fullscreenElement === t.el;
    const pip = document.pictureInPictureElement === t.video;
    const sig = JSON.stringify([spec, fs, pip, this._focusTile() === t, this.hyper, !!t.recorder, !!t.clipBuf, t.statsOn, t.kind]);
    if (sig === t.controlsRendered) return;
    t.controlsRendered = sig;
    const mk = (name, label, onclick, { pressed, cls = '', ic } = {}) => h('button', {
      class: `gkc-cbtn ${cls}${pressed ? ' gkc-on' : ''}`, type: 'button', title: label, 'aria-label': label,
      'aria-pressed': pressed === undefined ? null : String(!!pressed), onclick: (e) => { e.stopPropagation(); onclick(e); },
    }, icon(ic || name, { size: 18 }));
    const kids = [];
    if (spec.volume) kids.push(this._volumeControl(t));
    if (spec.video && recordingSupported()) {
      kids.push(mk('record', t.recorder ? 'Parar gravação' : 'Gravar esta transmissão', () => this._toggleRecording(t), { pressed: !!t.recorder, cls: t.recorder ? 'gkc-rec' : '' }));
      kids.push(mk('clip', t.clipBuf ? 'Salvar os últimos 30 s' : 'Ativar clip dos últimos 30 s', () => this._clip(t), { pressed: !!t.clipBuf }));
    }
    if (spec.stats) kids.push(mk('chart', t.statsOn ? 'Esconder estatísticas' : 'Estatísticas da conexão', () => this._toggleStats(t), { pressed: t.statsOn }));
    if (spec.quality) kids.push(mk('sliders', 'Qualidade da transmissão', (e) => this._qualityMenu(t, e.currentTarget)));
    if (spec.video) {
      kids.push(mk('zoomIn', 'Ajustar imagem (zoom, girar, espelhar)', (e) => this._adjustMenu(t, e.currentTarget)));
      if (document.pictureInPictureEnabled) kids.push(mk(pip ? 'pipExit' : 'pip', pip ? 'Sair do picture-in-picture' : 'Picture-in-picture', () => this._togglePip(t)));
      kids.push(mk('focus', this._focusTile() === t ? 'Voltar para a grade' : 'Destacar esta transmissão', () => this.toggleFocus(t.key), { pressed: this._focusTile() === t }));
      kids.push(mk('hyperfocus', this.hyper && this._focusTile() === t ? 'Mostrar todos de novo' : 'Ver só esta transmissão', () => this.toggleHyperfocus(t.key), { pressed: this.hyper && this._focusTile() === t }));
      kids.push(mk(fs ? 'fullscreenExit' : 'fullscreen', fs ? 'Sair da tela cheia' : 'Tela cheia', () => this._toggleFullscreen(t)));
    }
    if (spec.stop) kids.push(mk('eyeOff', 'Parar de assistir', () => this._setWatching(t, false)));
    t.controls.replaceChildren(...kids);
    t.el.classList.toggle('gkc-no-controls', kids.length === 0);
  }

  _volumeControl(t) {
    const key = t.key;
    const cur = () => this.hooks.getVolume?.(key) ?? 100;
    const muteBtn = h('button', { class: 'gkc-cbtn', type: 'button' });
    const slider = h('input', { class: 'gkc-vol', type: 'range', min: '0', max: '200', step: '5', 'aria-label': `Volume de ${this._labelOf(t)}` });
    const sync = () => {
      const v = cur();
      slider.value = String(v);
      slider.style.setProperty('--p', `${(v / 200) * 100}%`);
      muteBtn.replaceChildren(icon(v === 0 ? 'speakerMute' : 'speaker', { size: 18 }));
      muteBtn.classList.toggle('gkc-bad', v === 0);
      muteBtn.title = v === 0 ? 'Ativar som' : 'Silenciar';
      slider.title = v === 0 ? 'Mudo' : `${v}%`;
    };
    slider.addEventListener('input', () => { this.hooks.setVolume?.(key, Number(slider.value)); t._lastVol = Number(slider.value) || t._lastVol; sync(); });
    muteBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const v = cur();
      if (v === 0) this.hooks.setVolume?.(key, t._lastVol || 100);
      else { t._lastVol = v; this.hooks.setVolume?.(key, 0); }
      sync();
    });
    sync();
    return h('span', { class: 'gkc-volgroup' }, [slider, muteBtn]);
  }

  // ---------------------------------------------------------- menus
  _qualityMenu(t, anchor) {
    const opts = [['auto', 'Automática'], ['high', 'Alta'], ['medium', 'Média'], ['low', 'Baixa']];
    const cur = t.quality || 'auto';
    const pop = openPopover(anchor, [
      h('div', { class: 'gkc-pop-title', text: 'Qualidade que você recebe' }),
      ...opts.map(([id, label]) => h('button', {
        class: `gkc-menu-item${cur === id ? ' gkc-on' : ''}`, type: 'button', text: label,
        onclick: () => { t.quality = id; this.hooks.setQuality?.(t.key, id); pop.close(); openPop = null; },
      })),
      h('div', { class: 'gkc-pop-hint', text: 'Automática ajusta pelo tamanho do tile. Alta gasta mais internet.' }),
    ]);
  }

  _adjustMenu(t, anchor) {
    const zoom = h('input', { class: 'gkc-vol', type: 'range', min: '100', max: '600', step: '5', 'aria-label': 'Zoom' });
    const zlabel = h('span', { class: 'gkc-pop-val' });
    const sync = () => { zoom.value = String(Math.round(t.zoom * 100)); zoom.style.setProperty('--p', `${((zoom.value - 100) / 500) * 100}%`); zlabel.textContent = `${zoom.value}%`; };
    zoom.addEventListener('input', () => { t.zoom = Number(zoom.value) / 100; if (t.zoom === 1) t.panX = t.panY = 0; this._applyTransform(t); sync(); });
    sync();
    const b = (ic, label, fn) => h('button', { class: 'gkc-cbtn gkc-cbtn-flat', type: 'button', title: label, 'aria-label': label, onclick: () => { fn(); this._applyTransform(t); sync(); } }, icon(ic, { size: 18 }));
    openPopover(anchor, [
      h('div', { class: 'gkc-pop-title', text: 'Ajustar imagem' }),
      h('div', { class: 'gkc-pop-row' }, [h('span', { class: 'gkc-pop-lbl', text: 'Zoom' }), zoom, zlabel]),
      h('div', { class: 'gkc-pop-row gkc-pop-icons' }, [
        b('rotateLeft', 'Girar à esquerda', () => { t.rot = (t.rot - 90 + 360) % 360; }),
        b('rotateRight', 'Girar à direita', () => { t.rot = (t.rot + 90) % 360; }),
        b('flipH', 'Espelhar na horizontal', () => { t.flipX = !t.flipX; }),
        b('flipV', 'Espelhar na vertical', () => { t.flipY = !t.flipY; }),
        b('resetView', 'Restaurar', () => this._resetView(t)),
      ]),
      h('div', { class: 'gkc-pop-hint', text: 'Dica: use a roda do mouse (ou pinça) para dar zoom e arraste para mover.' }),
    ]);
  }

  // ---------------------------------------------------------- PiP / tela cheia
  async _togglePip(t) {
    try {
      if (document.pictureInPictureElement === t.video) await document.exitPictureInPicture();
      else { t.video.muted = true; await t.video.requestPictureInPicture(); }
    } catch (e) { this.hooks.onError?.('Não foi possível abrir o picture-in-picture.'); }
    this._syncControls(t);
  }
  async _toggleFullscreen(t) {
    try {
      if (document.fullscreenElement === t.el) await document.exitFullscreen();
      else await (t.el.requestFullscreen?.() || t.el.webkitRequestFullscreen?.());
    } catch (e) { this.hooks.onError?.('Tela cheia indisponível neste navegador.'); }
  }
  _syncFullscreen(t) {
    const on = document.fullscreenElement === t.el;
    t.el.classList.toggle('gkc-fullscreen', on);
    if (on) { t.el.classList.add('gkc-fs-active'); clearTimeout(t.fsIdle); t.fsIdle = setTimeout(() => t.el.classList.remove('gkc-fs-active'), FS_IDLE_MS); }
    else t.el.classList.remove('gkc-fs-active');
    this._applyTransform(t);
    t.controlsRendered = '';
    this._syncControls(t);
  }

  // ---------------------------------------------------------- gravação / clip
  _streamFor(t) {
    const s = this.hooks.getStream?.(t.key);
    if (s && s.getTracks().length) return s;
    return t.video.srcObject instanceof MediaStream ? t.video.srcObject : null;
  }
  _toggleRecording(t) { if (t.recorder) this._stopRecording(t, false); else this._startRecording(t); }
  _startRecording(t) {
    const stream = this._streamFor(t);
    if (!stream || !recordingSupported()) { this.hooks.onError?.('Não há vídeo para gravar ainda.'); return; }
    const mime = pickMime(stream.getAudioTracks().length > 0);
    let rec;
    try { rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 6_000_000 }); }
    catch (e) { this.hooks.onError?.('Seu navegador não conseguiu iniciar a gravação.'); return; }
    const chunks = [];
    rec.ondataavailable = (e) => { if (e.data?.size) chunks.push(e.data); };
    rec.onstop = () => {
      clearInterval(t.recTimer);
      const ms = Date.now() - t.recStart;
      t.recorder = null;
      t.el.classList.remove('gkc-recording');
      t.recBadge?.remove(); t.recBadge = null;
      this._syncControls(t);
      if (!t._discardRec && chunks.length) {
        showRecordingModal({ blob: new Blob(chunks, { type: rec.mimeType || mime || 'video/webm' }), durationMs: ms, name: this._labelOf(t), kind: 'rec' });
      }
      t._discardRec = false;
    };
    rec.start(1000);
    t.recorder = rec; t.recStart = Date.now();
    t.el.classList.add('gkc-recording');
    t.recBadge = h('span', { class: 'gkc-rec-badge', text: '● 00:00' });
    t.bottom.appendChild(t.recBadge);
    t.recTimer = setInterval(() => { if (t.recBadge) t.recBadge.textContent = `● ${fmtDur(Date.now() - t.recStart)}`; }, 500);
    this.hooks.onRecordingNotice?.(this._labelOf(t));
    this._syncControls(t);
  }
  _stopRecording(t, discard) {
    if (!t.recorder) return;
    t._discardRec = !!discard;
    try { t.recorder.stop(); } catch (e) { t.recorder = null; }
  }
  async _clip(t) {
    if (!t.clipBuf) {
      const stream = this._streamFor(t);
      if (!stream) { this.hooks.onError?.('Não há vídeo para clipar ainda.'); return; }
      t.clipBuf = new ClipBuffer(stream);
      this.hooks.onInfo?.('Clip ligado: clique de novo para salvar os últimos 30 s.');
      this._syncControls(t);
      return;
    }
    const res = await t.clipBuf.clip();
    if (!res) { this.hooks.onInfo?.('Ainda está juntando imagem — tente em alguns segundos.'); return; }
    showRecordingModal({ ...res, name: this._labelOf(t), kind: 'clip' });
  }

  // ---------------------------------------------------------- estatísticas
  _toggleStats(t) {
    t.statsOn = !t.statsOn;
    t.statsBox.hidden = !t.statsOn;
    clearInterval(t.statsTimer);
    if (t.statsOn) {
      const tick = async () => {
        let s = null;
        try { s = await this.hooks.getStats?.(t.key); } catch (e) { /* sem estatísticas */ }
        const q = t.video.getVideoPlaybackQuality?.();
        const rows = [
          ['Resolução', t.video.videoWidth ? `${t.video.videoWidth}×${t.video.videoHeight}` : '—'],
          ['Quadros/s', s?.fps != null ? `${Math.round(s.fps)}` : '—'],
          ['Taxa', s?.kbps != null ? `${(s.kbps / 1000).toFixed(2)} Mbps` : '—'],
          ['Codec', s?.codec || '—'],
          ['Perda de pacotes', s?.lossPct != null ? `${s.lossPct.toFixed(1)}%` : '—'],
          ['Latência (RTT)', s?.rttMs != null ? `${Math.round(s.rttMs)} ms` : '—'],
          ['Rota', s?.route || '—'],
          ['Quadros perdidos', q ? `${q.droppedVideoFrames}` : '—'],
        ];
        t.statsBox.replaceChildren(
          h('div', { class: 'gkc-stats-title', text: 'Estatísticas da conexão' }),
          ...rows.map(([k, v]) => h('div', { class: 'gkc-stats-row' }, [h('span', { text: k }), h('b', { text: v })])),
        );
      };
      tick();
      t.statsTimer = setInterval(tick, 2000);
    }
    t.controlsRendered = '';
    this._syncControls(t);
  }

  // ---------------------------------------------------------- foco
  _focusTile() {
    if (this.focusKey && this.tiles.has(this.focusKey) && this.tiles.get(this.focusKey).hasVideo) return this.tiles.get(this.focusKey);
    // foco automático: a primeira transmissão de tela (a dos outros vem antes da sua)
    const screens = [...this.tiles.values()].filter((t) => t.kind === 'screen' && t.hasVideo && !this.dismissed.has(t.key));
    if (!screens.length) return null;
    return screens.find((t) => !t.local) || screens[0];
  }
  toggleFocus(key) {
    const cur = this._focusTile();
    if (cur && cur.key === key) { this.focusKey = null; this.dismissed.add(key); this.hyper = false; }
    else { this.focusKey = key; this.dismissed.delete(key); }
    this.layout();
  }
  toggleHyperfocus(key) {
    if (this.hyper && this._focusTile()?.key === key) this.hyper = false;
    else { this.focusKey = key; this.dismissed.delete(key); this.hyper = true; }
    this.layout();
  }
  /** Clicar num tile pequeno da faixa traz ele para o foco. */
  focusOn(key) { this.focusKey = key; this.dismissed.delete(key); this.layout(); }

  // ---------------------------------------------------------- layout
  layout() {
    if (this._raf) return;
    this._raf = requestAnimationFrame(() => { this._raf = 0; this._layoutNow(); });
  }

  _order() {
    const all = [...this.tiles.values()];
    // telas primeiro; depois câmeras/rostos (você por último,)
    const rank = (t) => (t.kind === 'screen' ? (t.local ? 1 : 0) : (this.people.get(t.uid)?.isSelf ? 3 : 2));
    return all.sort((a, b) => rank(a) - rank(b));
  }

  _layoutNow() {
    const W = this.pane.clientWidth; const H = this.pane.clientHeight;
    if (!W || !H) return;
    const tiles = this._order();
    const before = new Map();
    tiles.forEach((t) => { if (t.rect) before.set(t.key, t.rect); });

    const anyVideo = tiles.some((t) => t.hasVideo || (t.kind === 'screen'));
    const focus = anyVideo ? this._focusTile() : null;
    let mode = 'faces';
    if (anyVideo) mode = focus && tiles.length > 1 ? 'focus' : (focus ? 'solo' : 'grid');
    this.mode = mode;
    this.root.dataset.mode = mode;
    const rects = new Map();
    let contentH = H;
    let hidden = 0;

    if (mode === 'faces') {
      const n = tiles.length || 1;
      const size = n <= 2 ? 96 : n <= 4 ? 72 : 56;
      const cw = Math.max(112, size + 40); const chh = size + 54;
      const perRow = Math.max(1, Math.floor((W - 24 + 20) / (cw + 20)));
      const rows = Math.ceil(n / perRow);
      const totalH = rows * chh + (rows - 1) * 20;
      const top0 = Math.max(16, (H - totalH) / 2);
      tiles.forEach((t, i) => {
        const r = Math.floor(i / perRow); const inRow = r === rows - 1 ? n - r * perRow : perRow;
        const c = i % perRow;
        const rowW = inRow * cw + (inRow - 1) * 20;
        rects.set(t.key, { x: (W - rowW) / 2 + c * (cw + 20), y: top0 + r * (chh + 20), w: cw, h: chh });
        t.el.style.setProperty('--face', `${size}px`);
      });
      contentH = Math.max(H, top0 * 2 + totalH);
    } else if (mode === 'grid') {
      const plan = planTileGrid(tiles.length, W - 24, H - 24, GAP) || { cols: 1, rows: tiles.length, tileWidth: MIN_TILE_WIDTH };
      const tw = plan.tileWidth; const th = Math.round(tw / TILE_ASPECT);
      const blockW = plan.cols * tw + (plan.cols - 1) * GAP; const blockH = plan.rows * th + (plan.rows - 1) * GAP;
      const left0 = Math.max(12, (W - blockW) / 2); const top0 = Math.max(12, (H - blockH) / 2);
      tiles.forEach((t, i) => {
        const r = Math.floor(i / plan.cols); const inRow = r === plan.rows - 1 ? tiles.length - r * plan.cols : plan.cols;
        const c = i % plan.cols;
        const rowW = inRow * tw + (inRow - 1) * GAP;
        rects.set(t.key, { x: (W - rowW) / 2 + c * (tw + GAP), y: top0 + r * (th + GAP), w: tw, h: th });
      });
      contentH = Math.max(H, top0 * 2 + blockH);
      void left0;
    } else {
      // foco ('focus'): principal grande + faixa; 'solo': só um tile
      const pad = 12;
      const others = tiles.filter((t) => t !== focus);
      if (mode === 'solo' || this.hyper) {
        rects.set(focus.key, { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 });
        others.forEach((t) => rects.set(t.key, null));
        hidden = this.hyper ? others.length : 0;
      } else if (W >= 760) {
        const strip = this._planStrip(others.length, H - pad * 2, true);
        const stripW = strip.cols * strip.w + (strip.cols - 1) * GAP;
        rects.set(focus.key, { x: pad, y: pad, w: W - pad * 2 - stripW - GAP, h: H - pad * 2 });
        others.forEach((t, i) => {
          if (i >= strip.shown) { rects.set(t.key, null); return; }
          const c = Math.floor(i / strip.rows); const r = i % strip.rows;
          rects.set(t.key, { x: W - pad - stripW + c * (strip.w + GAP), y: pad + r * (strip.h + GAP), w: strip.w, h: strip.h });
        });
        hidden = Math.max(0, others.length - strip.shown);
      } else {
        const strip = this._planStrip(others.length, W - pad * 2, false);
        const stripH = strip.shown ? strip.h : 0;
        rects.set(focus.key, { x: pad, y: pad, w: W - pad * 2, h: H - pad * 2 - (stripH ? stripH + GAP : 0) });
        others.forEach((t, i) => {
          if (i >= strip.shown) { rects.set(t.key, null); return; }
          rects.set(t.key, { x: pad + i * (strip.w + GAP), y: H - pad - strip.h, w: strip.w, h: strip.h });
        });
        hidden = Math.max(0, others.length - strip.shown);
      }
    }

    this.canvas.style.height = `${contentH}px`;
    tiles.forEach((t) => {
      const r = rects.get(t.key);
      const isMain = mode === 'focus' || mode === 'solo' ? t === focus : false;
      t.el.classList.toggle('gkc-main', isMain);
      t.el.classList.toggle('gkc-strip', mode === 'focus' && t !== focus && !!r);
      t.el.classList.toggle('gkc-hidden', !r);
      if (!r) { t.rect = null; return; }
      t.el.style.width = `${Math.round(r.w)}px`;
      t.el.style.height = `${Math.round(r.h)}px`;
      t.el.style.transform = `translate(${Math.round(r.x)}px, ${Math.round(r.y)}px)`;
      const first = !t.rect;
      t.rect = r;
      if (first) { t.el.classList.add('gkc-enter'); setTimeout(() => t.el.classList.remove('gkc-enter'), 320); }
      this._applyTransform(t);
      this._syncControls(t);
    });
    void before;
    this.moreBadge.hidden = !(hidden > 0 && !this.hyper);
    if (!this.moreBadge.hidden) this.moreBadge.textContent = `+${hidden}`;
    if (this.hyper) {
      this.moreBadge.hidden = false;
      this.moreBadge.textContent = `Só esta · ${hidden} oculta${hidden === 1 ? '' : 's'}`;
    }
    this.hooks.onLayout?.({ mode, tiles: tiles.length, anyVideo });
  }

  /** Quantos tiles pequenos cabem na faixa e de que tamanho. */
  _planStrip(n, avail, vertical) {
    if (n <= 0) return { cols: 0, rows: 0, shown: 0, w: 0, h: 0 };
    if (vertical) {
      for (const w of [208, 176, 144, 120]) {
        const hgt = Math.round(w / TILE_ASPECT);
        const rows = Math.max(1, Math.floor((avail + GAP) / (hgt + GAP)));
        const cols = Math.min(3, Math.ceil(n / rows));
        if (rows * cols >= n) return { cols, rows: Math.min(rows, n), shown: n, w, h: hgt };
      }
      const w = 120; const hgt = Math.round(w / TILE_ASPECT);
      const rows = Math.max(1, Math.floor((avail + GAP) / (hgt + GAP)));
      return { cols: 3, rows, shown: Math.min(n, rows * 3), w, h: hgt };
    }
    const hgt = 92; const w = Math.round(hgt * TILE_ASPECT);
    const perRow = Math.max(1, Math.floor((avail + GAP) / (w + GAP)));
    return { cols: Math.min(n, perRow), rows: 1, shown: Math.min(n, perRow), w, h: hgt };
  }
}

function fallbackAvatarUrl(name = '?') {
  const ch = ((name || '?').trim().charAt(0).toUpperCase() || '?').replace(/[<>&"']/g, '?');
  const svg = `<svg xmlns="${SVG_NS}" width="128" height="128"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7C4FE0"/><stop offset="1" stop-color="#3EA6F5"/></linearGradient></defs><rect width="128" height="128" fill="url(#g)"/><text x="64" y="86" font-size="62" font-family="sans-serif" font-weight="700" text-anchor="middle" fill="white">${ch}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}
