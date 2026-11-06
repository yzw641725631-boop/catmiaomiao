import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompanionRuntime, PROJECT } from '../../adapters/runtime.mjs';
import { createCompanionServer } from '../../adapters/server.mjs';
import { recordedSpecialists, recordSpecialists, specialistInput } from '../../adapters/team.mjs';
import { injectTeamHook } from '../../adapters/workspace-hook.mjs';
import { creationProposal } from '../src/teamUi.ts';
import { fakeReachai, fixtureReachaiConfig } from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';

test('specialist registration preserves Chief ownership and creation cannot smuggle execution permissions', () => {
  const root = scratch('specialist-policy'); mkdirSync(root, { recursive: true });
  const ledger = join(root, 'members.jsonl'), chief = randomUUID(), helper = randomUUID(), foreign = randomUUID();
  recordSpecialists(ledger, chief, [helper, helper], 'first'); recordSpecialists(ledger, foreign, [randomUUID()], 'other');
  assert.deepEqual(recordedSpecialists(ledger, chief), [helper]);
  const input = { sendId: randomUUID(), name: '新助理', role: '整理资料', instructions: '依据真实资料工作' };
  for (const patch of [{ approvalMode: 'full' }, { toolScope: { allow: ['*'] } }, { cwd: 'C:/' }, { modelSelection: {} }]) assert.throws(() => specialistInput({ ...input, ...patch }));
  assert.throws(() => specialistInput({ ...input, name: 'two\nlines' }));
  const source = readFileSync(join(PROJECT, 'upstream/OpenMausBot/server/store.ts'), 'utf8');
  assert.doesNotThrow(() => injectTeamHook(source)); assert.throws(() => injectTeamHook(source + '\n'), /Pinned/);
});

test('a creation proposal shows created only after a native applied result', () => {
  const request = { operations: [{ action: 'create', botId: randomUUID(), fields: { name: '资料助理', title: '整理资料', soul: '先给结论' } }], newTeams: [] };
  const card = { tool: 'set_up_team', teamSetupRequest: request };
  assert.equal(creationProposal(card).status, '等待你确认');
  assert.equal(creationProposal({ ...card, answered: 'Apply setup' }).status, '正在应用创建结果');
  assert.equal(creationProposal({ ...card, teamSetupRequest: { ...request, result: { state: 'applied' } } }).status, '已创建');
  assert.equal(creationProposal({ ...card, teamSetupRequest: { ...request, result: { state: 'failed', error: 'save failed' } } }).status, '创建未完成');
  assert.equal(creationProposal({ ...card, expired: true }).status, '此请求已过期');
  assert.equal(creationProposal({ ...card, teamSetupRequest: { ...request, operations: [{ action: 'update', fields: {} }] } }), null);
});

test('native chat creates a specialist with an applied receipt, delegates real scoped files and keeps the new team after restart', { timeout: 120000 }, async () => {
  const rootDir = scratch('specialists-native'); mkdirSync(rootDir, { recursive: true });
  let helperId, helperToolNames = [], rootThread;
  const provider = await fakeReachai({ chat(body, event, res) {
    const user = body.messages.filter(message => message.role === 'user').at(-1)?.content || '';
    const completed = prefix => body.messages.some(message => message.role === 'tool' && message.toolCallId?.startsWith(prefix));
    const call = (id, name, args) => {
      const direct = body.tools?.find(tool => tool.function.name === name || tool.function.name.endsWith('agents_' + name));
      const bridge = body.tools?.find(tool => tool.function.name.endsWith('agents_use_tool'));
      assert(direct || bridge, 'Missing native tool: ' + name);
      event({ type: 'tool_call.delta', toolCall: { index: 0, id, type: 'function', name: (direct || bridge).function.name, arguments: JSON.stringify(direct ? args : { name, arguments: args }) } });
      event({ type: 'completed', finishReason: 'tool_calls' }); res.end();
    };
    if (user.includes('NATIVE_CREATE_ACCEPTED') && !completed('accepted_create')) return call('accepted_create', 'create_bot', { name: '测试资料助理', role: '整理合成资料', instructions: '只使用本次任务绑定的工作目录，保存真实文件并校验后回报主助理。' });
    if (user.includes('NATIVE_TEAM_WORK') && !completed('team_delegate')) return call('team_delegate', 'coordinate_bots', { bot_ids: [helperId], message: 'NATIVE_SPECIALIST_WORK 在本次任务目录保存 new-helper.md，写入“新助理实际交付 SAMPLE-84”，用 UTF-8 校验后返回文件链接。' });
    if (user.includes('NATIVE_SPECIALIST_WORK')) {
      helperToolNames = body.tools.map(tool => tool.function.name);
      if (!completed('helper_write')) return call('helper_write', 'workspace_write_file', { path: 'new-helper.md', content: '# 新助理\n新助理实际交付 SAMPLE-84\n', expected_sha256: null });
      if (!completed('helper_check')) return call('helper_check', 'workspace_check_file', { path: 'new-helper.md', check: 'utf8' });
    }
    event({ type: 'content.delta', text: user.includes('NATIVE_SPECIALIST_WORK') ? '已保存并校验。[阅读文件](new-helper.md)' : '本轮原生工具调用已返回。' });
    event({ type: 'completed', finishReason: 'stop' }); res.end();
  } });
  writeFileSync(join(rootDir, 'companion-settings.json'), JSON.stringify({ provider: 'reachai', reachai: fixtureReachaiConfig(provider.url) }));
  const runtime = new CompanionRuntime({routineTools:'ask', rootDir }); let app;
  try {
    app = await createCompanionServer({ port: 5236, runtime });
    const boot = await fetch(app.url + '/companion/info'), cookie = boot.headers.get('set-cookie').split(';')[0], initial = await boot.json();
    const api = async (method, path, body, status = 200) => {
      const response = await fetch(app.url + path, { method, headers: { cookie, origin: app.url, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); return data;
    };
    const waitFor = async (read, accept, label) => { const deadline = Date.now() + 40000; let result; while (Date.now() < deadline) { result = await read(); if (await accept(result)) return result; await new Promise(resolve => setTimeout(resolve, 120)); } assert.fail(label + '\n' + JSON.stringify(result).slice(-2000)); };
    const createInChat = async marker => {
      await api('POST', '/companion/send', { kind: 'chat', sendId: randomUUID(), text: marker }, 202);
      const messages = await waitFor(async () => (await api('GET', `/api/threads/${initial.companionThreadId}/messages?limit=100`)).messages,
        messages => messages.some(message => message.card?.tool === 'set_up_team' && message.card.teamSetupRequest?.result?.state === 'applied'), 'Native creation receipt did not appear');
      const card = messages.findLast(message => message.card?.tool === 'set_up_team').card;
      assert(card.teamSetupRequest.result.bots.some(bot => bot.action === 'created'));
      await waitFor(() => api('GET', '/api/bots'), data => !data.bots.find(bot => bot.id === initial.chiefId).tasks.find(task => task.threadId === initial.companionThreadId).busy, 'Chief did not settle after creation decision');
    };
    await createInChat('NATIVE_CREATE_ACCEPTED 创建测试资料助理。');
    const info = await waitFor(() => api('GET', '/companion/info'), value => value.helperIds.length === 3, 'New specialist missing from product roster');
    helperId = info.helperIds.find(id => !initial.helperIds.includes(id));
    const helper = (await api('GET', '/api/bots')).bots.find(bot => bot.id === helperId);
    assert.equal(helper.name, '测试资料助理'); assert.equal(helper.computer, 'off'); assert.equal(helper.approvalMode, 'ask');
    assert.deepEqual(helper.mcpServers, []); assert(!helper.toolScope.allow.includes('mcp:agents:create_bot'));
    const started = await api('POST', '/companion/send', { kind: 'work', sendId: randomUUID(), text: 'NATIVE_TEAM_WORK 让新资料助理保存并校验文件。' }, 202); rootThread = started.threadId;
    const approved = new Set();
    const evidence = await waitFor(async () => {
      const data = await api('GET', '/api/bots');
      const childTasks = data.bots.find(bot => bot.id === helperId).tasks.filter(task => task.openedBy?.threadId === rootThread);
      for (const task of childTasks) {
        const { messages } = await api('GET', `/api/threads/${task.threadId}/messages?limit=100`);
        for (const message of messages) { const card = message.card; if (!card?.requestId || card.answered || card.expired || card.dismissed || approved.has(card.requestId)) continue;
          assert(['workspace_write_file', 'workspace_check_file'].includes(card.tool)); assert.equal(JSON.parse(card.subtitle).path, 'new-helper.md');
          approved.add(card.requestId); await api('POST', `/api/bots/${helperId}/respond`, { threadId: task.threadId, requestId: card.requestId, behavior: 'allow' });
        }
      }
      return api('GET', `/companion/work/${rootThread}/evidence`);
    }, value => value.files.some(file => file.path === 'new-helper.md') && value.tests.some(check => check.exitCode === 0), 'New specialist did not deliver scoped evidence');
    assert.match(evidence.files[0].after, /SAMPLE-84/); assert.equal(approved.size, 2);
    assert(helperToolNames.includes('workspace_write_file')); assert(!helperToolNames.some(name => /terminal|powershell|vm_exec|computer_click/i.test(name)));
    const foreign = (await runtime.api(runtime.current, 'POST', '/api/bots', { name: '同组但未登记', section: '私人书房', useDefaults: false })).bot;
    assert(!(await api('GET', '/companion/info')).helperIds.includes(foreign.id));
    assert.equal(await runtime.workspaceScope(runtime.current, foreign.id, foreign.threadId), null);
    await app.close(); app = null;
    const reopened = new CompanionRuntime({routineTools:'ask', rootDir });
    try { const restored = await reopened.start(); assert(restored.helperIds.includes(helperId)); assert.equal(restored.chiefId, initial.chiefId); assert.equal(restored.companionThreadId, initial.companionThreadId);
      const data = await reopened.api(reopened.current, 'GET', '/api/bots'), child = data.bots.find(bot => bot.id === helperId).tasks.find(task => task.openedBy?.threadId === rootThread);
      assert.equal((await reopened.workspaceScope(reopened.current, helperId, child.threadId)).root, runtime.jobs.get(rootThread).folder);
    } finally { await reopened.close(); }
  } finally { if (app) await app.close(); await provider.close(); }
});

test('manual creation is authenticated, idempotent and retained on a fresh runtime', { timeout: 60000 }, async () => {
  const rootDir = scratch('specialists-manual'); mkdirSync(rootDir, { recursive: true });
  const provider = await fakeReachai(); writeFileSync(join(rootDir, 'companion-settings.json'), JSON.stringify({ provider: 'reachai', reachai: fixtureReachaiConfig(provider.url) }));
  let app;
  const input = { sendId: randomUUID(), name: '行程助理', role: '整理行程', instructions: '先给结论，使用本次已经接通的工具。' };
  try {
    app = await createCompanionServer({ port: 5237, runtime: new CompanionRuntime({routineTools:'ask', rootDir }) });
    const boot = await fetch(app.url + '/companion/info'), cookie = boot.headers.get('set-cookie').split(';')[0], initial = await boot.json();
    assert.equal((await fetch(app.url + '/companion/team/specialists', { method: 'POST', headers: { origin: app.url, 'content-type': 'application/json' }, body: JSON.stringify(input) })).status, 401);
    const create = body => fetch(app.url + '/companion/team/specialists', { method: 'POST', headers: { cookie, origin: app.url, 'content-type': 'application/json' }, body: JSON.stringify(body) });
    const [first, second] = await Promise.all([create(input), create(input)]); const data = await first.json(); assert.equal(first.status, 201, JSON.stringify(data)); assert.equal(second.status, 201);
    assert.equal(data.botId, input.sendId); assert.equal(data.info.helperIds.length, 3);
    assert.equal((await create({ ...input, instructions: 'changed' })).status, 409);
    assert.equal((await create({ ...input, sendId: randomUUID(), name: input.name })).status, 409);
    assert.equal((await create({ ...input, sendId: randomUUID(), approvalMode: 'full' })).status, 400);
    await app.close(); app = null;
    const reopened = new CompanionRuntime({routineTools:'ask', rootDir });
    try { await reopened.start(); const again = await reopened.createSpecialist(input); assert.equal(again.botId, data.botId); assert.equal(again.info.helperIds.length, 3); assert.equal(again.info.chiefId, initial.chiefId); }
    finally { await reopened.close(); }
  } finally { if (app) await app.close(); await provider.close(); }
});
