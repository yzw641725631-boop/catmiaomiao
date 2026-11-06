import { test } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createCompanionServer } from '../../adapters/server.mjs';
import { CompanionRuntime } from '../../adapters/runtime.mjs';
import { WebSocket, WebSocketServer } from '../../adapters/realtime-asr.mjs';
import { fakeReachai, fixtureReachaiConfig, REACHAI_FIXTURE_KEY } from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';

async function until(check, timeout = 30000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = await check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 100)); }
  assert.fail('ReachAI contract state did not arrive');
}

test('ReachAI drives native delegation, speech, protected realtime ASR and persistent identity', async () => {
  let helpers = [];
  const provider = await fakeReachai({ chat(body, event, res) {
    const user = (body.messages.filter(message => message.role === 'user').at(-1)?.content || '').split('[本地助理能力说明')[0];
    const dispatched = body.messages.some(message => message.role === 'tool' && message.toolCallId === 'reachai_dispatch_call');
    if (body.modelInstanceId === 'fixture-llm' && user.includes('REACHAI_DISPATCH_PROBE') && !dispatched) {
      const tool = body.tools?.find(item => item.function.name.endsWith('coordinate_bots'));
      if (!tool) { event({ type: 'content.delta', text: 'COORDINATOR_TOOL_NOT_FOUND' }); event({ type: 'completed', finishReason: 'stop' }); res.end(); return; }
      const args = JSON.stringify({ bot_ids: helpers, message: 'REACHAI_HELPER_PROBE：请只返回隔离契约验证结果，不操作其他目录。' });
      event({ type: 'reasoning.delta', text: 'fixture delegation reasoning' });
      event({ type: 'tool_call.delta', toolCall: { index: 0, id: 'reachai_dispatch_call', type: 'function', name: tool.function.name, arguments: args.slice(0, 23) } });
      event({ type: 'tool_call.delta', toolCall: { index: 0, arguments: args.slice(23) } });
      event({ type: 'completed', finishReason: 'tool_calls' }); res.end(); return;
    }
    const text = body.modelInstanceId === 'fixture-llm-alt' ? 'ReachAI 原生网关回复通过。' : user.includes('REACHAI_HELPER_PROBE') ? 'REACHAI_HELPER_PROBE 已核对隔离契约。' : dispatched ? 'ReachAI 派工与工具往返通过。' : 'ReachAI 原生网关回复通过。';
    event({ type: 'content.delta', text }); event({ type: 'usage', usage: { promptTokens: 12, completionTokens: 9, totalTokens: 21 } }); event({ type: 'completed', finishReason: 'stop' }); res.end();
  } });
  const wireStarts = [], wireAudio = [];
  const realtime = new WebSocketServer({ noServer: true });
  provider.server.on('upgrade', (req, socket, head) => {
    if (req.url !== '/model/audio/transcriptions/stream' || req.headers.authorization !== `Bearer ${REACHAI_FIXTURE_KEY}`) { socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n'); return; }
    realtime.handleUpgrade(req, socket, head, ws => {
      ws.on('message', (bytes, binary) => {
        if (binary) { wireAudio.push(Buffer.from(bytes)); ws.send(JSON.stringify({ type: 'partial', segment: 0, text: '实时识别' })); return; }
        const message = JSON.parse(bytes.toString());
        if (message.type === 'start') { wireStarts.push(message); ws.send(JSON.stringify({ type: 'ready', sample_rate: 16000, private: REACHAI_FIXTURE_KEY })); }
        else if (message.type === 'end') {
          const value = JSON.stringify({ type: 'final', segment: 0, text: '实时识别文字。', reason: 'end' }); ws.send(value); ws.send(value);
        } else if (message.type === 'cancel') ws.send(JSON.stringify({ type: 'final', segment: 1, text: '迟到的文字不应出现。', reason: 'end' }));
      });
    });
  });
  const rootDir = scratch('reachai-contract'); mkdirSync(rootDir, { recursive: true });
  let app;
  try {
    app = await createCompanionServer({ port: 5230, runtime: new CompanionRuntime({routineTools:'ask', rootDir, forceFixture: true }) });
    const boot = await fetch(app.url + '/companion/info');
    const cookie = boot.headers.get('set-cookie').split(';')[0];
    const call = async (method, path, body, status = 200) => {
      const response = await fetch(app.url + path, { method, headers: { cookie, origin: app.url, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
      const data = await response.json(); assert.equal(response.status, status, JSON.stringify(data)); assert(!JSON.stringify(data).includes(REACHAI_FIXTURE_KEY)); return data;
    };
    const config = fixtureReachaiConfig(provider.url);
    const catalog = await call('POST', '/companion/reachai/instances', { url: provider.url, key: REACHAI_FIXTURE_KEY });
    assert.equal(catalog.instances.length, 5); assert(!JSON.stringify(catalog).includes('connection'));
    await call('POST', '/companion/settings/reachai', { ...config, llmId: 'inactive-llm' }, 409);
    assert.equal((await call('GET', '/companion/info')).mode, 'fixture');
    const info = await call('POST', '/companion/settings/reachai', config);
    assert.equal(info.mode, 'live'); assert.equal(info.provider, 'reachai'); assert.equal(info.voice.ready, true); helpers = info.helperIds;
    const team = (await call('GET', '/api/bots')).bots;
    assert.equal(team.find(bot => bot.id === info.chiefId).chiefOfStaff, true);
    assert.match(team.find(bot => bot.id === info.chiefId).soul, /个人助理/);
    assert(!readFileSync(join(rootDir, 'live-harness', 'config.json'), 'utf8').includes(REACHAI_FIXTURE_KEY));
    const delegation=await call('POST', '/companion/send', { text: 'REACHAI_DISPATCH_PROBE：请派遣两位小助理验证模型工具往返。', kind: 'work', sendId: 'reachai_live_dispatch_0001' }, 202);
    const reply = await until(async () => {
      const page = await call('GET', `/api/threads/${delegation.threadId}/messages`);
      const failed = page.messages.find(message => message.text?.includes('COORDINATOR_TOOL_NOT_FOUND'));
      assert(!failed, 'native coordinator must be exposed to the model');
      return page.messages.find(message => message.turnTerminal && message.text?.includes('ReachAI 派工与工具往返通过'));
    });
    const toolResult = provider.requests.flatMap(row => row.body?.messages || []).find(message => message.toolCallId === 'reachai_dispatch_call');
    assert(toolResult && !toolResult.content.includes('Unknown field'), 'native tool schema must accept the request');
    await until(async () => {
      const { bots } = await call('GET', '/api/bots');
      return helpers.every(id => bots.find(bot => bot.id === id).tasks.some(task => task.openedBy && !task.busy)) && bots.every(bot => !bot.tasks.some(task => task.busy || task.waitingForTeammates));
    });
    const calls = provider.requests.filter(row => row.path === '/model/chat/stream/events');
    assert(calls.some(row => row.body.messages.some(message => message.toolCallId === 'reachai_dispatch_call')));
    assert(calls.some(row => row.body.messages.some(message => message.reasoningContent === 'fixture delegation reasoning')));
    const memoryPath = `/api/bots/${info.chiefId}/memory/file`;
    const memory = await call('GET', memoryPath);
    await call('PUT', memoryPath, { text: '# ReachAI contract memory\n\n- concise Chinese replies\n', expectedHash: memory.hash });
    const form = new FormData(); form.append('file', new Blob(['synthetic-voice'], { type: 'audio/webm' }), 'voice.webm');
    const voiceId = randomUUID(); await call('POST', '/companion/voice/session', { action: 'claim', id: voiceId });
    const transcription = await fetch(app.url + '/companion/transcribe', { method: 'POST', headers: { cookie, origin: app.url, 'x-companion-voice-session': voiceId }, body: form });
    assert.equal(transcription.status, 200); assert.equal((await transcription.json()).text, '今天先处理重要的事。');
    const prepared = await call('POST', '/api/tts/prepare', { text: '你好，我是助理。' }); assert.equal(prepared.ready, true); assert(prepared.utterances.length);
    const speech = await fetch(app.url + '/api/tts/speak', { method: 'POST', headers: { cookie, origin: app.url, 'content-type': 'application/json' }, body: JSON.stringify({ text: '试听句子' }) });
    assert.equal(speech.headers.get('x-companion-audio-mode'), 'stream'); assert.match(await speech.text(), /^ID3fixture-part-one-part-two$/);
    await call('POST', '/api/tts/speak', { text: 'business-error' }, 429);
    const voiceChanged = await call('POST', '/companion/settings/reachai', { ...config, key: '', asrMode: 'realtime' });
    assert.equal(voiceChanged.sessionId, info.sessionId, 'voice-only configuration must not restart the model harness');

    const rejectsSocket = async headers => {
      const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/companion/asr/stream', { headers });
      socket.on('error', () => {});
      return new Promise(resolve => socket.on('unexpected-response', (_req, res) => { res.resume(); resolve(res.statusCode); socket.terminate(); }));
    };
    assert.equal(await rejectsSocket({ origin: app.url }), 401);
    assert.equal(await rejectsSocket({ cookie, origin: 'http://other.invalid' }), 403);
    const socket = new WebSocket(app.url.replace('http:', 'ws:') + '/companion/asr/stream?session=' + voiceId, { headers: { cookie, origin: app.url } });
    const events = []; socket.on('message', data => events.push(JSON.parse(data.toString()))); await once(socket, 'open');
    socket.send(JSON.stringify({ type: 'start', model_instance_id: 'arbitrary-model', key: 'must-not-forward' }));
    await until(() => events.some(event => event.type === 'ready'));
    socket.send(Buffer.from([0, 0, 128, 0])); await until(() => events.some(event => event.type === 'partial'));
    socket.send(JSON.stringify({ type: 'end' })); await until(() => events.some(event => event.type === 'final'));
    assert.equal(events.filter(event => event.type === 'final').length, 1); assert.equal(events.find(event => event.type === 'final').reason, 'end');
    assert(!JSON.stringify(events).includes(REACHAI_FIXTURE_KEY)); assert.equal(wireStarts[0].encoding, 'pcm_s16le'); assert.equal(wireStarts[0].model_instance_id, undefined); assert.equal(wireStarts[0].key, undefined); assert.equal(wireAudio[0].length, 4);
    socket.send(JSON.stringify({ type: 'cancel' })); await once(socket, 'close');
    assert(!events.some(event => event.text?.includes('迟到')));
    const malformed = new WebSocket(app.url.replace('http:', 'ws:') + '/companion/asr/stream?session=' + voiceId, { headers: { cookie, origin: app.url } });
    const malformedEvents = []; malformed.on('message', data => malformedEvents.push(JSON.parse(data.toString())));
    await once(malformed, 'open'); malformed.send('null'); await once(malformed, 'close');
    assert(malformedEvents.some(event => event.type === 'error'));
    assert.equal((await call('GET', '/companion/info')).provider, 'reachai', 'invalid socket control must not crash the local service');
    const changed = await call('POST', '/companion/settings/reachai', { ...config, llmId: 'fixture-llm-alt', key: '', asrMode: 'realtime' });
    assert.notEqual(changed.sessionId, info.sessionId); assert.equal(changed.chiefId, info.chiefId); assert.equal(changed.companionThreadId, info.companionThreadId);
    await call('POST', '/companion/send', { text: '验证换模型后的对话', kind: 'chat', sendId: 'reachai_live_changed_0002' }, 202);
    await until(async () => (await call('GET', `/api/threads/${info.companionThreadId}/messages`)).messages.some(message => message.turnTerminal && message.text?.includes('ReachAI 原生网关回复通过')));
    assert(provider.requests.some(row => row.path === '/model/chat/stream/events' && row.body.modelInstanceId === 'fixture-llm-alt'));
    const ids = { chiefId: info.chiefId, companionThreadId: info.companionThreadId };
    await app.close(); app = null;
    const reopened = new CompanionRuntime({routineTools:'ask', rootDir });
    try {
      const again = await reopened.start();
      assert.equal(again.provider, 'reachai'); assert.equal(again.chiefId, ids.chiefId); assert.equal(again.companionThreadId, ids.companionThreadId);
      assert.equal(again.model.model, 'fixture-llm-alt');
      assert.match((await reopened.api(reopened.current, 'GET', memoryPath)).text, /concise Chinese replies/);
      const page = await reopened.api(reopened.current, 'GET', `/api/threads/${delegation.threadId}/messages`); assert(page.messages.some(message => message.id === reply.id));
    } finally { await reopened.close(); }
  } finally {
    if (app) await app.close();
    for (const client of realtime.clients) client.terminate();
    await new Promise(resolve => realtime.close(resolve)); await provider.close();
  }
});
