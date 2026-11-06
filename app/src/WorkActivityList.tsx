import { type ReactNode } from 'react';
import { AlertCircle, Check, ChevronRight, Clock3, LoaderCircle } from 'lucide-react';
import { workExcerpt, workTitle, workEntries } from './work.ts';
import type { WireMessage } from './types.ts';

type Entry = ReturnType<typeof workEntries>[number];
export type ActivityFilter = 'all' | 'active' | 'attention' | 'done';
type Filter = ActivityFilter;
const category = (status: string): Filter =>
  /需要|等待你/.test(status)
    ? 'attention'
    : /正在|等待小/.test(status)
      ? 'active'
      : /已交付|已回复/.test(status)
        ? 'done'
        : 'all';
function day(at: number) {
  const date = new Date(at);
  return date.toLocaleDateString('zh-CN', { timeZone: 'Asia/Shanghai', month: 'long', day: 'numeric' });
}
export function WorkActivityList({
  entries,
  messages,
  status,
  open,
  attention,
  attentionCount = 0,
  filter,
  setFilter,
}: {
  entries: Entry[];
  messages: Record<string, WireMessage[]>;
  status(entry: Entry): string;
  open(id: string): void;
  attention?: ReactNode;
  attentionCount?: number;
  filter: Filter;
  setFilter(filter: Filter): void;
}) {
  const items = entries.map((entry) => ({ entry, status: status(entry) }));
  const visible = items.filter((item) => filter === 'all' || category(item.status) === filter);
  return (
    <section className="activity-list" aria-label="工作动态">
      <div className="activity-intro">
        <p>查看进展，打开一项工作阅读回复与成果。</p>
      </div>
      <nav className="activity-filters" aria-label="工作状态">
        {(
          [
            ['all', '全部'],
            ['active', '进行中'],
            ['attention', '需要我'],
            ['done', '已完成'],
          ] as const
        ).map(([id, label]) => (
          <button key={id} aria-pressed={filter === id} onClick={() => setFilter(id)}>
            {label}
            <span>{id === 'all' ? items.length : items.filter((item) => category(item.status) === id).length}</span>
          </button>
        ))}
      </nav>
      {attentionCount > 0 && (
        <details className="activity-attention">
          <summary>
            <AlertCircle size={15} />
            <span>{attentionCount} 项等待你处理</span>
            <ChevronRight size={14} />
          </summary>
          <div>{attention}</div>
        </details>
      )}
      {!visible.length && (
        <p className="activity-empty">
          {entries.length ? '这里暂时没有相应的工作。' : '把一件事交给助理，进展会留在这里。'}
        </p>
      )}
      <ol className="activity-rows">
        {visible.map(({ entry, status }, index) => {
          const prior = visible[index - 1],
            at = entry.task.updatedAt || entry.task.createdAt,
            current = category(status),
            failed = status === '未完成';
          return (
            <li key={entry.task.threadId}>
              {(!prior || day(prior.entry.task.createdAt) !== day(entry.task.createdAt)) && (
                <h3 className="activity-day">{day(entry.task.createdAt)}</h3>
              )}
              <button
                data-work-id={entry.task.threadId}
                className={`activity-open ${current} ${failed ? 'failed' : ''}`}
                onClick={() => open(entry.task.threadId)}
              >
                <span className="activity-symbol">
                  {current === 'active' ? (
                    <LoaderCircle size={17} className="spin" />
                  ) : current === 'attention' || failed ? (
                    <AlertCircle size={17} />
                  ) : current === 'done' ? (
                    <Check size={17} />
                  ) : (
                    <Clock3 size={17} />
                  )}
                </span>
                <span className="activity-copy">
                  <strong>{workTitle(entry.task, messages[entry.task.threadId] || [])}</strong>
                  <span className="activity-excerpt">
                    {workExcerpt(messages[entry.task.threadId] || []) ||
                      (current === 'attention'
                        ? '处理请求后，助理就能继续。'
                        : failed
                          ? '打开查看原因与执行记录。'
                          : current === 'active'
                            ? '助理正在整理，回复会留在这里。'
                            : '打开查看回复与已有成果。')}
                  </span>
                  <small>
                    {entry.name}
                    <i />
                    {status}
                    <time dateTime={new Date(at).toISOString()}>
                      {new Date(at).toLocaleTimeString('zh-CN', {
                        timeZone: 'Asia/Shanghai',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </time>
                  </small>
                </span>
                <ChevronRight size={14} className="activity-chevron" />
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
