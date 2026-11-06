import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConversationSettings } from '../../adapters/conversation-settings.mjs';
import { CompanionRuntime } from '../../adapters/runtime.mjs';
import { createCompanionServer } from '../../adapters/server.mjs';
import { AssistantServices } from '../../adapters/assistant-services.mjs';
import { ContinuousVoice } from '../src/continuousVoice.ts';
import { fakeReachai, fixtureReachaiConfig } from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';

function fixture() {
  const rootDir = scratch('conversation-settings'); mkdirSync(rootDir, { recursive: true });
  const settingsFile = join(rootDir, 'companion-settings.json');
  const original = { provider: 'reachai', reachai: { url: 'https://fixture.invalid', key: 'fixture-local-private', llmId: 'keep-model', asrMode: 'realtime', ttsId: 'existing-voice', speed: 1, voice: 'original' }, unrelated: { keep: true } };
  writeFileSync(settingsFile, JSON.stringify(original));
  const runtime = { rootDir, settingsFile, current: { chiefId: 'chief', companionThreadId: 'chat', helperIds: ['helper'] }, activeProvider: () => 'reachai', switching: false };
  runtime.conversationSettings = new ConversationSettings(runtime);
  return { runtime, original, rootDir, settingsFile };
}

test('conversation preferences persist atomically, merge GUI settings and reject credential/access/model changes', () => {
  const { runtime, original, settingsFile } = fixture(), settings = runtime.conversationSettings, observed = [];
  const unsubscribe = settings.subscribe(snapshot => observed.push(snapshot));
  const first = settings.update({ readReplies: true, reducedMotion: true, speechRate: 0.85 });
  assert(first.saved); assert.equal(first.settings.revision, 1); assert.equal(first.settings.voice.speechRate, 0.85);
  const stored = JSON.parse(readFileSync(settingsFile, 'utf8'));
  assert.equal(stored.reachai.key, original.reachai.key); assert.equal(stored.reachai.llmId, original.reachai.llmId); assert.deepEqual(stored.unrelated, original.unrelated);
  assert(!JSON.stringify(first).includes(original.reachai.key)); assert(!JSON.stringify(first).includes(original.reachai.url));
  // A GUI voice update is read from the same source, rather than hidden by an old conversational override.
  stored.reachai.speed = 1.2; writeFileSync(settingsFile, JSON.stringify(stored));
  const restarted = new ConversationSettings(runtime); assert.equal(restarted.snapshot().voice.speechRate, 1.2); assert(restarted.snapshot().preferences.readReplies);
  const second = settings.update({ pureView: true }); assert.equal(second.settings.revision, 2); assert.equal(second.settings.voice.speechRate, 1.2);
  const beforeInvalid = readFileSync(settingsFile, 'utf8');
  for (const patch of [{}, { readReplies: 'true' }, { speechRate: 0.1 }, { speechRate: NaN }, { voiceId: 'bad\nvoice' }, { model: 'other' }, { permissions: 'full' }, { key: 'injected' }, { reducedMotion: true, computer: true }]) assert.throws(() => settings.update(patch));
  assert.equal(readFileSync(settingsFile, 'utf8'), beforeInvalid);
  runtime.switching = true; assert.throws(() => settings.update({ pureView: false }), /重新连接/); runtime.switching = false;
  runtime.activeProvider = () => 'compatible'; assert.throws(() => settings.update({ speechRate: 0.8, reducedMotion: false }), /声音连接/); assert.equal(readFileSync(settingsFile, 'utf8'), beforeInvalid);
  assert.equal(observed.length, 2); unsubscribe(); settings.update({ pureView: false }); assert.equal(observed.length, 2);
});

test('only the chief conversation controls preferences; explicit memory confirmation and reminder pause retain history', async () => {
  const { runtime } = fixture(); let memory = { text: '# 记忆', hash: 'before' };
  runtime.api = async (session, method, path, body) => {
    if (path === '/api/bots') return { bots: [{ id: 'chief', tasks: [{ threadId: 'chat' }, { threadId: 'background' }] }, { id: 'helper', tasks: [{ threadId: 'child' }] }] };
    if (method === 'GET') return memory;
    assert.equal(body.expectedHash, memory.hash); memory = { text: body.text, hash: randomUUID() }; return memory;
  };
  const service = new AssistantServices(runtime), actor = { botId: 'chief', threadId: 'chat' };
  for (const other of [{ botId: 'helper', threadId: 'child' }, { botId: 'chief', threadId: 'background' }, { botId: 'foreign', threadId: 'chat' }]) await assert.rejects(service.call('app_settings', { action: 'update', changes: { readReplies: true } }, other));
  assert.equal((await service.call('app_settings', { action: 'update', changes: { readReplies: true } }, actor)).saved, true);
  await assert.rejects(service.call('app_settings', { action: 'read', changes: { readReplies: false } }, actor));
  const pending = await service.call('remember_preference', { text: '报告先给结论' }, actor); assert.equal(pending.status, 'pending'); assert(!memory.text.includes(pending.text));
  const listing = await service.call('manage_preference', { action: 'list' }, actor); assert.equal(listing.preferences[0].id, pending.id);
  await service.call('manage_preference', { action: 'confirm', id: pending.id }, actor); assert(memory.text.includes(pending.text));
  await service.call('manage_preference', { action: 'forget', id: pending.id }, actor); assert(!memory.text.includes(pending.text)); assert.equal(service.data.preferences[0].status, 'forgotten');
  const reminder = service.createReminder({ title: '喝水', at: new Date(Date.now() + 3600000).toISOString(), repeat: 'once', action: 'notify' });
  await service.call('manage_reminder', { action: 'pause', id: reminder.id }, actor); assert.equal(reminder.status, 'paused');
  await service.call('manage_reminder', { action: 'resume', id: reminder.id }, actor); assert.equal(reminder.status, 'active');
  await service.call('manage_reminder', { action: 'cancel', id: reminder.id }, actor); assert.equal(reminder.status, 'cancelled'); assert.equal(service.data.reminders.length, 1);
});

test('a spoken rename executes through the real native conversation, resumes listening, and settings changes reach an authenticated live subscriber', { timeout: 60000 }, async () => {
  const rootDir = scratch('conversation-controls-native'); mkdirSync(rootDir, { recursive: true });
  const provider = await fakeReachai({ chat(body, event, res) {
    const userIndex = body.messages.findLastIndex(message => message.role === 'user'), user = body.messages[userIndex]?.content.split('\n\n[本地助理能力说明，')[0] || '';
    const current = body.messages.slice(userIndex + 1), done = prefix => current.some(message => message.role === 'tool' && message.toolCallId?.startsWith(prefix));
    const call = (prefix, name, args) => { assert(body.tools.some(tool => tool.function.name === name)); event({ type: 'tool_call.delta', toolCall: { index: 0, id: prefix + '_' + randomUUID(), type: 'function', name, arguments: JSON.stringify(args) } }); event({ type: 'completed', finishReason: 'tool_calls' }); res.end(); };
    if (user.includes('改一下名字') && !done('rename')) { assert(body.messages[userIndex].content.includes('[本次输入方式：语音转写]')); return call('rename', 'assistant_rename_assistant', { name: '小蕊' }); }
    if (user.includes('语速调慢') && !done('settings')) return call('settings', 'assistant_app_settings', { action: 'update', changes: { speechRate: 0.85, reducedMotion: true, readReplies: true } });
    if (user.includes('记住')) {
      if (!done('propose')) return call('propose', 'assistant_remember_preference', { text: '报告先给结论' });
      if (!done('confirm')) { const tool = current.find(message => message.role === 'tool' && message.toolCallId?.startsWith('propose')); const row = JSON.parse(JSON.parse(tool.content).result); return call('confirm', 'assistant_manage_preference', { action: 'confirm', id: row.id }); }
    }
    event({ type: 'content.delta', text: user.includes('改一下名字') ? '好，以后我就叫小蕊。' : '已保存。' }); event({ type: 'completed', finishReason: 'stop' }); res.end();
  } });
  writeFileSync(join(rootDir, 'companion-settings.json'), JSON.stringify({ provider: 'reachai', reachai: fixtureReachaiConfig(provider.url) }));
  const runtime = new CompanionRuntime({ rootDir }); let app, streamReader, voice;
  try {
    app = await createCompanionServer({ port: 5256, runtime });
    const boot = await fetch(app.url + '/companion/info'), info = await boot.json(), cookie = boot.headers.get('set-cookie').split(';')[0];
    const headers = { cookie, origin: app.url, 'content-type': 'application/json' };
    const endpoint = app.url + '/companion/settings/conversation';
    assert.equal((await fetch(endpoint)).status, 401);
    assert.equal((await fetch(endpoint, { method: 'POST', headers: { ...headers, origin: 'https://foreign.invalid' }, body: JSON.stringify({ readReplies: true }) })).status, 403);
    assert.equal((await fetch(app.url + '/companion/settings/events')).status, 401);
    const stream = await fetch(app.url + '/companion/settings/events', { headers: { cookie }, signal: AbortSignal.timeout(30000) }); streamReader = stream.body.getReader(); let streamBuffer = '';
    const nextSettings = async () => {
      while (true) {
        const end = streamBuffer.indexOf('\n\n');
        if (end >= 0) { const frame = streamBuffer.slice(0, end); streamBuffer = streamBuffer.slice(end + 2); if (frame.startsWith('data: ')) return JSON.parse(frame.slice(6)); }
        const { value, done } = await streamReader.read(); assert(!done); streamBuffer += new TextDecoder().decode(value);
      }
    };
    assert.equal((await nextSettings()).revision, 0);
    const messages = async () => (await runtime.api(runtime.current, 'GET', `/api/threads/${info.companionThreadId}/messages?limit=100`)).messages;
    const waitReply = async sendId => { const until = Date.now() + 20000; while (Date.now() < until) { const list = await messages(), user = list.find(message => message.sendId === sendId); if (user && list.some(message => message.requestMessageId === user.id && message.turnTerminal && message.turnSucceeded)) return list; await new Promise(resolve => setTimeout(resolve, 100)); } assert.fail('Native conversational action did not complete'); };
    const send = async (text, inputSource = 'text') => { const sendId = randomUUID(); const response = await fetch(app.url + '/companion/send', { method: 'POST', headers, body: JSON.stringify({ kind: 'chat', text, sendId, inputSource }) }); assert.equal(response.status, 202); return sendId; };
    const captures = [], spoken = []; let sendId;
    voice = new ContinuousVoice({ capture: handlers => { captures.push(handlers); return { cancel() {}, async finish() {} }; }, submit: async (text, arm) => { sendId = await send(text, 'voice'); arm(sendId); return true; }, speak: async text => { spoken.push(text); }, stopSpeech() {}, changed() {}, failed: message => assert.fail(message) }, 45000, false);
    voice.start(); captures[0].complete('你帮我改一下名字，叫小蕊就行了。');
    while (!sendId) await new Promise(resolve => setTimeout(resolve, 20));
    voice.receive({ [info.companionThreadId]: await waitReply(sendId) });
    await new Promise(resolve => setTimeout(resolve, 340)); assert.deepEqual(spoken, ['好，以后我就叫小蕊。']); assert.equal(voice.phase, 'listening'); assert.equal(captures.length, 2); voice.stop();
    assert.equal((await runtime.api(runtime.current, 'GET', '/api/bots')).bots.find(bot => bot.id === info.chiefId).name, '小蕊');
    await waitReply(await send('语速调慢一点，打字回复也读出来，并减少动态效果。'));
    const pushed = await nextSettings(); assert.equal(pushed.voice.speechRate, 0.85); assert(pushed.preferences.readReplies); assert(pushed.preferences.reducedMotion);
    assert.equal(runtime.reachaiClient().config.speed, 0.85); assert.equal((await runtime.info()).sessionId, info.sessionId, 'Preference changes must not restart or interrupt the native conversation');
    const spokenAudio = await fetch(app.url + '/api/tts/speak', { method: 'POST', headers, body: JSON.stringify({ text: '合成音频配置验证' }) }); assert(spokenAudio.ok); await spokenAudio.arrayBuffer();
    assert.equal(provider.requests.findLast(row => row.path === '/model/audio/speech').body.speed, 0.85);
    const latest = await fetch(endpoint, { headers: { cookie } }); assert.equal((await latest.json()).revision, pushed.revision);
    await waitReply(await send('帮我记住，报告先给结论。'));
    assert.equal(runtime.services.data.preferences[0].status, 'confirmed');
    assert((await runtime.api(runtime.current, 'GET', `/api/bots/${info.chiefId}/memory/file`)).text.includes('报告先给结论'));
    const all = await messages(); assert(!all.some(message => message.kind === 'options' && !message.card?.answered));
  } finally { voice?.stop(); await streamReader?.cancel().catch(() => {}); if (app) await app.close(); await provider.close(); }
});
