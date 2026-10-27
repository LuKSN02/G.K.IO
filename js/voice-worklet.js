// ============================================================
// G.K.IO — AudioWorklet de supressão de ruído (RNNoise, WebAssembly)
// Roda na thread de áudio. Recebe o .wasm do thread principal (mensagem 'init'),
// processa o microfone em quadros de 480 amostras (10 ms a 48 kHz) e devolve o áudio limpo.
// Latência adicionada: ~10 ms. Com `enabled: false` apenas repassa o áudio.
// ============================================================
import createRNNWasmModule from './vendor/rnnoise/rnnoise.js';

const FRAME = 480;
const SCALE = 32768; // o RNNoise trabalha com amostras na escala de 16 bits

class GkRnnoiseProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.enabled = true;
    this.strength = 'standard'; // 'standard' | 'strong' (strong também fecha o "portão" quando não há voz)
    this.mod = null;
    this.state = 0;
    this.ptr = 0;
    this.dead = false;
    this.inBuf = new Float32Array(FRAME);
    this.inPos = 0;
    this.outBuf = new Float32Array(FRAME);
    this.outPos = FRAME; // vazio: o primeiro quadro de saída sai em silêncio
    this.gain = 1;
    this.vad = 0;
    this.port.onmessage = (e) => this.onMessage(e.data || {});
  }

  async onMessage(m) {
    if (m.type === 'init') {
      try {
        const mod = await createRNNWasmModule({ wasmBinary: m.wasm });
        this.state = mod._rnnoise_create(0);
        this.ptr = mod._malloc(FRAME * 4);
        this.mod = mod;
        this.port.postMessage({ type: 'ready' });
      } catch (err) {
        this.port.postMessage({ type: 'error', message: String((err && err.message) || err) });
      }
    } else if (m.type === 'config') {
      if ('enabled' in m) this.enabled = !!m.enabled;
      if (m.strength) this.strength = m.strength;
    } else if (m.type === 'destroy') {
      this.dead = true;
      try {
        if (this.mod && this.ptr) this.mod._free(this.ptr);
        if (this.mod && this.state) this.mod._rnnoise_destroy(this.state);
      } catch (e) { /* já liberado */ }
      this.mod = null;
    }
  }

  runFrame() {
    const mod = this.mod;
    const heap = mod.HEAPF32; // pode ser recriado se a memória crescer: sempre ler de novo
    const base = this.ptr >> 2;
    heap.set(this.inBuf, base);
    this.vad = mod._rnnoise_process_frame(this.state, this.ptr, this.ptr);
    this.outBuf.set(mod.HEAPF32.subarray(base, base + FRAME));
    this.outPos = 0;
  }

  process(inputs, outputs) {
    const output = outputs[0] && outputs[0][0];
    if (!output) return !this.dead;
    const input = inputs[0] && inputs[0][0];
    if (!input) { output.fill(0); return !this.dead; }
    if (!this.enabled || !this.mod) { output.set(input); return !this.dead; }

    const gateTarget = () => (this.strength === 'strong' && this.vad < 0.3 ? 0 : 1);
    for (let i = 0; i < input.length; i++) {
      this.inBuf[this.inPos++] = input[i] * SCALE;
      if (this.inPos === FRAME) { this.runFrame(); this.inPos = 0; }
      let s = 0;
      if (this.outPos < FRAME) s = this.outBuf[this.outPos++] / SCALE;
      this.gain += (gateTarget() - this.gain) * 0.004;
      output[i] = s * this.gain;
    }
    return !this.dead;
  }
}

registerProcessor('gkio-rnnoise', GkRnnoiseProcessor);
