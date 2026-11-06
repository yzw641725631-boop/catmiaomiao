import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync, symlinkSync, linkSync, readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { WorkspaceFiles } from '../../adapters/workspace-files.mjs';
import { injectWorkspaceHook } from '../../adapters/workspace-hook.mjs';
import { CompanionRuntime, PROJECT } from '../../adapters/runtime.mjs';
import { scratch } from './scratch.mjs';

function fixture() {
  const base = scratch('workspace-contract');
  const root = join(base, 'work'); mkdirSync(root, { recursive: true });
  const scope = { root, archive: join(base, '归档'), ledger: join(base, 'ledger.jsonl'), botId: randomUUID(), threadId: randomUUID() };
  return { base, scope, files: new WorkspaceFiles(scope) };
}

test('assigned file tools archive replacements, require the exact prior hash and preserve Unicode', async () => {
  const { files, scope } = fixture();
  const created = await files.call('write_file', { path: '文档/report.md', content: '# 真实文件\n', expected_sha256: null });
  assert.equal(created.archived, false); assert.equal(files.read('文档/report.md').content, '# 真实文件\n');
  assert.throws(() => files.write('文档/report.md', 'overwrite', null), /read it/);
  assert.throws(() => files.write('文档/report.md', 'overwrite', 'a'.repeat(64)), /read it/);
  files.write('文档/report.md', '# 修改后\n', created.sha256);
  const backup = join(scope.archive, readdirSync(scope.archive).find(name => name !== '_locks'));
  assert.equal(readFileSync(join(backup, 'previous.txt'), 'utf8'), '# 真实文件\n');
  assert.equal(files.read('文档/report.md').content, '# 修改后\n');
  assert.equal(JSON.parse(readFileSync(scope.ledger, 'utf8').trim().split('\n').at(-1)).archived, true);
});

test('separate helper instances cannot overwrite or validate while another mutation holds the job lock', async () => {
  const { files, scope } = fixture(), second = new WorkspaceFiles(scope), release = files.lock();
  try { assert.throws(() => second.write('concurrent.md', 'no', null), /Another helper/); await assert.rejects(second.check('concurrent.md', 'utf8'), /Another helper/); }
  finally { release(); }
  second.write('concurrent.md', 'one real write', null); assert.equal(files.read('concurrent.md').content, 'one real write');
  assert(readdirSync(join(scope.archive, '_locks')).length >= 2);
});

test('file boundaries reject Windows escape paths, secrets, junctions, hardlinks and oversized text', async () => {
  const { base, scope, files } = fixture();
  for (const path of ['../outside.txt', 'C:/outside.txt', '\\outside.txt', 'x/../../outside.md', 'x.txt:secret', '.env', '.companion-evidence.json', 'a./test.md', 'CON.txt', 'tokens.json', 'x.exe']) assert.throws(() => files.write(path, 'no', null), path);
  writeFileSync(join(base, 'external.md'), 'outside');
  linkSync(join(base, 'external.md'), join(scope.root, 'hard.md'));
  assert.throws(() => files.read('hard.md'), /Links/);
  mkdirSync(join(base, 'external-folder'));
  symlinkSync(join(base, 'external-folder'), join(scope.root, 'junction'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => files.write('junction/leak.md', 'no', null), /Links/);
  writeFileSync(join(scope.root, 'big.md'), 'x'.repeat(64001)); assert.throws(() => files.read('big.md'), /too large/);
  assert.equal(readFileSync(join(base, 'external.md'), 'utf8'), 'outside');
  await assert.rejects(files.call('delete_file', { path: 'hard.md' }));
});

test('validation receipts reflect real failures and syntax checks do not execute model code', async () => {
  const { files, scope } = fixture();
  files.write('broken.json', '{', null);
  assert.equal((await files.check('broken.json', 'json')).exitCode, 1);
  files.write('code.mjs', "throw new Error('must not execute')\n", null);
  const syntax = await files.check('code.mjs', 'javascript_syntax'); assert.equal(syntax.exitCode, 0);
  files.write('bad.mjs', 'const = broken', null); assert.notEqual((await files.check('bad.mjs', 'javascript_syntax')).exitCode, 0);
  const receipts = readFileSync(scope.ledger, 'utf8').trim().split('\n').map(line => JSON.parse(line)).filter(item => item.operation === 'check_file');
  assert.deepEqual(receipts.map(item => item.exitCode === 0), [false, true, false]);
});

test('the native turn hook is pinned and MCP stdio uses only its trusted assigned root', async () => {
  const source = readFileSync(join(PROJECT, 'upstream/OpenMausBot/server/index.ts'), 'utf8');
  assert.match(injectWorkspaceHook(source), /await globalThis\[Symbol.for\("companion.workspace.integration"\)\]/);
  assert.throws(() => injectWorkspaceHook(source + '\n'), /Pinned/);
  const { scope } = fixture();
  const child = spawn(process.execPath, [join(PROJECT, 'adapters/workspace-mcp.mjs')], { env: { ...process.env, COMPANION_WORK_ROOT: scope.root, COMPANION_WORK_ARCHIVE: scope.archive, COMPANION_WORK_LEDGER: scope.ledger }, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
  let output = '', stderr = ''; child.stdout.on('data', data => output += data); child.stderr.on('data', data => stderr += data);
  child.stdin.end([
    { id: 1, method: 'initialize' }, { id: 2, method: 'tools/list' },
    { id: 3, method: 'tools/call', params: { name: 'write_file', arguments: { path: 'mcp.md', content: '# MCP 实际文件', expected_sha256: null } } },
    { id: 4, method: 'tools/call', params: { name: 'write_file', arguments: { path: '../escape.md', content: 'no', expected_sha256: null } } },
  ].map(item => JSON.stringify({ jsonrpc: '2.0', ...item })).join('\n') + '\n');
  const code = await new Promise(resolve => child.on('close', resolve)); assert.equal(code, 0, stderr);
  const frames = output.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(frames[1].result.tools.length, 6); assert.equal(frames[2].result.isError, undefined); assert.equal(frames[3].result.isError, true);
  assert.equal(readFileSync(join(scope.root, 'mcp.md'), 'utf8'), '# MCP 实际文件');
});

test('native delegation ancestry grants only the matching job root and never ordinary chat or foreign bots', async () => {
  const { base } = fixture(); const runtime = new CompanionRuntime({routineTools:'ask', rootDir: base });
  const chiefId = randomUUID(), helperId = randomUUID(), first = randomUUID(), second = randomUUID(), child = randomUUID(), unrelated = randomUUID();
  const dataDir = join(base, 'live-harness'); const folder = join(dataDir, 'companion-work', randomUUID()); mkdirSync(folder, { recursive: true });
  const session = { dataDir, chiefId, helperIds: [helperId], workThreadIds: [first, second] };
  runtime.jobs.set(first, { threadId: first, folder, session });
  runtime.api = async () => ({ bots: [{ id: chiefId, tasks: [{ threadId: first }, { threadId: second }, { threadId: unrelated }] }, { id: helperId, tasks: [{ threadId: child, openedBy: { kind: 'work', botId: chiefId, threadId: first } }] }] });
  assert.equal((await runtime.workspaceScope(session, helperId, child)).root, folder);
  assert.equal(await runtime.workspaceScope(session, chiefId, unrelated), null);
  assert.equal(await runtime.workspaceScope(session, helperId, first), null);
  assert.equal(await runtime.workspaceScope(session, randomUUID(), child), null);
  assert.equal(await runtime.workspaceScope(session, chiefId, second), null);
});

test('failed work resumes in its original folder, deduplicates retries and restores its evidence after restart', async () => {
  const { base } = fixture(), runtime = new CompanionRuntime({routineTools:'ask', rootDir: base });
  const chiefId = randomUUID(), threadId = randomUUID(), dataDir = join(base, 'live-harness'), folder = join(dataDir, 'companion-work', randomUUID()); mkdirSync(folder, { recursive: true });
  const session = { mode: 'live', sessionId: randomUUID(), dataDir, chiefId, helperIds: [], workThreadIds: [threadId] }; runtime.current = session;
  const job = { threadId, folder, session, startedAt: Date.now(), before: { files: new Map(), unavailable: [] }, status: 'settled' }; runtime.jobs.set(threadId, job);
  let calls = 0, success = false;
  const api = async (_, method, route) => {
    if (route === '/api/bots') return { bots: [{ id: chiefId, tasks: [{ threadId, cwd: folder, busy: false, waitingForTeammates: false }] }] };
    if (method === 'GET') return { messages: [{ kind: 'digest', turnSucceeded: success }] };
    calls++; return { threadId, accepted: true };
  };
  runtime.api = api; runtime.observeJob = async () => {};
  const body = { sendId: 'retry_contract_000001' };
  const [first, second] = await Promise.all([runtime.retryWork(threadId, body), runtime.retryWork(threadId, body)]);
  assert.deepEqual(first, second); assert.equal(calls, 1); assert.equal(job.folder, folder);
  success = true; await assert.rejects(runtime.retryWork(threadId, { sendId: 'retry_contract_000002' }), /没有需要重试/);
  writeFileSync(join(folder, '.companion-evidence.json'), JSON.stringify({ threadId, files: [{ path: 'report.md', status: 'added' }], tests: [], coverage: 'test evidence' }));
  const reopened = new CompanionRuntime({routineTools:'ask', rootDir: base }); reopened.api = api; reopened.current = session;
  await reopened.restoreJobs(session); assert.equal((await reopened.evidence(threadId)).files[0].path, 'report.md');
  await assert.rejects(reopened.retryWork(randomUUID(), { sendId: 'retry_contract_000003' }), /不存在/);
});

test('helper answers use the native question destination, stay in the same job and reject unrelated messages', async () => {
  const { base } = fixture(), runtime = new CompanionRuntime({routineTools:'ask', rootDir: base });
  const chiefId = randomUUID(), helperId = randomUUID(), threadId = randomUUID(), childId = randomUUID(), questionId = randomUUID(), dataDir = join(base, 'live-harness'), folder = join(dataDir, 'companion-work', randomUUID()); mkdirSync(folder, { recursive: true });
  const session = { mode: 'live', sessionId: randomUUID(), dataDir, chiefId, helperIds: [helperId], workThreadIds: [threadId] }; runtime.current = session;
  runtime.jobs.set(threadId, { threadId, folder, session, evidence: { files: [] } });
  let submissions = 0, answered = false;
  runtime.api = async (_, method, route, body) => {
    if (route === '/api/bots') return { bots: [{ id: chiefId, tasks: [{ threadId }] }, { id: helperId, tasks: [{ threadId: childId, openedBy: { kind: 'work', botId: chiefId, threadId } }] }] };
    if (route === `/api/threads/${threadId}/messages?limit=100`) return { messages: [{ id: questionId, at: 5, kind: 'activity', tool: { name: 'helper needs your input: question' }, threadRef: { botId: helperId, threadId: childId } }] };
    if (method === 'GET') return { messages: answered ? [{ role: 'user', at: 6 }] : [] };
    assert.equal(route, `/api/bots/${helperId}/messages`); assert.equal(body.threadId, childId); submissions++; answered = true; return { accepted: true };
  };
  const body = { questionId, text: 'Continue with the supplied facts.', sendId: 'answer_contract_00001' };
  await Promise.all([runtime.replyToHelper(threadId, body), runtime.replyToHelper(threadId, body)]); assert.equal(submissions, 1);
  await assert.rejects(async () => runtime.replyToHelper(threadId, { ...body, text: 'changed' }), /内容不一致/);
  await assert.rejects(runtime.replyToHelper(threadId, { ...body, questionId: randomUUID(), sendId: 'answer_contract_00002' }), /不是本次小助理/);
  await assert.rejects(runtime.replyToHelper(randomUUID(), { ...body, sendId: 'answer_contract_00003' }), /不存在/);
  await assert.rejects(runtime.replyToHelper(threadId, { ...body, sendId: 'answer_contract_00004' }), /已经收到回答/);
});
test('questions delegated from ordinary chat can be answered only within their verified parent conversation', async () => {
  const {base}=fixture(),runtime=new CompanionRuntime({routineTools:'ask',rootDir:base});
  const chiefId=randomUUID(),helperId=randomUUID(),chat=randomUUID(),child=randomUUID(),questionId=randomUUID();
  const session={mode:'live',sessionId:randomUUID(),chiefId,helperIds:[helperId],companionThreadId:chat,workThreadIds:[]};runtime.current=session;let parent=chat,calls=0;
  runtime.api=async(_session,method,path,body)=>{
    if(path==='/api/bots')return {bots:[{id:helperId,tasks:[{threadId:child,openedBy:{botId:chiefId,threadId:parent}}]}]};
    if(path===`/api/threads/${chat}/messages?limit=100`)return {messages:[{id:questionId,at:10,kind:'activity',tool:{name:'文档助理 needs your input: 哪个文件夹'},threadRef:{botId:helperId,threadId:child}}]};
    if(method==='GET')return {messages:[]};assert.equal(body.threadId,child);calls++;return {accepted:true};
  };
  await runtime.replyToHelper(chat,{questionId,text:'请用已授权的目录。',sendId:'chat_helper_answer_0001'});assert.equal(calls,1);
  parent=randomUUID();await assert.rejects(runtime.replyToHelper(chat,{questionId,text:'不能串到别处。',sendId:'chat_helper_answer_0002'}),/不属于/);
});
