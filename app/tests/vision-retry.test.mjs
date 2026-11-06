import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { completeVisionWithRetry } from '../../adapters/vision-retry.mjs';
import { CompanionRuntime, PROJECT } from '../../adapters/runtime.mjs';
import { createCompanionServer } from '../../adapters/server.mjs';
import { fakeReachai, fixtureReachaiConfig } from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';

const uploadError = () => Object.assign(new Error('Synthetic upload failure'), { status: 500, code: 'VISION_IMAGE_UPLOAD_FAILED' });
const reply = text => ({ id: 'synthetic-vision', choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: 'stop' }] });
const request = { messages: [
  { role: 'user', content: [{ type: 'text', text: 'synthetic-private-marker' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,aW1hZ2U=' } }] },
  { role: 'assistant', content: null, tool_calls: [{ id: 'previous-action', type: 'function', function: { name: 'write_file', arguments: '{"value":84}' } }] },
  { role: 'tool', tool_call_id: 'previous-action', content: 'Already saved once.' },
] };

test('vision upload retries preserve the exact continuation and return only the eventual complete response', async () => {
  let calls = 0; const events = [], original = structuredClone(request), result = reply('已恢复');
  const vision = { async complete(body) { assert.equal(body, request); if (++calls < 3) throw uploadError(); return result; } };
  assert.equal(await completeVisionWithRetry(vision, request, undefined, { retryDelays: [0, 0], diagnostic: event => events.push(event) }), result);
  assert.equal(calls, 3); assert.deepEqual(request, original);
  assert.deepEqual(events.map(event => [event.attempt, event.result]), [[1, 'retry'], [2, 'retry'], [3, 'completed']]);
  assert(!JSON.stringify(events).includes('synthetic-private-marker')); assert(!JSON.stringify(events).includes('base64'));
});

test('vision retries stop after two additional attempts and preserve the original upload error', async () => {
  let calls = 0; const error = uploadError(), events = [];
  await assert.rejects(completeVisionWithRetry({ async complete() { calls++; throw error; } }, request, undefined,
    { retryDelays: [0, 0, 0, 0], diagnostic: event => events.push(event) }), value => value === error);
  assert.equal(calls, 3); assert.deepEqual(events.map(event => event.result), ['retry', 'retry', 'failed']);
});

test('vision upstream 400/502/503 errors can recover without reissuing a user message', async () => {
  for (const status of [400, 502, 503]) {
    let calls = 0;
    const result = await completeVisionWithRetry({ async complete() { if (++calls === 1) throw Object.assign(new Error('Temporary'), { status, code: 'VISION_UPSTREAM_ERROR' }); return reply('恢复'); } }, request, undefined, { retryDelays: [0, 0] });
    assert.equal(calls, 2); assert.equal(result.choices[0].message.content, '恢复');
  }
});

test('repeated upstream 400 errors stop after three attempts without retrying local input validation', async () => {
  let calls = 0;
  const error = Object.assign(new Error('Upstream rejected'), { status: 400, code: 'VISION_UPSTREAM_ERROR' });
  await assert.rejects(completeVisionWithRetry({ async complete() { calls++; throw error; } }, request, undefined, { retryDelays: [0, 0] }), value => value === error);
  assert.equal(calls, 3);
});

test('vision authentication, verification, invalid input, timeout and incomplete responses are not retried', async () => {
  const errors = [
    { status: 401, code: 'VISION_UPSTREAM_ERROR' }, { status: 403, code: 'VISION_UPSTREAM_ERROR' },
    { status: 400, code: 'VISION_INVALID_INPUT' }, { status: 413, code: 'VISION_UPSTREAM_ERROR' },
    { status: 503, code: 'MODEL_UPSTREAM_WEB_VERIFICATION' }, { status: 503, code: 'VISION_AUTH_REQUIRED' },
    { status: 504, code: 'VISION_UPSTREAM_ERROR' }, { status: 500, code: 'VISION_UPSTREAM_ERROR' },
    { status: 502, code: 'VISION_UPSTREAM_ERROR', name: 'AbortError' },
  ];
  for (const fields of errors) {
    let calls = 0; const error = Object.assign(new Error('Do not retry'), fields);
    await assert.rejects(completeVisionWithRetry({ async complete() { calls++; throw error; } }, request, undefined, { retryDelays: [0, 0] }), value => value === error);
    assert.equal(calls, 1, JSON.stringify(fields));
  }
  let calls = 0; const events = [];
  await assert.rejects(completeVisionWithRetry({ async complete() { calls++; return { choices: [] }; } }, request, undefined,
    { retryDelays: [0, 0], diagnostic: event => events.push(event) }), error => error.code === 'VISION_INCOMPLETE_RESPONSE');
  assert.equal(calls, 1); assert.deepEqual(events.map(event => event.result), ['failed']);
});

test('cancelling before a vision call or during backoff prevents any subsequent attempts', async () => {
  const already = new AbortController(); already.abort(); let calls = 0;
  await assert.rejects(completeVisionWithRetry({ async complete() { calls++; } }, request, already.signal), error => error.name === 'AbortError');
  assert.equal(calls, 0);
  const controller = new AbortController();
  await assert.rejects(completeVisionWithRetry({ async complete() { calls++; throw uploadError(); } }, request, controller.signal,
    { retryDelays: [1000, 2000], diagnostic(event) { if (event.result === 'retry') setTimeout(() => controller.abort(), 5); } }), error => error.name === 'AbortError');
  assert.equal(calls, 1);
});

test('a response arriving after cancellation is never delivered to the native harness', async () => {
  const controller = new AbortController(), result = reply('Late reply'); let reported = false;
  await assert.rejects(completeVisionWithRetry({ async complete() { controller.abort(); return result; } }, request, controller.signal,
    { diagnostic() { reported = true; } }), error => error.name === 'AbortError');
  assert.equal(reported, false);
});

test('the retry window prevents restarting a long vision call even when attempt slots remain', async t => {
  let clockReads = 0, calls = 0; const error = uploadError();
  t.mock.method(Date, 'now', () => clockReads++ === 0 ? 0 : 90001);
  await assert.rejects(completeVisionWithRetry({ async complete() { calls++; throw error; } }, request, undefined, { retryDelays: [0, 0] }), value => value === error);
  assert.equal(calls, 1);
});

test('a native image job recovers from upstream 400 after its file action without replaying that action', { timeout: 90000 }, async () => {
  const rootDir = scratch('vision-retry'); mkdirSync(rootDir, { recursive: true });
  let calls = 0, continuationCalls = 0; const continuations = [];
  const vision = { async complete(body) {
    calls++;
    const priorResult = body.messages.find(message => message.role === 'tool' && message.tool_call_id === 'vision-retry-write-84');
    if (priorResult) {
      continuations.push(structuredClone(body));
      if (++continuationCalls < 3) throw Object.assign(new Error('Synthetic upstream 400'), { status: 400, code: 'VISION_UPSTREAM_ERROR' });
      return reply('视觉请求自动恢复，原文件仅保存了一次。');
    }
    const tool = body.tools.find(tool => tool.function.name.endsWith('workspace_write_file')); assert(tool);
    return { id: 'synthetic-vision-tool', choices: [{ index: 0, message: { role: 'assistant', content: null,
      tool_calls: [{ id: 'vision-retry-write-84', type: 'function', function: { name: tool.function.name,
        arguments: JSON.stringify({ path: 'once.md', content: '# 只保存一次\nVISION-RETRY-84\n', expected_sha256: null }) } }] }, finish_reason: 'tool_calls' }] };
  }, close() {} };
  const provider = await fakeReachai(); let app;
  writeFileSync(join(rootDir, 'companion-settings.json'), JSON.stringify({ provider: 'reachai', reachai: fixtureReachaiConfig(provider.url) }));
  try {
    app = await createCompanionServer({ port: 5287, runtime: new CompanionRuntime({ rootDir, visionTransport: vision, routineTools: 'assist' }) });
    const boot = await fetch(app.url + '/companion/info'), cookie = boot.headers.get('set-cookie').split(';')[0], info = await boot.json();
    const api = async (method, path, body) => {
      const response = await fetch(app.url + path, { method, headers: { cookie, origin: app.url, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json(); assert(response.ok, JSON.stringify(data)); return data;
    };
    const upload = await fetch(app.url + '/api/attachments?uploadId=' + randomUUID(), { method: 'POST', headers: { cookie, origin: app.url, 'content-type': 'image/png' }, body: readFileSync(join(PROJECT, 'evidence/interaction-vision-20261023/vision-fixture.png')) });
    assert.equal(upload.status, 201); const saved = await upload.json();
    const receipt = await api('POST', '/companion/send', { kind: 'work', sendId: randomUUID(), text: `保存合成文件，然后继续回应本次图片任务。\n\n<attached-image path="${saved.path}" name="合成验收.png" />` });
    const threadId = receipt.info.workThreadIds.find(id => !info.workThreadIds.includes(id)); assert(threadId);
    let page, final; const deadline = Date.now() + 40000;
    while (Date.now() < deadline) {
      page = await api('GET', `/api/threads/${threadId}/messages?limit=100`);
      final = page.messages.find(message => message.turnTerminal && message.text?.includes('原文件仅保存了一次'));
      if (final) break;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert(final, JSON.stringify(page).slice(-1500)); assert.equal(final.turnSucceeded, true);
    assert.equal(calls, 4); assert.equal(continuationCalls, 3);
    assert.deepEqual(continuations[0], continuations[1]); assert.deepEqual(continuations[1], continuations[2]);
    const writes = page.messages.filter(message => message.kind === 'activity' && message.tool?.name.endsWith('workspace_write_file'));
    assert.equal(writes.length, 1); assert.equal(writes[0].tool.ok, true);
    const job = app.runtime.jobs.get(threadId); assert.equal(readFileSync(join(job.folder, 'once.md'), 'utf8'), '# 只保存一次\nVISION-RETRY-84\n');
    assert.equal(app.runtime.jobs.size, 1); assert(!page.messages.some(message => message.tool?.ok === false));
    assert(!provider.requests.some(request => request.path === '/model/chat/stream/events'));
    const diagnostics = readFileSync(join(rootDir, 'logs/model-requests.jsonl'), 'utf8').trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(diagnostics.filter(row => row.instanceId === 'us-vision').map(row => row.result), ['completed', 'retry', 'retry', 'completed']);
    writeFileSync(join(rootDir, 'acceptance.json'), JSON.stringify({ passed: true, synthetic: true, taskCount: 1, fileActions: writes.length,
      visionCalls: calls, continuationCalls, diagnosticResults: diagnostics.map(row => row.result), finalReply: final.text }, null, 2));
  } finally { if (app) await app.close(); await provider.close(); }
});
