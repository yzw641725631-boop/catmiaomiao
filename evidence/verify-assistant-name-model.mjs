import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CompanionRuntime, PROJECT } from '../adapters/runtime.mjs';

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rootDir = join(PROJECT, 'runtime/isolated-name-' + stamp);
const output = join(PROJECT, 'evidence/name-latency-20261025/live-name-' + stamp + '.json');
const { reachai } = JSON.parse(readFileSync(join(PROJECT, 'runtime/companion-settings.json'), 'utf8'));
mkdirSync(rootDir, { recursive: true });
writeFileSync(join(rootDir, 'companion-settings.json'), JSON.stringify({ provider: 'reachai', reachai }), { mode: 0o600 });
const runtime = new CompanionRuntime({ rootDir }); const started = Date.now(); let report;
try {
  const info = await runtime.start(), sendId = randomUUID();
  await runtime.send({ kind: 'chat', sendId, text: '我希望你以后正式叫小蕊，请现在保存这个名字。保存成功后只用一句话确认，不用派工。' });
  const deadline = Date.now() + 80000; let messages, chief;
  while (true) {
    ({ messages } = await runtime.api(runtime.current, 'GET', `/api/threads/${info.companionThreadId}/messages?limit=100`));
    chief = (await runtime.api(runtime.current, 'GET', '/api/bots')).bots.find(bot => bot.id === info.chiefId);
    if (messages.some(message => message.turnTerminal)) break;
    if (Date.now() >= deadline) break;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const terminal = messages.findLast(message => message.turnTerminal);
  const diagnostics = readFileSync(join(rootDir, 'logs/model-requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
  report = { at: new Date().toISOString(), scope: 'Actual selected model calls the real rename tool in an isolated runtime, no daily conversation mutation', modelInstanceId: reachai.llmId,
    nameSaved: chief.name === '小蕊', terminalSuccess: terminal?.turnSucceeded === true, name: chief.name, elapsedMs: Date.now() - started,
    pendingRenameApproval: messages.some(message => message.card?.tool?.includes('rename') && !message.card.answered), diagnostics };
} catch (error) { report = { at: new Date().toISOString(), nameSaved: false, terminalSuccess: false, errorCode: error.code || error.name, status: error.status || null, elapsedMs: Date.now() - started }; }
finally { await runtime.close(); }
writeFileSync(output, JSON.stringify(report, null, 2) + '\n'); console.log(JSON.stringify({ output, ...report }));
