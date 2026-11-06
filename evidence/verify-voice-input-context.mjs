import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CompanionRuntime, PROJECT } from '../adapters/runtime.mjs';

const stamp = new Date().toISOString().replace(/[:.]/g, '-'), directory = join(PROJECT, 'evidence/conversation-settings-20261025');
const rootDir = join(PROJECT, 'runtime/isolated-voice-context-' + stamp); mkdirSync(rootDir, { recursive: true });
const { reachai } = JSON.parse(readFileSync(join(PROJECT, 'runtime/companion-settings.json'), 'utf8'));
writeFileSync(join(rootDir, 'companion-settings.json'), JSON.stringify({ provider: 'reachai', reachai }), { mode: 0o600 });
const runtime = new CompanionRuntime({ rootDir }); let report; const start = Date.now();
try {
  const info = await runtime.start(), sendId = randomUUID();
  await runtime.send({ kind: 'chat', inputSource: 'voice', sendId, text: '你现在能收到我说话吗？只用一句话回答。' });
  const until = Date.now() + 70000; let terminal;
  while (Date.now() < until) {
    const { messages } = await runtime.api(runtime.current, 'GET', `/api/threads/${info.companionThreadId}/messages?limit=100`), user = messages.find(message => message.sendId === sendId);
    if (user) terminal = messages.findLast(message => message.requestMessageId === user.id && (message.turnTerminal || message.tool?.terminal));
    if (terminal) break; await new Promise(resolve => setTimeout(resolve, 200));
  }
  report = { at: new Date().toISOString(), scope: 'Synthetic transcript with inputSource=voice through the actual selected model. No human audio captured; tests model understanding of the existing ASR channel, not microphone quality.',
    elapsedMs: Date.now() - start, terminalSuccess: terminal?.turnSucceeded === true, syntheticReply: terminal?.text || '',
    diagnostics: readFileSync(join(rootDir, 'logs/model-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
  report.passed = report.terminalSuccess && /收到|接收|听到/.test(report.syntheticReply) && !/没有.*(?:语音通道|麦克风)|听不到|无法.*听/.test(report.syntheticReply);
} catch (error) { report = { at: new Date().toISOString(), passed: false, errorCode: error.code || error.name, status: error.status || null }; }
finally { await runtime.close(); }
mkdirSync(directory, { recursive: true }); writeFileSync(join(directory, 'voice-context-' + stamp + '.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ output: join(directory, 'voice-context-' + stamp + '.json'), ...report }));
