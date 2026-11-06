import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createCompanionServer } from '../../adapters/server.mjs';
import { CompanionRuntime, validatedEndpoint } from '../../adapters/runtime.mjs';
import { scratch } from './scratch.mjs';

const app = await createCompanionServer({ port: 5227, runtime: new CompanionRuntime({ forceFixture: true, rootDir: scratch('bridge') }) });
after(() => app.close());
const boot = await fetch(app.url + '/companion/info');
const cookie = boot.headers.get('set-cookie').split(';')[0];
const info = await boot.json();
const call = async (method, path, body, expected = 200) => {
  const res = await fetch(app.url + path, { method, headers: { cookie, origin: app.url, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  const data = await res.json();
  assert.equal(res.status, expected, JSON.stringify(data));
  return data;
};
async function until(fn, timeout = 35000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await fn(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 200)); }
  assert.fail('The expected state did not arrive');
}

test('browser bridge rejects cross-origin, unknown host, missing capability and arbitrary admin proxy', async () => {
  assert.equal((await fetch(app.url + '/api/bots')).status, 401);
  assert.equal((await fetch(app.url + '/companion/info', { headers: { origin: 'http://attacker.invalid' } })).status, 403);
  await call('PUT', '/api/config', { instances: {} }, 403);
  await call('POST', '/api/bots', { name: 'not-allowed' }, 404);
  assert.throws(() => validatedEndpoint('http://example.com/v1'));
  assert.throws(() => validatedEndpoint('https://user:secret@example.com/v1'));
  assert.equal(validatedEndpoint('http://127.0.0.1:9000/v1/chat/completions'), 'http://127.0.0.1:9000/v1');
});

test('production page permits the local voice WASM backend while retaining script and frame protections', async () => {
  const page = await fetch(app.url + '/');
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /^text\/html/);
  const policy = page.headers.get('content-security-policy');
  const directives = new Map(policy.split(';').map(value => value.trim().split(/\s+/)).filter(([name]) => name).map(([name, ...sources]) => [name, sources]));
  assert(directives.get('script-src').includes("'wasm-unsafe-eval'"), 'The deployed voice detector needs WebAssembly compilation');
  assert(directives.get('script-src').includes("'self'"));
  assert(!directives.get('script-src').includes("'unsafe-eval'"), 'JavaScript eval must remain blocked');
  assert(!directives.get('script-src').includes("'unsafe-inline'"), 'Inline scripts must remain blocked');
  assert.deepEqual(directives.get('frame-ancestors'), ["'none'"]);
  assert.deepEqual(directives.get('object-src'), ["'none'"]);
  assert.deepEqual(directives.get('connect-src'), ["'self'"]);
  const wasm = await fetch(app.url + '/audio/vad/ort-wasm-simd-threaded.wasm');
  assert.equal(wasm.status, 200);
  assert.equal(wasm.headers.get('content-type'), 'application/wasm');
  assert.equal(wasm.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(Buffer.from(await wasm.arrayBuffer()).subarray(0, 4).toString(), '\0asm');
  const worklet = await fetch(app.url + '/audio/vad/vad.worklet.bundle.min.js');
  assert.equal(worklet.status, 200);
  assert.match(worklet.headers.get('content-type'), /javascript/);
});

test('same send id dispatches one work thread, real helpers write a file and chat continues', async () => {
  const body = { kind: 'work', text: '集成测试：整理一份文档', sendId: 'bridge_integration_work_0001' };
  const [one, two] = await Promise.all([call('POST', '/companion/send', body, 202), call('POST', '/companion/send', body, 202)]);
  assert.equal(one.threadId, two.threadId);
  assert.equal(one.info.workThreadIds.length, 1);
  const during = await until(async () => { const { bots } = await call('GET', '/api/bots'); return bots.filter(bot => info.helperIds.includes(bot.id)).every(bot => bot.tasks.some(task => task.busy)) && bots; });
  assert.equal(during.filter(bot => info.helperIds.includes(bot.id)).length, 2);
  await call('POST', '/companion/send', { kind: 'chat', text: '工作的时候可以聊吗？', sendId: 'bridge_integration_chat_0001' }, 202);
  await until(async () => (await call('GET', `/api/threads/${info.companionThreadId}/messages`)).messages.find(message => message.role === 'bot' && message.turnTerminal));
  const evidence = await until(async () => { const value = await call('GET', `/companion/work/${one.threadId}/evidence`); return value.files.length && value; });
  assert.equal(evidence.files[0].path, 'report.md');
  assert.match(evidence.files[0].after, /集成测试/);
  assert.equal(evidence.tests[0].exitCode, 0);
  assert.match(evidence.coverage, /隔离演示/);
  const transcript = await until(async () => { const { messages } = await call('GET', `/api/threads/${one.threadId}/messages`); return messages.some(message => message.text?.includes('两位小助理已经完成')) && messages; });
  const final = transcript.find(message => message.text?.includes('查看这份文档'));
  assert(final);
  const href = /\[查看这份文档\]\(([^)]+)\)/.exec(final.text)[1];
  const file = await fetch(`${app.url}/api/threads/${one.threadId}/messages/${final.id}/file`, { method: 'POST', headers: { cookie, origin: app.url, 'content-type': 'application/json' }, body: JSON.stringify({ path: href }) });
  assert.equal(file.status, 200); assert.match(await file.text(), /个人助理工作小样/);
  const conflict = { ...body, text: '同一个标识的另一段消息' };
  await call('POST', '/companion/send', conflict, 409);
});

test('stopping the selected slow work does not stop a separate chat', async () => {
  const work = await call('POST', '/companion/send', { kind: 'work', text: '慢任务：验证停止范围', sendId: 'bridge_integration_stop_0001' }, 202);
  await until(async () => { const { bots } = await call('GET', '/api/bots'); return bots.find(bot => bot.id === info.chiefId).tasks.find(task => task.threadId === work.threadId)?.busy; });
  await call('POST', `/api/bots/${info.chiefId}/interrupt`, { threadId: work.threadId });
  const chat = await call('POST', '/companion/send', { kind: 'chat', text: '停止以后继续聊', sendId: 'bridge_integration_chat_0002' }, 202);
  assert.equal(chat.threadId, info.companionThreadId);
  await until(async () => (await call('GET', `/api/threads/${info.companionThreadId}/messages`)).messages.filter(message => message.role === 'bot' && message.turnTerminal).length >= 2);
});

test('a follow-up reaches work that was already handed off, idempotently, and unknown work is refused', async () => {
  await call('POST', '/companion/work/no-such-work-thread/add', { text: '补充', sendId: 'bridge_addition_unknown_0001' }, 404);
  const work = await call('POST', '/companion/send', { kind: 'work', text: '集成测试：补充到已有工作', sendId: 'bridge_addition_work_0001' }, 202);
  await call('POST', `/companion/work/${work.threadId}/add`, { text: '', sendId: 'bridge_addition_empty_0001' }, 400);
  await until(async () => { const { bots } = await call('GET', '/api/bots'); const task = bots.find(bot => bot.id === info.chiefId).tasks.find(task => task.threadId === work.threadId); return task && !task.busy && !task.waitingForTeammates; }, 60000);
  const body = { text: '再加一段三句话的总结', sendId: 'bridge_addition_text_0001' };
  const [one, two] = await Promise.all([call('POST', `/companion/work/${work.threadId}/add`, body, 202), call('POST', `/companion/work/${work.threadId}/add`, body, 202)]);
  assert.equal(one.delivery, two.delivery);
  assert(['steered', 'queued', 'started'].includes(one.delivery));
  await call('POST', `/companion/work/${work.threadId}/add`, { ...body, text: '另一段补充' }, 409);
  const { messages } = await until(async () => { const page = await call('GET', `/api/threads/${work.threadId}/messages`); return page.messages.some(message => message.role === 'user' && message.text?.startsWith('[用户补充] 再加一段三句话的总结')) && page; });
  assert.equal(messages.filter(message => message.role === 'user' && message.text?.startsWith('[用户补充]')).length, 1);
});

test('search, reply, reactions, documents and notifications stay inside this session and the narrow routes', async () => {
  await call('POST', '/companion/send', { kind: 'chat', text: '搜索测试：蓝莓果酱的做法', sendId: 'bridge_features_chat_0001' }, 202);
  const page = await until(async () => { const value = await call('GET', `/api/threads/${info.companionThreadId}/messages`); return value.messages.some((m) => m.role === 'bot' && m.turnTerminal && m.at > Date.now() - 60000) && value; });
  // search: own threads only, query validated, raw upstream route stays closed
  const found = await until(async () => { const value = await call('GET', '/companion/search?q=' + encodeURIComponent('蓝莓果酱')); return value.hits.length && value; });
  assert.equal(found.hits[0].where, 'chat'); assert.equal(found.hits[0].threadId, info.companionThreadId); assert.match(found.hits[0].snippet, /蓝莓果酱/);
  assert.equal((await call('GET', '/companion/search?q=' + encodeURIComponent('本地助理能力说明'))).hits.length, 0, 'adapter envelopes are not search results');
  await call('GET', '/companion/search?q=', undefined, 400);
  await call('GET', '/companion/search?q=a&limit=5', undefined, 400);
  await call('POST', '/companion/search?q=a', {}, 404);
  await call('GET', '/api/search?q=a', undefined, 404);
  // reactions: only on the Chief's replies in the main conversation
  const reply = page.messages.filter((m) => m.role === 'bot' && m.kind === 'text').at(-1);
  const mine = page.messages.filter((m) => m.role === 'user').at(-1);
  const reacted = await call('POST', `/companion/messages/${reply.id}/reactions`, { emoji: '❤️' });
  assert(reacted.message.reactions.some((r) => r.emoji === '❤️' && r.by === 'user'));
  await call('POST', `/companion/messages/${reply.id}/reactions`, { emoji: '❤️', on: false });
  await call('POST', `/companion/messages/${mine.id}/reactions`, { emoji: '❤️' }, 404);
  await call('POST', `/companion/messages/${reply.id}/reactions`, { emoji: 'not-an-emoji' }, 400);
  await call('POST', `/companion/messages/${reply.id}/reactions`, { emoji: '❤️', on: 'yes' }, 400);
  await call('POST', `/api/threads/${info.companionThreadId}/messages/${reply.id}/reactions`, { emoji: '❤️' }, 404);
  // reply: replyToId reaches upstream; only for chat; unknown target refused
  await until(async () => { const { bots } = await call('GET', '/api/bots'); return !bots.find((b) => b.id === info.chiefId).tasks.find((t) => t.threadId === info.companionThreadId)?.busy; });
  await call('POST', '/companion/send', { kind: 'chat', text: '接着这条说', sendId: 'bridge_features_reply_0001', replyToId: reply.id }, 202);
  const answered = await until(async () => (await call('GET', `/api/threads/${info.companionThreadId}/messages`)).messages.find((m) => m.sendId === 'bridge_features_reply_0001'));
  assert.equal(answered.replyToId, reply.id);
  await call('POST', '/companion/send', { kind: 'work', text: '回复不能用于任务', sendId: 'bridge_features_reply_0002', replyToId: reply.id }, 400);
  await call('POST', '/companion/send', { kind: 'chat', text: '回复格式', sendId: 'bridge_features_reply_0003', replyToId: '../x' }, 400);
  // documents: upload through /api/files only; no generic file serving
  const bytes = new TextEncoder().encode('# 附件\n蓝莓三盒');
  const upload = await fetch(`${app.url}/api/files?uploadId=${crypto.randomUUID()}&name=${encodeURIComponent('清单.md')}`, { method: 'POST', headers: { cookie, origin: app.url, 'content-type': 'text/markdown' }, body: bytes });
  const saved = await upload.json(); assert.equal(upload.status, 201, JSON.stringify(saved)); assert.match(saved.path, /[a-f0-9-]{36}\.md$/);
  const name = saved.path.split(/[\\/]/).at(-1);
  assert.equal((await fetch(`${app.url}/api/attachments/${name}`, { headers: { cookie, origin: app.url } })).status, 404);
  assert.equal((await fetch(`${app.url}/api/files/${name}`, { headers: { cookie, origin: app.url } })).status, 404);
  // notifications: merged list, read routes; raw upstream routes stay closed
  const list = await call('GET', '/companion/notifications');
  assert(Array.isArray(list.notifications)); assert.equal(typeof list.unread, 'number');
  assert(list.notifications.every((item) => ['native', 'reminder'].includes(item.source)));
  const native = list.notifications.find((item) => item.source === 'native');
  if (native) await call('POST', `/companion/notifications/native/${native.id}/read`, {});
  await call('POST', '/companion/notifications/native/not-a-notification/read', {}, 404);
  await call('POST', '/companion/notifications/read-all', {});
  assert.equal((await call('GET', '/companion/notifications')).unread, 0);
  await call('GET', '/api/notifications', undefined, 404);
  await call('POST', '/api/notifications/read-all', {}, 404);
});

test('special cards: secret entry is scoped to this team and never echoed; sign-in, today, style and brief validate input', async () => {
  const sendId = 'bridge_cards_demo_0001';
  // A message sent into a running reply is steered into it; start the demo on its own turn.
  await until(async () => { const { bots } = await call('GET', '/api/bots'); return !bots.find(bot => bot.id === info.chiefId).tasks.find(task => task.threadId === info.companionThreadId)?.busy; }, 60000);
  const receipt = await call('POST', '/companion/send', { kind: 'chat', text: '演示卡片', sendId }, 202);
  assert(!receipt.steered && !receipt.queued, JSON.stringify(receipt));
  const { messages } = await until(async () => { const page = await call('GET', `/api/threads/${info.companionThreadId}/messages`); return page.messages.some(m => m.kind === 'secret') && page.messages.some(m => m.kind === 'widget') && page; }, 60000);
  const widget = messages.find(m => m.kind === 'widget');
  assert(JSON.stringify(widget.widget.root).includes('"Chart"') && JSON.stringify(widget.widget.root).includes('"Table"'));
  const secret = messages.find(m => m.kind === 'secret');
  const card = { botId: info.chiefId, threadId: info.companionThreadId, messageId: secret.id };
  const value = 'bridge-secret-value-never-echoed-9041';
  await call('POST', '/companion/cards/secret', { ...card, messageId: 'not a card' }, 400);
  await call('POST', '/companion/cards/secret', { ...card, value: '' }, 400);
  await call('POST', '/companion/cards/secret', { ...card, value: 'two\nlines' }, 400);
  await call('POST', '/companion/cards/secret', { ...card, botId: '00000000-0000-4000-8000-000000000000', value }, 403);
  await call('POST', '/companion/cards/secret', { ...card, threadId: '00000000-0000-4000-8000-000000000001', value }, 403);
  await call('POST', '/companion/cards/secret', { ...card, messageId: widget.id, value }, 404);
  // Saving is checked by the native route against the provider; here it may fail offline. Either way the value never comes back.
  const res = await fetch(app.url + '/companion/cards/secret', { method: 'POST', headers: { cookie, origin: app.url, 'content-type': 'application/json' }, body: JSON.stringify({ ...card, value }) });
  const raw = await res.text();
  assert(!raw.includes(value), 'the secret value must not be echoed');
  assert([200, 400, 502].includes(res.status), raw);
  // The native write routes stay closed to the browser.
  for (const [method, path] of [['PUT', '/api/config'], ['PATCH', '/api/config'], ['POST', `/api/bots/${info.chiefId}/secret-cards/${secret.id}/provided`], ['POST', `/api/bots/${info.chiefId}/sign-in-cards/${secret.id}/done`], ['GET', '/api/today?since=0']]) {
    const blocked = await fetch(app.url + path, { method, headers: { cookie, origin: app.url, 'content-type': 'application/json' }, ...(method === 'GET' ? {} : { body: '{}' }) });
    assert([403, 404].includes(blocked.status), `${method} ${path} -> ${blocked.status}`);
  }
  await call('POST', '/companion/cards/sign-in', { ...card, answer: 'maybe' }, 400);
  await call('POST', '/companion/cards/sign-in', { ...card, answer: 'done' }, 404);
  const today = await call('GET', '/companion/today');
  assert(Array.isArray(today.needsYou) && Array.isArray(today.results) && Array.isArray(today.works) && Array.isArray(today.reminders));
  assert(today.results.every(line => typeof line.title === 'string'));
  assert.equal(today.brief.enabled, false);
  await call('POST', '/companion/style', { preset: 'loud' }, 400);
  await call('POST', '/companion/style', { preset: 'concise', text: 'x'.repeat(201) }, 400);
  await call('POST', '/companion/style', { preset: 'concise', extra: 1 }, 400);
  assert.deepEqual(await call('POST', '/companion/style', { preset: 'warm', text: '称呼我小林' }), { preset: 'warm', text: '称呼我小林' });
  const chief = (await call('GET', '/api/bots')).bots.find(bot => bot.id === info.chiefId);
  assert.match(chief.soul, /\[说话风格\]\n.*温和[\s\S]*称呼我小林\n\[\/说话风格\]$/);
  await call('POST', '/companion/style', { preset: '', text: '' });
  assert(!(await call('GET', '/api/bots')).bots.find(bot => bot.id === info.chiefId).soul.includes('[说话风格]'));
  await call('POST', '/companion/brief', { enabled: true, time: '25:00' }, 400);
  assert.equal((await call('POST', '/companion/brief', { enabled: true, time: '07:45' })).time, '07:45');
  assert.equal((await call('POST', '/companion/brief', { enabled: false })).enabled, false);
});

test('memory writes retain optimistic conflict handling across the bridge', async () => {
  const path = `/api/bots/${info.chiefId}/memory/file`;
  const first = await call('GET', path);
  const text = '# 偏好\n\n- 集成测试：简短中文回复。\n';
  await call('PUT', path, { text, expectedHash: first.hash });
  await call('PUT', path, { text: 'stale overwrite', expectedHash: first.hash }, 409);
  assert.equal((await call('GET', path)).text, text);
  const current = await call('GET', path);
  await call('PUT', path, { text: `${text}- 第二次修改，用于撤销测试。\n`, expectedHash: current.hash });
  const { entries } = await call('GET', `/api/bots/${info.chiefId}/memory/journal`);
  const latest = entries.find(entry => entry.path === 'MEMORY.md' && entry.canRevert);
  assert(latest, 'a real reversible journal entry exists');
  await call('POST', `/api/bots/${info.chiefId}/memory/journal/${latest.id}/revert`, {});
  assert.equal((await call('GET', path)).text, text);
});
