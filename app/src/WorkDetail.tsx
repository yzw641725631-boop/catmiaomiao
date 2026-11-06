import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowLeft,
  ArrowUpRight,
  ChevronDown,
  Download,
  FileText,
  Check,
  ListTree,
  MessageSquare,
  Square,
  X,
  Globe2,
  Monitor,
} from 'lucide-react';
import { request } from './api.ts';
import { MessageMarkdown, downloadMessageFile } from './MessageMarkdown.ts';
import { artifactSource, workEntries, workReplies, workRows, workTitle } from './work.ts';
import type { EvidenceChange, WorkEvidence } from './types.ts';
import { ArtifactPanel } from './ArtifactPanel.tsx';
import { ConversationFeed } from './ConversationFeed.tsx';

type Entry = ReturnType<typeof workEntries>[number];
type Row = ReturnType<typeof workRows>[number];
export function WorkDetail({
  entry,
  rows,
  questions,
  status,
  back,
  stop,
  retry,
  inspect,
  openFolders,
  renderRow,
  openSurface,
  addToWork,
}: {
  entry: Entry;
  rows: Row[];
  questions: Row[];
  status: string;
  back(): void;
  stop(): void;
  retry?: () => void;
  inspect(): void;
  openFolders(): void;
  renderRow(row: Row): ReactNode;
  openSurface?(kind: 'browser' | 'computer', botId: string): void;
  addToWork?(text: string): Promise<string>;
}) {
  const [view, setView] = useState<'result' | 'steps'>('result');
  const [evidence, setEvidence] = useState<WorkEvidence>();
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<EvidenceChange | null>(null);
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    if (!entry.evidence) return;
    let live = true;
    const load = () =>
      void request<WorkEvidence>(`/companion/work/${entry.task.threadId}/evidence`)
        .then((data) => {
          if (live) {
            setEvidence(data);
            setError('');
          }
        })
        .catch(() => {
          if (live) setError('文件暂未同步，点击重新读取。');
        });
    load();
    const timer = status === '正在处理' || status === '等待小助理' ? setInterval(load, 3000) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [entry.task.threadId, entry.evidence, status, revision]);
  const replies = workReplies(rows),
    helpers = replies.filter((row) => row.botId !== entry.botId),
    primary = replies.find((row) => row.botId === entry.botId);
  const documentTitle = evidence?.files.length === 1 ? /^#\s+([^\n]+)$/m.exec(evidence.files[0].after)?.[1] : undefined;
  const title =
    documentTitle ||
    workTitle(
      entry.task,
      rows.filter((row) => row.threadId === entry.task.threadId).map((row) => row.message),
    );
  const receiptLabels: Record<string, string> = {
    assistant_folder_read: '已阅读文档',
    assistant_web_read: '已阅读来源',
    workspace_write_file: '已保存文件',
    workspace_check_file: '已校验',
    workspace_create_document: 'Word 已生成并校验',
    workspace_create_spreadsheet: 'Excel 已生成并校验',
  };
  const receipts = [
    ...new Set(
      rows
        .filter((row) => row.message.tool?.ok === true)
        .map((row) => receiptLabels[row.message.tool!.name])
        .filter(Boolean),
    ),
  ];
  const sourceFor = (file: EvidenceChange) => artifactSource(replies, file.path);
  return (
    <div className="work-reading">
      <button className="work-back" onClick={back}>
        <ArrowLeft size={14} />
        工作动态<span>/</span>详情
      </button>
      <div className="work-detail-heading">
        <span
          className={`work-state state-${status === '未完成' ? 'failed' : status.includes('等待') || status === '需要补充' ? 'waiting' : 'normal'}`}
        >
          {status}
        </span>
        <h2>{title}</h2>
        <div className="work-detail-actions">
          {(entry.task.busy || entry.task.waitingForTeammates) && (
            <button onClick={stop}>
              <Square size={12} />
              停止
            </button>
          )}
          {retry && (
            <button onClick={retry}>
              继续原任务
              <ArrowUpRight size={13} />
            </button>
          )}
        </div>
      </div>
      <p className="work-detail-owner">
        {entry.name}
        <span>·</span>
        {new Date(entry.task.createdAt).toLocaleString('zh-CN', {
          timeZone: 'Asia/Shanghai',
          month: 'long',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })}
      </p>
      <nav className="result-tabs" aria-label="工作内容">
        <button aria-pressed={view === 'result'} onClick={() => setView('result')}>
          <MessageSquare size={15} />
          回复与成果
        </button>
        <button aria-pressed={view === 'steps'} onClick={() => setView('steps')}>
          <ListTree size={15} />
          执行过程<span>{rows.filter((row) => row.message.kind === 'activity').length}</span>
        </button>
      </nav>
      {openSurface && (
        <div className="native-actions">
          {[
            ...new Set(rows.filter((row) => row.message.tool?.name?.startsWith('browser_')).map((row) => row.botId)),
          ].map((botId) => (
            <button className="text-button" key={'browser' + botId} onClick={() => openSurface('browser', botId)}>
              <Globe2 size={14} />
              查看工作网页
              <ArrowUpRight size={13} />
            </button>
          ))}
          {[
            ...new Set(rows.filter((row) => row.message.tool?.name?.startsWith('computer_')).map((row) => row.botId)),
          ].map((botId) => (
            <button className="text-button" key={'computer' + botId} onClick={() => openSurface('computer', botId)}>
              <Monitor size={14} />
              查看电脑工作
              <ArrowUpRight size={13} />
            </button>
          ))}
        </div>
      )}
      {questions.length > 0 && (
        <section className="work-needs-input">
          <span>{questions.some((row) => row.message.kind === 'options') ? '需要你确认' : '需要你补充'}</span>
          <p>
            {questions.some((row) => row.message.kind === 'options')
              ? '处理下面的请求后，助理才能继续这项工作。'
              : '小助理正在等待你的补充说明。'}
          </p>
          {questions.map(renderRow)}
          {questions.some((row) => /目录|文件夹|桌面/.test(row.message.tool?.name || '')) && (
            <button className="secondary-button" onClick={openFolders}>
              接入要处理的文件夹
              <ArrowUpRight size={14} />
            </button>
          )}
        </section>
      )}
      {view === 'result' ? (
        <>
          <ArtifactPanel
            threadId={entry.task.threadId}
            active={Boolean(entry.task.busy || entry.task.waitingForTeammates)}
          />
          {evidence?.files.length ? (
            <section className="work-artifacts">
              <div className="section-label">
                交付文件 <span>{evidence.files.length}</span>
              </div>
              {evidence.files.map((file) => (
                <button className="artifact-open" key={file.path} onClick={() => setPreview(file)}>
                  <span className="artifact-file-icon">
                    <FileText size={22} />
                  </span>
                  <span>
                    <strong>{file.path}</strong>
                    <small>
                      {evidence.tests.some(
                        (test) => test.path === file.path && test.exitCode === 0 && test.current !== false,
                      ) ? (
                        <>
                          <Check size={12} />
                          已校验
                        </>
                      ) : (
                        '已捕获文件'
                      )}{' '}
                      · 点击阅读
                    </small>
                  </span>
                  <ArrowUpRight size={16} />
                </button>
              ))}
            </section>
          ) : null}
          {error && (
            <button className="text-button" onClick={() => setRevision((value) => value + 1)}>
              {error}
            </button>
          )}
          {!!receipts.length && (
            <p className="receipt-sentence">
              <Check size={13} />
              {receipts.join(' · ')}
            </p>
          )}
          {helpers.map((row) => (
            <section className="helper-result" key={row.message.id}>
              <div className="result-author">
                <span className="author-monogram">{row.name.slice(0, 1)}</span>
                <div>
                  <strong>{row.name}</strong>
                  <small>这位小助理的实际回复</small>
                </div>
                <time>
                  {new Date(row.message.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                </time>
              </div>
              {row.message.text!.length > 900 ? (
                <>
                  <div className="message-content">
                    <MessageMarkdown
                      text={row.message.text!.split(/\n\s*\n/)[0]}
                      threadId={row.threadId}
                      messageId={row.message.id}
                    />
                  </div>
                  <details className="complete-helper-reply">
                    <summary>
                      阅读完整回复
                      <ChevronDown size={13} />
                    </summary>
                    <div className="message-content">
                      <MessageMarkdown text={row.message.text!} threadId={row.threadId} messageId={row.message.id} />
                    </div>
                  </details>
                </>
              ) : (
                <div className="message-content">
                  <MessageMarkdown text={row.message.text!} threadId={row.threadId} messageId={row.message.id} />
                </div>
              )}
            </section>
          ))}
          {primary &&
            (helpers.length ? (
              <details className="chief-summary">
                <summary>
                  主助理的汇总
                  <ChevronDown size={14} />
                </summary>
                {renderRow(primary)}
              </details>
            ) : (
              <section className="helper-result">
                <div className="result-author">
                  <span className="author-monogram">{primary.name.slice(0, 1)}</span>
                  <div>
                    <strong>{primary.name}</strong>
                    <small>助理的实际回复</small>
                  </div>
                </div>
                <div className="message-content">
                  <MessageMarkdown
                    text={primary.message.text!}
                    threadId={primary.threadId}
                    messageId={primary.message.id}
                  />
                </div>
              </section>
            ))}
          {!replies.length && !questions.length && (
            <p className="result-empty">
              {entry.task.busy
                ? '助理正在处理，回复和文件会出现在这里。'
                : '还没有收到助理回复，可以打开执行过程查看进度。'}
            </p>
          )}
          {entry.evidence && (
            <button className="inspect-link" onClick={inspect}>
              查看文件差异与校验记录
              <ArrowUpRight size={14} />
            </button>
          )}
        </>
      ) : (
        <div className="work-process">
          <ConversationFeed rows={rows} render={renderRow} showDates={false} />
        </div>
      )}
      {addToWork && <WorkAddition key={entry.task.threadId} addToWork={addToWork} />}
      {preview && evidence && (
        <DocumentPreview
          file={preview}
          evidence={evidence}
          source={sourceFor(preview)}
          close={() => setPreview(null)}
        />
      )}
    </div>
  );
}

/** Follow-up box under a work: the text goes to this work, not to a new task. */
function WorkAddition({ addToWork }: { addToWork(text: string): Promise<string> }) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<{ ok: boolean; text: string }>();
  const submit = async () => {
    if (sending || !text.trim()) return;
    setSending(true);
    setNote(undefined);
    try {
      setNote({ ok: true, text: await addToWork(text.trim()) });
      setText('');
    } catch (error) {
      setNote({ ok: false, text: error instanceof Error ? error.message : '补充没有送达，请再试一次。' });
    } finally {
      setSending(false);
    }
  };
  return (
    <form
      className="work-addition"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="work-addition-text">补充到这项工作</label>
      <div className="work-addition-row">
        <textarea
          id="work-addition-text"
          rows={2}
          maxLength={10000}
          value={text}
          placeholder="比如：再加一段总结"
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
        />
        <button className="primary-button" disabled={sending || !text.trim()}>
          {sending ? '正在补充…' : '补充'}
        </button>
      </div>
      {note && (
        <p className={`feedback${note.ok ? '' : ' error'}`} role="status">
          {note.text}
        </p>
      )}
    </form>
  );
}

export function DocumentPreview({
  file,
  evidence,
  source,
  close,
}: {
  file: Pick<EvidenceChange, 'path' | 'after'>;
  evidence: WorkEvidence;
  source?: Row & { downloadPath: string };
  close(): void;
}) {
  const dialog = useRef<HTMLElement>(null),
    [error, setError] = useState('');
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const keys = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        close();
      }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') || [])];
      if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };
    document.addEventListener('keydown', keys, true);
    return () => {
      document.removeEventListener('keydown', keys, true);
      prior?.focus();
    };
  }, []);
  const current = evidence.tests.some(
    (test) => test.path === file.path && test.exitCode === 0 && test.current !== false,
  );
  return createPortal(
    <div className="document-backdrop" onClick={(event) => event.target === event.currentTarget && close()}>
      <section
        ref={dialog}
        className="document-preview"
        role="dialog"
        aria-modal="true"
        aria-label={`阅读 ${file.path}`}
        tabIndex={-1}
      >
        <header>
          <div>
            <span>助理交付的文件</span>
            <h2>
              <FileText size={19} />
              {file.path}
            </h2>
          </div>
          <div>
            {source && (
              <button
                className="document-download"
                onClick={() =>
                  void downloadMessageFile(source.downloadPath, source.threadId, source.message.id).catch(() =>
                    setError('下载暂未完成，请稍后再试。'),
                  )
                }
              >
                <Download size={16} />
                下载
              </button>
            )}
            <button className="icon-button" aria-label="关闭文档预览" onClick={close}>
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="document-toolbar">
          <span>
            {current ? (
              <>
                <Check size={13} />
                校验通过
              </>
            ) : (
              '文件快照'
            )}
          </span>
          <span>来自本次工作 · {new TextEncoder().encode(file.after).length.toLocaleString()} 字节</span>
        </div>
        {error && <p className="feedback error">{error}</p>}
        <article className="document-page message-content">
          {/\.(?:md|markdown)$/i.test(file.path) ? (
            <MessageMarkdown text={file.after} threadId={source?.threadId} messageId={source?.message.id} />
          ) : (
            <pre>{file.after}</pre>
          )}
        </article>
      </section>
    </div>,
    document.body,
  );
}
