import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
const project = join(import.meta.dirname, '..'), origin = 'http://127.0.0.1:5217', threadId = '5947ee45-8d54-488f-8ab7-19389c0cbec2';
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const dir = join(project, 'evidence/windows-files-20261022'), baselineFile = join(dir, 'before-final-restart.json');
const boot = await fetch(origin + '/companion/info'), cookie = boot.headers.get('set-cookie').split(';')[0], info = await boot.json();
async function api(path) { const response = await fetch(origin + path, { headers: { cookie, origin }, signal: AbortSignal.timeout(15000) }); assert(response.ok, path); return response.json(); }
const { bots } = await api('/api/bots'), chat = await api(`/api/threads/${info.companionThreadId}/messages?limit=100`), main = await api(`/api/threads/${threadId}/messages?limit=100`), evidence = await api(`/companion/work/${threadId}/evidence`);
assert.equal(info.model.model, 'cc51f07d-0e7e-4fbe-9b4b-52f9cc998644'); assert.equal(info.provider, 'reachai'); assert.equal(info.mode, 'live');
const job = bots.find(bot => bot.id === info.chiefId).tasks.find(task => task.threadId === threadId); assert(!job.busy && !job.waitingForTeammates);
const final = main.messages.filter(message => message.turnTerminal && message.kind === 'text').at(-1); assert(final?.turnSucceeded);
const file = join(job.cwd, 'report.md'), sha256 = digest(await readFile(file));
assert(evidence.files.some(item => item.path === 'report.md' && item.status === 'added')); assert(evidence.tests.some(item => item.path === 'report.md' && item.sha256 === sha256 && item.current === true && item.exitCode === 0));
const snapshot = { chiefId: info.chiefId, helperIds: info.helperIds, companionThreadId: info.companionThreadId, chatMessageIds: chat.messages.map(item => item.id), threadId, finalMessageId: final.id, sha256, evidenceSha256: digest(JSON.stringify(evidence)) };
if (process.argv.includes('--capture')) { await writeFile(baselineFile, JSON.stringify(snapshot, null, 2) + '\n'); console.log(JSON.stringify({ captured: true, baselineFile })); }
else {
  assert.deepEqual(snapshot, JSON.parse(await readFile(baselineFile, 'utf8')), 'Identity, messages, real file and evidence must survive the owned restart');
  const download = await fetch(origin + `/api/threads/${threadId}/messages/${final.id}/file`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ path: file.replaceAll('\\', '/') }) });
  assert.equal(download.status, 200); assert.equal(digest(Buffer.from(await download.arrayBuffer())), sha256);
  assert.equal(digest(await readFile(join(project, '../../Agent文档/main.md'))), '413986ce2afd8062d050150674e42d2c0ff1834a1c6396456703c1146b526030');
  const index = JSON.parse(await readFile(join(project, '../../Agent文档/doc_index.json'), 'utf8')), previous = JSON.parse(await readFile(join(project, '../../归档/openmaus-assistant/windows-files-20261022/doc_index-before-files.json'), 'utf8'));
  const unrelated = value => ({ ...value, projects: value.projects.filter(item => item.name !== 'openmaus-assistant'), documents: value.documents.filter(item => item.project !== 'openmaus-assistant') });
  assert.deepEqual(unrelated(index), unrelated(previous));
  for (const entry of index.documents.filter(item => item.project === 'openmaus-assistant')) await readFile(join(project, '../..', entry.path));
  const output = join(dir, 'delivery-audit-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
  await writeFile(output, JSON.stringify({ at: new Date().toISOString(), passed: true, ...snapshot, model: 'agens / agnes-3.0-flash', fileLinkWorksAfterRestart: true, mainUnchanged: true, unrelatedIndexPreserved: true }, null, 2) + '\n'); console.log(JSON.stringify({ passed: true, output }));
}
