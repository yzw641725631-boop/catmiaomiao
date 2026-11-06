import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SpeechController } from '../src/speech.ts';

test('stopping during preparation prevents late audio from starting', async () => {
  const original = globalThis.fetch;
  const states = [];
  let deliver;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return new Promise(resolve => { deliver = resolve; }); };
  try {
    const controller = new SpeechController(state => states.push(state));
    const pending = controller.speak('这段话应当被取消');
    controller.stop();
    deliver(Response.json({ ready: true, utterances: ['迟到的声音'] }));
    await pending;
    assert.equal(calls, 1);
    assert.deepEqual(states.at(-1), { status: 'idle', caption: '' });
    assert(!states.some(state => state.status === 'speaking'));
  } finally { globalThis.fetch = original; }
});

test('barge-in pauses audio, releases its URL and prevents subsequent chunks', async () => {
  const originalFetch = globalThis.fetch, originalAudio = globalThis.Audio;
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  let audio, audioCalls = 0, released = 0, playing;
  const ready = new Promise(resolve => { playing = resolve; });
  const states = [];
  globalThis.fetch = async path => path === '/api/tts/prepare'
    ? Response.json({ ready: true, utterances: ['第一句', '不应播放的第二句'] })
    : (audioCalls++, new Response(new Blob(['synthetic audio']), { headers: { 'content-type': 'audio/mpeg' } }));
  URL.createObjectURL = () => 'blob:synthetic'; URL.revokeObjectURL = () => released++;
  globalThis.Audio = class {
    paused = false;
    constructor() { audio = this; }
    play() { this.onplaying?.(); playing(); return Promise.resolve(); }
    pause() { this.paused = true; }
  };
  try {
    const controller = new SpeechController(state => states.push(state));
    const pending = controller.speak('两句话');
    await ready;
    controller.stop(); await pending;
    assert.equal(audio.paused, true); assert.equal(released, 1); assert.equal(audioCalls, 1);
    assert.deepEqual(states.at(-1), { status: 'idle', caption: '' });
  } finally {
    globalThis.fetch = originalFetch; globalThis.Audio = originalAudio;
    URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke;
  }
});

test('streaming MP3 starts playback before the response finishes downloading', async () => {
  const originals = { fetch: globalThis.fetch, Audio: globalThis.Audio, MediaSource: globalThis.MediaSource, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
  let feed, audio, played, downloaded = false, released = 0;
  const playing = new Promise(resolve => { played = resolve; });
  class MockBuffer extends EventTarget {
    appendBuffer() { queueMicrotask(() => this.dispatchEvent(new Event('updateend'))); }
  }
  class MockMediaSource extends EventTarget {
    readyState = 'open';
    static isTypeSupported(mime) { return mime === 'audio/mpeg'; }
    addSourceBuffer() { return new MockBuffer(); }
    endOfStream() { queueMicrotask(() => audio.onended?.()); }
  }
  globalThis.MediaSource = MockMediaSource;
  URL.createObjectURL = source => { queueMicrotask(() => source.dispatchEvent(new Event('sourceopen'))); return 'blob:stream-fixture'; };
  URL.revokeObjectURL = () => released++;
  globalThis.Audio = class { constructor() { audio = this; } play() { this.onplaying?.(); played(); return Promise.resolve(); } pause() {} };
  globalThis.fetch = async path => path === '/api/tts/prepare'
    ? Response.json({ ready: true, utterances: ['分块试听'] })
    : new Response(new ReadableStream({ start(controller) { feed = controller; controller.enqueue(new Uint8Array([1, 2, 3])); } }), { headers: { 'content-type': 'audio/mpeg', 'x-companion-audio-mode': 'stream' } });
  const states = [];
  const controller = new SpeechController(state => states.push(state));
  try {
    const pending = controller.speak('分块试听'); await playing;
    assert.equal(downloaded, false); assert(states.some(state => state.status === 'speaking'));
    feed.enqueue(new Uint8Array([4, 5, 6])); downloaded = true; feed.close(); await pending;
    assert.equal(released, 1); assert.equal(states.at(-1).status, 'idle');
  } finally {
    controller.stop(); globalThis.fetch = originals.fetch; globalThis.Audio = originals.Audio; globalThis.MediaSource = originals.MediaSource;
    URL.createObjectURL = originals.create; URL.revokeObjectURL = originals.revoke;
  }
});
