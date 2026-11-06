import type { RefObject } from 'react';
import { AlertCircle, CheckCheck, ChevronDown, FileText, LoaderCircle, X } from 'lucide-react';
import type { WorkEvidence } from './types.ts';

type EvidenceDrawerProps = {
  dialogRef: RefObject<HTMLElement | null>;
  close: () => void;
  loading: boolean;
  error: string;
  evidence: WorkEvidence | null;
};

const diffClass = (line: string) =>
  line.startsWith('+') && !line.startsWith('+++')
    ? 'added'
    : line.startsWith('-') && !line.startsWith('---')
      ? 'removed'
      : '';

/** Modal with the captured file changes and check results of one piece of work. */
export function EvidenceDrawer({ dialogRef, close, loading, error, evidence }: EvidenceDrawerProps) {
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && close()}>
      <section
        className="evidence-drawer"
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="evidence-title"
      >
        <header className="drawer-header">
          <div>
            <span className="eyebrow">每一步，都有迹可循</span>
            <h2 id="evidence-title">工作明细</h2>
          </div>
          <button className="icon-button" aria-label="关闭工作明细" onClick={close}>
            <X size={20} />
          </button>
        </header>
        <div className="evidence-body">
          {loading && (
            <p className="loading-line">
              <LoaderCircle size={18} className="spin" />
              读取实际工作结果…
            </p>
          )}
          {error && <p className="feedback error">{error}</p>}
          {evidence && (
            <>
              <p className="field-note">{evidence.coverage}</p>
              {evidence.files.length === 0 && (
                <div className="empty-evidence">
                  <FileText size={26} />
                  <h3>暂未提供完整文件差异</h3>
                  <p>对话中的工作摘要仍可查看；只有实际捕获的差异才会显示在这里。</p>
                </div>
              )}
              {evidence.files.map((file) => (
                <details className="file-diff" key={file.path} open>
                  <summary>
                    <FileText size={16} />
                    <strong>{file.path}</strong>
                    <span>{file.status === 'added' ? '新增' : file.status === 'changed' ? '修改' : '删除'}</span>
                    <ChevronDown size={15} />
                  </summary>
                  <pre>
                    {file.diff.split('\n').map((line, i) => (
                      <span className={diffClass(line)} key={i}>
                        {line}
                        {'\n'}
                      </span>
                    ))}
                  </pre>
                </details>
              ))}
              <h3 className="evidence-section-title">验证记录</h3>
              {evidence.tests.length === 0 ? (
                <p className="field-note">尚无可验证的命令结果，不标记测试通过。</p>
              ) : (
                evidence.tests.map((test, index) => (
                  <details className="test-receipt" key={index}>
                    <summary>
                      {test.exitCode === 0 && test.current !== false ? (
                        <CheckCheck size={17} />
                      ) : (
                        <AlertCircle size={17} />
                      )}
                      <span>
                        {test.current === false
                          ? '文件已变化，需重新校验'
                          : test.exitCode === 0
                            ? '校验通过'
                            : '校验失败'}
                      </span>
                      <code>退出码 {test.exitCode}</code>
                      <ChevronDown size={15} />
                    </summary>
                    <code className="test-command">{test.command}</code>
                    <pre>
                      {test.stdout}
                      {test.stderr}
                    </pre>
                  </details>
                ))
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
