// Media link: hands the microphone to the page as 20 ms chunks of 16-bit PCM (see apps/phone/src/link.ts).
class OmnicamPcm extends AudioWorkletProcessor {
  constructor() {
    super();
    this.chunk = new Int16Array(Math.round(sampleRate / 50));
    this.filled = 0;
  }

  process(inputs) {
    const samples = inputs[0]?.[0];
    if (samples) {
      for (let i = 0; i < samples.length; i++) {
        this.chunk[this.filled++] = Math.max(-1, Math.min(1, samples[i])) * 32767;
        if (this.filled === this.chunk.length) {
          const full = this.chunk;
          this.chunk = new Int16Array(full.length);
          this.filled = 0;
          this.port.postMessage(full.buffer, [full.buffer]);
        }
      }
    }
    return true;
  }
}
registerProcessor('omnicam-pcm', OmnicamPcm);
