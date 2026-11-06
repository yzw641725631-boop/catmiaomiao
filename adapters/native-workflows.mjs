import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { writeFileAtomic } from '../upstream/OpenMausBot/server/atomic.ts';
import { captureFiles } from './work-evidence.mjs';
import { fail } from './endpoints.mjs';
import { createHash } from 'node:crypto';

export class NativeWorkflows {
  constructor(runtime) {
    this.runtime = runtime;
    this.file = join(runtime.rootDir, 'native-workflows.json');
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { version: 1, routines: [] };
    this.busy = false;
  }
  save() {
    mkdirSync(this.runtime.rootDir, { recursive: true });
    writeFileAtomic(this.file, JSON.stringify(this.data, null, 2) + '\n');
  }
  async snapshot() {
    const session = this.runtime.current;
    if (session?.mode !== 'live') return { routines: [], runs: [], available: false };
    const value = await this.runtime.api(session, 'GET', '/api/routines');
    const ids = new Set(this.data.routines.filter((row) => row.botId === session.chiefId).map((row) => row.id));
    const routines = value.routines.filter(
      (row) => ids.has(row.id) && row.botId === session.chiefId && row.target === 'bot' && row.runOn === 'maus',
    );
    return {
      available: true,
      routines,
      runs: value.runs
        .filter((row) => ids.has(row.routineId) && row.botId === session.chiefId && row.target === 'bot')
        .map((row) => ({
          ...row,
          workThreadId: session.workThreadIds.includes(row.threadId) ? row.threadId : undefined,
        })),
    };
  }
  async create(input) {
    if (this.busy) throw fail('例行工作正在保存，请稍后。', 409);
    const session = this.runtime.current,
      at = Date.parse(input?.at);
    if (session?.mode !== 'live') throw fail('先连接真实模型再创建例行工作。', 409);
    if (
      typeof input?.title !== 'string' ||
      !input.title.trim() ||
      input.title.length > 150 ||
      typeof input.task !== 'string' ||
      !input.task.trim() ||
      input.task.length > 5000 ||
      typeof input.at !== 'string' ||
      !/(?:Z|[+-]\d\d:\d\d)$/.test(input.at) ||
      !Number.isFinite(at) ||
      at < Date.now() - 60000 ||
      at > Date.now() + 5 * 366 * 86400000 ||
      !['once', 'daily'].includes(input.repeat) ||
      typeof input.continuity !== 'boolean'
    )
      throw fail('请填写名称、工作说明、带时区的时间和重复方式。');
    this.busy = true;
    try {
      const fingerprint = createHash('sha256')
        .update(JSON.stringify([input.title.trim(), input.task.trim(), input.at, input.repeat, input.continuity]))
        .digest('hex');
      const prior = this.data.routines.find((row) => row.botId === session.chiefId && row.fingerprint === fingerprint);
      if (prior) {
        const existing = (await this.snapshot()).routines.find((row) => row.id === prior.id);
        if (existing) return { routine: existing, reused: true };
      }
      const date = new Date(at),
        time = new Intl.DateTimeFormat('en-GB', {
          timeZone: 'Asia/Shanghai',
          hour: '2-digit',
          minute: '2-digit',
          hour12: false,
        }).format(date);
      const schedule =
        input.repeat === 'daily' ? { type: 'daily', time, weekdays: [0, 1, 2, 3, 4, 5, 6] } : { type: 'once', at };
      const prompt =
        input.task.trim() +
        '\n\n这是用户设置的例行工作，请现在实际执行。先读取实际可用工具。文件只保存到本次绑定的 workspace 目录，用 workspace_create_document / workspace_create_spreadsheet 生成真正的 Word / Excel，或用文本工具保存和校验。可把子任务交给同组小助理，目录与要求一起转交，收到结果再回报。需要用户授权就等待，不要把等待当作完成。' +
        (await this.runtime.capabilities.prompt());
      const { routine } = await this.runtime.api(session, 'POST', '/api/routines', {
        name: input.title.trim(),
        prompt,
        botId: session.chiefId,
        target: 'bot',
        runOn: 'maus',
        enabled: false,
        schedule,
        continuity: input.continuity,
        overlap: 'skip',
        runOnStartup: false,
        timeoutMinutes: 30,
        resultsThreadId: session.companionThreadId,
      });
      this.data.routines.push({
        id: routine.id,
        botId: session.chiefId,
        createdAt: Date.now(),
        task: input.task.trim(),
        fingerprint,
      });
      this.save();
      return this.runtime.api(session, 'PATCH', `/api/routines/${routine.id}`, { enabled: true });
    } finally {
      this.busy = false;
    }
  }
  async action(id, action) {
    if (!['pause', 'resume', 'run', 'cancel'].includes(action)) throw fail('例行动作无效。');
    const snapshot = await this.snapshot();
    const routine = snapshot.routines.find((row) => row.id === id);
    if (!routine) throw fail('这项例行工作不存在。', 404);
    if (action === 'pause' || action === 'resume')
      return this.runtime.api(this.runtime.current, 'PATCH', `/api/routines/${id}`, { enabled: action === 'resume' });
    if (action === 'run') return this.runtime.api(this.runtime.current, 'POST', `/api/routines/${id}/run`, {});
    const active = snapshot.runs.filter(
      (row) => row.routineId === id && ['queued', 'running', 'waiting'].includes(row.status),
    );
    for (const run of active)
      await this.runtime.api(this.runtime.current, 'POST', `/api/routine-runs/${run.id}/cancel`, {});
    return { cancelled: active.length };
  }
  async bind(session, botId, threadId, task) {
    if (session.mode !== 'live' || botId !== session.chiefId || !task || task.archivedAt) return null;
    const value = await this.runtime.api(session, 'GET', '/api/routines'),
      ids = new Set(this.data.routines.filter((row) => row.botId === botId).map((row) => row.id));
    const run = value.runs.find(
      (row) =>
        ids.has(row.routineId) &&
        row.botId === botId &&
        row.threadId === threadId &&
        row.target === 'bot' &&
        row.runOn === 'maus',
    );
    if (!run) return null;
    const folder = resolve(task.cwd || ''),
      id = basename(folder);
    if (!/^[a-f0-9-]{36}$/.test(id) || folder !== resolve(session.dataDir, 'companion-work', id) || !existsSync(folder))
      return null;
    let job = this.runtime.jobs.get(threadId);
    if (!job) {
      job = {
        threadId,
        folder,
        before: captureFiles(folder),
        tests: [],
        session,
        startedAt: run.startedAt || Date.now(),
        status: 'running',
        nativeRoutineId: run.routineId,
        nativeRunId: run.id,
      };
      this.runtime.jobs.set(threadId, job);
      if (!session.workThreadIds.includes(threadId)) session.workThreadIds.push(threadId);
      this.runtime.persistJob(job);
      this.runtime.persistSession(session);
      this.runtime.observeJob(job).catch((error) => {
        job.error = error.message;
        job.status = 'unverified';
      });
    }
    return this.runtime.jobScope(session, job);
  }
}
