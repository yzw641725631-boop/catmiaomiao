import { RealtimeSpeech } from './realtimeSpeech.ts';
import { VoiceActivity, type UtteranceEnd } from './voiceActivity.ts';
import { inputLevel, microphoneConstraints, microphoneError, selectedMicrophone, silentMicrophone, type InputLevel } from './microphone.ts';
import {createSpeechGate,type SpeechGate,type SpeechGateFactory} from './speechGate.ts';

export type CaptureStatus = 'idle' | 'starting' | 'recording' | 'transcribing';
interface Callbacks {
  status: (status: CaptureStatus) => void;
  partial: (text: string) => void;
  elapsed: (seconds: number) => void;
  complete: (text: string) => void;
  failed: (message: string, partial: string) => void;
  level?: (level: InputLevel) => void;
  noSpeech?: () => void;
  activity?:()=>void;
}
export class VoiceCapture {
  private closed = false;
  private finishing = false;
  private realtime: RealtimeSpeech | null = null;
  private recorder: MediaRecorder | null = null;
  private tracks: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private node: AudioWorkletNode | null = null;
  private abort: AbortController | null = null;
  private finals: string[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private callbacks: Callbacks;
  private activity: VoiceActivity;
  private sessionId: string;
  private speechGate:SpeechGate|null=null;
  private gateFactory:SpeechGateFactory;
  constructor(callbacks: Callbacks, sessionId = '',gateFactory:SpeechGateFactory=createSpeechGate) { this.callbacks = callbacks; this.sessionId = sessionId;this.gateFactory=gateFactory; this.activity = new VoiceActivity(callbacks.noSpeech ? { noSpeechMs: 60000 } : {}); }

  async start(mode: 'file' | 'realtime', deviceId = selectedMicrophone()) {
    this.callbacks.status('starting');
    try {
      if (mode === 'realtime') {
        const recorder = new RealtimeSpeech({
          partial: text => { if (!this.closed) this.callbacks.partial(text); },
          final: text => { if (!this.closed) this.finals.push(text); },
          failed: message => this.fail(message),
          elapsed: seconds => { if (!this.closed) this.callbacks.elapsed(seconds); },
          ended: reason => this.endDetected(reason),
          level: level => { if (!this.closed) this.callbacks.level?.(level); },
          continuous: !!this.callbacks.noSpeech,
          speech:()=>{if(!this.closed)this.callbacks.activity?.();},
          sessionId: this.sessionId,
        },this.gateFactory);
        this.realtime = recorder; await recorder.start(deviceId);
      } else await this.startFile(deviceId);
      if (!this.closed && !this.finishing) this.callbacks.status('recording');
    } catch (error) {
      this.fail(microphoneError(error));
    }
  }
  private async startFile(deviceId: string) {
    const context = new AudioContext(); this.context = context;
    await context.resume();
    if (this.closed) return;
    const tracks = await navigator.mediaDevices.getUserMedia(microphoneConstraints(deviceId));
    if (this.closed) { tracks.getTracks().forEach(track => track.stop()); return; }
    this.tracks = tracks;
    const gate=this.gateFactory({speech:()=>{if(!this.closed){this.activity.noteSpeech();this.callbacks.activity?.();}},end:()=>this.endDetected('silence')});this.speechGate=gate;
    await gate.start(tracks,context);if(this.closed)return;
    await context.audioWorklet.addModule('/audio/pcm-capture.js');
    if (this.closed) return;
    await context.resume();
    if (this.closed) return;
    const recorder = new MediaRecorder(tracks); this.recorder = recorder;
    const chunks: Blob[] = [], activity = this.activity;
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => this.fail('录音中断，请检查麦克风。');
    recorder.onstop = () => { if (!this.closed) void this.transcribe(new Blob(chunks, { type: recorder.mimeType })); };
    const node = new AudioWorkletNode(context, 'companion-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' }); this.node = node;
    node.port.onmessage = event => {
      if (this.closed || this.finishing || event.data?.type !== 'pcm') return;
      const reason = activity.push(new Int16Array(event.data.bytes), 16000, 32768);
      this.callbacks.level?.(inputLevel(activity, tracks));
      this.callbacks.elapsed(Math.floor(activity.elapsedMs / 1000)); if (reason&&reason!=='silence') this.endDetected(reason);
    };
    node.onprocessorerror = () => this.fail('录音处理发生错误，请重新开始。');
    this.source = context.createMediaStreamSource(tracks); this.source.connect(node); node.connect(context.destination);
    recorder.start();
    const startedAt = Date.now();
    this.timer = setInterval(() => { if (context.state !== 'running') this.fail('录音已暂停，请保持页面打开后重试。'); else if (Date.now() - startedAt > 4000 && activity.elapsedMs === 0) this.fail('浏览器没有送来麦克风音频，请在“声音 → 麦克风”检查耳机输入。'); else if (Date.now() - startedAt >= 65000) void this.finish(); }, 2000);
  }
  private endDetected(reason: UtteranceEnd) {
    if (this.closed || this.finishing) return;
    if (['no-speech', 'limit'].includes(reason) && !(this.realtime?.hasSpeech??this.speechGate?.hasSpeech)) { this.empty(); return; }
    void this.finish();
  }
  async finish() {
    if (this.closed || this.finishing) return;
    if(!(this.realtime?.hasSpeech??this.speechGate?.hasSpeech)){this.empty();return;}
    this.finishing = true; this.callbacks.status('transcribing');
    if (this.realtime) {
      try { await this.realtime.finish(); if (!this.closed) this.done(this.finals.join(' ')); }
      catch (error) { this.fail(error instanceof Error ? error.message : '实时识别未完成。'); }
    } else if (this.recorder?.state !== 'inactive') { this.recorder?.stop(); this.stopAudio(); }
  }
  private async transcribe(blob: Blob) {
    this.finishing = true; this.stopAudio(); this.callbacks.status('transcribing');
    const abort = new AbortController(); this.abort = abort;
    try {
      const body = new FormData(); body.append('file', blob, 'voice.webm');
      const response = await fetch('/companion/transcribe', { method: 'POST', body, headers: { 'x-companion-voice-session': this.sessionId }, signal: AbortSignal.any([abort.signal, AbortSignal.timeout(60000)]) });
      const result = await response.json();
      if (!response.ok || typeof result.text !== 'string') throw new Error(result.error || '这段话没有识别成功，请重试。');
      if (!this.closed) this.done(result.text);
    } catch (error) { if (!this.closed) this.fail(error instanceof Error ? error.message : '语音识别失败。'); }
  }
  private done(text: string) {
    if (!text.trim()) { if (this.callbacks.noSpeech) this.empty(); else this.fail('麦克风有输入，但没有识别出文字。请靠近耳机麦克风重试，或到“声音 → 麦克风”测试输入。'); return; }
    this.cancel(); this.callbacks.complete(text.trim());
  }
  private fail(message: string) {
    if (this.closed) return;
    const partial = this.finals.join(' '); this.cancel(); this.callbacks.failed(message, partial);
  }
  private empty() { if (this.callbacks.noSpeech) { this.cancel(); this.callbacks.noSpeech(); } else this.fail(silentMicrophone); }
  cancel() {
    if (this.closed) return;
    this.closed = true; this.abort?.abort(); this.abort = null;
    this.realtime?.cancel(); this.realtime = null;
    if (this.recorder) {
      this.recorder.onstop = null; this.recorder.ondataavailable = null; this.recorder.onerror = null;
      if (this.recorder.state !== 'inactive') this.recorder.stop(); this.recorder = null;
    }
    this.stopAudio(); this.callbacks.partial(''); this.callbacks.status('idle');
  }
  private stopAudio() {
    const stopped=this.speechGate?.stop();this.speechGate=null;
    if (this.timer) clearInterval(this.timer); this.timer = null;
    this.source?.disconnect(); this.node?.disconnect(); if (this.node) this.node.port.onmessage = null;
    this.source = null; this.node = null;
    this.tracks?.getTracks().forEach(track => track.stop()); this.tracks = null;
    const context=this.context;this.context=null;
    if(context)void Promise.resolve(stopped).then(()=>context.state!=='closed'?context.close():undefined).catch(()=>{});
  }
}
