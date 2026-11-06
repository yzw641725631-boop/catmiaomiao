import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, Bell, CheckCircle2, CircleDashed, Hand, RefreshCw, Sunrise, X } from 'lucide-react';
import { post, request } from './api.ts';

type Place = { threadId?: string; workThreadId?: string };
type TodayData = {
  since: number;
  needsYou: Array<Place & { id: string; at: number; title: string; text: string }>;
  works: Array<{ id: string; title: string; startedAt: number; supplements: number }>;
  reminders: Array<{ id: string; at: number; title: string; kind: string }>;
  results: Array<Place & { id: string; at: number; title: string; ok: boolean; from: string }>;
  brief: { enabled: boolean; time: string };
};

const time = (at: number) => new Date(at).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit' });

/** 今天：需要你的、进行中的工作、今天的提醒、交回的结果，加上可选的早间简报。 */
export function TodayDrawer({ close, openPlace, openReminders }: { close: () => void; openPlace: (place: Place) => void; openReminders: () => void }) {
  const dialog = useRef<HTMLElement>(null);
  const [data, setData] = useState<TodayData>();
  const [error, setError] = useState('');
  const [briefTime, setBriefTime] = useState('08:30');
  const [briefNote, setBriefNote] = useState('');
  const load = useCallback(async () => {
    setError('');
    try { const value = await request<TodayData>('/companion/today'); setData(value); setBriefTime(value.brief.time); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '暂时读不到今天的情况。'); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus(); };
  }, [close]);
  const setBrief = async (enabled: boolean) => {
    setBriefNote('');
    try {
      const brief = await post<TodayData['brief']>('/companion/brief', { enabled, time: briefTime });
      setData(current => (current ? { ...current, brief } : current));
      setBriefNote(enabled ? `每天 ${brief.time} 主助理会在对话里给你一段简报。` : '早间简报已关闭。');
    } catch (reason) { setBriefNote(reason instanceof Error ? reason.message : '没有保存成功。'); }
  };
  const go = (place: Place) => { openPlace(place); close(); };
  const empty = data && !data.needsYou.length && !data.works.length && !data.reminders.length && !data.results.length;
  return (
    <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && close()}>
      <section ref={dialog} className="status-drawer today-drawer" role="dialog" aria-modal="true" aria-labelledby="today-title" tabIndex={-1}>
        <header className="drawer-header status-drawer-header">
          <div><span className="eyebrow">需要你的、进行中的和交回的</span><h2 id="today-title">今天</h2></div>
          <button className="icon-button" aria-label="关闭今天" onClick={close}><X size={20} /></button>
        </header>
        <div className="status-drawer-body today-body">
          {error && <div className="status-error"><AlertCircle size={16} /><span>{error}</span><button className="text-button" onClick={() => void load()}><RefreshCw size={13} />重试</button></div>}
          {!data && !error && <p className="field-note">正在读取…</p>}
          {empty && <p className="today-empty">今天还没有需要你处理的事。有事可以直接跟主助理说。</p>}
          {!!data?.needsYou.length && (
            <section className="today-group" aria-labelledby="today-needs">
              <h3 id="today-needs"><Hand size={15} />需要你</h3>
              {data.needsYou.map(item => (
                <button key={item.id} className="today-row attention" onClick={() => go(item)}>
                  <strong>{item.title}</strong>{item.text && <span>{item.text}</span>}<time>{time(item.at)}</time>
                </button>
              ))}
            </section>
          )}
          {!!data?.works.length && (
            <section className="today-group" aria-labelledby="today-works">
              <h3 id="today-works"><CircleDashed size={15} />进行中</h3>
              {data.works.map(work => (
                <button key={work.id} className="today-row" onClick={() => go({ threadId: work.id, workThreadId: work.id })}>
                  <strong>{work.title || '一项工作'}</strong>{work.supplements > 0 && <span>补充过 {work.supplements} 次</span>}<time>{time(work.startedAt)} 开始</time>
                </button>
              ))}
            </section>
          )}
          {!!data?.reminders.length && (
            <section className="today-group" aria-labelledby="today-reminders">
              <h3 id="today-reminders"><Bell size={15} />今天的提醒</h3>
              {data.reminders.map(item => (
                <button key={item.id} className="today-row" onClick={() => { openReminders(); close(); }}>
                  <strong>{item.title}</strong><span>{item.kind === 'work' ? '到时发起后台工作' : '到时提醒你'}</span><time>{time(item.at)}</time>
                </button>
              ))}
            </section>
          )}
          {!!data?.results.length && (
            <section className="today-group" aria-labelledby="today-results">
              <h3 id="today-results"><CheckCircle2 size={15} />交回的结果</h3>
              {data.results.map(item => (
                <button key={item.id} className={`today-row ${item.ok ? '' : 'failed'}`} onClick={() => go(item)}>
                  <strong>{item.title || '一次回复'}</strong><span>{item.from}{item.ok ? '' : ' · 没有完成'}</span><time>{time(item.at)}</time>
                </button>
              ))}
            </section>
          )}
          {data && (
            <section className="today-group today-brief" aria-labelledby="today-brief">
              <h3 id="today-brief"><Sunrise size={15} />早间简报</h3>
              <p className="field-note">开启后，主助理每天在这个时间用几句话告诉你今天的情况。默认关闭。</p>
              <div className="today-brief-row">
                <label htmlFor="brief-time">时间</label>
                <input id="brief-time" type="time" value={briefTime} onChange={event => setBriefTime(event.target.value)} />
                {data.brief.enabled ? (
                  <><button className="secondary-button" onClick={() => void setBrief(true)}>改时间</button><button className="secondary-button" onClick={() => void setBrief(false)}>关闭</button></>
                ) : (
                  <button className="primary-button" onClick={() => void setBrief(true)}>开启早间简报</button>
                )}
              </div>
              {briefNote && <p className="feedback" role="status">{briefNote}</p>}
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
