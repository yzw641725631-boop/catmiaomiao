// Isolated synthetic conversation, real currently selected provider. No daily
// messages or credentials are copied into evidence. No computer tools execute.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CompanionRuntime, PROJECT } from '../adapters/runtime.mjs';
import { compactCompanionContext, modelEventsWithRetry, ReachAIClient } from '../adapters/reachai.mjs';
import { fakeReachai, fixtureReachaiConfig } from '../app/tests/fixtures/reachai.mjs';

const output = join(PROJECT, 'evidence/name-latency-20261025', new Date().toISOString().replace(/[:.]/g, '-'));
const rootDir = join(output, 'isolated'); mkdirSync(rootDir, { recursive: true });
const actual = JSON.parse(readFileSync(join(PROJECT, 'runtime/companion-settings.json'), 'utf8')).reachai;
assert(actual?.key && actual.llmId, 'Keep the existing configured model');
const provider = await fakeReachai({ chat(body, event, res) { event({ type: 'content.delta', text: '你好，我在。' }); event({ type: 'completed', finishReason: 'stop' }); res.end(); } });
writeFileSync(join(rootDir, 'companion-settings.json'), JSON.stringify({ provider: 'reachai', reachai: fixtureReachaiConfig(provider.url) }));
writeFileSync(join(rootDir, 'native-capabilities.json'), JSON.stringify({ version: 1, bots: {}, computerHostEnabled: true }));
const runtime = new CompanionRuntime({ rootDir }); let baseline, compact, catalog;
try {
  const info = await runtime.start();
  assert(runtime.desktopHost.status().ready, 'Use the already installed desktop driver catalog');
  await runtime.capabilities.configure(info.chiefId, { browser: true, computer: true, mcpServers: [], permissions: { browser: 'ask', computer: 'ask' } });
  for (const text of ['合成问候一：你好，只回复“你好”，不用工具。', '合成问候二：你好，只回复“你好”，不用工具。']) {
    const sendId = randomUUID(); await runtime.send({ kind: 'chat', sendId, text });
    const deadline = Date.now() + 30000;
    while (true) {
      const { messages } = await runtime.api(runtime.current, 'GET', `/api/threads/${info.companionThreadId}/messages?limit=100`);
      const request = messages.find(message => message.sendId === sendId);
      if (request && messages.some(message => message.requestMessageId === request.id && message.turnTerminal && message.turnSucceeded && message.text)) break;
      assert(Date.now() < deadline, 'Synthetic native turn timeout'); await new Promise(resolve => setTimeout(resolve, 100));
    }
  }
  compact = structuredClone(provider.requests.filter(row => row.path === '/model/chat/stream/events').at(-1).body);
  const { messages } = await runtime.api(runtime.current, 'GET', `/api/threads/${info.companionThreadId}/messages?limit=100`);
  baseline = structuredClone(compact);
  for (const message of baseline.messages.filter(message => message.role === 'user')) {
    if (message.content.includes('\n\n[本地助理能力说明，')) continue;
    const native = messages.find(row => row.role === 'user' && row.text.includes('\n\n[本地助理能力说明，') && message.content.includes(row.text.split('\n\n[本地助理能力说明，')[0]));
    if (native) message.content = message.content.replace(native.text.split('\n\n[本地助理能力说明，')[0], native.text);
  }
  assert.deepEqual(compactCompanionContext(baseline.messages), compact.messages);
  catalog = compact.tools.map(tool => ({ name: tool.function.name, bytes: Buffer.byteLength(JSON.stringify(tool)) })).sort((a, b) => b.bytes - a.bytes);
} finally { await runtime.close(); await provider.close(); }

const report = { at: new Date().toISOString(), scope: 'Two isolated synthetic greetings with the real selected provider; desktop catalog only, zero tool executions. Small sample, no speed guarantee.', modelInstanceId: actual.llmId,
  catalog: { count: catalog.length, bytes: Buffer.byteLength(JSON.stringify(compact.tools)), largest: catalog.slice(0, 12) }, samples: [] };
report.historyBytesSaved = Buffer.byteLength(JSON.stringify(baseline)) - Buffer.byteLength(JSON.stringify(compact));
assert(report.historyBytesSaved > 0, 'The comparison must contain an obsolete envelope');
if (process.argv.includes('--catalog-only')) { report.scope = 'Isolated native request accounting only; no real cloud request'; writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ output, ...report })); process.exit(0); }
const client = new ReachAIClient(actual);
for (const [variant, request] of [['before', baseline], ['after', compact]]) {
  request.modelInstanceId = actual.llmId;
  const sample = { variant, requestBytes: Buffer.byteLength(JSON.stringify(request)), messageBytes: Buffer.byteLength(JSON.stringify(request.messages)) };
  try {
    for await (const event of modelEventsWithRetry(client, request, AbortSignal.timeout(60000), { retryDelays: [], diagnostic: row => Object.assign(sample, row) })) {
      if (event.type === 'tool_call.delta') sample.unexpectedToolCall = true;
    }
  } catch (error) { sample.errorCode = error.code || error.name; sample.status = error.status || null; }
  report.samples.push(sample); writeFileSync(join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ output, ...sample }));
}
console.log(JSON.stringify({ catalog: report.catalog, output }));
