import { VoiceReplies } from './voiceReplies.ts';
import type { WireMessage } from './types.ts';

export type VoicePhase = 'off' | 'listening' | 'waiting' | 'speaking' | 'paused' | 'error';
export interface SessionCapture { cancel(): void; finish(): Promise<void> }
interface CaptureHandlers { complete(text: string): void; failed(message: string, partial: string): void; noSpeech(): void; activity?():void }
interface Dependencies {
  capture(handlers: CaptureHandlers): SessionCapture;
  submit(text: string, arm: (sendId: string) => void): Promise<boolean | 'background'>;
  speak(text: string): Promise<void>;
  stopSpeech(): void;
  changed(phase: VoicePhase): void;
  failed(message: string, draft?: string): void;
}

// One user action enables the conversation. Generations prevent late ASR/model/TTS
// results from reopening a microphone after switching to typing or opening settings.
export class ContinuousVoice {
  enabled = false;
  phase: VoicePhase = 'off';
  private generation = 0;
  private recorder: SessionCapture | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private waitingTimer: ReturnType<typeof setTimeout> | null = null;
  private replies = new VoiceReplies();
  private deps: Dependencies;
  private replyTimeoutMs: number;
  private concurrent:boolean;
  private pending=new Map<string,{replies:VoiceReplies;timer:ReturnType<typeof setTimeout>}>();
  private ready:string[]=[];
  private userTalking=false;
  constructor(deps: Dependencies, replyTimeoutMs = 45000, concurrent=true) { this.deps = deps; this.replyTimeoutMs = replyTimeoutMs;this.concurrent=concurrent; }
  private change(phase: VoicePhase) { this.phase = phase; this.deps.changed(phase); }
  private cancelPending() {
    this.generation++; if (this.timer) clearTimeout(this.timer); this.timer = null;
    if (this.waitingTimer) clearTimeout(this.waitingTimer); this.waitingTimer = null;
    this.recorder?.cancel(); this.recorder = null; this.replies.clear(); this.deps.stopSpeech();
    for(const request of this.pending.values())clearTimeout(request.timer);this.pending.clear();this.ready=[];this.userTalking=false;
  }
  start() { this.cancelPending(); this.enabled = true; this.listen(); }
  stop() { this.enabled = false; this.cancelPending(); this.change('off'); }
  pause() { if (!this.enabled || this.phase === 'paused') return; this.cancelPending(); this.change('paused'); }
  resume() { if (this.enabled && this.phase === 'paused') this.listen(); }
  interrupt() { if (this.enabled) { this.cancelPending(); this.listen(); } }
  async finish() { await this.recorder?.finish(); }
  private later() {
    if (!this.enabled) return;
    const generation = this.generation;
    this.timer = setTimeout(() => { this.timer = null; if (this.enabled && generation === this.generation) {if(this.concurrent)this.change('listening');if(!this.playReady())this.listen();} }, 300);
  }
  private listen() {
    if (!this.enabled) return;
    const generation = ++this.generation;this.userTalking=false; this.change('listening');
    let completed = false;
    this.recorder = this.deps.capture({
      activity:()=>{if(generation===this.generation)this.userTalking=true;},
      complete: text => { if (!completed && generation === this.generation && this.enabled) { completed = true; void this.send(text, generation); } },
      noSpeech: () => { if (!completed && generation === this.generation && this.enabled) { completed = true; this.recorder = null; this.later(); } },
      failed: (message, partial) => { if (!completed && generation === this.generation && this.enabled) { completed = true; this.recorder = null; this.change('error'); this.deps.failed(message, partial); } },
    });
  }
  private async send(text: string, generation: number) {
    this.recorder = null;this.userTalking=false; this.change('waiting');
    let result: boolean | 'background' = false;
    let requestId='';
    try { result = await this.deps.submit(text, sendId => {
      if(!this.concurrent){this.replies.arm(sendId);return;}
      requestId=sendId;const replies=new VoiceReplies();replies.arm(sendId);
      const timer=setTimeout(()=>this.pending.delete(sendId),Math.max(180000,this.replyTimeoutMs));this.pending.set(sendId,{replies,timer});
    }); } catch {}
    if (!this.enabled || generation !== this.generation) return;
    if(this.concurrent){
      if(!result||result==='background'){const request=this.pending.get(requestId);if(request)clearTimeout(request.timer);this.pending.delete(requestId);}
      if(!result)this.deps.failed('这句话暂时没有发送成功，识别文字已保留。',text);
      this.later();return;
    }
    if (!result) { this.replies.clear(); this.deps.failed('这句话暂时没有发送成功，识别文字已保留。', text); this.later(); }
    else if (result === 'background') { this.replies.clear(); this.later(); }
    else if (this.phase === 'waiting') this.waitingTimer = setTimeout(() => {
      this.waitingTimer = null;
      if (!this.enabled || generation !== this.generation || this.phase !== 'waiting') return;
      this.replies.clear(); this.deps.failed('这句话已发送，暂未收到对应回复。我会继续听；稍后的回复会保留在对话里，不会重复发送。'); this.later();
    }, this.replyTimeoutMs);
  }
  receive(histories: Record<string, WireMessage[]>) {
    if(this.concurrent){
      if(!this.enabled||this.phase==='paused'||this.phase==='error')return;
      for(const [id,request] of this.pending){const result=request.replies.takeResult(histories);if(!result)continue;clearTimeout(request.timer);this.pending.delete(id);if(result.error)this.deps.failed(result.error);else if(result.reply?.text)this.ready.push(result.reply.text);}
      this.playReady();return;
    }
    if (!this.enabled || this.phase !== 'waiting') return;
    const result = this.replies.takeResult(histories); if (!result) return;
    if (this.waitingTimer) clearTimeout(this.waitingTimer); this.waitingTimer = null;
    const generation = this.generation;
    if (result.error) { this.deps.failed(result.error); this.later(); return; }
    this.change('speaking');
    void this.deps.speak(result.reply!.text!).catch(() => this.deps.failed('这次声音未播完，回复文字已保留。')).finally(() => { if (this.enabled && generation === this.generation) this.later(); });
  }
  private playReady(){
    if(!this.enabled||!this.ready.length||this.userTalking||['speaking','paused','off','error','waiting'].includes(this.phase))return false;
    if(this.timer)clearTimeout(this.timer);this.timer=null;this.recorder?.cancel();this.recorder=null;
    const generation=++this.generation,text=this.ready.shift()!;this.change('speaking');
    void this.deps.speak(text).catch(()=>this.deps.failed('这次声音未播完，回复文字已保留。')).finally(()=>{if(this.enabled&&generation===this.generation){this.change('listening');this.later();}});return true;
  }
}
