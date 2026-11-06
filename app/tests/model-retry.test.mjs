import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createReachaiModelBridge, modelEventsWithRetry, ReachAIClient } from '../../adapters/reachai.mjs';
import { fakeReachai, fixtureReachaiConfig } from './fixtures/reachai.mjs';

const collect = async generator => { const events = []; for await (const event of generator) events.push(event); return events; };
test('request timings distinguish upstream reasoning, first visible text and completion without retaining content', async () => {
  const diagnostics = [];
  const provider = await fakeReachai({ async chat(body, event, res) {
    event({ type: 'reasoning.delta', text: 'private-fixture-reasoning' });
    await new Promise(resolve => setTimeout(resolve, 30)); event({ type: 'content.delta', text: 'private-fixture-answer' });
    await new Promise(resolve => setTimeout(resolve, 30)); event({ type: 'completed', finishReason: 'stop' }); res.end();
  } });
  try {
    await collect(modelEventsWithRetry(new ReachAIClient(fixtureReachaiConfig(provider.url)), { messages: [] }, undefined, { diagnostic: event => diagnostics.push(event) }));
    assert.equal(diagnostics.length, 1); const timing = diagnostics[0];
    assert(timing.headersMs <= timing.firstOutputMs); assert(timing.firstOutputMs < timing.firstContentMs); assert(timing.firstContentMs < timing.elapsedMs);
    assert(!JSON.stringify(diagnostics).includes('private-fixture'));
  } finally { await provider.close(); }
});
test('a transient failure before model output retries the same request and returns a single completion', async () => {
  let calls = 0; const diagnostics = [];
  const provider = await fakeReachai({ chat(body, event, res) { calls++; if (calls === 1) event({ type: 'error', code: 'MODEL_PROVIDER_ERROR', message: 'Upstream HTTP 503' }); else { event({ type: 'content.delta', text: '成功' }); event({ type: 'completed', finishReason: 'stop' }); } res.end(); } });
  try {
    const client = new ReachAIClient(fixtureReachaiConfig(provider.url)), request = { messages: [{ role: 'user', content: 'fixture' }] };
    const events = await collect(modelEventsWithRetry(client, request, undefined, { retryDelays: [0, 0], diagnostic: item => diagnostics.push(item) }));
    assert.equal(calls, 2); assert.equal(events.filter(event => event.type === 'completed').length, 1); assert.equal(diagnostics[0].upstreamStatus, 503); assert.equal(diagnostics[0].result, 'retry'); assert.equal(diagnostics[1].result, 'completed');
  } finally { await provider.close(); }
});
test('web verification before model output gets fresh upstream attempts for account rotation', async () => {
  let calls = 0; const diagnostics = [];
  const provider = await fakeReachai({ chat(body, event, res) {
    calls++;
    if (calls < 3) event({ type: 'error', code: 'MODEL_UPSTREAM_WEB_VERIFICATION', message: 'HTTP 503' });
    else { event({ type: 'content.delta', text: '换号后成功' }); event({ type: 'completed', finishReason: 'stop' }); }
    res.end();
  } });
  try {
    const client = new ReachAIClient(fixtureReachaiConfig(provider.url));
    const events = await collect(modelEventsWithRetry(client, { messages: [{ role: 'user', content: 'fixture' }] }, undefined, { retryDelays: [0, 0], diagnostic: item => diagnostics.push(item) }));
    assert.equal(calls, 3); assert.equal(events.filter(event => event.type === 'completed').length, 1);
    assert.deepEqual(diagnostics.map(item => item.result), ['retry', 'retry', 'completed']);
    assert(diagnostics.slice(0, 2).every(item => item.code === 'MODEL_UPSTREAM_WEB_VERIFICATION' && item.outputStarted === false));
  } finally { await provider.close(); }
});
test('partial text or a tool call is never replayed after a provider error', async () => {
  for (const [first, code] of [[{ type: 'content.delta', text: '一部分' }, 'MODEL_PROVIDER_ERROR'], [{ type: 'tool_call.delta', toolCall: { index: 0, name: 'write_file' } }, 'MODEL_PROVIDER_ERROR'], [{ type: 'content.delta', text: '一部分' }, 'MODEL_UPSTREAM_WEB_VERIFICATION']]) {
    let calls = 0; const provider = await fakeReachai({ chat(body, event, res) { calls++; event(first); event({ type: 'error', code, message: 'HTTP 502' }); res.end(); } });
    try { await assert.rejects(collect(modelEventsWithRetry(new ReachAIClient(fixtureReachaiConfig(provider.url)), {}, undefined, { retryDelays: [0, 0] }))); assert.equal(calls, 1); }
    finally { await provider.close(); }
  }
});
test('invalid model requests are not retried and repeated transient errors stop after three attempts', async () => {
  for (const [status, expected] of [[400, 1], [502, 3]]) {
    let calls = 0; const provider = await fakeReachai({ chat(body, event, res) { calls++; event({ type: 'error', code: 'MODEL_PROVIDER_ERROR', message: 'HTTP ' + status }); res.end(); } });
    try { await assert.rejects(collect(modelEventsWithRetry(new ReachAIClient(fixtureReachaiConfig(provider.url)), {}, undefined, { retryDelays: [0, 0] }))); assert.equal(calls, expected); }
    finally { await provider.close(); }
  }
});
test('cancelling during model retry backoff prevents another provider request', async () => {
  let calls = 0; const abort = new AbortController();
  const provider = await fakeReachai({ chat(body, event, res) { calls++; event({ type: 'error', code: 'MODEL_PROVIDER_ERROR', message: 'HTTP 502' }); res.end(); } });
  try { await assert.rejects(collect(modelEventsWithRetry(new ReachAIClient(fixtureReachaiConfig(provider.url)), {}, abort.signal, { retryDelays: [1000], diagnostic: () => abort.abort() })), error => error.name === 'AbortError'); assert.equal(calls, 1); }
  finally { await provider.close(); }
});

test('provider web verification returns an actionable 503 after bounded retries without raw error details', async () => {
  for (const nested of [true, false]) {
    let calls = 0; const diagnostics = [];
    const provider = await fakeReachai({ chat(body, event, res) {
      calls++;
      const detail = { error: { message: 'secret-fixture-body https://private.invalid?key=never-forward', code: 'upstream_web_verification' } };
      event({ type: 'error', ...(nested ? {} : { code: 'upstream_web_verification' }), message: nested ? 'Model provider API error: HTTP 503 ' + JSON.stringify(detail) : 'secret-fixture-body' }); res.end();
    } });
    const bridge = await createReachaiModelBridge(fixtureReachaiConfig(provider.url), { onDiagnostic: item => diagnostics.push(item) });
    try {
      const response = await fetch(bridge.url + '/chat/completions', { method: 'POST', headers: { authorization: `Bearer ${bridge.key}`, 'content-type': 'application/json' }, body: JSON.stringify({ model: 'fixture-llm', stream: true, messages: [{ role: 'user', content: 'fixture' }] }) });
      assert.equal(response.status, 503);
      const result = await response.json();
      assert.equal(result.error.code, 'MODEL_UPSTREAM_WEB_VERIFICATION'); assert.match(result.error.message, /网页验证/);
      assert.equal(calls, 3); assert.equal(diagnostics.length, 3); assert.deepEqual(diagnostics.map(item => item.result), ['retry', 'retry', 'failed']); assert.equal(diagnostics.at(-1).upstreamStatus, 503);
      assert(!JSON.stringify({ result, diagnostics }).includes('secret-fixture-body')); assert(!JSON.stringify({ result, diagnostics }).includes('private.invalid'));
    } finally { await bridge.close(); await provider.close(); }
  }
});

test('ordinary service unavailable errors retain 503 after bounded retries', async () => {
  let calls = 0; const provider = await fakeReachai({ chat(body, event, res) { calls++; event({ type: 'error', message: 'Model provider API error: HTTP 503' }); res.end(); } });
  try {
    await assert.rejects(collect(modelEventsWithRetry(new ReachAIClient(fixtureReachaiConfig(provider.url)), {}, undefined, { retryDelays: [0, 0] })), error => error.status === 503 && error.upstreamStatus === 503 && /服务当前不可用/.test(error.message));
    assert.equal(calls, 3);
  } finally { await provider.close(); }
});
