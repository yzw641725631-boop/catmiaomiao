import { Pcm16Resampler } from './pcm-resampler.mjs';

class CompanionPcmCapture extends AudioWorkletProcessor {
  constructor() {
    super(); this.resampler = new Pcm16Resampler(sampleRate);
    this.port.onmessage = event => {
      if (event.data?.type !== 'flush') return;
      const bytes = this.resampler.flush(); if (bytes) this.port.postMessage({ type: 'pcm', bytes }, [bytes]);
      this.port.postMessage({ type: 'flushed' });
    };
  }
  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    if (input) for (const bytes of this.resampler.process(input)) this.port.postMessage({ type: 'pcm', bytes }, [bytes]);
    for (const output of outputs) for (const channel of output) channel.fill(0);
    return true;
  }
}
registerProcessor('companion-pcm-capture', CompanionPcmCapture);
