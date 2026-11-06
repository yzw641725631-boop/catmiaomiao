import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompanionRuntime } from '../../adapters/runtime.mjs';
import { createCompanionServer } from '../../adapters/server.mjs';
import { renameInput } from '../../adapters/team.mjs';
import { fakeReachai, fixtureReachaiConfig } from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';

test('assistant names are single lines and cannot carry profile or execution changes', () => {
  const input = { botId: randomUUID(), name: ' 小蕊 ' };
  assert.equal(renameInput(input).name, '小蕊');
  for (const patch of [{ name: '' }, { name: '  ' }, { name: 'a\nb' }, { name: '\u2028name' }, { name: 'x'.repeat(81) }, { botId: '../someone' }, { soul: 'injected' }, { computer: 'local' }, { permissions: 'full' }]) assert.throws(() => renameInput({ ...input, ...patch }));
});

test('chat renames the chief without an approval card; authenticated UI changes persist without replacing identities', { timeout: 60000 }, async () => {
  const rootDir = scratch('assistant-names'); mkdirSync(rootDir, { recursive: true });
  const provider = await fakeReachai({ chat(body, event, res) {
    if (!body.messages.some(message => message.role === 'tool' && message.toolCallId === 'save_requested_name')) {
      assert(body.tools.some(tool => tool.function.name === 'assistant_rename_assistant'));
      event({ type: 'tool_call.delta', toolCall: { index: 0, id: 'save_requested_name', type: 'function', name: 'assistant_rename_assistant', arguments: JSON.stringify({ name: '小蕊' }) } });
      event({ type: 'completed', finishReason: 'tool_calls' });
    } else {
      const saved = body.messages.find(message => message.toolCallId === 'save_requested_name');
      assert.match(saved.content, /小蕊/);
      event({ type: 'content.delta', text: '已保存，我以后叫小蕊。' }); event({ type: 'completed', finishReason: 'stop' });
    }
    res.end();
  } });
  writeFileSync(join(rootDir, 'companion-settings.json'), JSON.stringify({ provider: 'reachai', reachai: fixtureReachaiConfig(provider.url) }));
  const runtime = new CompanionRuntime({ rootDir }); let app;
  try {
    app = await createCompanionServer({ port: 5246, runtime });
    const boot = await fetch(app.url + '/companion/info'), cookie = boot.headers.get('set-cookie').split(';')[0], info = await boot.json();
    const headers = { cookie, origin: app.url, 'content-type': 'application/json' };
    const rename = body => fetch(app.url + '/companion/team/rename', { method: 'POST', headers, body: JSON.stringify(body) });
    const bots = () => runtime.api(runtime.current, 'GET', '/api/bots');
    const before = (await bots()).bots.find(bot => bot.id === info.chiefId);
    const sent = await fetch(app.url + '/companion/send', { method: 'POST', headers, body: JSON.stringify({ kind: 'chat', text: '给你改名字，以后叫小蕊。', sendId: randomUUID() }) });
    assert.equal(sent.status, 202);
    const deadline = Date.now() + 30000; let messages;
    while (Date.now() < deadline) {
      messages = (await runtime.api(runtime.current, 'GET', `/api/threads/${info.companionThreadId}/messages?limit=100`)).messages;
      if (messages.some(message => message.turnTerminal && message.turnSucceeded && message.text?.includes('已保存，我以后叫小蕊。'))) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(messages.some(message => message.text?.includes('已保存，我以后叫小蕊。')));
    assert(!messages.some(message => message.kind === 'options' && message.card?.tool?.includes('rename')), 'An explicit requested local rename should not block on approval');
    const renamed = (await bots()).bots.find(bot => bot.id === info.chiefId);
    assert.equal(renamed.name, '小蕊');
    for (const field of ['soul', 'computer', 'browser', 'approvalMode', 'toolScope', 'mcpServers', 'modelSelection']) assert.deepEqual(renamed[field], before[field]);
    assert.deepEqual(renamed.tasks.map(task => task.threadId), before.tasks.map(task => task.threadId));
    assert.equal((await fetch(app.url + '/companion/team/rename', { method: 'POST', headers: { origin: app.url, 'content-type': 'application/json' }, body: JSON.stringify({ botId: info.chiefId, name: '未授权' }) })).status, 401);
    assert.equal((await fetch(app.url + '/companion/team/rename', { method: 'POST', headers: { ...headers, origin: 'https://foreign.invalid' }, body: JSON.stringify({ botId: info.chiefId, name: '跨站' }) })).status, 403);
    assert.equal((await rename({ botId: info.chiefId, name: '小蕊', computer: 'local' })).status, 400);
    const foreign = (await runtime.api(runtime.current, 'POST', '/api/bots', { name: '非本团队', section: before.section, useDefaults: false })).bot;
    assert.equal((await rename({ botId: foreign.id, name: '不能修改' })).status, 403);
    assert.equal((await rename({ botId: info.helperIds[0], name: '小蕊' })).status, 409);
    const simultaneous = await Promise.all(info.helperIds.slice(0, 2).map(botId => rename({ botId, name: '同名冲突' })));
    assert.deepEqual(simultaneous.map(response => response.status).sort(), [200, 409]);
    const helper = (await bots()).bots.find(bot => bot.id === info.helperIds[0]);
    await assert.rejects(runtime.services.call('rename_assistant', { name: '越权' }, { botId: helper.id, threadId: helper.tasks[0].threadId }), /主助理/);
    assert.equal((await rename({ botId: info.chiefId, name: '小蕊' })).status, 200, 'An exact retry remains successful');
    const expectedNames = (await bots()).bots.filter(bot => [info.chiefId, ...info.helperIds].includes(bot.id)).map(bot => [bot.id, bot.name]);
    await app.close(); app = null;
    const reopened = new CompanionRuntime({ rootDir });
    try {
      const restored = await reopened.start();
      assert.equal(restored.chiefId, info.chiefId); assert.equal(restored.companionThreadId, info.companionThreadId);
      for (const [id, name] of expectedNames) assert.equal((await reopened.api(reopened.current, 'GET', '/api/bots')).bots.find(bot => bot.id === id).name, name);
      const saved = await reopened.api(reopened.current, 'GET', `/api/threads/${info.companionThreadId}/messages?limit=100`);
      assert(saved.messages.some(message => message.text?.includes('已保存，我以后叫小蕊。')));
    } finally { await reopened.close(); }
  } finally { if (app) await app.close(); await provider.close(); }
});
