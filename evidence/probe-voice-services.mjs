import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const origin = 'http://127.0.0.1:5217', boot = await fetch(origin + '/companion/info'), cookie = boot.headers.get('set-cookie').split(';')[0], info = await boot.json();
const dir = join(import.meta.dirname, 'voice-markdown-20261022'); await mkdir(dir, { recursive: true });
const record = { at: new Date().toISOString(), asrMode: info.asr.mode, asrId: info.reachai.asrId, ttsId: info.reachai.ttsId, text: '你好，请回答语音链路正常。', passed: false };
const started = performance.now();
try {
  const response = await fetch(origin + '/api/tts/speak', { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ text: record.text }), signal: AbortSignal.timeout(90000) });
  record.status = response.status; record.contentType = response.headers.get('content-type');
  if (!response.ok || !record.contentType?.startsWith('audio/')) { record.error = (await response.json().catch(() => ({}))).error || 'No audio response'; }
  else { const bytes = Buffer.from(await response.arrayBuffer()); record.bytes = bytes.length; record.file = join(dir, 'tts-synthetic-probe.mp3'); await writeFile(record.file, bytes); record.passed = bytes.length > 200; }
} catch (error) { record.error = error.message; }
record.elapsedMs = Math.round(performance.now() - started);
const output = join(dir, 'initial-services-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json'); await writeFile(output, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify(record)); console.log(JSON.stringify({ output }));
