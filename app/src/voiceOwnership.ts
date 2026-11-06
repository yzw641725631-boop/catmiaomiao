import { post } from './api.ts';

// Held across utterances, model waiting and playback, including separate browsers.
export class VoiceOwnership {
  id = '';
  onLost: (message: string) => void = () => {};
  private timer: ReturnType<typeof setInterval> | null = null;
  private generation = 0;
  async claim() {
    const generation = ++this.generation, id = crypto.randomUUID();
    await post('/companion/voice/session', { action: 'claim', id });
    if (generation !== this.generation) { void post('/companion/voice/session', { action: 'release', id }).catch(() => {}); return false; }
    if (this.timer) clearInterval(this.timer);
    this.id = id;
    this.timer = setInterval(() => void post('/companion/voice/session', { action: 'renew', id }).catch(error => {
      if (this.id !== id) return;
      this.release(); this.onLost(error instanceof Error ? error.message : '语音连接已暂停，请重新开启。');
    }), 10000);
    return true;
  }
  release() {
    this.generation++; const id = this.id; this.id = '';
    if (this.timer) clearInterval(this.timer); this.timer = null;
    if (id) void post('/companion/voice/session', { action: 'release', id }).catch(() => {});
  }
}
