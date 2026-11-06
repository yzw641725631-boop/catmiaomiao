import { useCallback, useEffect, useRef, useState } from 'react';
import { Bell, CheckCheck } from 'lucide-react';
import { post, request } from './api.ts';

export type NotificationItem = {
  source: 'native' | 'reminder';
  id: string;
  kind: string;
  title: string;
  body: string;
  from: string;
  at: number;
  read: boolean;
  threadId?: string;
  workThreadId?: string;
  where?: 'chat' | 'work';
};

/** Upstream writes some notification bodies in English; show them in Chinese. Unknown text passes through unchanged. */
export function notificationBody(body: string) {
  const text = body.trim();
  const results = /^Results in from (.+)$/.exec(text);
  if (results) return `${results[1].replace(/, /g, '、')} 已交回结果`;
  const waiting = /^(.*?):?\s*Waiting for your approval to use (.+)$/.exec(text);
  if (waiting) return `${waiting[1] ? waiting[1] + '：' : ''}等你同意使用 ${waiting[2]}`;
  if (/^.+ finished$/.test(text)) return '已完成';
  if (/已交回结果$/.test(text)) return text.replace(/, /g, '、');
  return text;
}

const SYSTEM_KEY = 'companion.system-notifications';
const systemAllowed = () => {
  try {
    return localStorage.getItem(SYSTEM_KEY) === 'true' && 'Notification' in window && Notification.permission === 'granted';
  } catch {
    return false;
  }
};

/** Bell in the top bar: upstream notifications for this team plus reminder events, with read state. */
export function NotificationCenter({ openItem }: { openItem: (item: NotificationItem) => void }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [system, setSystem] = useState(systemAllowed);
  const [note, setNote] = useState('');
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const seen = useRef<Set<string> | null>(null);

  const load = useCallback(async () => {
    const data = await request<{ notifications: NotificationItem[]; unread: number }>('/companion/notifications');
    setItems(data.notifications);
    setUnread(data.unread);
    const known = seen.current;
    seen.current = new Set(data.notifications.map((item) => item.source + item.id));
    // A system banner only for items that arrive while this page is open and hidden; never for the backlog.
    if (known && document.hidden && systemAllowed())
      for (const item of data.notifications.filter((row) => !row.read && !known.has(row.source + row.id)).slice(0, 3))
        new Notification(item.title, { body: notificationBody(item.body).slice(0, 160), tag: item.source + item.id });
  }, []);

  useEffect(() => {
    void load().catch(() => {});
    const timer = setInterval(() => void load().catch(() => {}), 10000);
    const onNotify = () => void load().catch(() => {});
    window.addEventListener('companion:notify', onNotify);
    return () => {
      clearInterval(timer);
      window.removeEventListener('companion:notify', onNotify);
    };
  }, [load]);

  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!panel.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const markRead = async (item: NotificationItem) => {
    if (item.read) return;
    await post(item.source === 'reminder' ? `/companion/notifications/${item.id}/read` : `/companion/notifications/native/${item.id}/read`, {});
    await load();
  };
  const toggleSystem = async () => {
    setNote('');
    if (system) {
      localStorage.setItem(SYSTEM_KEY, 'false');
      setSystem(false);
      return;
    }
    if (!('Notification' in window)) return setNote('这个浏览器不支持系统通知。');
    const permission = Notification.permission === 'default' ? await Notification.requestPermission() : Notification.permission;
    if (permission !== 'granted') return setNote('浏览器没有允许通知。可以在浏览器的网站设置里打开。');
    localStorage.setItem(SYSTEM_KEY, 'true');
    setSystem(true);
  };

  return (
    <div className="notification-center">
      <button
        ref={trigger}
        className="icon-button ambient notification-button"
        aria-label={unread ? `通知，${unread} 条未读` : '通知'}
        title="通知"
        aria-expanded={open}
        aria-controls="notification-panel"
        onClick={() => setOpen((value) => !value)}
      >
        <Bell size={19} />
        {unread > 0 && <span className="notification-count">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div
          id="notification-panel"
          className="notification-panel"
          role="dialog"
          aria-label="通知"
          ref={panel}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.stopPropagation();
              setOpen(false);
              trigger.current?.focus();
            }
          }}
        >
          <header>
            <strong>通知</strong>
            <button
              className="text-button"
              disabled={!unread}
              onClick={() => void post('/companion/notifications/read-all', {}).then(load)}
            >
              <CheckCheck size={14} />
              全部已读
            </button>
          </header>
          {items.length ? (
            <ol>
              {items.map((item) => (
                <li key={item.source + item.id} className={item.read ? '' : 'unread'}>
                  <button
                    onClick={() => {
                      void markRead(item).catch(() => {});
                      setOpen(false);
                      openItem(item);
                    }}
                  >
                    <span className="notification-meta">
                      <strong>{item.title}</strong>
                      <time>
                        {new Date(item.at).toLocaleString('zh-CN', {
                          month: 'numeric',
                          day: 'numeric',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </time>
                    </span>
                    <span className="notification-body">
                      {item.from} · {notificationBody(item.body)}
                    </span>
                  </button>
                </li>
              ))}
            </ol>
          ) : (
            <p className="notification-empty">还没有通知。助理完成工作、需要你确认，或提醒到时，会出现在这里。</p>
          )}
          <footer>
            <label className="notification-system">
              <input type="checkbox" checked={system} onChange={() => void toggleSystem()} />
              页面不在前台时，用系统通知提醒我
            </label>
            {note && <p className="field-note">{note}</p>}
          </footer>
        </div>
      )}
    </div>
  );
}
