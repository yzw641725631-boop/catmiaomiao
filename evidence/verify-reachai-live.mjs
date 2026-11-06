import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const project = 'J:/agent_project/projects/openmaus-assistant';
const origin = 'http://127.0.0.1:5217';
const boot = await fetch(origin + '/companion/info');
const cookie = boot.headers.get('set-cookie').split(';')[0];
const info = await boot.json();
assert.equal(info.mode, 'live');
assert.equal(info.provider, 'reachai');
const api = async (route, body) => {
  const response = await fetch(origin + route, { method: body === undefined ? 'GET' : 'POST', headers: { cookie, origin, 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(45000) });
  assert(response.ok, `Local acceptance route returned ${response.status}`);
  return response.json();
};
const startedAt = new Date();
const textOnly = process.argv.includes('--text-only');
const existingThread = process.argv.find(value => value.startsWith('--thread='))?.slice('--thread='.length);
if (existingThread) assert(/^[a-f0-9-]{36}$/.test(existingThread));
const outputDir = path.join(project, 'evidence/reachai-live-20261022');
const output = path.join(outputDir, 'native-work-' + startedAt.toISOString().replace(/[:.]/g, '-') + '.json');
const prompt = textOnly
  ? `真实模型文字协作验收，不涉及文件或电脑操作。请调用 agents_coordinate_bots 两次，每次只传 bot_ids 和 message 两个字段。第一次 bot_ids 必须是 JSON 数组 ["${info.helperIds[0]}"], message 为“仅用一行文字回复：检索助理真实模型回传成功。不要使用任何工具，不要操作文件、网络、电脑或数据库。”。第二次 bot_ids 必须是 JSON 数组 ["${info.helperIds[1]}"], message 为“仅用一行文字回复：文档助理真实模型回传成功。不要使用任何工具，不要操作文件、网络、电脑或数据库。”。数组不能写成字符串。发出两次后结束本轮，等两位小助理的真实回复自动回传后再汇总。最终回复中应包含两位小助理实际回复的两句话，明确本次只验证文字协作、未写入文件。`
  : '真实模型连接验收：请同时委派两位小助理。检索助理只根据这条消息整理三条验收点：真实模型连接、两名独立小助理、真实文件落盘，不要联网。文档助理将这三点写入本次工作唯一指定目录下的 report.md，标题必须是“真实模型连接验证”，说明由 ReachAI 提供 DeepSeek 完成。不得读取其他目录、安装软件、外发消息或更改配置。请收齐两名小助理的实际结果后汇总，并给出生成文件链接。';
const receipt = existingThread ? null : await api('/companion/send', { kind: 'work', text: prompt, sendId: 'reachai_actual_work_' + randomUUID() });
const threadId = existingThread || receipt.threadId || receipt.info.workThreadIds.at(-1);
assert(threadId && threadId !== info.companionThreadId);
await fs.mkdir(outputDir, { recursive: true });
const record = { startedAt: startedAt.toISOString(), kind: textOnly ? 'actual ReachAI LLM with text-only native delegation' : 'actual ReachAI LLM with native file work', model: info.model.model, chiefId: info.chiefId, threadId, passed: false };
await fs.writeFile(output, JSON.stringify(record, null, 2) + '\n');
console.log(JSON.stringify({ phase: 'native-work-started', threadId, evidence: output }));
const announced = new Set();
let lastState = '';
try {
  const deadline = Date.now() + 5 * 60 * 1000;
  while (Date.now() < deadline) {
    const { bots } = await api('/api/bots');
    const chief = bots.find(bot => bot.id === info.chiefId);
    const task = chief.tasks.find(task => task.threadId === threadId);
    const helpers = bots.filter(bot => info.helperIds.includes(bot.id)).flatMap(bot => (bot.tasks || []).filter(task => task.openedBy?.threadId === threadId).map(task => ({ botId: bot.id, name: bot.name, ...task })));
    const main = await api(`/api/threads/${threadId}/messages?limit=100`);
    const pages = [{ botId: chief.id, threadId, messages: main.messages }];
    for (const helper of helpers) pages.push({ botId: helper.botId, threadId: helper.threadId, messages: (await api(`/api/threads/${helper.threadId}/messages?limit=100`)).messages });
    for (const page of pages) for (const message of page.messages) {
      const card = message.card;
      if (card?.requestId && !card.answered && !card.dismissed && !card.expired && !announced.has(card.requestId)) {
        announced.add(card.requestId);
        console.log(JSON.stringify({ phase: 'approval-request', botId: page.botId, threadId: page.threadId, requestId: card.requestId, title: card.title, subtitle: card.subtitle, requestType: card.requestType, options: card.options, detail: card.detail }));
      }
    }
    const state = JSON.stringify({ phase: 'native-work-progress', helperTasks: helpers.map(task => ({ name: task.name, busy: task.busy, waiting: task.waitingForTeammates })), mainBusy: task.busy, mainWaiting: task.waitingForTeammates });
    if (state !== lastState) { console.log(state); lastState = state; }
    if (!task.busy && !task.waitingForTeammates && main.messages.some(message => message.turnTerminal)) {
      const terminal = main.messages.filter(message => message.turnTerminal).at(-1);
      assert(terminal?.turnSucceeded !== false, 'The latest native model turn ended unsuccessfully');
      assert.equal(new Set(helpers.map(task => task.botId)).size, 2, 'Both native helpers must actually receive tasks');
      assert(helpers.every(task => !task.busy && !task.waitingForTeammates));
      if (textOnly) {
        const reply = main.messages.filter(message => message.turnTerminal && message.kind === 'text').at(-1);
        for (const name of ['检索助理', '文档助理']) {
          assert(reply?.text.includes(name + '真实模型回传成功'), 'The final answer must include each actual helper response');
          assert(pages.some(page => page.threadId !== threadId && page.messages.some(message => message.role === 'bot' && message.turnSucceeded && message.text?.includes(name + '真实模型回传成功'))), 'The helper must actually produce its own successful response');
        }
        Object.assign(record, { passed: true, completedAt: new Date().toISOString(), auditedExistingThread: !!existingThread, helpers: helpers.map(task => ({ id: task.botId, name: task.name, threadId: task.threadId, openedBy: task.openedBy })), approvalsObserved: announced.size, finalReply: reply.text, finalMessageId: reply.id, earlierFailedTurns: main.messages.filter(message => message.turnTerminal && message.turnSucceeded === false).length, failedToolCalls: main.messages.filter(message => message.kind === 'activity' && message.tool?.ok === false).length, filesWritten: false });
        await fs.writeFile(output, JSON.stringify(record, null, 2) + '\n');
        console.log(JSON.stringify({ phase: 'native-text-delegation-passed', threadId, helpers: helpers.map(task => task.name), evidence: output }));
        break;
      }
      const cwd = path.resolve(task.cwd);
      const allowed = path.resolve(project, 'runtime/live-harness/companion-work') + path.sep;
      assert(cwd.toLowerCase().startsWith(allowed.toLowerCase()), 'Work must stay in its isolated project directory');
      const filename = path.join(cwd, 'report.md');
      const stat = await fs.lstat(filename);
      assert(stat.isFile() && !stat.isSymbolicLink());
      const report = await fs.readFile(filename, 'utf8');
      assert(report.includes('真实模型连接验证') && !report.includes('\uFFFD'), 'The actual UTF-8 report must contain the requested title');
      let evidence = await api(`/companion/work/${threadId}/evidence`);
      if (!evidence.files.length) { await delay(800); evidence = await api(`/companion/work/${threadId}/evidence`); }
      assert(evidence.files.some(file => file.path === 'report.md' && file.status === 'added'), 'The work evidence must capture the real created file');
      const reply = main.messages.filter(message => message.turnTerminal && message.kind === 'text').at(-1);
      Object.assign(record, { passed: true, completedAt: new Date().toISOString(), helpers: helpers.map(task => ({ id: task.botId, name: task.name, threadId: task.threadId, openedBy: task.openedBy })), approvalsObserved: announced.size, file: filename, report, finalReply: reply?.text, workEvidence: evidence });
      await fs.writeFile(output, JSON.stringify(record, null, 2) + '\n');
      console.log(JSON.stringify({ phase: 'native-work-passed', threadId, helpers: helpers.map(task => task.name), file: filename, evidence: output }));
      break;
    }
    await delay(1200);
  }
  assert(record.passed, 'Native work did not complete before the bounded acceptance deadline');
} catch (error) {
  Object.assign(record, { error: error.message, completedAt: new Date().toISOString() });
  await fs.writeFile(output, JSON.stringify(record, null, 2) + '\n');
  console.log(JSON.stringify({ phase: 'native-work-incomplete', threadId, error: error.message, evidence: output }));
  process.exitCode = 1;
}
