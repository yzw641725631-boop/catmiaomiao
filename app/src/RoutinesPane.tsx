import { useEffect, useState } from 'react';
import { CalendarClock, Check, Plus } from 'lucide-react';
import { post, request } from './api.ts';
interface Routine {
  id: string;
  name: string;
  enabled: boolean;
  nextRunAt: number | null;
  continuity?: boolean;
  schedule: { type: string; time?: string; at?: number };
}
interface Run {
  id: string;
  routineId: string;
  routineName: string;
  status: string;
  startedAt?: number;
  createdAt: number;
  output?: string;
  error?: string;
  attention?: string;
  workThreadId?: string;
}
interface Data {
  routines: Routine[];
  runs: Run[];
  available: boolean;
}
const states: Record<string, string> = {
  queued: '等待空闲',
  running: '正在执行',
  waiting: '等待处理',
  completed: '已结束',
  failed: '未完成',
  cancelled: '已停止',
  missed: '未执行',
};
export function RoutinesPane({
  busy,
  run,
}: {
  busy: boolean;
  run(action: () => Promise<unknown>, feedback?: string): Promise<void>;
}) {
  const [data, setData] = useState<Data>(),
    [adding, setAdding] = useState(false),
    [title, setTitle] = useState(''),
    [task, setTask] = useState(''),
    [at, setAt] = useState(''),
    [repeat, setRepeat] = useState<'once' | 'daily'>('daily'),
    [continuity, setContinuity] = useState(true),
    [error, setError] = useState('');
  const load = () => request<Data>('/companion/routines').then(setData);
  useEffect(() => {
    let live = true;
    const read = () =>
      void request<Data>('/companion/routines')
        .then((value) => {
          if (live) {
            setData(value);
            setError('');
          }
        })
        .catch((e) => live && setError(e.message));
    read();
    const timer = setInterval(read, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  const mutate = (action: () => Promise<unknown>, feedback: string) =>
    run(async () => {
      await action();
      await load();
    }, feedback);
  return (
    <div className="native-pane">
      <p className="native-intro">
        交给主助理按时处理，也可以接着上一次的结果继续。工作、等待确认和每次回复都会留下记录。
      </p>
      <p className="field-note">
        按本机时区（Asia/Shanghai）执行，助理服务需要保持运行。之前设置的提醒仍在“能力 → 提醒”保留。
      </p>
      {error && <p className="feedback error">{error}</p>}
      {data?.available && (
        <div className="native-pane-actions">
          <button className="secondary-button" disabled={busy} onClick={() => setAdding(!adding)}>
            <Plus size={15} />
            {adding ? '收起' : '新建例行工作'}
          </button>
        </div>
      )}
      {adding && (
        <form
          className="native-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(async () => {
              await post('/companion/routines', { title, task, at: new Date(at).toISOString(), repeat, continuity });
              setAdding(false);
              setTitle('');
              setTask('');
              setAt('');
            }, '例行工作已保存。');
          }}
        >
          <label>
            工作名称
            <input
              required
              maxLength={150}
              value={title}
              disabled={busy}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="每天整理研究资料"
            />
          </label>
          <label>
            要做什么
            <textarea
              required
              maxLength={5000}
              rows={4}
              disabled={busy}
              value={task}
              onChange={(event) => setTask(event.target.value)}
              placeholder="说明要处理的资料、输出格式和实际工具。"
            />
          </label>
          <label>
            时间
            <input
              type="datetime-local"
              required
              value={at}
              disabled={busy}
              onChange={(event) => setAt(event.target.value)}
            />
          </label>
          <label>
            重复
            <select value={repeat} disabled={busy} onChange={(event) => setRepeat(event.target.value as typeof repeat)}>
              <option value="daily">每天</option>
              <option value="once">仅一次</option>
            </select>
          </label>
          <label className="native-check">
            <input
              type="checkbox"
              checked={continuity}
              disabled={busy}
              onChange={(event) => setContinuity(event.target.checked)}
            />
            接着上一次已完成的报告继续
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? '正在保存…' : '保存例行工作'}
          </button>
        </form>
      )}
      {!data ? (
        <p className="field-note">正在读取例行工作…</p>
      ) : !data.available ? (
        <p className="field-note">连接真实模型后，可以让主助理按时工作。</p>
      ) : !data.routines.length ? (
        <div className="native-empty">
          <CalendarClock size={25} />
          <h3>把常做的事交给助理</h3>
          <p>设定时间和明确要求，结果回来后再继续讨论。</p>
        </div>
      ) : (
        <div className="native-list">
          {data.routines.map((routine) => {
            const latest = data.runs
              .filter((row) => row.routineId === routine.id)
              .sort((a, b) => b.createdAt - a.createdAt)[0];
            return (
              <article className="native-routine" key={routine.id}>
                <div className="native-section-heading">
                  <h3>{routine.name}</h3>
                  <span className="field-note">{routine.enabled ? '已开启' : '已暂停'}</span>
                </div>
                <p className="field-note">
                  {routine.schedule.type === 'daily' ? `每天 ${routine.schedule.time}` : '仅一次'} ·{' '}
                  {routine.nextRunAt ? `下次 ${new Date(routine.nextRunAt).toLocaleString('zh-CN')}` : '暂无下次运行'}
                  {routine.continuity ? ' · 保留上次报告' : ''}
                </p>
                <div className="native-pane-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () => post(`/companion/routines/${routine.id}/${routine.enabled ? 'pause' : 'resume'}`, {}),
                        routine.enabled ? '已暂停，历史仍保留。' : '已恢复例行工作。',
                      )
                    }
                  >
                    {routine.enabled ? '暂停' : '恢复'}
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void mutate(
                        () => post(`/companion/routines/${routine.id}/run`, {}),
                        '已加入原生执行队列，实际结果见下方记录。',
                      )
                    }
                  >
                    现在运行一次
                  </button>
                  {latest && ['running', 'waiting', 'queued'].includes(latest.status) && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void mutate(() => post(`/companion/routines/${routine.id}/cancel`, {}), '当前执行已停止。')
                      }
                    >
                      停止当前执行
                    </button>
                  )}
                </div>
                <details className="native-run-history">
                  <summary>
                    执行记录 {data.runs.filter((row) => row.routineId === routine.id).length} 次
                    {latest ? ` · ${states[latest.status] || latest.status}` : ''}
                  </summary>
                  {data.runs
                    .filter((row) => row.routineId === routine.id)
                    .sort((a, b) => b.createdAt - a.createdAt)
                    .map((row) => (
                      <div key={row.id}>
                        <p>
                          <Check size={13} /> {states[row.status] || row.status} ·{' '}
                          {new Date(row.startedAt || row.createdAt).toLocaleString('zh-CN')}
                        </p>
                        {(row.output || row.error || row.attention) && (
                          <pre>{row.output || row.error || row.attention}</pre>
                        )}
                        {row.workThreadId && <p className="field-note">文件与详细过程已收录到主界面的“工作”。</p>}
                      </div>
                    ))}
                </details>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
