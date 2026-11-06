import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRecovery } from '../../adapters/tool-recovery.mjs';

const signal = () => new AbortController().signal;
const computer = name => ({ server: 'computer', name, hostComputer: true });
const blocked = () => ({ ok: false, text: 'Background unavailable\n' + JSON.stringify({ code: 'background_unavailable', escalation: { recommended: 'foreground' } }) });
const result = text => ({ ok: true, text });
const state = (snapshot, value = 'same') => result(JSON.stringify({ snapshot_id: snapshot, pid: 84, window_id: 150, elements: [{ role: 'Edit', label: '地址和搜索栏', value, element_token: snapshot + ':6' }] }));

test('a proven undelivered native keystroke retries foreground exactly once under a live full grant', async () => {
  const recovery = new ToolRecovery({ allowForeground: () => true }), calls = [], args = { pid: 84, window_id: 150, key: 'Enter' };
  const got = await recovery.execute(computer('press_key'), args, signal(), async input => { calls.push(input); return calls.length === 1 ? blocked() : result('Delivered'); });
  assert.equal(got.ok, true); assert.match(got.text, /前台方式补试一次/);
  assert.deepEqual(calls, [args, { ...args, delivery_mode: 'foreground' }]); assert(!('delivery_mode' in args));
  let count = 0;
  const failed = await recovery.execute(computer('press_key'), args, signal(), async () => { count++; return blocked(); });
  assert.equal(count, 2); assert.equal(failed.ok, false);
});

test('ask mode, revoked access, custom tools and uncertain failures never receive automatic foreground input', async () => {
  for (const [tool, full, response, args] of [
    [computer('press_key'), false, blocked(), {}],
    [{ server: 'other', name: 'press_key', hostComputer: false }, true, blocked(), {}],
    [computer('click'), true, blocked(), {}],
    [computer('press_key'), true, { ok: false, text: 'Timed out; execution may have taken effect' }, {}],
    [computer('press_key'), true, blocked(), { delivery_mode: 'foreground' }],
  ]) {
    let calls = 0;
    await new ToolRecovery({ allowForeground: () => full }).execute(tool, args, signal(), async () => { calls++; return response; });
    assert.equal(calls, 1);
  }
  let allowed = true, calls = 0;
  await new ToolRecovery({ allowForeground: () => allowed }).execute(computer('press_key'), {}, signal(), async () => { calls++; allowed = false; return blocked(); });
  assert.equal(calls, 1);
});

test('cancellation during a rejected keystroke prevents the foreground attempt', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(new ToolRecovery({ allowForeground: () => true }).execute(computer('press_key'), {}, controller.signal, async () => { calls++; controller.abort(); return blocked(); }), error => error.name === 'AbortError');
  assert.equal(calls, 1);
});

test('nested native refusal and business failure are failures even when transport succeeded', async () => {
  const recovery = new ToolRecovery({ allowForeground: () => true }); let calls = 0;
  const refusal = { ok: true, text: JSON.stringify({ ok: true, result: 'refused (browser_consent_required)\n' + JSON.stringify({ status: 'refused', refusal: { code: 'browser_consent_required' } }) }) };
  const got = await recovery.execute(computer('get_browser_state'), { pid: 84 }, signal(), async () => { calls++; return refusal; });
  assert.equal(got.ok, false); assert.match(got.text, /尚未取得页面/); assert.equal(calls, 1);
  const business = await recovery.execute(computer('click'), {}, signal(), async () => ({ ok: true, text: JSON.stringify({ ok: false, result: 'Failed' }) }));
  assert.equal(business.ok, false);
});

test('repeated identical observations warn then stop despite fresh snapshot tokens or screenshot options', async () => {
  const recovery = new ToolRecovery(); let calls = 0;
  const run = async () => state('s' + ++calls);
  for (let index = 1; index < 4; index++) {
    const got = await recovery.execute(computer('get_window_state'), { pid: 84, query: '地址和搜索栏', include_screenshot: index % 2 === 0 }, signal(), run);
    if (index === 3) assert.match(got.text, /再次空转/);
  }
  await assert.rejects(recovery.execute(computer('get_window_state'), { pid: 84, query: '地址和搜索栏' }, signal(), run), /连续 4 次/);
  await assert.rejects(recovery.execute(computer('click'), {}, signal(), run), /已暂停/); assert.equal(calls, 4);
});

test('a changed page or a successful action resets observations while failed actions do not', async () => {
  const recovery = new ToolRecovery(), tool = computer('get_window_state'), args = { pid: 84 };
  for (let index = 0; index < 3; index++) await recovery.execute(tool, args, signal(), async () => state(String(index)));
  await recovery.execute(tool, args, signal(), async () => state('new', 'new page'));
  for (let index = 0; index < 2; index++) await recovery.execute(tool, args, signal(), async () => state(String(index), 'new page'));
  await recovery.execute(computer('press_key'), {}, signal(), async () => result('Delivered'));
  for (let index = 0; index < 3; index++) await recovery.execute(tool, args, signal(), async () => state(String(index), 'new page'));
  await recovery.execute(computer('click'), {}, signal(), async () => ({ ok: false, text: 'failed' }));
  await assert.rejects(recovery.execute(tool, args, signal(), async () => state('last', 'new page')), /连续 4 次/);
});

test('changing screenshot pixels count as progress even when the accessibility tree is unchanged', async () => {
  const recovery = new ToolRecovery(), tool = computer('get_window_state'), args = { pid: 84 };
  const screen = value => ({ ...state('fresh'), images: [{ type: 'image_url', image_url: { url: 'data:image/png;base64,' + value } }] });
  for (let index = 0; index < 6; index++) await recovery.execute(tool, args, signal(), async () => screen(String(index)));
  for (let index = 0; index < 2; index++) await recovery.execute(tool, args, signal(), async () => screen('5'));
  await assert.rejects(recovery.execute(tool, args, signal(), async () => screen('5')), /连续 4 次/);
});

test('repeated browser consent refusals are bounded without auto granting or changing the request', async () => {
  const recovery = new ToolRecovery({ allowForeground: () => true }), tool = computer('get_browser_state'), args = { pid: 84 };
  const refusal = { ok: true, text: JSON.stringify({ status: 'refused', refusal: { code: 'browser_consent_required' } }) }; let calls = 0;
  const run = async input => { assert.deepEqual(input, args); calls++; return refusal; };
  for (let index = 0; index < 3; index++) assert.equal((await recovery.execute(tool, args, signal(), run)).ok, false);
  await assert.rejects(recovery.execute(tool, args, signal(), run), /连续 4 次/); assert.equal(calls, 4);
});
