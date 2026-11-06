import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { injectRoutineToolPolicy } from '../../adapters/workspace-hook.mjs';
import { SurfaceGrants } from '../../adapters/surface-grants.mjs';
import { ToolRecovery } from '../../adapters/tool-recovery.mjs';
import { scratch } from './scratch.mjs';

const entry = new URL('../../upstream/OpenMausBot/server/drivers/chat-mcp-tools.ts', import.meta.url).href;
registerHooks({ load(url, context, next) {
  const loaded = next(url, context);
  return url === entry ? { ...loaded, source: injectRoutineToolPolicy(Buffer.from(loaded.source).toString('utf8')) } : loaded;
} });
const { mountChatTools, ChatToolSessionError } = await import(entry);

test('native validated MCP calls recover an undelivered key, expose refusal and terminate a real observation loop', { timeout: 30000 }, async () => {
  const root = scratch('tool-recovery'); mkdirSync(root, { recursive: true });
  const file = join(root, 'permissions.json'), calls = join(root, 'calls.jsonl'), botId = randomUUID();
  const localComputer = { scope: 'local-computer', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/recovery-computer.mjs', import.meta.url))], env: { RECOVERY_FIXTURE_CALLS: calls } };
  const integrations = { localComputer }, grants = new SurfaceGrants(file);
  grants.bind(integrations, botId);
  writeFileSync(file, JSON.stringify({ bots: { [botId]: { computer: true, permissions: { computer: 'full' } } } }));
  globalThis[Symbol.for('companion.tool-recovery')] = mounted => new ToolRecovery({ allowForeground: () => grants.allows('computer', mounted.localComputer, { hostComputer: true }) });
  const controller = new AbortController(), session = await mountChatTools(integrations, controller.signal, true, { allow: ['mcp:computer:*'] });
  const readCalls = () => readFileSync(calls, 'utf8').trim().split('\n').map(line => JSON.parse(line));
  try {
    const key = { pid: 84, window_id: 150, key: 'Enter' };
    const sent = await session.execute('computer_press_key', key, controller.signal);
    assert(sent.ok); assert.match(sent.text, /SYNTHETIC-KEY-DELIVERED/);
    assert.deepEqual(readCalls().map(row => row.args.delivery_mode), [undefined, 'foreground']);
    const refused = await session.execute('computer_get_browser_state', { pid: 84, window_id: 150 }, controller.signal);
    assert.equal(refused.ok, false); assert.match(refused.text, /尚未取得页面/);
    for (let count = 0; count < 3; count++) await session.execute('computer_get_window_state', { pid: 84, window_id: 150 }, controller.signal);
    await assert.rejects(session.execute('computer_get_window_state', { pid: 84, window_id: 150 }, controller.signal), error => error instanceof ChatToolSessionError && /连续 4 次/.test(error.message));
    assert.equal(readCalls().filter(row => row.name === 'get_window_state').length, 4);
    writeFileSync(join(root, 'acceptance.json'), JSON.stringify({ isolated: true, foregroundRetryCount: 1, refusalIsFailure: true, stoppedAtRepeatedObservation: 4, calls: readCalls() }, null, 2));
  } finally { await session.close(); }
});

test('native recovery retains schema rejection and live permission revocation', { timeout: 30000 }, async () => {
  const root = scratch('tool-recovery'); mkdirSync(root, { recursive: true });
  const calls = join(root, 'calls.jsonl');
  globalThis[Symbol.for('companion.tool-recovery')] = () => new ToolRecovery({ allowForeground: () => false });
  const localComputer = { scope: 'local-computer', command: process.execPath, args: [fileURLToPath(new URL('./fixtures/recovery-computer.mjs', import.meta.url))], env: { RECOVERY_FIXTURE_CALLS: calls } };
  const controller = new AbortController(), session = await mountChatTools({ localComputer }, controller.signal, true, { allow: ['mcp:computer:*'] });
  try {
    await assert.rejects(session.execute('computer_press_key', { pid: 84, window_id: 150, key: ['Enter'] }, controller.signal), /schema/);
    const got = await session.execute('computer_press_key', { pid: 84, window_id: 150, key: 'Enter' }, controller.signal);
    assert.equal(got.ok, false);
    assert.equal(readFileSync(calls, 'utf8').trim().split('\n').length, 1);
  } finally { await session.close(); }
});
