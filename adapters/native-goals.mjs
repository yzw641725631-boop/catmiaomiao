import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { basename, join, resolve } from 'node:path';
import { writeFileAtomic } from '../upstream/OpenMausBot/server/atomic.ts';
import { captureFiles } from './work-evidence.mjs';
import { fail } from './endpoints.mjs';
export class NativeGoals {
  constructor(runtime) {
    this.runtime = runtime;
    this.file = join(runtime.rootDir, 'native-goals.json');
    this.rows = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : [];
    this.busy = false;
  }
  save() {
    mkdirSync(this.runtime.rootDir, { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(this.rows, null, 2) + '\n');
  }
  valid(session, row, group) {
    const members = new Set([session.chiefId, ...session.helperIds]);
    return (
      row?.chiefId === session.chiefId &&
      group &&
      !group.dm &&
      group.id === row.id &&
      group.threadId === row.threadId &&
      group.memberIds.length === row.memberIds.length &&
      group.memberIds.every((id) => members.has(id) && row.memberIds.includes(id))
    );
  }
  job(session, row) {
    const folder = resolve(row.folder),
      id = basename(folder);
    if (!/^[a-f0-9-]{36}$/.test(id) || folder !== resolve(session.dataDir, 'companion-work', id) || !existsSync(folder))
      throw fail('目标文件夹不可用。', 409);
    let job = this.runtime.jobs.get(row.threadId);
    if (!job || job.session !== session) {
      job = {
        threadId: row.threadId,
        folder,
        session,
        before: captureFiles(folder),
        tests: [],
        startedAt: row.createdAt,
        status: 'running',
        goalGroupId: row.id,
      };
      this.runtime.jobs.set(row.threadId, job);
      if (!session.workThreadIds.includes(row.threadId)) session.workThreadIds.push(row.threadId);
      this.runtime.persistJob(job);
      this.runtime.persistSession(session);
    }
    return job;
  }
  async scope(session, botId, threadId, state) {
    const row = this.rows.find((row) => row.threadId === threadId),
      group = state.groups?.find((group) => group.id === row?.id);
    if (
      !this.valid(session, row, group) ||
      !group.memberIds.includes(botId) ||
      !group.tasks?.some((task) => task.threadId === threadId && !task.archivedAt)
    )
      return null;
    return { ...this.runtime.jobScope(session, this.job(session, row)), goal: true };
  }
  async snapshot(id) {
    const session = this.runtime.current;
    if (session?.mode !== 'live') return { available: false, goals: [] };
    const state = await this.runtime.api(session, 'GET', '/api/bots?messages=0');
    const goals = [];
    for (const row of this.rows.filter((row) => !id || row.id === id)) {
      const group = state.groups.find((group) => group.id === row.id);
      if (!this.valid(session, row, group)) continue;
      this.job(session, row);
      const page = await this.runtime.api(session, 'GET', `/api/threads/${row.threadId}/messages?limit=200`),
        goalRun = page.messages.findLast((message) => message.goalRun)?.goalRun;
      goals.push({
        id: row.id,
        title: row.title,
        goal: row.goal,
        threadId: row.threadId,
        createdAt: row.createdAt,
        working: Boolean(group.busyBotId || group.tasks?.find((task) => task.threadId === row.threadId)?.working),
        members: row.memberIds.map((botId) => ({
          id: botId,
          name: state.bots.find((bot) => bot.id === botId)?.name || '助理',
        })),
        goalRun,
        messages: id ? page.messages : undefined,
        files: id
          ? [...captureFiles(row.folder).files].map(([path, file]) => ({ path, text: file.text, sha256: file.hash }))
          : undefined,
      });
    }
    if (id && !goals.length) throw fail('这项目标不存在。', 404);
    return { available: true, goals };
  }
  async create(input) {
    if (this.busy) throw fail('正在建立目标，请稍后。', 409);
    const session = this.runtime.current;
    if (session?.mode !== 'live') throw fail('先连接真实模型，再创建持续目标。', 409);
    if (
      typeof input?.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 100 ||
      typeof input.goal !== 'string' ||
      !input.goal.trim() ||
      input.goal.length > 6000 ||
      !/^[\w-]{16,80}$/.test(input.sendId || '')
    )
      throw fail('请填写目标名称、要求和有效请求标识。');
    this.busy = true;
    try {
      const prior = this.rows.find((row) => row.sendId === input.sendId && row.chiefId === session.chiefId);
      if (prior) {
        if (prior.goal !== input.goal.trim() || prior.title !== input.title.trim())
          throw fail('重复请求的目标内容不同。', 409);
        return { id: prior.id, reused: true };
      }
      await this.runtime.refreshTeam(session);
      const memberIds = [session.chiefId, ...session.helperIds],
        folder = join(session.dataDir, 'companion-work', randomUUID());
      mkdirSync(folder, { recursive: true });
      const { group } = await this.runtime.api(session, 'POST', '/api/groups', {
        name: input.title.trim(),
        memberIds,
        section: '私人书房',
        setup: {
          bulletin: `这是一项用户的持续目标：${input.goal.trim()}\n本目标唯一指定文件夹：${folder}。所有成员使用绑定的 workspace 文件工具，文件按实际回执核对。按原生团队目标协议工作，遇到缺少信息或权限就明确等待，不伪造进展。`,
          defaultResponder: { kind: 'member', botId: session.chiefId },
        },
      });
      const row = {
        id: group.id,
        threadId: group.threadId,
        chiefId: session.chiefId,
        memberIds,
        folder,
        title: input.title.trim(),
        goal: input.goal.trim(),
        sendId: input.sendId,
        createdAt: Date.now(),
      };
      this.rows.push(row);
      this.save();
      this.job(session, row);
      await this.runtime.api(session, 'PATCH', `/api/groups/${group.id}`, { cwd: folder });
      await this.send(row.id, { text: row.goal, sendId: input.sendId });
      return { id: row.id };
    } finally {
      this.busy = false;
    }
  }
  async send(id, input) {
    const session = this.runtime.current,
      { goals } = await this.snapshot(id),
      goal = goals[0],
      row = this.rows.find((row) => row.id === id);
    if (
      typeof input?.text !== 'string' ||
      !input.text.trim() ||
      input.text.length > 6000 ||
      !/^[\w-]{16,80}$/.test(input.sendId || '')
    )
      throw fail('请填写要补充的目标要求。');
    const text =
      input.text.trim() +
      `\n\n[本地助理能力说明，${new Date().toISOString()}]\n你有 assistant 工具：读取已授权目录和网页、读取技能。当前是持久团队目标，人员调度由底座原生目标协议负责：主助理在回复末尾用系统规定的 openmaus-goal 信封选择下一位成员或完成。此目标不挂载 coordinate_bots 工具；不要调用它或在信封之外另建派工。文件唯一目录：${row.folder}。保存文本用 workspace_write_file，再用 workspace_check_file；Word/Excel 用 workspace_create_document/workspace_create_spreadsheet。各成员均有绑定该目录的工具。完成条件以实际工具结果和用户目标为准，不要求无关工具调用。` +
      (await this.runtime.capabilities.prompt());
    const job = this.job(session, row);
    // While a goal step runs, upstream queues the message behind it; keep the current observation and re-arm once the queued round starts.
    if (!goal.working) {
      job.latestAttemptAt = Date.now();
      job.evidence = null;
      job.status = 'running';
      this.runtime.persistJob(job);
    }
    const receipt = await this.runtime.api(session, 'POST', `/api/groups/${id}/messages`, {
      text,
      sendId: input.sendId,
      mode: 'goal',
      threadId: row.threadId,
    });
    if (receipt.queued) this.followQueued(session, id, row, job);
    else
      this.runtime.observeJob(job).catch((error) => {
        job.error = error.message;
        job.status = 'unverified';
      });
    return { ...receipt, delivery: receipt.queued ? 'queued' : 'started' };
  }
  async followQueued(session, id, row, job) {
    // Wait for the current step to end, then for the queued round to start, and observe that round as a new attempt.
    let idleSeen = false;
    const deadline = Date.now() + 30 * 60 * 1000;
    while (!this.runtime.closed && this.runtime.current === session && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const group = (await this.runtime.api(session, 'GET', '/api/bots').catch(() => ({ groups: [] }))).groups?.find(
        (group) => group.id === id,
      );
      const working = Boolean(
        group?.busyBotId || group?.tasks?.find((task) => task.threadId === row.threadId)?.working,
      );
      if (!working) idleSeen = true;
      else if (idleSeen) {
        job.latestAttemptAt = Date.now();
        job.evidence = null;
        job.status = 'running';
        this.runtime.persistJob(job);
        this.runtime.observeJob(job).catch((error) => {
          job.error = error.message;
          job.status = 'unverified';
        });
        return;
      }
    }
  }
  async pause(id) {
    const { goals } = await this.snapshot(id);
    return this.runtime.api(this.runtime.current, 'POST', `/api/groups/${id}/interrupt`, {
      threadId: goals[0].threadId,
    });
  }
  async respond(row, botId, body) {
    const { goals } = await this.snapshot(row.id),
      goal = goals[0],
      message = goal.messages.find((message) => message.card?.requestId === body.requestId);
    if (!message || message.from?.botId !== botId || !goal.members.some((member) => member.id === botId))
      throw fail('确认请求不属于这项目标的当前助理。', 403);
    if (message.card.skillRequest) this.runtime.capabilities.archiveNative('goal-skill-review');
    return this.runtime.api(this.runtime.current, 'POST', `/api/threads/${row.threadId}/respond`, body);
  }
}
