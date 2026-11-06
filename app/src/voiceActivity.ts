export type UtteranceEnd = 'silence' | 'no-speech' | 'limit';
export interface ActivityOptions { silenceMs: number; minSpeechMs: number; noSpeechMs: number; maxMs: number; threshold: number }

// One click records one utterance. Duration is derived from audio frames, not UI timers.
export class VoiceActivity {
  elapsedMs = 0;
  rms = 0;
  peakRms = 0;
  private voicedMs = 0;
  private quietMs = 0;
  private speech = false;
  private ended = false;
  private options: ActivityOptions;
  constructor(options: Partial<ActivityOptions> = {}) { this.options = { silenceMs: 2000, minSpeechMs: 200, noSpeechMs: 10000, maxMs: 60000, threshold: 0.003, ...options }; }
  noteSpeech() { this.speech = true; this.quietMs = 0; }
  push(samples: ArrayLike<number>, sampleRate: number, scale = 1): UtteranceEnd | null {
    if (!samples.length || sampleRate <= 0) return null;
    const ms = samples.length / sampleRate * 1000;
    let energy = 0;
    for (let i = 0; i < samples.length; i++) energy += (samples[i] / scale) ** 2;
    this.rms = Math.sqrt(energy / samples.length); this.peakRms = Math.max(this.peakRms, this.rms); this.elapsedMs += ms;
    if (this.ended) return null;
    if (this.rms >= this.options.threshold) {
      this.voicedMs += ms; this.quietMs = 0;
      if (this.voicedMs >= this.options.minSpeechMs) this.speech = true;
    } else { this.quietMs += ms; if (!this.speech) this.voicedMs = 0; }
    const reason = this.elapsedMs >= this.options.maxMs ? 'limit' : this.speech && this.quietMs >= this.options.silenceMs ? 'silence' : !this.speech && this.elapsedMs >= this.options.noSpeechMs ? 'no-speech' : null;
    if (reason) this.ended = true;
    return reason;
  }
}
