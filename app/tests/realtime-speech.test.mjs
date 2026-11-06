import {speechGateFixture} from './fixtures/speech-gate.mjs';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RealtimeSpeech } from '../src/realtimeSpeech.ts';

function browserFixture({ immediateOpen = true, getMedia } = {}) {
  const gate=speechGateFixture();
  const originals = new Map(['navigator', 'AudioContext', 'AudioWorkletNode', 'WebSocket', 'location'].map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  const tracks = { stopped: false, getTracks: () => [{ stop: () => { tracks.stopped = true; } }] };
  let context, node, socket;
  class MockContext {
    state = 'running'; destination = {};
    audioWorklet = { addModule: async path => assert.equal(path, '/audio/pcm-capture.js') };
    constructor(options) { assert.equal(options, undefined, 'use the native hardware rate and resample in the worklet'); context = this; }
    async resume() {}
    createMediaStreamSource() { return { connect() {}, disconnect() {} }; }
    async close() { this.state = 'closed'; }
  }
  class MockNode {
    port = { onmessage: null, postMessage: message => { if (message.type === 'flush') queueMicrotask(() => this.port.onmessage?.({ data: { type: 'flushed' } })); } };
    constructor() { node = this; }
    connect() {} disconnect() {}
  }
  class MockSocket {
    static CONNECTING = 0; static OPEN = 1;
    readyState = 0; bufferedAmount = 0; sent = [];
    constructor(url) { assert.equal(url, 'ws://127.0.0.1:5230/companion/asr/stream'); socket = this; if (immediateOpen) queueMicrotask(() => this.open()); }
    open() { this.readyState = 1; this.onopen?.(); }
    emit(event) { this.onmessage?.({ data: JSON.stringify(event) }); }
    send(data) {
      this.sent.push(data);
      if (typeof data !== 'string') return;
      const message = JSON.parse(data);
      if (message.type === 'start') queueMicrotask(() => this.emit({ type: 'ready' }));
      if (message.type === 'end') queueMicrotask(() => this.emit({ type: 'final', segment: 1, reason: 'end', text: '最后一句' }));
    }
    close() { this.readyState = 3; this.onclose?.(); }
  }
  const values = { navigator: { mediaDevices: { getUserMedia: getMedia || (async () => tracks) } }, AudioContext: MockContext, AudioWorkletNode: MockNode, WebSocket: MockSocket, location: { protocol: 'http:', host: '127.0.0.1:5230' } };
  for (const [name, value] of Object.entries(values)) Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return { gate,tracks, get context() { return context; }, get node() { return node; }, get socket() { return socket; }, restore() { for (const [name, descriptor] of originals) { if (descriptor) Object.defineProperty(globalThis, name, descriptor); else Reflect.deleteProperty(globalThis, name); } } };
}

test('realtime transcript merges each final once and waits for the end receipt', async () => {
  const fixture = browserFixture(); const final = [], partial = [], errors = [];
  const recorder = new RealtimeSpeech({ final: text => final.push(text), partial: text => partial.push(text), failed: text => errors.push(text) },fixture.gate.factory);
  try {
    await recorder.start();fixture.gate.speech();
    fixture.node.port.onmessage({ data: { type: 'pcm', bytes: new ArrayBuffer(1280) } });
    fixture.socket.emit({ type: 'partial', segment: 0, text: '第一' });
    fixture.socket.emit({ type: 'final', segment: 0, reason: 'vad', text: '第一句' });
    fixture.socket.emit({ type: 'final', segment: 0, reason: 'vad', text: '第一句' });
    assert.deepEqual(final, ['第一句']); assert(partial.includes('第一'));
    await Promise.all([recorder.finish(), recorder.finish()]);
    assert.deepEqual(final, ['第一句', '最后一句']); assert.deepEqual(errors, []);
    assert.equal(fixture.tracks.stopped, true); assert.equal(fixture.context.state, 'closed');
    assert(fixture.socket.sent.some(value => value instanceof ArrayBuffer && value.byteLength === 1280));
    assert.equal(fixture.socket.sent.filter(value => typeof value === 'string' && JSON.parse(value).type === 'end').length, 1);
    fixture.socket.emit({ type: 'final', segment: 2, text: '迟到内容' }); assert.equal(final.length, 2);
  } finally { recorder.cancel(); fixture.restore(); }
});

test('cancelling while microphone permission is pending stops a late stream without opening a socket', async () => {
  let deliver;
  const fixture = browserFixture({ getMedia: () => new Promise(resolve => { deliver = resolve; }) });
  const recorder = new RealtimeSpeech({ final: () => assert.fail('late final'), partial: () => {}, failed: () => assert.fail('cancel is not failure') },fixture.gate.factory);
  try {
    const pending = recorder.start(); await new Promise(resolve => setImmediate(resolve)); recorder.cancel(); deliver(fixture.tracks); await pending;
    assert.equal(fixture.tracks.stopped, true); assert.equal(fixture.socket, undefined);
  } finally { recorder.cancel(); fixture.restore(); }
});

test('cancelling a connecting socket closes it if the handshake completes late', async () => {
  const fixture = browserFixture({ immediateOpen: false });
  const recorder = new RealtimeSpeech({ final: () => assert.fail('late final'), partial: () => {}, failed: () => assert.fail('cancel is not failure') },fixture.gate.factory);
  try {
    const pending = recorder.start();
    await new Promise(resolve => setImmediate(resolve)); assert(fixture.socket, 'socket should start after microphone setup');
    const rejected = assert.rejects(pending, error => error.name === 'AbortError');
    recorder.cancel(); await rejected; fixture.socket.open();
    assert.equal(fixture.socket.readyState, 3); assert.equal(fixture.tracks.stopped, true);
  } finally { recorder.cancel(); fixture.restore(); }
});

test('an invalid recognition frame releases the microphone and rejects late results', async () => {
  const fixture = browserFixture(); const errors = [], final = [];
  const recorder = new RealtimeSpeech({ final: text => final.push(text), partial: () => {}, failed: text => errors.push(text) },fixture.gate.factory);
  try {
    await recorder.start(); fixture.socket.emit(null);await new Promise(resolve=>setImmediate(resolve));
    assert.equal(errors.length, 1); assert.equal(fixture.tracks.stopped, true); assert.equal(fixture.context.state, 'closed');
    fixture.socket.emit({ type: 'final', segment: 1, text: 'late' }); assert.deepEqual(final, []);
  } finally { recorder.cancel(); fixture.restore(); }
});

test('non-speech audio is zeroed and provider hallucinations cannot interrupt or create a transcript',async()=>{
  const fixture=browserFixture(),final=[],partial=[];let interruptions=0;
  const recorder=new RealtimeSpeech({final:text=>final.push(text),partial:text=>partial.push(text),failed:()=>assert.fail(),speech:()=>interruptions++},fixture.gate.factory);
  try{await recorder.start();const bytes=new Int16Array(640).fill(10000).buffer;fixture.node.port.onmessage({data:{type:'pcm',bytes}});fixture.socket.emit({type:'partial',text:'幻觉'});fixture.socket.emit({type:'final',segment:0,text:'谢谢观看'});
    assert.deepEqual(final,[]);assert(!partial.includes('幻觉'));assert.equal(interruptions,0);assert([...new Int16Array(fixture.socket.sent.find(item=>item instanceof ArrayBuffer))].every(value=>value===0));
    fixture.gate.speech();assert.equal(interruptions,1);assert(fixture.socket.sent.some(item=>item===bytes),'retain short pre-roll after confirmed speech');
    fixture.socket.emit({type:'final',segment:1,text:'真实人声'});assert.deepEqual(final,['真实人声']);
  }finally{recorder.cancel();fixture.restore();}
});
