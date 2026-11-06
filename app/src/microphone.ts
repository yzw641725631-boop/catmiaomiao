import { VoiceActivity } from './voiceActivity.ts';

const preferenceKey = 'companion.microphone-device';
export function selectedMicrophone() { try { return localStorage.getItem(preferenceKey) || ''; } catch { return ''; } }
export function selectMicrophone(deviceId: string) { try { localStorage.setItem(preferenceKey, deviceId); } catch {} }
export function microphoneConstraints(deviceId = ''): MediaStreamConstraints {
  return { audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...(deviceId ? { deviceId: { exact: deviceId } } : {}) } };
}
export function microphoneError(error: unknown) {
  const name = error instanceof Error ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') return '麦克风权限未开启，请允许此页面使用麦克风，并检查 Windows 的麦克风隐私设置。';
  if (name === 'NotFoundError') return '没有找到麦克风，请连接耳机麦克风后重新读取设备。';
  if (name === 'OverconstrainedError') return '之前选择的麦克风已不可用，请在“声音 → 麦克风”重新选择耳机输入。';
  if (name === 'NotReadableError') return '麦克风暂时无法使用，请检查耳机连接，以及是否被其他应用独占。';
  return error instanceof Error ? error.message : '无法开始录音，请检查麦克风。';
}
export interface InputLevel { rms: number; peakRms: number; percent: number; seconds: number; muted: boolean; label: string }
export function inputLevel(activity: VoiceActivity, stream: MediaStream): InputLevel {
  const track = stream.getTracks()[0];
  const db = activity.rms > 0 ? 20 * Math.log10(activity.rms) : -90;
  return { rms: activity.rms, peakRms: activity.peakRms, percent: Math.round(Math.max(0, Math.min(100, (db + 70) / 70 * 100))), seconds: activity.elapsedMs / 1000, muted: !!track?.muted, label: track?.label || '当前麦克风' };
}
export const silentMicrophone = '麦克风没有输入声音：请在“声音 → 麦克风”选择耳机麦克风，并检查耳机静音键。';

// Local input test: uses the same capture worklet, never stores or uploads audio.
export class MicrophoneProbe {
  private closed = false;
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private level: InputLevel | null = null;
  private onLevel: (level: InputLevel) => void;
  private onEnd: (message: string, error: boolean) => void;
  constructor(onLevel: (level: InputLevel) => void, onEnd: (message: string, error: boolean) => void) { this.onLevel = onLevel; this.onEnd = onEnd; }
  async start(deviceId = selectedMicrophone()) {
    try {
      const context = new AudioContext(); this.context = context;
      await context.resume();
      if (this.closed) return;
      const stream = await navigator.mediaDevices.getUserMedia(microphoneConstraints(deviceId));
      if (this.closed) { stream.getTracks().forEach(track => track.stop()); return; }
      this.stream = stream;
      await context.audioWorklet.addModule('/audio/pcm-capture.js');
      if (this.closed) return;
      const activity = new VoiceActivity();
      const node = new AudioWorkletNode(context, 'companion-pcm-capture', { numberOfInputs: 1, numberOfOutputs: 1, outputChannelCount: [1], channelCount: 1, channelCountMode: 'explicit' }); this.node = node;
      node.port.onmessage = event => {
        if (this.closed || event.data?.type !== 'pcm') return;
        activity.push(new Int16Array(event.data.bytes), 16000, 32768);
        this.level = inputLevel(activity, stream); this.onLevel(this.level);
      };
      node.onprocessorerror = () => this.end('浏览器未能处理麦克风音频，请重新测试或换用 Chrome / Edge。', true);
      this.source = context.createMediaStreamSource(stream); this.source.connect(node); node.connect(context.destination);
      this.timer = setTimeout(() => {
        const peak = this.level?.peakRms || 0;
        this.end(!this.level ? '浏览器没有送来麦克风音频，请检查设备、页面权限和输入连接。' : peak < 0.00005 ? silentMicrophone : peak < 0.003 ? '已收到声音，但输入较小；可以靠近耳机麦克风，或提高 Windows 的麦克风输入音量。' : '已收到麦克风声音，关闭设置后可以开始对话。', !this.level || peak < 0.00005);
      }, 15000);
    } catch (error) { if (!this.closed) this.end(microphoneError(error), true); }
  }
  private end(message: string, error: boolean) { if (this.closed) return; this.cancel(); this.onEnd(message, error); }
  cancel() {
    if (this.closed) return;
    this.closed = true; if (this.timer) clearTimeout(this.timer); this.timer = null;
    this.source?.disconnect(); this.node?.disconnect(); if (this.node) this.node.port.onmessage = null;
    this.source = null; this.node = null;
    this.stream?.getTracks().forEach(track => track.stop()); this.stream = null;
    if (this.context && this.context.state !== 'closed') void this.context.close().catch(() => {}); this.context = null;
  }
}
