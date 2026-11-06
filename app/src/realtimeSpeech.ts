import { VoiceActivity, type UtteranceEnd } from './voiceActivity.ts';
import { inputLevel, microphoneConstraints, selectedMicrophone, type InputLevel } from './microphone.ts';
import {createSpeechGate,type SpeechGate,type SpeechGateFactory} from './speechGate.ts';
type AsrEvent = { type: string; text?: string; segment?: number; message?: string; reason?: string };
interface Callbacks { partial: (text: string) => void; final: (text: string) => void; failed: (message: string) => void; ended?: (reason: UtteranceEnd) => void; elapsed?: (seconds: number) => void; level?: (level: InputLevel) => void; continuous?: boolean; sessionId?: string;speech?:()=>void }

export class RealtimeSpeech {
  private tracks: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private socket: WebSocket | null = null;
  private closed = false;
  private capturing = false;
  private finals = new Set<number>();
  private resolveEnd: (() => void) | null = null;
  private rejectEnd: ((error: Error) => void) | null = null;
  private rejectStart: ((error: Error) => void) | null = null;
  private flushed: (() => void) | null = null;
  private finishing: Promise<void> | null = null;
  private callbacks: Callbacks;
  private activity: VoiceActivity;
  private watchdog: ReturnType<typeof setInterval> | null = null;
  get peakRms() { return this.activity.peakRms; }
  private gate:SpeechGate|null=null;
  private gateFactory:SpeechGateFactory;
  private preroll:ArrayBuffer[]=[];
  get hasSpeech(){return this.gate?.hasSpeech===true;}
  constructor(callbacks: Callbacks,gateFactory:SpeechGateFactory=createSpeechGate) { this.callbacks = callbacks;this.gateFactory=gateFactory; this.activity = new VoiceActivity(callbacks.continuous ? { noSpeechMs: 60000 } : {}); }

  async start(deviceId = selectedMicrophone()) {
    try {
      // Resume in the initiating click and keep the hardware's native rate; the worklet resamples to 16k.
      const context = new AudioContext(); this.context = context;
      await context.resume();
      if (this.closed) return;
      const tracks = await navigator.mediaDevices.getUserMedia(microphoneConstraints(deviceId));
      if (this.closed) { tracks.getTracks().forEach(track => track.stop()); return; }
      this.tracks = tracks;
      this.gate=this.gateFactory({speech:()=>{if(this.closed)return;this.activity.noteSpeech();this.callbacks.speech?.();const socket=this.socket;if(socket?.readyState===WebSocket.OPEN){for(const bytes of this.preroll)socket.send(bytes);this.preroll=[];}},end:()=>{if(!this.closed&&!this.finishing)this.callbacks.ended?.('silence');}});
      await this.gate.start(tracks,context);if(this.closed)return;
      await context.audioWorklet.addModule('/audio/pcm-capture.js');
      if (this.closed) return;
      await context.resume();
      if (this.closed) return;
      const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/companion/asr/stream${this.callbacks.sessionId ? '?session=' + encodeURIComponent(this.callbacks.sessionId) : ''}`); this.socket = socket;
      socket.binaryType = 'arraybuffer';
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('实时识别连接超时，请检查声音设置。')), 15000);
        this.rejectStart = error => { clearTimeout(timer); reject(error); };
        const ready = () => { clearTimeout(timer); this.rejectStart = null; resolve(); };
        socket.onopen = () => { if (!this.closed) socket.send(JSON.stringify({ type: 'start' })); };
        socket.onmessage = event => {
          if (this.closed || typeof event.data !== 'string') return;
          let data: AsrEvent; try { data = JSON.parse(event.data); } catch { this.fail('实时识别返回格式无效。'); return; }
          if (!data || typeof data !== 'object' || Array.isArray(data) || typeof data.type !== 'string') { this.fail('实时识别返回格式无效。'); return; }
          if (data.type === 'ready') { ready(); return; }
          if (data.type === 'error') { clearTimeout(timer); this.fail(data.message || '这次实时识别没有完成。'); return; }
          if (data.type === 'partial' && typeof data.text === 'string'&&this.hasSpeech) this.callbacks.partial(data.text);
          if (data.type === 'final' && typeof data.segment === 'number') {
            if (!this.finals.has(data.segment)&&data.text?.trim()&&this.hasSpeech) { this.finals.add(data.segment);this.callbacks.final(data.text.trim()); }
            this.callbacks.partial('');
            if (data.reason === 'end' && this.resolveEnd) { this.resolveEnd(); this.resolveEnd = null; this.rejectEnd = null; }
            // A provider segment may end before the person's pause is over. Only local
            // audio silence (2s) or an explicit finish may submit the complete utterance.
          }
        };
        socket.onerror = () => { clearTimeout(timer); this.fail('无法连接实时识别，请检查平台设置。'); };
        socket.onclose = () => { clearTimeout(timer); if (!this.closed) this.fail('实时识别连接中断，已识别的文字仍保留。'); };
      });
      if (this.closed) return;
      const node = new AudioWorkletNode(context, 'companion-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' }); this.node = node;
      this.source = context.createMediaStreamSource(tracks);
      node.port.onmessage = event => {
        if (event.data?.type === 'flushed') { this.flushed?.(); this.flushed = null; return; }
        if (event.data?.type !== 'pcm' || !this.capturing || this.closed || socket.readyState !== WebSocket.OPEN) return;
        if (socket.bufferedAmount > 256 * 1024) { this.fail('识别服务处理较慢，已保留识别文字，请重新开始。'); return; }
        if(this.hasSpeech)socket.send(event.data.bytes);
        else{this.preroll.push(event.data.bytes);while(this.preroll.reduce((sum,bytes)=>sum+bytes.byteLength,0)>19200)this.preroll.shift();socket.send(new ArrayBuffer(event.data.bytes.byteLength));}
        if (!this.finishing) {
          const reason = this.activity.push(new Int16Array(event.data.bytes), 16000, 32768);
          this.callbacks.level?.(inputLevel(this.activity, tracks));
          this.callbacks.elapsed?.(Math.floor(this.activity.elapsedMs / 1000)); if (reason&&reason!=='silence') this.callbacks.ended?.(reason);
        }
      };
      node.onprocessorerror = () => this.fail('录音处理发生错误，请重新开始。');
      this.capturing = true;
      this.source.connect(node); node.connect(context.destination);
      const startedAt = Date.now();
      this.watchdog = setInterval(() => {
        if (context.state !== 'running') this.fail('录音已暂停，请保持页面打开后重试。');
        else if (Date.now() - startedAt > 4000 && this.activity.elapsedMs === 0) this.fail('浏览器没有送来麦克风音频，请在“声音 → 麦克风”检查耳机输入。');
        else if (Date.now() - startedAt >= 65000) this.callbacks.ended?.('limit');
      }, 2000);
    } catch (error) { this.cancel(); throw error; }
  }

  async finish() {
    if (this.finishing) return this.finishing;
    this.finishing = this.finishUtterance();
    return this.finishing;
  }
  private async finishUtterance() {
    if (this.closed) return;
    if (this.node && this.capturing) await new Promise<void>(resolve => {
      const timer = setTimeout(resolve, 250);
      this.flushed = () => { clearTimeout(timer); resolve(); };
      this.node!.port.postMessage({ type: 'flush' });
    });
    this.stopAudio();
    if (this.closed || this.socket?.readyState !== WebSocket.OPEN) { this.cancel(); return; }
    try {
      await new Promise<void>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('识别结束超时，已识别的文字仍保留，请重试。')), 10000);
        this.resolveEnd = () => { clearTimeout(timer); resolve(); };
        this.rejectEnd = error => { clearTimeout(timer); reject(error); };
        this.socket!.send(JSON.stringify({ type: 'end' }));
      });
    } finally { this.cancel(); }
  }
  cancel() {
    if (this.closed) return;
    this.closed = true; this.stopAudio();
    this.flushed?.(); this.flushed = null;
    this.rejectStart?.(new DOMException('Stopped', 'AbortError')); this.rejectStart = null;
    this.rejectEnd?.(new DOMException('Stopped', 'AbortError')); this.rejectEnd = null; this.resolveEnd = null;
    if (this.socket) {
      const socket = this.socket;
      socket.onmessage = null; socket.onclose = null; socket.onerror = null; socket.onopen = null;
      if (socket.readyState === WebSocket.OPEN) { socket.send(JSON.stringify({ type: 'cancel' })); socket.close(); }
      else if (socket.readyState === WebSocket.CONNECTING) { socket.onopen = () => socket.close(); }
      this.socket = null;
    }
  }
  private stopAudio() {
    const stopped=this.gate?.stop();this.preroll=[];
    if (this.watchdog) clearInterval(this.watchdog); this.watchdog = null;
    this.capturing = false; this.source?.disconnect(); this.node?.disconnect();
    if (this.node) this.node.port.onmessage = null;
    this.node = null; this.source = null;
    this.tracks?.getTracks().forEach(track => track.stop()); this.tracks = null;
    const context=this.context;this.context=null;
    if(context)void Promise.resolve(stopped).then(()=>context.state!=='closed'?context.close():undefined).catch(()=>{});
  }
  private fail(message: string) {
    if (this.closed) return;
    this.rejectStart?.(new Error(message)); this.rejectStart = null;
    this.rejectEnd?.(new Error(message)); this.rejectEnd = null;
    this.callbacks.failed(message); this.cancel();
  }
}
