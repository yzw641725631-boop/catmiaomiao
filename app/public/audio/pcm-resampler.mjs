export class Pcm16Resampler {
  constructor(inputRate, outputRate = 16000, frameSamples = 640) {
    if (!Number.isFinite(inputRate) || inputRate < outputRate || inputRate > 192000) throw new Error('Unsupported audio rate');
    this.ratio = inputRate / outputRate;
    this.sum = 0; this.weight = 0; this.cursor = 0; this.frame = new ArrayBuffer(frameSamples * 2); this.frameSamples = frameSamples;
  }
  process(input) {
    const frames = [];
    for (const inputValue of input) {
      const value = Number.isFinite(inputValue) ? Math.max(-1, Math.min(1, inputValue)) : 0;
      let remaining = 1;
      while (remaining > 1e-8) {
        const take = Math.min(remaining, this.ratio - this.weight);
        this.sum += value * take; this.weight += take; remaining -= take;
        if (this.weight >= this.ratio - 1e-8) {
          const sample = this.sum / this.weight;
          new DataView(this.frame).setInt16(this.cursor++ * 2, Math.round(sample * (sample < 0 ? 32768 : 32767)), true);
          this.sum = 0; this.weight = 0;
          if (this.cursor === this.frameSamples) { frames.push(this.frame); this.frame = new ArrayBuffer(this.frameSamples * 2); this.cursor = 0; }
        }
      }
    }
    return frames;
  }
  flush() {
    if (!this.cursor) return null;
    const final = this.frame.slice(0, this.cursor * 2); this.frame = new ArrayBuffer(this.frameSamples * 2); this.cursor = 0;
    return final;
  }
}
