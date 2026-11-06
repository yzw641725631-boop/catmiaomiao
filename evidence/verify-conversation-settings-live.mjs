import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createInterface } from 'node:readline';
import { CompanionRuntime, PROJECT } from '../adapters/runtime.mjs';
import { createCompanionServer } from '../adapters/server.mjs';

// Actual selected provider; all changes remain in this new verification home.
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const rootDir = join(PROJECT, 'runtime/isolated-conversation-settings-' + stamp);
const directory = join(PROJECT, 'evidence/conversation-settings-20261025'); mkdirSync(directory, { recursive: true }); mkdirSync(rootDir, { recursive: true });
const { reachai } = JSON.parse(readFileSync(join(PROJECT, 'runtime/companion-settings.json'), 'utf8'));
writeFileSync(join(rootDir, 'companion-settings.json'), JSON.stringify({ provider: 'reachai', reachai }), { mode: 0o600 });
const runtime = new CompanionRuntime({ rootDir, verificationLabel: '隔离验收 · 使用合成指令' });
const app = await createCompanionServer({ port: 5250, runtime });
console.log(JSON.stringify({ ready: true, url: app.url, rootDir, directory }));
let running = false;
const run = async () => {
  if (running) return; running = true;
  const started = Date.now(), before = await runtime.info(); let result;
  try {
    const sendId = randomUUID();
    await runtime.send({ kind: 'chat', sendId, text: '你帮我改一下名字，叫小蕊就行了。再把语速调成0.85倍，减少动态效果，打字回复不要朗读，收起面板进入纯净视图。请实际保存后一句话确认，不用派工。' });
    const deadline = Date.now() + 80000; let user, terminal, messages;
    while (Date.now() < deadline) {
      ({ messages } = await runtime.api(runtime.current, 'GET', `/api/threads/${before.companionThreadId}/messages?limit=100`));
      user = messages.find(message => message.sendId === sendId);
      if (user) terminal = messages.findLast(message => message.requestMessageId === user.id && (message.turnTerminal || message.tool?.terminal));
      if (terminal) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    const { bots } = await runtime.api(runtime.current, 'GET', '/api/bots'), chief = bots.find(bot => bot.id === before.chiefId);
    const settings = runtime.conversationSettings.snapshot();
    result = { at: new Date().toISOString(), scope: 'Actual selected model executes colloquial rename and app preferences in an isolated runtime. No human microphone captured and no daily data modified.',
      modelInstanceId: reachai.llmId, elapsedMs: Date.now() - started, chiefName: chief.name, nameSaved: chief.name === '小蕊', settings,
      terminalSuccess: terminal?.turnSucceeded === true, sessionUnchanged: (await runtime.info()).sessionId === before.sessionId,
      pendingApprovals: messages.filter(message => message.card?.requestId && !message.card.answered && !message.card.expired).length,
      tools: messages.filter(message => message.requestMessageId === user?.id && message.tool).map(message => ({ name: message.tool.name, ok: message.tool.ok })),
      diagnostics: readFileSync(join(rootDir, 'logs/model-requests.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line)) };
    result.passed = result.nameSaved && result.terminalSuccess && result.sessionUnchanged && result.pendingApprovals === 0 && settings.voice.speechRate === 0.85 && settings.preferences.reducedMotion === true && settings.preferences.readReplies === false && settings.preferences.pureView === true;
  } catch (error) { result = { at: new Date().toISOString(), passed: false, errorCode: error.code || error.name, status: error.status || null, elapsedMs: Date.now() - started }; }
  writeFileSync(join(directory, 'live-' + stamp + '.json'), JSON.stringify(result, null, 2) + '\n');
  console.log(JSON.stringify({ output: join(directory, 'live-' + stamp + '.json'), ...result }));
};
if (process.argv.includes('--hold')) {
  const input = createInterface({ input: process.stdin }); let chain = Promise.resolve();
  input.on('line', line => { chain = chain.then(async () => { if (line.trim() === 'run') await run(); if (line.trim() === 'quit') { await app.close(); input.close(); } }).catch(error => console.log(JSON.stringify({ errorCode: error.name }))); });
} else { try { await run(); } finally { await app.close(); } }
