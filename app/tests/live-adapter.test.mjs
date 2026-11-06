import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCompanionServer } from '../../adapters/server.mjs';
import { CompanionRuntime } from '../../adapters/runtime.mjs';
import { scratch } from './scratch.mjs';

test('compatible API route, secret masking, ASR and restart persistence use an isolated live runtime', async () => {
  const requests = [];
  const provider = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    const raw = Buffer.concat(chunks).toString();
    requests.push({ path: req.url, authorized: req.headers.authorization === 'Bearer fixture-key-never-real', authorizedSecond: req.headers.authorization === 'Bearer fixture-key-never-real-second', raw });
    if (req.url === '/v1/models') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'fixture-chat' }] })); return; }
    if (req.url === '/v1/audio/transcriptions') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ text: '这是一段模拟语音识别结果。' })); return; }
    if (req.url !== '/v1/chat/completions') { res.writeHead(404); res.end(); return; }
    const body = JSON.parse(raw || '{}');
    const text = '兼容 API 传输验证成功。';
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: text }, finish_reason: null }] })}\n\ndata: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 8 } })}\n\ndata: [DONE]\n\n`);
    } else { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: text }, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 8 } })); }
  });
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const providerUrl = `http://127.0.0.1:${provider.address().port}`;
  const rootDir = scratch('live-contract');
  mkdirSync(rootDir, { recursive: true });
  let app;
  try {
    app = await createCompanionServer({ port: 5228, runtime: new CompanionRuntime({routineTools:'ask', forceFixture: true, rootDir }) });
    const infoRes = await fetch(app.url + '/companion/info');
    const cookie = infoRes.headers.get('set-cookie').split(';')[0];
    const call = async (method, path, body) => {
      const res = await fetch(app.url + path, { method, headers: { cookie, origin: app.url, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await res.json(); assert(res.ok, JSON.stringify(data)); return data;
    };
    const saved = await call('POST', '/companion/settings/model', { url: providerUrl + '/v1', model: 'fixture-chat', key: 'fixture-key-never-real' });
    assert.equal(saved.mode, 'live'); assert(!JSON.stringify(saved).includes('fixture-key-never-real'));
    assert(existsSync(join(rootDir, 'live-harness', 'tmp')), 'Isolated SQLite and process temp folder must exist before dispatch');
    const send = await call('POST', '/companion/send', { kind: 'chat', text: '请验证兼容接口', sendId: 'live_contract_chat_0001' });
    const deadline = Date.now() + 30000; let reply;
    while (Date.now() < deadline) {
      const page = await call('GET', `/api/threads/${send.threadId}/messages`);
      reply = page.messages.find(message => message.text?.includes('传输验证成功') && message.turnTerminal);
      if (reply) break;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
    assert(reply, 'The real compatible driver must return the loopback API response');
    assert(requests.some(request => request.path === '/v1/chat/completions' && request.authorized));
    const memoryPath = `/api/bots/${saved.chiefId}/memory/file`;
    const memory = await call('GET', memoryPath);
    await call('PUT', memoryPath, { text: '# Persistent fixture preference\n\n- concise replies\n', expectedHash: memory.hash });
    await call('POST', '/companion/settings/asr', { url: providerUrl + '/v1/audio/transcriptions', model: 'fixture-asr', key: 'fixture-key-never-real' });
    const form = new FormData(); form.append('file', new Blob(['test-audio'], { type: 'audio/webm' }), 'voice.webm');
    const voiceId = randomUUID(); await call('POST', '/companion/voice/session', { action: 'claim', id: voiceId });
    const transcribed = await fetch(app.url + '/companion/transcribe', { method: 'POST', headers: { cookie, origin: app.url, 'x-companion-voice-session': voiceId }, body: form });
    assert.equal(transcribed.status, 200); assert.equal((await transcribed.json()).text, '这是一段模拟语音识别结果。');
    assert(requests.some(request => request.path === '/v1/audio/transcriptions' && request.authorized && request.raw.includes('fixture-asr')));
    const status = await call('GET', '/companion/info');
    assert(!JSON.stringify(status).includes('fixture-key-never-real'));
    const unchanged = await call('POST', '/companion/settings/model', { url: providerUrl + '/v1', model: 'fixture-chat', key: '' });
    assert.equal(unchanged.sessionId, saved.sessionId);
    const rotated = await call('POST', '/companion/settings/model', { url: providerUrl + '/v1', model: 'fixture-chat', key: 'fixture-key-never-real-second' });
    assert.equal(rotated.chiefId, saved.chiefId); assert.equal(rotated.companionThreadId, saved.companionThreadId); assert.notEqual(rotated.sessionId, saved.sessionId);
    assert(!JSON.stringify(rotated).includes('fixture-key-never-real'));
    await call('POST', '/companion/send', { kind: 'chat', text: '验证模型连接更新', sendId: 'live_contract_chat_0002' });
    const rotatedDeadline = Date.now() + 15000;
    while (!requests.some(row => row.authorizedSecond && row.path === '/v1/chat/completions') && Date.now() < rotatedDeadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert(requests.some(row => row.authorizedSecond && row.path === '/v1/chat/completions'));
    await app.close(); app = null;
    const reopened = new CompanionRuntime({routineTools:'ask', rootDir });
    const again = await reopened.start();
    try {
      assert.equal(again.chiefId, saved.chiefId);
      assert.equal(again.companionThreadId, saved.companionThreadId);
      assert.match((await reopened.api(reopened.current, 'GET', memoryPath)).text, /concise replies/);
      const restored = await reopened.api(reopened.current, 'GET', `/api/threads/${saved.companionThreadId}/messages`);
      assert(restored.messages.some(message => message.id === reply.id));
    } finally { await reopened.close(); }
  } finally {
    if (app) await app.close();
    await new Promise(resolve => provider.close(resolve));
  }
});
