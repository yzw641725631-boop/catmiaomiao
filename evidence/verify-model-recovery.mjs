import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VoiceReplies } from '../app/src/voiceReplies.ts';
const origin = 'http://127.0.0.1:5217';
const boot = await fetch(origin + '/companion/info'), cookie = boot.headers.get('set-cookie').split(';')[0], info = await boot.json();
const headers = { cookie, origin, 'content-type': 'application/json' }, sendId = 'model_recovery_' + crypto.randomUUID();
const started = Date.now();
const sent = await fetch(origin + '/companion/send', { method: 'POST', headers, body: JSON.stringify({ kind: 'chat', sendId, text: '模型连接验证，请只回复“模型连接正常”。不要派工、使用工具或修改任何配置。' }) });
assert(sent.ok); const receipt = await sent.json(); let result;
const voiceReplies = new VoiceReplies(); voiceReplies.arm(sendId);
while (Date.now() - started < 95000) {
  const response = await fetch(origin + `/api/threads/${receipt.threadId}/messages?limit=100`, { headers });
  const messages = (await response.json()).messages, user = messages.find(message => message.sendId === sendId);
  const voiceResult = voiceReplies.takeResult({ [receipt.threadId]: messages });
  if (user && voiceResult) {
    const failure = messages.findLast(message => message.requestMessageId === user.id && message.tool?.terminal && message.tool.ok === false);
    result = { passed: !!voiceResult.reply, requestId: user.id, replyId: voiceResult.reply?.id, nativeRequestPending: user.requestPending,
      failureCode: voiceResult.error ? String(failure?.tool?.name || '').match(/HTTP\s+(\d{3})/)?.[1] || 'MODEL_FAILED' : null,
      verificationRequired: /网页验证|MODEL_UPSTREAM_WEB_VERIFICATION/.test(voiceResult.error || '') }; break;
  }
  await new Promise(resolve => setTimeout(resolve, 700));
}
result ||= { passed: false, failureCode: 'WAIT_TIMEOUT' };
let diagnostics = []; try { diagnostics = (await readFile(join(import.meta.dirname, '../runtime/logs/model-requests.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line)).filter(row => Date.parse(row.at) >= started); } catch {}
const output = join(import.meta.dirname, 'microphone-20261022/model-recovery-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
await writeFile(output, JSON.stringify({ at: new Date().toISOString(), kind: 'synthetic native assistant request through actual ReachAI bridge; no human audio or transcript saved', instanceId: info.reachai.llmId, elapsedMs: Date.now() - started, ...result, diagnostics }, null, 2) + '\n');
console.log(JSON.stringify({ output, elapsedMs: Date.now() - started, ...result, diagnostics }));
