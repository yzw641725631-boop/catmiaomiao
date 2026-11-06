import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Pcm16Resampler } from '../public/audio/pcm-resampler.mjs';

test('PCM resampling preserves duration and chunk continuity at 48k and 44.1k', () => {
  for (const inputRate of [48000, 44100, 16000]) {
    const input = new Float32Array(inputRate).fill(0.5);
    const resampler = new Pcm16Resampler(inputRate);
    const frames = [];
    for (let i = 0; i < input.length; i += 128) frames.push(...resampler.process(input.subarray(i, i + 128)));
    const tail = resampler.flush(); if (tail) frames.push(tail);
    const result = Buffer.concat(frames.map(frame => Buffer.from(frame)));
    assert.equal(result.length, 16000 * 2);
    for (let i = 0; i < result.length; i += 2) assert.equal(result.readInt16LE(i), 16384);
  }
});

test('PCM limits samples and encodes signed little endian', () => {
  const resampler = new Pcm16Resampler(16000, 16000, 4);
  const [frame] = resampler.process(new Float32Array([-2, 2, NaN, 0]));
  assert.deepEqual([...new Int16Array(frame)], [-32768, 32767, 0, 0]);
  assert.equal(resampler.flush(), null);
});
