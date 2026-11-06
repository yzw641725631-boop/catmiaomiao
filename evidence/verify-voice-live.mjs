import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { MPEGDecoder } from './tooling/audio-probe/node_modules/mpg123-decoder/index.js';
import { Pcm16Resampler } from '../app/public/audio/pcm-resampler.mjs';
import { VoiceReplies } from '../app/src/voiceReplies.ts';
import { WebSocket } from '../adapters/realtime-asr.mjs';
const origin = 'http://127.0.0.1:5217', boot = await fetch(origin + '/companion/info'), cookie = boot.headers.get('set-cookie').split(';')[0], info = await boot.json();
const dir = join(import.meta.dirname, 'voice-markdown-20261022'); await mkdir(dir, { recursive: true });
const record = { at: new Date().toISOString(), kind: 'synthetic Fish TTS -> actual streaming ASR -> native LLM -> reply TTS; no human microphone recording', passed: false, llmId: info.model.model, asrMode: info.asr.mode, ttsId: info.reachai.ttsId };
const output = join(dir, 'live-pipeline-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
async function api(route, body) {
  const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(60000) });
  assert(response.ok, `Voice pipeline returned ${response.status}`); return response.json();
}
let socket, decoder;
try {
  assert.equal(info.mode, 'live'); assert.equal(info.asr.mode, 'realtime'); assert(info.voice.ready);
  decoder = new MPEGDecoder(); await decoder.ready;
  const audio = decoder.decode(new Uint8Array(await readFile(join(dir, 'tts-synthetic-probe.mp3'))));
  assert(audio.samplesDecoded > 10000 && audio.sampleRate > 0); assert.equal(audio.errors.length, 0);
  const mono = new Float32Array(audio.samplesDecoded); for (const channel of audio.channelData) for (let i = 0; i < mono.length; i++) mono[i] += channel[i] / audio.channelData.length;
  const resampler = new Pcm16Resampler(audio.sampleRate), frames = resampler.process(mono), last = resampler.flush(); if (last) frames.push(last);
  record.inputSeconds = mono.length / audio.sampleRate;
  const events = [], finals = new Map(); let ended = false, firstPartialMs;
  const start = performance.now();
  socket = new WebSocket(origin.replace('http:', 'ws:') + '/companion/asr/stream', { headers: { cookie, origin } });
  socket.on('error', error => { record.socketError = error.message; });
  socket.on('message', bytes => { const event = JSON.parse(bytes.toString()); events.push(event); if (event.type === 'partial' && event.text && firstPartialMs === undefined) firstPartialMs = Math.round(performance.now() - start); if (event.type === 'final' && event.text?.trim() && !finals.has(event.segment)) finals.set(event.segment, event.text.trim()); if (event.reason === 'end') ended = true; });
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); }); socket.send(JSON.stringify({ type: 'start' }));
  const wait = async (predicate, timeout = 15000) => { const deadline = Date.now() + timeout; while (!predicate()) { const failure = events.find(event => event.type === 'error'); assert(!failure, failure?.message); assert(Date.now() < deadline, 'Voice event timeout'); await delay(30); } };
  await wait(() => events.some(event => event.type === 'ready'));
  for (const frame of frames) { socket.send(frame); await delay(frame.byteLength / 2 / 16000 * 1000); }
  for (let i = 0; i < 35; i++) { socket.send(Buffer.alloc(1280)); await delay(40); }
  socket.send(JSON.stringify({ type: 'end' })); await wait(() => ended, 20000);
  socket.close();
  const text = [...finals.values()].join(' '); assert(text.length > 2); assert(/你好|语音|正常|请/.test(text));
  record.transcript = text; record.firstPartialMs = firstPartialMs; record.asrEvents = events;
  const sendId = 'voice_acceptance_' + randomUUID(), replies = new VoiceReplies(); replies.arm(sendId);
  const sent = await api('/companion/send', { kind: 'chat', text, sendId }); record.threadId = sent.threadId;
  let reply; const deadline = Date.now() + 120000;
  while (!reply && Date.now() < deadline) { const page = await api(`/api/threads/${sent.threadId}/messages?limit=100`); reply = replies.take({ [sent.threadId]: page.messages }); if (!reply) await delay(350); }
  assert(reply, 'Native LLM must return an owned voice reply'); record.reply = reply.text; record.replyMessageId = reply.id; record.requestMessageId = reply.requestMessageId;
  const prepared = await api('/api/tts/prepare', { text: reply.text }); assert(prepared.ready && prepared.utterances.length);
  const response = await fetch(origin + '/api/tts/speak', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ text: prepared.utterances[0] }), signal: AbortSignal.timeout(90000) });
  assert(response.ok && response.headers.get('content-type')?.startsWith('audio/'));
  const bytes = Buffer.from(await response.arrayBuffer()); assert(bytes.length > 200); await decoder.reset(); const decoded = decoder.decode(new Uint8Array(bytes)); assert(decoded.samplesDecoded > 1000);
  const file = join(dir, 'actual-voice-reply.mp3'); await writeFile(file, bytes);
  Object.assign(record, { passed: true, replyAudio: file, replyAudioBytes: bytes.length, replyAudioSeconds: decoded.samplesDecoded / decoded.sampleRate, replyDecoded: true, asrEndReceived: true, completedAt: new Date().toISOString() });
} catch (error) { record.error = error.message; process.exitCode = 1; }
finally { socket?.terminate(); decoder?.free(); }
await writeFile(output, JSON.stringify(record, null, 2) + '\n'); console.log(JSON.stringify(record)); console.log(JSON.stringify({ output }));
