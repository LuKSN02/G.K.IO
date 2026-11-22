// ============================================================
// G.K.IO — Efeitos de voz (Web Audio)
// Processador no formato do LiveKit (track.setProcessor). Cadeia: microfone → efeito → saída.
// Enquanto um efeito está ligado ele SUBSTITUI a supressão de ruído por IA (só um processador
// por vez); o cancelamento de ruído do navegador continua valendo na captura.
// ============================================================
export const VOICE_EFFECTS = [
  { id: 'none', label: 'Nenhum' },
  { id: 'robot', label: 'Robô' },
  { id: 'echo', label: 'Eco' },
  { id: 'radio', label: 'Rádio / walkie-talkie' },
  { id: 'cave', label: 'Caverna (reverb)' },
  { id: 'megaphone', label: 'Megafone' },
];
export const voiceEffectsSupported = () => typeof AudioContext !== 'undefined' && typeof MediaStreamAudioDestinationNode !== 'undefined';

function curve(amount) { // distorção suave
  const n = 2048; const c = new Float32Array(n);
  for (let i = 0; i < n; i++) { const x = (i * 2) / n - 1; c[i] = ((1 + amount) * x) / (1 + amount * Math.abs(x)); }
  return c;
}
function impulse(ctx, seconds = 2.2, decay = 2.5) {
  const len = Math.floor(ctx.sampleRate * seconds); const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) { const d = buf.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay); }
  return buf;
}

/** Monta o efeito entre `input` e `output`. Devolve uma função que desfaz as conexões extras. */
export function buildEffect(ctx, id, input, output) {
  const extra = [];
  const add = (n) => { extra.push(n); return n; };
  switch (id) {
    case 'robot': { // modulação em anel ~ 55 Hz
      const g = add(ctx.createGain()); g.gain.value = 0;
      const osc = add(ctx.createOscillator()); osc.frequency.value = 55; osc.type = 'sine';
      const depth = add(ctx.createGain()); depth.gain.value = 1;
      osc.connect(depth).connect(g.gain); osc.start();
      input.connect(g).connect(output); break;
    }
    case 'echo': {
      const dry = add(ctx.createGain()); const wet = add(ctx.createGain()); wet.gain.value = 0.45;
      const delay = add(ctx.createDelay(1)); delay.delayTime.value = 0.28;
      const fb = add(ctx.createGain()); fb.gain.value = 0.38;
      input.connect(dry).connect(output); input.connect(delay); delay.connect(fb).connect(delay); delay.connect(wet).connect(output); break;
    }
    case 'radio': {
      const hp = add(ctx.createBiquadFilter()); hp.type = 'highpass'; hp.frequency.value = 500;
      const lp = add(ctx.createBiquadFilter()); lp.type = 'lowpass'; lp.frequency.value = 3200;
      const ws = add(ctx.createWaveShaper()); ws.curve = curve(8);
      input.connect(hp).connect(lp).connect(ws).connect(output); break;
    }
    case 'cave': {
      const dry = add(ctx.createGain()); dry.gain.value = 0.75;
      const wet = add(ctx.createGain()); wet.gain.value = 0.7;
      const conv = add(ctx.createConvolver()); conv.buffer = impulse(ctx);
      input.connect(dry).connect(output); input.connect(conv).connect(wet).connect(output); break;
    }
    case 'megaphone': {
      const bp = add(ctx.createBiquadFilter()); bp.type = 'bandpass'; bp.frequency.value = 1500; bp.Q.value = 0.9;
      const ws = add(ctx.createWaveShaper()); ws.curve = curve(40);
      const g = add(ctx.createGain()); g.gain.value = 0.9;
      input.connect(bp).connect(ws).connect(g).connect(output); break;
    }
    default: input.connect(output);
  }
  return () => extra.forEach((n) => { try { n.disconnect(); n.stop?.(); } catch (e) { /* ok */ } });
}

export class VoiceEffectProcessor {
  constructor(effect = 'none') {
    this.name = 'gkio-voicefx'; this.effect = effect; this.processedTrack = undefined;
    this.ctx = null; this.src = null; this.dest = null; this.undo = null; this.bus = null;
  }
  async init(opts) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    this.src = this.ctx.createMediaStreamSource(new MediaStream([opts.track]));
    this.dest = this.ctx.createMediaStreamDestination();
    this.bus = this.ctx.createGain();
    this.bus.connect(this.dest);
    this.undo = buildEffect(this.ctx, this.effect, this.src, this.bus);
    this.processedTrack = this.dest.stream.getAudioTracks()[0];
    if (this.ctx.state === 'suspended') await this.ctx.resume().catch(() => {});
  }
  async restart(opts) { await this.destroy(); await this.init(opts); }
  setEffect(id) {
    if (!this.ctx || id === this.effect) return;
    this.effect = id;
    try { this.src.disconnect(); this.undo?.(); } catch (e) { /* ok */ }
    this.undo = buildEffect(this.ctx, id, this.src, this.bus);
  }
  async destroy() {
    try { this.undo?.(); this.src?.disconnect(); this.bus?.disconnect(); } catch (e) { /* ok */ }
    try { await this.ctx?.close(); } catch (e) { /* ok */ }
    this.ctx = this.src = this.dest = this.bus = this.undo = null; this.processedTrack = undefined;
  }
}
