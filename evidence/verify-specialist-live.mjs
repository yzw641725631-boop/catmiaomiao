import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompanionRuntime, PROJECT, SETTINGS_FILE } from '../adapters/runtime.mjs';
import { createCompanionServer } from '../adapters/server.mjs';

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const rootDir = join(PROJECT, 'runtime', 'isolated-team-' + timestamp);
const outputDir = join(PROJECT, 'evidence', 'dynamic-specialists-20261023'); mkdirSync(outputDir, { recursive: true });
const output = join(outputDir, 'live-' + timestamp + '.json');
const runtime = new CompanionRuntime({ rootDir });
// Read the selected model settings in place; all bots, transcripts and files stay in this isolated runtime.
runtime.settingsFile = SETTINGS_FILE;
const record = { at: new Date().toISOString(), passed: false, isolated: true, approvals: [], rootDir };
let app;
const started = Date.now();
try {
  app = await createCompanionServer({ port: 5240, runtime });
  const session = runtime.current, initial = await runtime.info();
  assert.equal(initial.mode, 'live');
  record.instanceId = initial.reachai.llmId;
  record.platformCatalogReadable = (await runtime.reachaiClient().instances()).some(instance => instance.id === initial.reachai.llmId);
  record.chiefId = initial.chiefId; record.companionThreadId = initial.companionThreadId;
  const native = (method, path, body) => runtime.api(session, method, path, body);
  const page = threadId => native('GET', `/api/threads/${threadId}/messages?limit=100`);
  const limit = Date.now() + 210000;
  const waitFor = async (observe, accept, label) => { while (Date.now() < limit) { const value = await observe(); if (await accept(value)) return value; await new Promise(resolve => setTimeout(resolve, 800)); } throw new Error(label); };
  await runtime.send({ kind: 'chat', sendId: randomUUID(), text: '这是独立合成验收工作区。请实际调用 create_bot 创建一名小助理，名字必须是“资料校对助理”，role 为“核对合成资料并整理文档”，instructions 为“用中文核对本次任务给定的合成资料，只在指定目录内写文件，用实际回执汇报结果”。使用默认模型即可。创建后说明是否成功；不要仅描述计划，不要再创建其他成员、提醒或偏好。' });
  console.log(JSON.stringify({ phase: 'creating', url: app.url, output }));
  const created = await waitFor(() => native('GET', '/api/bots'), async data => {
    const chief = data.bots.find(bot => bot.id === initial.chiefId);
    const settled = !chief.tasks.find(task => task.threadId === initial.companionThreadId).busy;
    const added = data.bots.filter(bot => ![initial.chiefId, ...initial.helperIds].includes(bot.id));
    return settled && added.some(bot => bot.name === '资料校对助理');
  }, 'Real model did not create the requested specialist within the bounded deadline');
  const helper = created.bots.find(bot => bot.name === '资料校对助理'); record.helperId = helper.id;
  assert.equal(helper.computer, 'off'); assert.equal(helper.approvalMode, 'ask');
  const creationMessages = (await page(initial.companionThreadId)).messages;
  const receipt = creationMessages.find(message => message.card?.teamSetupRequest?.result?.bots?.some(bot => bot.id === helper.id && bot.action === 'created'));
  assert(receipt, 'Creation must have a native applied receipt');
  record.creation = { receiptId: receipt.id, requestId: receipt.card.requestId, state: receipt.card.teamSetupRequest.result.state };
  const creationTerminal = creationMessages.findLast(message => message.turnTerminal || message.tool?.terminal);
  record.creation.replySucceeded = creationTerminal?.turnSucceeded === true && creationTerminal?.tool?.ok !== false;
  assert((await runtime.info()).helperIds.includes(helper.id));
  console.log(JSON.stringify({ phase: 'created', helperId: helper.id }));
  const work = await runtime.send({ kind: 'work', sendId: randomUUID(), text: `请把这项实际工作交给新建的资料校对助理，bot_id=${helper.id}。合成资料：编号 SAMPLE-84，预算 120 元，追加 30 元，总额应为 150 元。请使用 coordinate_bots 的 bot_ids 和 message 委派：在本次工作目录用 workspace_write_file 新建 new-assistant.md（expected_sha256=null），写入编号、预算算式和中文简短结论，再用 workspace_check_file 的 check=utf8 校验并返回可打开链接。主助理收到实际结果后简短汇报。不要检索网页、读取其他文件夹或创建其他助理、提醒、偏好。` });
  record.workThreadId = work.threadId;
  const approved = new Set();
  const evidence = await waitFor(async () => {
    const { bots } = await native('GET', '/api/bots');
    const owner = bots.find(bot => bot.id === initial.chiefId), task = owner.tasks.find(task => task.threadId === work.threadId);
    const childTasks = bots.find(bot => bot.id === helper.id).tasks.filter(task => task.openedBy?.threadId === work.threadId);
    for (const actor of [{ botId: initial.chiefId, threadId: work.threadId }, ...childTasks.map(task => ({ botId: helper.id, threadId: task.threadId }))]) for (const message of (await page(actor.threadId)).messages) {
      const card = message.card;
      if (!card?.requestId || card.answered || card.expired || card.dismissed || approved.has(card.requestId)) continue;
      assert(['workspace_write_file', 'workspace_check_file', 'workspace_read_file', 'workspace_list_files'].includes(card.tool), 'Unexpected tool request in isolated acceptance');
      if (card.tool !== 'workspace_list_files') assert.equal(JSON.parse(card.subtitle).path, 'new-assistant.md');
      approved.add(card.requestId); record.approvals.push({ botId: actor.botId, threadId: actor.threadId, requestId: card.requestId, tool: card.tool });
      await native('POST', `/api/bots/${actor.botId}/respond`, { threadId: actor.threadId, requestId: card.requestId, behavior: 'allow' });
    }
    const evidence = await runtime.evidence(work.threadId);
    return { evidence, settled: !task.busy && !task.waitingForTeammates && childTasks.every(task => !task.busy && !task.waitingForTeammates), childTasks, cwd: task.cwd };
  }, value => value.settled && value.evidence.files.some(file => file.path === 'new-assistant.md') && value.evidence.tests.some(check => check.exitCode === 0 && check.current !== false), 'The new specialist did not deliver actual file and check receipts');
  const bytes = readFileSync(join(evidence.cwd, 'new-assistant.md'));
  assert.match(bytes.toString('utf8'), /SAMPLE-84/); assert.match(bytes.toString('utf8'), /150/);
  const workMessages = (await page(work.threadId)).messages;
  const finalReply = workMessages.findLast(message => message.role === 'bot' && message.kind === 'text' && message.turnTerminal);
  assert.equal(finalReply?.turnSucceeded, true, 'The Chief must finish with a successful actual reply');
  const diagnostics = readFileSync(join(rootDir, 'logs/model-requests.jsonl'), 'utf8').trim().split('\n').map(JSON.parse).filter(event => event.result === 'failed');
  Object.assign(record, { passed: true, elapsedMs: Date.now() - started, modelErrors: diagnostics, finalReplyId: finalReply.id, helperThreads: evidence.childTasks.map(task => task.threadId), file: join(evidence.cwd, 'new-assistant.md'), bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), evidence: evidence.evidence });
  writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ phase: 'passed', url: app.url, output, elapsedMs: record.elapsedMs }));
  if (process.argv.includes('--hold')) {
    console.log('UI_READY: isolated native app on port 5240; send quit to close');
    await new Promise(resolve => { process.stdin.setEncoding('utf8'); process.stdin.on('data', value => { if (value.includes('quit')) resolve(); }); process.stdin.resume(); });
  }
} catch (error) {
  record.error = error.message; record.elapsedMs = Date.now() - started;
  if (runtime.current) {
    const { bots } = await runtime.api(runtime.current, 'GET', '/api/bots').catch(() => ({ bots: [] }));
    record.finalStates = bots.map(bot => ({ id: bot.id, name: bot.name, tasks: bot.tasks.map(task => ({ threadId: task.threadId, busy: task.busy, waitingForTeammates: task.waitingForTeammates, activity: task.activity })) }));
  }
  writeFileSync(output, JSON.stringify(record, null, 2) + '\n', { flag: 'wx' }); process.exitCode = 1;
  console.log(JSON.stringify({ phase: 'incomplete', output, error: record.error }));
} finally { if (app) await app.close(); process.stdin.pause(); }
