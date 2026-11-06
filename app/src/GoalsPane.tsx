import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowLeft, ArrowUpRight, Plus, Square, Target } from 'lucide-react';
import { post, request } from './api.ts';
import { ArtifactPanel } from './ArtifactPanel.tsx';
import { MessageMarkdown } from './MessageMarkdown.ts';
import { visibleMessageText } from './projection.ts';
import type { WireMessage } from './types.ts';
import { DocumentPreview } from './WorkDetail.tsx';
export interface GoalRow {
  threadId: string;
  botId: string;
  name: string;
  message: WireMessage;
  workThreadId?: string;
}
interface Goal {
  id: string;
  title: string;
  goal: string;
  threadId: string;
  working: boolean;
  members: Array<{ id: string; name: string }>;
  goalRun?: { status: string; detail?: string; turnCount: number; maxTurns: number };
  messages?: WireMessage[];
  files?: Array<{ path: string; text: string; sha256: string }>;
}
interface Data {
  available: boolean;
  goals: Goal[];
}
const states: Record<string, string> = {
  working: '正在推进',
  completed: '本轮目标已完成',
  'needs-input': '需要你补充',
  blocked: '遇到阻碍',
  'limit-reached': '本轮已结束',
  paused: '已暂停',
  stopped: '已停止',
  failed: '本轮未完成',
};
export function GoalsPane({
  busy,
  run,
  renderRow,
}: {
  busy: boolean;
  run(action: () => Promise<unknown>, message?: string): Promise<void>;
  renderRow?: (row: GoalRow) => ReactNode;
}) {
  const [data, setData] = useState<Data>(),
    [selected, setSelected] = useState(''),
    [detail, setDetail] = useState<Goal>(),
    [adding, setAdding] = useState(false),
    [title, setTitle] = useState(''),
    [goal, setGoal] = useState(''),
    [text, setText] = useState(''),
    [error, setError] = useState(''),
    [steps, setSteps] = useState(false);
  const submission = useRef<{ key: string; id: string } | undefined>(undefined);
  const [preview, setPreview] = useState<{ path: string; after: string }>();
  const keyFor = (key: string) => {
    if (submission.current?.key !== key) submission.current = { key, id: crypto.randomUUID() };
    return submission.current.id;
  };
  const load = () => request<Data>('/companion/goals').then(setData);
  useEffect(() => {
    let live = true;
    const load = () =>
      void request<Data>('/companion/goals')
        .then((value) => {
          if (live) {
            setData(value);
            setError('');
          }
        })
        .catch((error) => live && setError(error.message));
    load();
    const timer = setInterval(load, 3000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  useEffect(() => {
    setDetail(undefined);
    setText('');
    if (!selected) return;
    let live = true;
    const load = () =>
      void request<Data>(`/companion/goals/${selected}`)
        .then((value) => live && setDetail(value.goals[0]))
        .catch((error) => live && setError(error.message));
    load();
    const timer = setInterval(load, 2000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [selected]);
  if (selected)
    return (
      <div className="goal-reading">
        <button className="work-back" onClick={() => setSelected('')}>
          <ArrowLeft size={14} />
          返回持续目标
        </button>
        {error && <p className="feedback error">{error}</p>}
        {detail ? (
          <>
            <div className="native-section-heading">
              <div>
                <span className="work-state">
                  {states[detail.goalRun?.status || ''] || (detail.working ? '正在推进' : '等待开始')}
                </span>
                <h2>{detail.title}</h2>
              </div>
              {(detail.working || detail.goalRun?.status === 'working') && (
                <button
                  className="text-button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () => post(`/companion/goals/${detail.id}/pause`, {}),
                      '已暂停当前推进，目标和结果仍保留。',
                    )
                  }
                >
                  <Square size={13} />
                  暂停
                </button>
              )}
            </div>
            <p className="native-intro">{detail.goal}</p>
            <p className="field-note">
              {detail.members.map((member) => member.name).join(' · ')}
              {detail.goalRun ? ` · 本轮 ${detail.goalRun.turnCount} 次协作` : ''}
            </p>
            {detail.goalRun?.detail && <p className="goal-progress">{detail.goalRun.detail}</p>}
            <ArtifactPanel threadId={detail.threadId} active={detail.working} />
            {!!detail.files?.length && (
              <section className="work-artifacts">
                <div className="section-label">目标文件</div>
                {detail.files.map((file) => (
                  <button
                    className="artifact-open"
                    key={file.path}
                    onClick={() => setPreview({ path: file.path, after: file.text })}
                  >
                    <strong>{file.path}</strong>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </section>
            )}
            {preview && (
              <DocumentPreview
                file={preview}
                evidence={{ threadId: detail.threadId, files: [], tests: [], coverage: '目标文件当前快照' }}
                close={() => setPreview(undefined)}
              />
            )}
            <div className="native-section-heading">
              <h3>推进记录</h3>
              <button className="text-button" aria-pressed={steps} onClick={() => setSteps(!steps)}>
                {steps ? '收起工具过程' : '查看工具过程'}
              </button>
            </div>
            <div className="goal-messages">
              {detail.messages
                ?.filter(
                  (message) =>
                    message.kind !== 'goal.run' &&
                    (steps ||
                      (message.kind !== 'activity' &&
                        message.kind !== 'digest' &&
                        !(
                          message.kind === 'options' &&
                          (message.card?.answered || message.card?.expired || message.card?.dismissed)
                        ))),
                )
                .map((message) => {
                  const member =
                    detail.members.find((member) => member.id === message.from?.botId) || detail.members[0];
                  const row = {
                    threadId: detail.threadId,
                    botId: member.id,
                    name: member.name,
                    message,
                    workThreadId: detail.threadId,
                  };
                  return renderRow ? (
                    <div key={message.id}>{renderRow(row)}</div>
                  ) : (
                    <article className="goal-message" key={message.id}>
                      <strong>{message.role === 'user' ? '你' : member.name}</strong>
                      <div className="message-content">
                        <MessageMarkdown text={visibleMessageText(message)} />
                      </div>
                    </article>
                  );
                })}
            </div>
            <form
              className="goal-followup native-form"
              onSubmit={(event) => {
                event.preventDefault();
                void run(
                  async () => {
                    await post(`/companion/goals/${detail.id}/send`, { text, sendId: keyFor(detail.id + ':' + text) });
                    setText('');
                    submission.current = undefined;
                  },
                  detail.working
                    ? '补充要求已排在当前这一步之后，结束后接着推进。'
                    : '补充要求已交给团队，会在原目标继续推进。',
                );
              }}
            >
              <label>
                补充要求，继续这项目标
                <textarea
                  required
                  rows={3}
                  disabled={busy}
                  value={text}
                  maxLength={6000}
                  onChange={(event) => setText(event.target.value)}
                  placeholder="说明下一步，或补充助理正在等的信息。"
                />
              </label>
              <button className="primary-button" disabled={busy}>
                {busy ? '正在提交…' : detail.working ? '排在这一步之后' : '继续推进'}
                <ArrowUpRight size={14} />
              </button>
            </form>
          </>
        ) : (
          <p className="field-note">正在读取目标与真实推进记录…</p>
        )}
      </div>
    );
  return (
    <div className="native-pane">
      <p className="native-intro">
        把需要反复推进的事情单独留在这里。主助理协调团队，每轮留下实际结果；你可以暂停、补充要求，之后继续同一目标。
      </p>
      {error && <p className="feedback error">{error}</p>}
      {data?.available && (
        <button className="secondary-button" disabled={busy} onClick={() => setAdding(!adding)}>
          <Plus size={15} />
          {adding ? '收起' : '建立持续目标'}
        </button>
      )}
      {adding && (
        <form
          className="native-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              const value = await post<{ id: string }>('/companion/goals', {
                title,
                goal,
                sendId: keyFor(title + ':' + goal),
              });
              await load();
              setTitle('');
              setGoal('');
              setAdding(false);
              setSelected(value.id);
              submission.current = undefined;
            }, '目标已交给原生团队协调，真实进度会保存在这里。');
          }}
        >
          <label>
            目标名称
            <input
              required
              maxLength={100}
              disabled={busy}
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="把个人资料整理成知识手册"
            />
          </label>
          <label>
            希望做到什么
            <textarea
              required
              rows={5}
              disabled={busy}
              maxLength={6000}
              value={goal}
              onChange={(event) => setGoal(event.target.value)}
              placeholder="写清完成条件、可用资料和你希望的结果。"
            />
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? '正在建立…' : '建立并开始推进'}
          </button>
        </form>
      )}
      {!data ? (
        <p className="field-note">正在读取目标…</p>
      ) : !data.available ? (
        <p className="field-note">连接真实模型后可以开始团队目标。</p>
      ) : !data.goals.length ? (
        <div className="native-empty">
          <Target size={25} />
          <h3>留一件值得持续做的事</h3>
          <p>资料整理、研究计划或分阶段的创作，都可以从明确的一步开始。</p>
        </div>
      ) : (
        <div className="goal-index">
          {data.goals.map((goal) => (
            <button key={goal.id} className="goal-index-row" onClick={() => setSelected(goal.id)}>
              <div>
                <span className="field-note">
                  {states[goal.goalRun?.status || ''] || (goal.working ? '正在推进' : '等待开始')}
                </span>
                <h3>{goal.title}</h3>
                <p>{goal.goal}</p>
                <small>{goal.members.map((member) => member.name).join(' · ')}</small>
              </div>
              <ArrowUpRight size={17} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
