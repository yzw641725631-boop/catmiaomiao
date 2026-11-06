import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { launchVerificationServer, runControlOmb } from '../upstream/OpenMausBot/scripts/control-omb.ts';
import { waitForExit } from '../upstream/OpenMausBot/server/testing/cleanup.ts';
import { openSse } from '../upstream/OpenMausBot/server/testing/sse.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runId = new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-');
const output = join(root, 'evidence', `verification-${runId}`);
const archiveRoot = resolve(root, '..', '..', '归档', 'openmaus-assistant', runId);
mkdirSync(output, { recursive: true });
const report = { runId, node: process.version, platform: process.platform, provider: 'repository fake Claude only', checks: [], limitations: ['No real model, microphone, TTS audio, avatar inference, desktop control or custom UI tested.'] };
const require = createRequire(import.meta.url);
const { desktopCapabilities } = require('../upstream/OpenMausBot/electron/capabilities.cjs');
let fixture;
let stream;
const streams = [];
const apiEvidence = [];
const save = (name, value) => writeFileSync(join(output, name), JSON.stringify(value, null, 2) + '\n');
const check = (name, detail) => { report.checks.push({ name, passed: true, detail }); console.log(`PASS ${name}`); };
async function until(fn, message, timeout = 45000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out: ${message}`);
}
try {
  fixture = await launchVerificationServer(process.env, undefined, undefined, undefined, undefined, { scripted: true });
  report.fixture = fixture.info;
  save('fixture.json', fixture.info);
  console.log(`Fixture ${fixture.info.url}`);
  const api = async (method, path, body, status = 200) => {
    const res = await fetch(fixture.info.url + path, {
      method, headers: { 'content-type': 'application/json', origin: fixture.info.url },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();
    apiEvidence.push({ method, path, status: res.status, body, response: data });
    assert.equal(res.status, status, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  const cli = (...args) => runControlOmb([...args, '--url', fixture.info.url]);
  const messages = async threadId => (await api('GET', `/api/threads/${threadId}/messages?limit=100`)).messages;
  const health = await api('GET', '/api/health');
  const edition = await api('GET', '/api/edition');
  save('health.json', { health, edition });
  check('isolated server boot', { version: health.version, edition });

  stream = await openSse(`${fixture.info.url}/api/events?screens=off`, { origin: fixture.info.url });
  streams.push(stream);
  const hello = await stream.until(frame => frame.kind === 'hello');
  assert.equal(hello.resumed, false);
  check('SSE cold connect declares snapshot required', hello);

  const chief = (await cli('new-bot', '--name', 'Companion', '--section', 'Evaluation')).bot;
  const researcher = (await cli('new-bot', '--name', 'Research', '--section', 'Evaluation')).bot;
  const writer = (await cli('new-bot', '--name', 'Writer', '--section', 'Evaluation')).bot;
  for (const bot of [chief, researcher, writer]) await api('PATCH', `/api/bots/${bot.id}`, { approvalMode: 'ask' });
  await api('PATCH', `/api/bots/${chief.id}`, { chiefOfStaff: true });
  const gate = join(fixture.info.dataDir, 'release-research');
  const readyA = join(fixture.info.dataDir, 'research-ready');
  const readyB = join(fixture.info.dataDir, 'writer-ready');
  const planPath = join(fixture.info.dataDir, 'room-plan.json');
  const plans = {
    [chief.id]: { turns: [
      { steps: [{ tool: 'coordinate_bots', arguments: { bot_ids: [researcher.id, writer.id], request_key: 'immersive-eval-delegation', message: 'Evaluate the synthetic report. Do not access real files or accounts.' } }], reply: 'Delegated the evaluation to Research and Writer.' },
      { reply: 'We can keep chatting while the two helpers work.' },
      { reply: 'Both helpers completed the synthetic evaluation.' },
    ] },
    [researcher.id]: { turns: [{ gateFile: gate, readyFile: readyA, progress: 'Reviewing synthetic research.', reply: 'Research evaluated the synthetic report.' }] },
    [writer.id]: { turns: [{ gateFile: gate, readyFile: readyB, progress: 'Reviewing synthetic document.', reply: 'Writer evaluated the synthetic report.' }] },
  };
  writeFileSync(planPath, JSON.stringify(plans));
  const dispatch = await cli('send', '--bot', chief.id, '--task', chief.activeTaskId, '--text', 'Delegate this synthetic evaluation to both helpers.');
  save('dispatch.json', dispatch);
  await until(() => existsSync(readyA) && existsSync(readyB), 'both delegated helpers entered their gated turns');
  const during = await api('GET', '/api/bots');
  const working = during.bots.filter(bot => [researcher.id, writer.id].includes(bot.id));
  assert.equal(working.length, 2);
  assert(working.every(bot => bot.tasks.some(task => task.openedBy?.botId === chief.id)));
  save('delegation-in-progress.json', during);
  check('Chief opens real bounded threads on two helpers', working.map(bot => ({ botId: bot.id, tasks: bot.tasks.map(task => ({ threadId: task.threadId, openedBy: task.openedBy, busy: task.busy })) })));

  const chatTask = (await api('POST', `/api/bots/${chief.id}/tasks`, { title: 'Companion chat during background work', approvalMode: 'ask' }, 201)).task;
  await cli('send', '--bot', chief.id, '--task', chatTask.threadId, '--text', 'CHAT_WHILE_WORKING: can we continue chatting?');
  const chatting = await cli('wait', '--bot', chief.id, '--task', chatTask.threadId, '--timeout', '30');
  assert.equal(chatting.status, 'settled');
  assert((await messages(chatTask.threadId)).some(message => message.text?.includes('keep chatting')));
  assert(!existsSync(gate));
  check('same persistent Chief chats in a separate thread while helpers remain running', { chatThreadId: chatTask.threadId, workThreadId: chief.activeTaskId });

  writeFileSync(gate, 'release');
  const settled = await cli('wait', '--bot', chief.id, '--task', chief.activeTaskId, '--timeout', '45');
  assert.equal(settled.status, 'settled');
  const completed = await until(async () => (await messages(chief.activeTaskId)).find(message => message.text?.includes('Both helpers completed')), 'Chief summary after helper completion');
  save('delegation-settled.json', { settled, completed, transcript: await messages(chief.activeTaskId) });
  const providerEvidence = readFileSync(`${planPath}.evidence.jsonl`, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  save('scripted-provider-evidence.json', providerEvidence);
  assert(providerEvidence.filter(turn => [researcher.id, writer.id].includes(turn.botId)).every(turn => turn.permissionMode === 'default'));
  check('helper results return to Chief without widening Ask permissions', { scriptedProviderTurns: providerEvidence.length });

  const resumed = await openSse(`${fixture.info.url}/api/events?since=${encodeURIComponent(hello.cursor)}&screens=off`, { origin: fixture.info.url });
  streams.push(resumed);
  const resumedHello = await resumed.until(frame => frame.kind === 'hello');
  assert.equal(resumedHello.resumed, true);
  await resumed.until(frame => frame.kind === 'message' && frame.threadId === chief.activeTaskId);
  const stale = await openSse(`${fixture.info.url}/api/events?since=oldrun00%3A999&screens=off`, { origin: fixture.info.url });
  streams.push(stale);
  const staleHello = await stale.until(frame => frame.kind === 'hello');
  assert.equal(staleHello.resumed, false);
  check('SSE resumes within buffer and refuses cursors from another server run', { resumedHello, staleHello });

  const memoryPath = `/api/bots/${chief.id}/memory/file`;
  const memoryBefore = await api('GET', memoryPath);
  const memoryText = '# Evaluation memory\n\n- Synthetic preference: concise Chinese replies.\n';
  const memorySaved = await api('PUT', memoryPath, { text: memoryText, expectedHash: memoryBefore.hash });
  assert.equal((await api('GET', memoryPath)).text, memoryText);
  await api('PUT', memoryPath, { text: 'stale overwrite', expectedHash: memoryBefore.hash }, 409);
  assert.equal((await api('GET', memoryPath)).text, memoryText);
  const journal = await api('GET', `/api/bots/${chief.id}/memory/journal`);
  assert(journal.entries.some(entry => entry.id === memorySaved.entry.id));
  check('memory persists via API, journals edits and rejects stale overwrites', { beforeHash: memoryBefore.hash, savedHash: memorySaved.hash, journalEntryId: memorySaved.entry.id });

  const stopBot = (await cli('new-bot', '--name', 'StopScope', '--section', 'Evaluation')).bot;
  await api('PATCH', `/api/bots/${stopBot.id}`, { approvalMode: 'ask' });
  const keepTask = (await api('POST', `/api/bots/${stopBot.id}/tasks`, { title: 'Keep running', approvalMode: 'ask' }, 201)).task;
  const stopReady = join(fixture.info.dataDir, 'stop-ready');
  const keepReady = join(fixture.info.dataDir, 'keep-ready');
  const keepGate = join(fixture.info.dataDir, 'keep-gate');
  plans[stopBot.id] = { script: [
    { key: 'stop', match: ['STOP_TARGET'], progress: 'Hold the selected task.', readyFile: stopReady, gateFile: join(fixture.info.dataDir, 'never-release'), reply: 'This reply must not arrive.' },
    { key: 'keep', match: ['KEEP_TARGET'], progress: 'Keep the other task running.', readyFile: keepReady, gateFile: keepGate, reply: 'The other task completed.' },
  ] };
  writeFileSync(planPath, JSON.stringify(plans));
  await cli('send', '--bot', stopBot.id, '--task', stopBot.activeTaskId, '--text', 'STOP_TARGET');
  await until(() => existsSync(stopReady), 'selected task running');
  await cli('send', '--bot', stopBot.id, '--task', keepTask.threadId, '--text', 'KEEP_TARGET');
  await until(() => existsSync(keepReady), 'unrelated task running');
  await api('POST', `/api/bots/${stopBot.id}/interrupt`, { threadId: stopBot.activeTaskId });
  assert(!existsSync(keepGate));
  const afterStop = (await api('GET', '/api/bots')).bots.find(bot => bot.id === stopBot.id);
  const kept = afterStop.tasks.find(task => task.threadId === keepTask.threadId);
  assert.equal(kept.busy, true);
  writeFileSync(keepGate, 'release');
  assert.equal((await cli('wait', '--bot', stopBot.id, '--task', keepTask.threadId, '--timeout', '30')).status, 'settled');
  assert((await messages(keepTask.threadId)).some(message => message.text?.includes('other task completed')));
  assert(!(await messages(stopBot.activeTaskId)).some(message => message.text?.includes('must not arrive')));
  check('thread-scoped interrupt leaves another thread on the same bot running', { stoppedThreadId: stopBot.activeTaskId, preservedThreadId: keepTask.threadId });

  const voice = await api('POST', '/api/tts/prepare', { text: '语音技术验证。' });
  assert.equal(voice.ready, false);
  await api('POST', '/api/live/session', { botId: chief.id, threadId: chatTask.threadId, sdp: 'fixture-no-network', client: 'desktop' }, 409);
  const nativeCapabilities = desktopCapabilities({ platform: 'win32', packaged: true, localConnection: null });
  assert.equal(nativeCapabilities.dictation.available, false);
  check('voice reports missing configuration; Windows native dictation is unavailable', { voice, nativeCapabilities });

  save('sse-frames.json', stream.frames);
  const frames = stream.frames;
  assert(frames.some(frame => frame.kind === 'runtime' && frame.event.type === 'content.delta'));
  assert(frames.some(frame => frame.kind === 'message' && frame.message.kind === 'digest'));
  check('real harness emits text deltas and persisted work digests', { frameCount: frames.length, kinds: [...new Set(frames.map(frame => frame.kind))] });
  report.passed = true;
} catch (error) {
  report.passed = false;
  report.error = { message: error.message, stack: error.stack };
  console.error(error);
  process.exitCode = 1;
} finally {
  for (const recorder of streams) recorder.close();
  if (fixture) {
    await waitForExit(fixture.child, { signal: 'SIGTERM' });
    if (existsSync(fixture.info.dataDir)) {
      mkdirSync(archiveRoot, { recursive: true });
      cpSync(fixture.info.dataDir, join(archiveRoot, 'fixture-data'), { recursive: true, errorOnExist: true });
      report.archivedFixtureData = join(archiveRoot, 'fixture-data');
    }
    if (existsSync(fixture.info.logPath)) cpSync(fixture.info.logPath, join(output, 'server.log'));
    await fixture.close();
    report.fixtureStopped = fixture.child.exitCode !== null || fixture.child.signalCode !== null;
  }
  save('api-evidence.json', apiEvidence);
  if (stream) save('sse-frames.json', stream.frames);
  save('report.json', report);
  console.log(`Evidence ${output}`);
}
