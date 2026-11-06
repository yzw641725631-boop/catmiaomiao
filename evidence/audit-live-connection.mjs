import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const workspace = 'J:/agent_project';
const project = path.join(workspace, 'projects/openmaus-assistant');
const origin = 'http://127.0.0.1:5217';
const readJson = async filename => JSON.parse((await fs.readFile(filename, 'utf8')).replace(/^\uFEFF/, ''));
const settings = await readJson(path.join(project, 'runtime/companion-settings.json'));
const initial = await fetch(origin + '/companion/info');
const cookie = initial.headers.get('set-cookie').split(';')[0];
const info = await initial.json();
assert.equal(info.mode, 'live'); assert.equal(info.provider, 'reachai');
assert.equal(info.chiefId, '7e60e8a5-b4ad-4d80-ad17-a7d97e8f740b');
assert.equal(info.companionThreadId, '5ac4c945-ac16-4dfb-8d3e-70a1115c8a7d');
assert.equal(info.reachai.llmId, '5e30cb57-167d-4c2f-b953-6e6b5bd500b1');
assert(info.reachai.keySaved && settings.reachai.key);
assert(!JSON.stringify(info).includes(settings.reachai.key));
assert(!(await fs.readFile(path.join(project, 'runtime/live-harness/config.json'), 'utf8')).includes(settings.reachai.key));
const headers = { cookie, origin };
const bots = (await (await fetch(origin + '/api/bots', { headers })).json()).bots;
const team = bots.filter(bot => [info.chiefId, ...info.helperIds].includes(bot.id));
assert.equal(team.length, 3);
assert(team.every(bot => bot.modelSelection.model === info.reachai.llmId));
assert(team.find(bot => bot.id === info.chiefId).chiefOfStaff);
const history = await (await fetch(origin + `/api/threads/${info.companionThreadId}/messages`, { headers })).json();
assert(history.messages.length >= 9);
const events = await fetch(origin + '/api/events?screens=off', { headers, signal: AbortSignal.timeout(2500) });
assert.equal(events.status, 200); assert.match(events.headers.get('content-type'), /text\/event-stream/);
const reader = events.body.getReader(); const first = await reader.read(); await reader.cancel();
assert(new TextDecoder().decode(first.value).includes('hello'));
const evidence = path.join(project, 'evidence/reachai-live-20261022');
const real = await readJson(path.join(evidence, 'native-work-2026-10-22T07-24-49-894Z.json'));
assert(real.passed && real.helpers.length === 2 && real.filesWritten === false);
const testsDir = path.join(project, 'evidence/app-checks-2026-10-22T07-26-13-658Z');
const tests = await readJson(path.join(testsDir, 'report.json'));
assert(tests.passed && tests.stages.every(stage => stage.exitCode === 0));
const log = await fs.readFile(path.join(testsDir, 'test.log'), 'utf8');
assert(/tests 24/.test(log) && /pass 24/.test(log) && /fail 0/.test(log));
const buildLog = await fs.readFile(path.join(testsDir, 'build.log'), 'utf8');
const html = await (await fetch(origin)).text();
for (const match of html.matchAll(/(?:src|href)="(\/assets\/[^\"]+)"/g)) {
  await fs.access(path.join(project, 'app/dist', match[1]));
  if (/\.(?:js|css)$/.test(match[1])) assert(buildLog.includes(path.basename(match[1])));
}
for (const name of ['llm-connected.jpg', 'restart-draft-retained.jpg']) {
  const bytes = await fs.readFile(path.join(evidence, name)); assert(bytes.length > 10000 && bytes[0] === 255 && bytes[1] === 216);
}
const index = await readJson(path.join(workspace, 'Agent文档/doc_index.json'));
const previous = await readJson(path.join(workspace, '归档/openmaus-assistant/reachai-live-connection-20261022/doc_index-before-live.json'));
const unrelated = value => ({ ...value, projects: value.projects.filter(row => row.name !== 'openmaus-assistant'), documents: value.documents.filter(row => row.project !== 'openmaus-assistant') });
assert.deepEqual(unrelated(index), unrelated(previous));
assert.equal(crypto.createHash('sha256').update(await fs.readFile(path.join(workspace, 'Agent文档/main.md'))).digest('hex'), '413986ce2afd8062d050150674e42d2c0ff1834a1c6396456703c1146b526030');
const docs = ['projects/openmaus-assistant/README.md', 'projects/openmaus-assistant/docs/ReachAI接入实现与验收_v1.0.md', 'Agent文档/openmaus-assistant_知识库/项目概览_v1.0.md', 'Agent文档/openmaus-assistant_工作日志/工作报告_20261022_ReachAI真实LLM连接_v1.0.md'];
let checkedLinks = 0;
for (const doc of docs) {
  assert.equal(index.documents.filter(row => row.path === doc).length, 1);
  const filename = path.join(workspace, doc);
  for (const match of (await fs.readFile(filename, 'utf8')).matchAll(/\]\(([^)]+)\)/g)) {
    if (/^(?:https?:|#)/i.test(match[1])) continue;
    await fs.access(path.resolve(path.dirname(filename), match[1])); checkedLinks++;
  }
}
const result = { date: '2026-10-22', mode: info.mode, provider: info.provider, model: 'deepseek-hongkong / configured deepseek-v4.1-flash', teamUsesSelectedModel: true, textChatVerified: true, nativeTextDelegationVerified: true, upstreamErrorsRecovered: true, windowsFileExecution: 'not connected; file acceptance did not pass', speechAndAvatar: 'not enabled', testsPassed: 24, typecheck: true, build: true, servedBuildMatchesEvidence: true, identityAndHistoryRetained: true, historyMessages: history.messages.length, sseHealthy: true, browserAutoReconnectAndDraft: 'visually verified; see restart-draft-retained.jpg', noPlatformKeyInInfoOrHarnessConfig: true, docs: docs.length, checkedLinks, unrelatedIndexPreserved: true, mainP0Unchanged: true };
await fs.writeFile(path.join(evidence, 'delivery-audit.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result));
