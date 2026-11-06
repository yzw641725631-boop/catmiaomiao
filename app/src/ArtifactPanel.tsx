import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUpRight, Check, Download, FileText, Sheet, X } from 'lucide-react';
import { post, request } from './api.ts';
interface Artifact {
  path: string;
  sha256: string;
  bytes: number;
  kind: 'document' | 'spreadsheet';
  title: string;
  current: boolean;
  check: string;
  text?: string;
  sheets?: Array<{ name: string; rows: Array<Array<string | number | boolean | null>> }>;
}
export function ArtifactPanel({ threadId, active }: { threadId: string; active: boolean }) {
  const [files, setFiles] = useState<Artifact[]>([]),
    [preview, setPreview] = useState<Artifact>(),
    [error, setError] = useState('');
  useEffect(() => {
    let live = true;
    const load = () =>
      void request<{ artifacts: Artifact[] }>(`/companion/work/${threadId}/artifacts`)
        .then((data) => live && setFiles(data.artifacts))
        .catch(() => {});
    load();
    const timer = active ? setInterval(load, 3000) : undefined;
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [threadId, active]);
  return (
    <>
      {files.length > 0 && (
        <section className="work-artifacts">
          <div className="section-label">
            文档与表格 <span>{files.length}</span>
          </div>
          {files.map((file) => (
            <button
              key={file.path}
              className="artifact-open"
              disabled={!file.current}
              onClick={() =>
                void post<Artifact>(`/companion/work/${threadId}/artifacts/preview`, {
                  path: file.path,
                  sha256: file.sha256,
                })
                  .then(setPreview)
                  .catch((e) => setError(e.message))
              }
            >
              <span className="artifact-file-icon">
                {file.kind === 'document' ? <FileText size={22} /> : <Sheet size={22} />}
              </span>
              <span>
                <strong>{file.title}</strong>
                <small>
                  {file.path} · {file.current ? '已生成并重新读取校验' : '文件已变化，请重新生成'}
                </small>
              </span>
              <ArrowUpRight size={16} />
            </button>
          ))}
        </section>
      )}
      {error && <p className="feedback error">{error}</p>}
      {preview && <ArtifactReader file={preview} threadId={threadId} close={() => setPreview(undefined)} />}
    </>
  );
}
function ArtifactReader({ file, threadId, close }: { file: Artifact; threadId: string; close(): void }) {
  const dialog = useRef<HTMLElement>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, [busy]);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopImmediatePropagation();
        close();
      }
      if (event.key === 'Tab') {
        const controls = [
          ...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],[tabindex="0"]') || []),
        ];
        if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) {
          event.preventDefault();
          controls.at(-1)?.focus();
        } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
          event.preventDefault();
          controls[0]?.focus();
        }
      }
    };
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('keydown', key, true);
      prior?.focus();
    };
  }, []);
  async function download() {
    setBusy(true);
    setError('');
    try {
      const response = await fetch(`/companion/work/${threadId}/artifacts/download`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: file.path, sha256: file.sha256 }),
      });
      if (!response.ok) throw new Error('文件已变化或下载失败，请重新打开。');
      const url = URL.createObjectURL(await response.blob()),
        link = document.createElement('a');
      link.href = url;
      link.download = file.path.split(/[\\/]/).at(-1)!;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(e instanceof Error ? e.message : '下载失败。');
    } finally {
      setBusy(false);
    }
  }
  return createPortal(
    <div className="document-backdrop" onClick={(event) => event.target === event.currentTarget && close()}>
      <section
        ref={dialog}
        className="document-preview artifact-reader"
        role="dialog"
        aria-modal="true"
        aria-label={file.title}
        tabIndex={-1}
      >
        <header>
          <div>
            <span>{file.kind === 'document' ? 'Word 文档' : 'Excel 表格'}</span>
            <h2>
              {file.kind === 'document' ? <FileText size={19} /> : <Sheet size={19} />} {file.title}
            </h2>
          </div>
          <div>
            <button className="document-download" disabled={busy} onClick={() => void download()}>
              <Download size={16} />
              {busy ? '正在下载…' : '下载原文件'}
            </button>
            <button className="icon-button" aria-label="关闭成果预览" onClick={close}>
              <X size={19} />
            </button>
          </div>
        </header>
        <div className="document-toolbar">
          <span>
            <Check size={13} />
            生成后已重新读取校验
          </span>
          <span>
            {file.bytes.toLocaleString()} 字节 · {file.path}
          </span>
        </div>
        {error && <p className="feedback error">{error}</p>}
        {file.kind === 'document' ? (
          <article className="document-page artifact-text">
            {file.text
              ?.split(/\n\s*\n/)
              .filter(Boolean)
              .map((paragraph, index) =>
                index === 0 ? <h1 key={index}>{paragraph}</h1> : <p key={index}>{paragraph}</p>,
              )}
          </article>
        ) : (
          <div className="artifact-workbook">
            {file.sheets?.map((sheet) => (
              <section key={sheet.name}>
                <h3>{sheet.name}</h3>
                <div
                  className="artifact-table-scroll"
                  role="region"
                  aria-label={`${sheet.name} 表格，可横向滚动`}
                  tabIndex={0}
                >
                  <table>
                    <thead>
                      <tr>
                        {sheet.rows[0]?.map((value, index) => (
                          <th key={index} scope="col">
                            {String(value ?? '')}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {sheet.rows.slice(1).map((row, index) => (
                        <tr key={index}>
                          {row.map((value, column) => (
                            <td key={column}>
                              {typeof value === 'boolean' ? (value ? '是' : '否') : String(value ?? '')}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="field-note">
                  内容来自实际 Excel 文件；保留全部 {Math.max(0, sheet.rows.length - 1)} 行。
                </p>
              </section>
            ))}
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
