import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Search, X } from 'lucide-react';
import { request } from './api.ts';

export type SearchHit = {
  threadId: string;
  messageId: string;
  at: number;
  role: string;
  snippet: string;
  matchStart: number;
  matchLength: number;
  where: 'chat' | 'work';
  workThreadId?: string;
  from: string;
  task?: string;
};

/** Search box and results inside the record card. Results come from /companion/search (this session's threads only). */
export function SearchPanel({ close, open }: { close: () => void; open: (hit: SearchHit) => void }) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const latest = useRef('');
  useEffect(() => input.current?.focus(), []);
  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!q) {
      setHits(null);
      setError('');
      return;
    }
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const result = await request<{ query: string; hits: SearchHit[] }>('/companion/search?q=' + encodeURIComponent(q));
        if (latest.current === q) {
          setHits(result.hits);
          setError('');
        }
      } catch (failure) {
        if (latest.current === q) setError(failure instanceof Error ? failure.message : '搜索没有完成，请再试一次。');
      } finally {
        if (latest.current === q) setLoading(false);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [query]);
  return (
    <div className="search-panel">
      <div className="search-row">
        <Search size={16} aria-hidden="true" />
        <input
          ref={input}
          type="search"
          aria-label="搜索对话和工作"
          placeholder="搜索对话和工作"
          value={query}
          maxLength={100}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              close();
            }
          }}
        />
        {loading && <LoaderCircle size={15} className="spin" aria-label="正在搜索" />}
        <button className="icon-button" aria-label="关闭搜索" onClick={close}>
          <X size={16} />
        </button>
      </div>
      {error && <p className="feedback error">{error}</p>}
      {hits && !hits.length && !loading && !error && <p className="search-empty">没有找到“{query.trim()}”。换个词试试。</p>}
      {hits && hits.length > 0 && (
        <ol className="search-results" aria-label="搜索结果">
          {hits.map((hit) => (
            <li key={hit.messageId}>
              <button onClick={() => open(hit)}>
                <span className="search-meta">
                  <strong>{hit.where === 'work' ? hit.task || '工作' : '对话'}</strong>
                  <span>{hit.from}</span>
                  <time>
                    {new Date(hit.at).toLocaleString('zh-CN', {
                      month: 'numeric',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </time>
                </span>
                <span className="search-snippet">
                  {hit.snippet.slice(0, hit.matchStart)}
                  <mark>{hit.snippet.slice(hit.matchStart, hit.matchStart + hit.matchLength)}</mark>
                  {hit.snippet.slice(hit.matchStart + hit.matchLength)}
                </span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {!hits && !error && <p className="search-empty">搜索你和助理说过的话，以及工作里的回复。</p>}
    </div>
  );
}
