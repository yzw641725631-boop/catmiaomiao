import {speechGateFixture} from './fixtures/speech-gate.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceActivity } from '../src/voiceActivity.ts';
import { VoiceCapture } from '../src/voiceCapture.ts';
import { VoiceReplies } from '../src/voiceReplies.ts';
import { MicrophoneProbe } from '../src/microphone.ts';

test('utterance detection tolerates short pauses, finishes once and never treats silence as speech', () => {
  const activity = new VoiceActivity(), voice = new Float32Array(1600).fill(0.06), quiet = new Float32Array(1600);
  assert.equal(activity.push(voice, 16000), null); assert.equal(activity.push(voice, 16000), null);
  for (let i = 0; i < 8; i++) assert.equal(activity.push(quiet, 16000), null);
  assert.equal(activity.push(voice, 16000), null);
  for (let i = 0; i < 19; i++) assert.equal(activity.push(quiet, 16000), null);
  assert.equal(activity.push(quiet, 16000), 'silence'); assert.equal(activity.push(quiet, 16000), null);
  const silent = new VoiceActivity(); for (let i = 0; i < 99; i++) assert.equal(silent.push(quiet, 16000), null);
  assert.equal(silent.push(quiet, 16000), 'no-speech');
  const click = new VoiceActivity(); click.push(voice, 16000); for (let i = 0; i < 20; i++) assert.equal(click.push(quiet, 16000), null);
});
test('voice replies bind to the original user send and survive a terminal patch with the same message id', () => {
  const queue = new VoiceReplies(); queue.arm('voice-send');
  const user = { id: 'user', role: 'user', kind: 'text', at: 1, sendId: 'voice-send', requestPending: true };
  const reply = { id: 'reply', role: 'bot', kind: 'text', at: 3, text: '语音回复', requestMessageId: 'user', turnTerminal: false, turnSucceeded: true };
  assert.equal(queue.take({ chat: [user, reply] }), null);
  assert.equal(queue.take({ chat: [{ ...user, requestPending: false }, { ...reply, turnTerminal: true, requestMessageId: 'other-user' }] }), null);
  const completed = { ...reply, turnTerminal: true };
  assert.equal(queue.take({ chat: [{ ...user, requestPending: false }, completed] })?.id, 'reply');
  assert.equal(queue.take({ chat: [{ ...user, requestPending: false }, completed] }), null);
  queue.arm('voice-send'); queue.clear(); assert.equal(queue.take({ chat: [{ ...user, requestPending: false }, completed] }), null);
});

test('voice failure explains upstream verification even when an earlier failed tool turn has text', () => {
  const queue = new VoiceReplies(); queue.arm('voice-send');
  const user = { id: 'user', role: 'user', kind: 'text', sendId: 'voice-send', requestPending: true };
  const messages = [user,
    { id: 'unrelated', role: 'bot', kind: 'activity', tool: { name: 'MODEL_UPSTREAM_WEB_VERIFICATION', ok: false, terminal: true }, requestMessageId: 'another-user' },
    { id: 'partial', role: 'bot', kind: 'text', text: '已安排文档助理。', requestMessageId: 'user', turnTerminal: true, turnSucceeded: false },
    { id: 'failure', role: 'bot', kind: 'activity', tool: { name: 'error: upstream HTTP 503: 模型上游需要网页验证', ok: false, terminal: true }, requestMessageId: 'user' },
  ];
  assert.equal(queue.takeResult({ chat: messages.slice(0, -1) }), null);
  const result = queue.takeResult({ chat: messages });
  assert.match(result.error, /已经识别并发送/); assert.match(result.error, /网页验证/); assert.match(result.error, /模型连接/);
  assert.equal(result.reply, undefined); assert.equal(queue.takeResult({ chat: messages }), null);
});

function audioFixture({ deferredMedia = false } = {}) {
  const names = ['navigator', 'AudioContext', 'AudioWorkletNode', 'WebSocket', 'MediaRecorder', 'location', 'fetch'];
  const gate=speechGateFixture();
  const originals = new Map(names.map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  let node, socket, context, recorder, deliverMedia, fetches = 0, constraints;
  const tracks = { stopped: false, getTracks: () => [{ label: 'Headset microphone', muted: false, stop: () => { tracks.stopped = true; } }] };
  class Context {
    state = 'running'; destination = {}; audioWorklet = { addModule: async () => {} };
    constructor() { context = this; } async resume() {} async close() { this.state = 'closed'; }
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
  }
  class Worklet {
    port = { onmessage: null, postMessage: message => { if (message.type === 'flush') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'flushed' } })); } };
    constructor() { node = this; } connect() {} disconnect() {}
  }
  class Socket {
    static OPEN = 1; static CONNECTING = 0; readyState = 0; bufferedAmount = 0; sent = [];
    constructor() { socket = this; queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    emit(data) { this.onmessage?.({ data: JSON.stringify(data) }); }
    send(data) {
      this.sent.push(data); if (typeof data !== 'string') return;
      const message = JSON.parse(data);
      if (message.type === 'start') queueMicrotask(() => this.emit({ type: 'ready' }));
      // Real services may finalize the same segment twice (VAD then end acknowledgement).
      if (message.type === 'end') queueMicrotask(() => this.emit({ type: 'final', segment: 0, text: '', reason: 'end' }));
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  class Recorder {
    state = 'inactive'; mimeType = 'audio/webm'; constructor() { recorder = this; }
    start() { this.state = 'recording'; }
    stop() { this.state = 'inactive'; queueMicrotask(() => { this.ondataavailable?.({ data: new Blob(['test audio']) }); this.onstop?.(); }); }
  }
  const values = { navigator: { mediaDevices: { getUserMedia: request => { constraints = request; return deferredMedia ? new Promise(resolve => { deliverMedia = resolve; }) : Promise.resolve(tracks); } } }, AudioContext: Context, AudioWorkletNode: Worklet, WebSocket: Socket, MediaRecorder: Recorder, location: { protocol: 'http:', host: '127.0.0.1:5217' }, fetch: async () => { fetches++; return Response.json({ text: '文件录音识别结果' }); } };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return { gate,tracks, get constraints() { return constraints; }, get node() { return node; }, get socket() { return socket; }, get context() { return context; }, get fetches() { return fetches; }, deliver: () => deliverMedia(tracks), restore() { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } } };
}
const settle = async () => { for (let i = 0; i < 8; i++) await new Promise(resolve => setImmediate(resolve)); };
function callbacks() { const complete = [], failed = [], states = []; return { complete, failed, states, api: { status: state => states.push(state), partial() {}, elapsed() {}, complete: text => complete.push(text), failed: message => failed.push(message) } }; }

test('provider VAD or raw audio silence cannot submit before the confirmed local speech-end event', async () => {
  const env = audioFixture(), result = callbacks(), capture = new VoiceCapture(result.api,'',env.gate.factory);
  try {
    await capture.start('realtime'); env.gate.speech(); env.socket.emit({ type: 'final', segment: 0, text: '真实停句', reason: 'vad' });
    await settle(); assert.deepEqual(result.complete, []);
    const push = value => env.node.port.onmessage?.({ data: { type: 'pcm', bytes: new Int16Array(1600).fill(value).buffer } });
    push(5000); push(5000); for (let i = 0; i < 19; i++) push(0);
    assert.deepEqual(result.complete, []); assert(!env.socket.sent.some(value => typeof value === 'string' && JSON.parse(value).type === 'end'));
    push(0);env.gate.end();
    await settle(); assert.deepEqual(result.complete, ['真实停句']); assert.deepEqual(result.failed, []);
    assert.equal(env.socket.sent.filter(value => typeof value === 'string' && JSON.parse(value).type === 'end').length, 1);
    assert(env.tracks.stopped); assert.equal(env.context.state, 'closed');
    env.socket.emit({ type: 'final', segment: 0, text: 'late', reason: 'vad' }); await capture.finish(); assert.equal(result.complete.length, 1);
  } finally { capture.cancel(); env.restore(); }
});
test('file capture stops after speech and silence, transcribes once and releases the microphone', async () => {
  const env = audioFixture(), result = callbacks(), capture = new VoiceCapture(result.api,'',env.gate.factory);
  try {
    await capture.start('file');
    const push = value => env.node.port.onmessage?.({ data: { type: 'pcm', bytes: new Int16Array(1600).fill(value).buffer } });
    env.gate.speech();push(5000); push(5000); for (let i = 0; i < 20; i++) push(0);env.gate.end();env.gate.end();
    await settle(); assert.deepEqual(result.complete, ['文件录音识别结果']); assert.equal(env.fetches, 1); assert(env.tracks.stopped); assert.equal(env.context.state, 'closed');
  } finally { capture.cancel(); env.restore(); }
});
test('no-speech and explicit cancellation do not send audio or late transcriptions', async () => {
  const env = audioFixture(), result = callbacks(), capture = new VoiceCapture(result.api,'',env.gate.factory);
  try {
    await capture.start('file'); for (let i = 0; i < 100; i++) env.node.port.onmessage?.({ data: { type: 'pcm', bytes: new Int16Array(1600).buffer } });
    await settle(); assert.equal(env.fetches, 0); assert.equal(result.complete.length, 0); assert.equal(result.failed.length, 1); assert(env.tracks.stopped);
  } finally { capture.cancel(); env.restore(); }
  const late = audioFixture({ deferredMedia: true }), second = callbacks(), cancelled = new VoiceCapture(second.api,'',late.gate.factory);
  try { const starting = cancelled.start('file'); await settle(); cancelled.cancel(); late.deliver(); await starting; assert(late.tracks.stopped); assert.equal(late.node, undefined); assert.equal(second.complete.length, 0); }
  finally { cancelled.cancel(); late.restore(); }
});

test('quiet headset speech below the previous threshold now ends after the normal pause', async () => {
  const env = audioFixture(), result = callbacks(), levels = [], capture = new VoiceCapture({ ...result.api, level: value => levels.push(value) },'',env.gate.factory);
  try {
    await capture.start('file', 'headset-input');
    assert.deepEqual(env.constraints.audio.deviceId, { exact: 'headset-input' }); assert.equal(env.constraints.audio.autoGainControl, true);
    const push = value => env.node.port.onmessage?.({ data: { type: 'pcm', bytes: new Int16Array(1600).fill(value).buffer } });
    env.gate.speech();push(160); push(160); for (let i = 0; i < 20; i++) push(0);env.gate.end();
    await settle(); assert.equal(env.fetches, 1); assert.equal(result.complete.length, 1); assert.deepEqual(result.failed, []);
    assert(levels.some(level => level.percent > 0 && level.label === 'Headset microphone'));
  } finally { capture.cancel(); env.restore(); }
});
test('unconfirmed low noise is never uploaded as an utterance', async () => {
  const env = audioFixture(), result = callbacks(), capture = new VoiceCapture(result.api,'',env.gate.factory);
  try {
    await capture.start('file');
    for (let i = 0; i < 100; i++) env.node.port.onmessage?.({ data: { type: 'pcm', bytes: new Int16Array(1600).fill(25).buffer } });
    await settle(); assert.equal(env.fetches, 0); assert.equal(result.complete.length, 0);assert.equal(result.failed.length,1);
  } finally { capture.cancel(); env.restore(); }
});
test('realtime capture forwards quiet headset PCM and completes its end acknowledgement', async () => {
  const env = audioFixture(), result = callbacks(), capture = new VoiceCapture(result.api,'',env.gate.factory);
  try {
    await capture.start('realtime', 'headset-input');
    assert.deepEqual(env.constraints.audio.deviceId, { exact: 'headset-input' });
    env.gate.speech();for (let i = 0; i < 100; i++) env.node.port.onmessage?.({ data: { type: 'pcm', bytes: new Int16Array(1600).fill(25).buffer } });
    env.socket.emit({ type: 'final', segment: 0, text: '小声说话也能发送', reason: 'vad' });env.gate.end();
    await settle(); assert.deepEqual(result.failed, []); assert.deepEqual(result.complete, ['小声说话也能发送']);
    assert.equal(env.socket.sent.filter(item => item instanceof ArrayBuffer).length, 100);
  } finally { capture.cancel(); env.restore(); }
});
test('local microphone test uses the selected device and reports actual PCM levels without uploading', async () => {
  const env = audioFixture(), levels = [], probe = new MicrophoneProbe(level => levels.push(level), () => {});
  try {
    await probe.start('headset-input');
    env.node.port.onmessage?.({ data: { type: 'pcm', bytes: new Int16Array(640).fill(330).buffer } });
    assert.equal(levels.length, 1); assert(levels[0].rms > 0.01); assert.equal(levels[0].seconds, 0.04); assert.equal(levels[0].label, 'Headset microphone'); assert.equal(env.fetches, 0); assert.equal(env.socket, undefined);
    probe.cancel(); assert(env.tracks.stopped); assert.equal(env.context.state, 'closed');
  } finally { probe.cancel(); env.restore(); }
});
