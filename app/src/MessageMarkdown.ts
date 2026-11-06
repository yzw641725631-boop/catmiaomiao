import { createElement, Fragment, useState, type ReactNode } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { safeMessageUrl } from './projection.ts';

export function MessageMarkdown({ text, threadId, messageId }: { text: string; threadId?: string; messageId?: string }) {
  return createElement(ReactMarkdown, {
    remarkPlugins: [remarkGfm], urlTransform: safeMessageUrl, skipHtml: true,
    components: {
      img: () => createElement('span', null, '（图片见附件）'),
      table: ({ children }) => createElement('div', { className: 'markdown-table', role: 'region', 'aria-label': '表格，可横向滚动', tabIndex: 0 }, createElement('table', null, children)),
      a: ({ href, children }) => createElement(MessageLink, { href: href || '', threadId, messageId, children }),
    },
  }, text);
}
function MessageLink({ href, threadId, messageId, children }: { href: string; threadId?: string; messageId?: string; children: ReactNode }) {
  const [error, setError] = useState('');
  if (/^https?:\/\//i.test(href)) return createElement('a', { href, target: '_blank', rel: 'noopener noreferrer' }, children);
  if (!href || !threadId || !messageId || /^(javascript|data|vbscript):/i.test(href)) return createElement('span', null, children);
  return createElement(Fragment, null,
    createElement('button', { className: 'file-link', onClick: async () => {
      setError('');
      try {
        await downloadMessageFile(href, threadId, messageId);
      } catch (error) { setError(error instanceof Error ? error.message : '文件不可用'); }
    } }, children), error ? createElement('span', { className: 'feedback error' }, error) : null);
}
export async function downloadMessageFile(path: string, threadId: string, messageId: string) {
  const response = await fetch(`/api/threads/${threadId}/messages/${messageId}/file`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path }) });
  if (!response.ok) throw new Error('该文件暂时无法打开。');
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement('a'); link.href = url; link.download = path.split(/[\\/]/).at(-1) || '助理文件'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
