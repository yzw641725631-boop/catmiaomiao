import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile, lstat } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
const project = resolve(import.meta.dirname, '..'), origin = 'http://127.0.0.1:5217';
const boot = await fetch(origin + '/companion/info'), cookie = boot.headers.get('set-cookie').split(';')[0], info = await boot.json();
assert.equal(info.mode, 'live'); assert.equal(info.provider, 'reachai');
async function api(route, body) {
  const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) });
  assert(response.ok, `Acceptance route returned ${response.status}`); return response.json();
}
const existing = process.argv.find(value => value.startsWith('--thread='))?.slice(9);
const startedAt = new Date().toISOString(), dir = join(project, 'evidence', 'windows-files-20261022'); await mkdir(dir, { recursive: true });
const output = join(dir, 'real-work-' + startedAt.replace(/[:.]/g, '-') + '.json');
const prompt = `Windows 真实文件验收，这是全新的任务，不能引用旧任务的完成结果：请通过 agents_coordinate_bots 分别派工，每次只传 bot_ids（JSON 数组）和 message。检索助理 ID 为 ${info.helperIds[0]}，只根据本条消息列出三点“真实模型、两位小助理、文件落盘”，无需联网。文档助理 ID 为 ${info.helperIds[1]}，用 workspace_write_file 在本次目录新建 report.md，标题“真实文件协作验证”，正文写这三点，并注明由 ReachAI 提供模型服务，不猜测供应商型号；写入后用 workspace_check_file 的 utf8 校验。只在本次目录操作，授权请求等我确认。收齐两位小助理本次的实际结果后，附文件链接和真实校验结果。`;
const receipt = existing ? null : await api('/companion/send', { kind: 'work', text: prompt, sendId: 'workspace_actual_' + randomUUID() });
const threadId = existing || receipt.threadId;
if (existing && process.argv.includes('--resume')) await api(`/companion/work/${threadId}/retry`, { sendId: 'workspace_retry_' + randomUUID() });
const record = { startedAt, threadId, model: info.model.model, passed: false, scope: 'actual ReachAI delegation, assigned Windows text files, native approval and real validation receipts' };
await writeFile(output, JSON.stringify(record, null, 2) + '\n'); console.log(JSON.stringify({ phase: 'started', threadId, output }));
let last = ''; const seen = new Set();
try {
  const deadline = Date.now() + 8 * 60 * 1000;
  while (Date.now() < deadline) {
    const { bots } = await api('/api/bots'), chief = bots.find(bot => bot.id === info.chiefId), task = chief.tasks.find(task => task.threadId === threadId);
    const helpers = bots.filter(bot => info.helperIds.includes(bot.id)).flatMap(bot => (bot.tasks || []).filter(task => task.openedBy?.threadId === threadId).map(task => ({ botId: bot.id, name: bot.name, ...task })));
    const pages = await Promise.all([{ botId: chief.id, threadId }, ...helpers].map(async item => ({ ...item, messages: (await api(`/api/threads/${item.threadId}/messages?limit=100`)).messages })));
    for (const page of pages) for (const message of page.messages) {
      const card = message.card;
      if (card?.requestId && !card.answered && !card.dismissed && !card.expired && !seen.has(card.requestId)) {
        seen.add(card.requestId); console.log(JSON.stringify({ phase: 'permission-pending', botId: page.botId, threadId: page.threadId, card }));
      }
    }
    const state = JSON.stringify({ phase: 'progress', main: { busy: task.busy, waiting: task.waitingForTeammates }, helpers: helpers.map(item => ({ name: item.name, threadId: item.threadId, busy: item.busy, activity: item.activity })) });
    if (state !== last) { console.log(state); last = state; }
    if (!task.busy && !task.waitingForTeammates && pages[0].messages.some(message => message.turnTerminal || message.tool?.terminal || message.kind === 'digest' && typeof message.turnSucceeded === 'boolean')) {
      const final = pages[0].messages.filter(message => message.turnTerminal || message.tool?.terminal || message.kind === 'digest' && typeof message.turnSucceeded === 'boolean').at(-1);
      assert.equal(final.turnSucceeded, true, 'Latest chief turn must succeed');
      assert.equal(new Set(helpers.map(item => item.botId)).size, 2, 'Both native helpers must receive work');
      assert(helpers.every(item => !item.busy && !item.waitingForTeammates), 'All helpers must settle');
      const folder = resolve(task.cwd), allowed = resolve(project, 'runtime/live-harness/companion-work') + sep;
      assert(folder.toLowerCase().startsWith(allowed.toLowerCase()));
      const file = join(folder, 'report.md'), stat = await lstat(file); assert(stat.isFile() && !stat.isSymbolicLink());
      const bytes = await readFile(file), text = new TextDecoder('utf-8', { fatal: true }).decode(bytes), sha256 = createHash('sha256').update(bytes).digest('hex');
      assert(text.includes('真实文件协作验证') && /ReachAI/i.test(text));
      const writer = pages.find(page => page.name === '文档助理');
      assert(writer?.messages.some(message => message.turnTerminal && message.turnSucceeded), 'The writer must actually finish');
      assert(writer.messages.some(message => message.tool?.name === 'workspace_write_file' && message.tool.ok === true), 'Native writer must successfully call the real file tool');
      assert(pages.filter(page => page.threadId !== threadId).every(page => page.messages.some(message => message.turnTerminal && message.turnSucceeded)), 'Both helpers must return actual successful replies');
      const ledger = (await readFile(join(project, 'runtime/workspace-ledger', folder.split(/[\\/]/).at(-1) + '.jsonl'), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
      assert(ledger.some(item => item.operation === 'write_file' && item.botId === writer.botId && item.threadId === writer.threadId && item.sha256 === sha256), 'Trusted file receipt must identify the actual native writer thread');
      const approvals = writer.messages.filter(message => message.card?.tool?.startsWith('workspace_')).map(message => ({ requestId: message.card.requestId, tool: message.card.tool, answered: message.card.answered, dismissed: message.card.dismissed, expired: message.card.expired }));
      assert(['workspace_list_files', 'workspace_write_file', 'workspace_check_file'].every(tool => approvals.some(card => card.tool === tool && card.answered)), 'Each file operation must retain its native authorization record');
      let evidence; for (let count = 0; count < 10; count++) { evidence = await api(`/companion/work/${threadId}/evidence`); if (evidence.files.length) break; await delay(400); }
      assert(evidence.files.some(item => item.path === 'report.md' && item.status === 'added'));
      assert(evidence.tests.some(item => item.path === 'report.md' && item.exitCode === 0 && item.sha256 === sha256 && item.current), 'A genuine validation receipt must match the final file bytes');
      const reply = pages[0].messages.filter(message => message.turnTerminal && message.kind === 'text').at(-1);
      assert(reply?.text?.includes('report.md'), 'Chief must link the real result');
      const chiefFileCalls = pages[0].messages.filter(message => message.tool?.ok === true && message.tool.name.startsWith('workspace_')).map(message => message.tool.name);
      const summaryLimitations = [];
      if (reply.text.includes('我独立重跑') && !chiefFileCalls.includes('workspace_check_file')) summaryLimitations.push('Chief claimed an independent repeated check, but the native chief thread has no matching check_file receipt. Only the writer check is verified.');
      if (reply.text.includes('我本会话直接用 workspace 工具做的') && !chiefFileCalls.includes('workspace_read_file')) summaryLimitations.push('Chief claimed a direct read, but the native chief thread has no matching read_file receipt.');
      const download = await fetch(origin + `/api/threads/${threadId}/messages/${reply.id}/file`, { method: 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, body: JSON.stringify({ path: file.replaceAll('\\', '/') }) });
      assert.equal(download.status, 200, 'The final message file link must open'); assert.equal(createHash('sha256').update(Buffer.from(await download.arrayBuffer())).digest('hex'), sha256);
      Object.assign(record, { passed: true, fileToolChainPassed: true, summaryAccuracyPassed: summaryLimitations.length === 0, summaryLimitations, chiefFileCalls, completedAt: new Date().toISOString(), file, sha256, text, helpers: helpers.map(item => ({ botId: item.botId, name: item.name, threadId: item.threadId })), approvalsObserved: seen.size, approvals, finalMessageId: reply.id, finalReply: reply.text, evidence, ledger, earlierFailedTurns: pages[0].messages.filter(message => message.turnTerminal && message.turnSucceeded === false || message.kind === 'digest' && message.turnSucceeded === false).length });
      break;
    }
    await delay(1200);
  }
  assert(record.passed, 'Real file task did not finish before the bounded deadline');
} catch (error) { record.error = error.message; process.exitCode = 1; }
await writeFile(output, JSON.stringify(record, null, 2) + '\n'); console.log(JSON.stringify({ phase: record.passed ? 'passed' : 'incomplete', threadId, output, error: record.error }));
