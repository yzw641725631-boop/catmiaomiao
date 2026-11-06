import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ReachAIClient, gatewayEvents } from '../adapters/reachai.mjs';
import { redactSecretsInText } from '../upstream/OpenMausBot/server/redact.ts';
const project = join(import.meta.dirname, '..');
const config = JSON.parse(await readFile(join(project, 'runtime/companion-settings.json'), 'utf8')).reachai;
const client = new ReachAIClient(config);
const instanceId = process.argv[2] || config.llmId;
if (!(await client.instances()).some(row => row.id === instanceId && row.modelType === 'LLM' && row.status === 'ACTIVE')) throw new Error('Requested probe model is not ACTIVE');
const clean = value => redactSecretsInText(String(value || '')).split(config.key).join('[redacted]').replace(/https?:\/\/[^\s"<>]+/g, '[upstream-url]').slice(0, 700);
const results = [];
for (let attempt = 1; attempt <= 3; attempt++) {
  const started = Date.now(), row = { attempt, instanceId, path: '/model/chat/stream/events', passed: false };
  try {
    const response = await client.fetch(row.path, { body: { modelInstanceId: instanceId, messages: [{ role: 'user', content: '连接稳定性测试，请只回复：连接正常。不要使用工具。' }], options: { temperature: 0, max_tokens: 60 } }, accept: 'text/event-stream', timeout: 45000 });
    row.status = response.status; row.contentType = response.headers.get('content-type'); row.ray = response.headers.get('cf-ray');
    if (!response.ok) row.error = clean(await response.text());
    else {
      let text = '';
      for await (const event of gatewayEvents(response)) {
        if (event.type === 'error') { row.error = clean(event.message || event.error); row.code = clean(event.code); }
        if (event.type === 'content.delta') text += event.text || '';
        if (event.type === 'completed') row.finishReason = event.finishReason;
      }
      row.contentLength = text.length; row.passed = !!row.finishReason && text.includes('连接正常') && !row.error;
    }
  } catch (error) { row.error = clean(error.message); row.code = clean(error.code); }
  row.elapsedMs = Date.now() - started; results.push(row); console.log(JSON.stringify(row));
}
const dir = join(project, 'evidence/microphone-20261022'); await mkdir(dir, { recursive: true });
const output = join(dir, 'llm-stability-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
await writeFile(output, JSON.stringify({ at: new Date().toISOString(), kind: 'synthetic direct gateway LLM probes; no human conversation or audio', results }, null, 2) + '\n');
console.log(JSON.stringify({ output }));
