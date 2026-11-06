import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { microphoneConstraints, microphoneError, selectedMicrophone, selectMicrophone } from '../src/microphone.ts';
import { Pcm16Resampler } from '../public/audio/pcm-resampler.mjs';
import { VoiceActivity } from '../src/voiceActivity.ts';

test('microphone preference is local, exact for a chosen headset and never silently falls back', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), values = new Map();
  try {
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) } });
    assert.equal(selectedMicrophone(), ''); assert.equal(microphoneConstraints().audio.deviceId, undefined);
    selectMicrophone('headset-1'); assert.deepEqual(microphoneConstraints(selectedMicrophone()).audio.deviceId, { exact: 'headset-1' });
    selectMicrophone(''); assert.equal(microphoneConstraints(selectedMicrophone()).audio.deviceId, undefined);
    assert.match(microphoneError(new DOMException('unplugged', 'OverconstrainedError')), /重新选择/);
    assert.match(microphoneError(new DOMException('busy', 'NotReadableError')), /独占/);
    assert.match(microphoneError(new DOMException('denied', 'NotAllowedError')), /权限/);
  } finally { if (original) Object.defineProperty(globalThis, 'localStorage', original); else Reflect.deleteProperty(globalThis, 'localStorage'); }
});

test('the actual AudioWorklet preserves quiet 48k headset samples through transferred 16k PCM frames', async () => {
  const source = (await readFile(new URL('../public/audio/pcm-capture.js', import.meta.url), 'utf8')).replace("import { Pcm16Resampler } from './pcm-resampler.mjs';", '');
  let Processor; const frames = [];
  class Base { port = { onmessage: null, postMessage: (message, transfer) => { frames.push(structuredClone(message, { transfer })); } }; }
  vm.runInNewContext(source, { Pcm16Resampler, sampleRate: 48000, AudioWorkletProcessor: Base, registerProcessor: (_, value) => { Processor = value; } });
  const processor = new Processor(), activity = new VoiceActivity();
  const render = (value, length) => { for (let offset = 0; offset < length; offset += 128) { const output = new Float32Array(Math.min(128, length - offset)).fill(1); processor.process([[new Float32Array(output.length).fill(value)]], [[output]]); assert(output.every(value => value === 0)); } };
  render(0.004, 14400); render(0, 100800); processor.port.onmessage({ data: { type: 'flush' } });
  const ends = frames.filter(frame => frame.type === 'pcm').map(frame => activity.push(new Int16Array(frame.bytes), 16000, 32768)).filter(Boolean);
  assert.deepEqual(ends, ['silence']); assert(activity.peakRms > 0.003 && activity.peakRms < 0.005);
  assert.equal(frames.reduce((total, frame) => total + (frame.bytes?.byteLength || 0), 0), 76800);
});
