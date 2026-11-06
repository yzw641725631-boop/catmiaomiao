import { request } from './api.ts';
import { speechText } from './projection.ts';

export interface PlaybackState { status: 'idle' | 'preparing' | 'speaking'; caption: string; error?: string }

export class SpeechController {
  generation = 0;
  private audio: HTMLAudioElement | null = null;
  private abort: AbortController | null = null;
  private release: (() => void) | null = null;
  private settle: (() => void) | null = null;
  private publish: (state: PlaybackState) => void;
  constructor(publish: (state: PlaybackState) => void) { this.publish = publish; }

  stop() {
    this.generation++;
    this.abort?.abort(); this.abort = null;
    this.audio?.pause(); this.audio = null;
    this.settle?.(); this.settle = null;
    this.release?.(); this.release = null;
    this.publish({ status: 'idle', caption: '' });
  }

  async speak(raw: string) {
    this.stop();
    const generation = this.generation;
    const abort = new AbortController(); this.abort = abort;
    try {
      this.publish({ status: 'preparing', caption: '准备播报…' });
      const prepared = await request<{ ready: boolean; utterances: string[] }>('/api/tts/prepare', { method: 'POST', body: JSON.stringify({ text: speechText(raw) }), signal: abort.signal });
      if (generation !== this.generation) return;
      if (!prepared.ready) throw new Error('先在声音设置中连接语音服务并选择声音。');
      for (const caption of prepared.utterances) {
        const response = await fetch('/api/tts/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: caption }), signal: abort.signal });
        if (!response.ok) {
          const failure = await response.json().catch(() => ({}));
          throw new Error(typeof failure.error === 'string' ? failure.error : '语音服务没有完成这段播报，可稍后重试。');
        }
        const mime = response.headers.get('content-type') || '';
        if (!/^audio\//i.test(mime)) throw new Error('声音服务没有返回音频，请检查声音设置。');
        await this.playResponse(response, caption, generation, abort.signal);
        if (generation !== this.generation) return;
      }
      this.publish({ status: 'idle', caption: '' });
    } catch (error) {
      if (generation === this.generation && !abort.signal.aborted) this.publish({ status: 'idle', caption: '', error: error instanceof Error ? error.message : '播报失败' });
    } finally {
      if (generation === this.generation) { this.release?.(); this.release = null; this.audio = null; this.settle = null; }
    }
  }

  private async playResponse(response: Response, caption: string, generation: number, signal: AbortSignal) {
    const streaming = response.headers.get('x-companion-audio-mode') === 'stream' && typeof MediaSource !== 'undefined' && MediaSource.isTypeSupported('audio/mpeg') && !!response.body;
    const source = streaming ? new MediaSource() : null;
    const blob = source ? null : await response.blob();
    if (generation !== this.generation || signal.aborted) return;
    await new Promise<void>((resolve, reject) => {
      const url = URL.createObjectURL(source || blob!);
      const audio = new Audio(url); this.audio = audio;
      let released = false, reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
      const release = () => {
        if (released) return; released = true;
        audio.pause(); URL.revokeObjectURL(url); void reader?.cancel().catch(() => {});
        audio.onended = null; audio.onerror = null; audio.onplaying = null;
        source?.removeEventListener('sourceopen', pump);
      };
      this.release = release; this.settle = resolve;
      const failed = (error: unknown) => { release(); reject(error instanceof Error && error.name === 'NotAllowedError' ? new Error('浏览器暂时阻止了自动播放，请点击回复旁的“听一听”继续。') : error instanceof Error ? error : new Error('音频播放中断，请重试。')); };
      audio.onplaying = () => generation === this.generation && this.publish({ status: 'speaking', caption });
      audio.onended = () => { release(); this.release = null; this.settle = null; resolve(); };
      audio.onerror = () => failed(new Error('当前设备无法播放该声音。'));
      const pump = async () => {
        try {
          if (!source || !response.body || released) return;
          const buffer = source.addSourceBuffer('audio/mpeg');
          reader = response.body.getReader(); let playing = false;
          while (!released && !signal.aborted) {
            const { value, done } = await reader.read(); if (done) break;
            if (released || signal.aborted) break;
            await new Promise<void>((appended, appendFailed) => {
              const cleanup = () => { buffer.removeEventListener('updateend', complete); buffer.removeEventListener('error', error); signal.removeEventListener('abort', cancelled); };
              const complete = () => { cleanup(); appended(); };
              const error = () => { cleanup(); appendFailed(new Error('音频片段无法播放。')); };
              const cancelled = () => { cleanup(); appendFailed(new DOMException('Stopped', 'AbortError')); };
              buffer.addEventListener('updateend', complete, { once: true }); buffer.addEventListener('error', error, { once: true }); signal.addEventListener('abort', cancelled, { once: true });
              try { buffer.appendBuffer(Uint8Array.from(value).buffer); } catch (failure) { cleanup(); appendFailed(failure); }
            });
            if (!playing && !released && !signal.aborted) { playing = true; void audio.play().catch(failed); }
          }
          if (!released && !signal.aborted && source.readyState === 'open') source.endOfStream();
          if (!playing && !released && !signal.aborted) failed(new Error('声音服务返回了空音频。'));
        } catch (error) { if (!released) failed(error); }
      };
      if (source) source.addEventListener('sourceopen', pump, { once: true });
      else void audio.play().catch(failed);
    });
  }
}
