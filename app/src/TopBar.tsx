import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { BookOpen, Focus, Layers2, Maximize2, Ellipsis, Plug, Settings2, Sun, WifiOff } from 'lucide-react';
import type { CompanionInfo } from './types.ts';

type TopBarProps = {
  info: CompanionInfo | null;
  connected: boolean;
  unseenEvents: boolean;
  openServices: () => void;
  openGoals: () => void;
  openSkills: () => void;
  openStatus: () => void;
  openToday: () => void;
  openMemory: () => void;
  fullScreen: () => void;
  openSettings: () => void;
  /** Shown left of 更多 (the notification bell). */
  extra?: ReactNode;
};

/** Room name on the left; one 更多 menu on the right with abilities, goals, skills, connection, memory, full screen and settings. */
export function TopBar(props: TopBarProps) {
  const { info, connected, unseenEvents } = props;
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const connection = !info ? '连接中' : info.mode === 'fixture' ? '本地演示' : info.verificationLabel || '已连接';

  const close = (refocus = true) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };
  const items = () => [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') || [])];

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    const outside = (event: PointerEvent) => {
      const target = event.target as Node;
      if (!menu.current?.contains(target) && !trigger.current?.contains(target)) setOpen(false);
    };
    document.addEventListener('pointerdown', outside);
    return () => document.removeEventListener('pointerdown', outside);
  }, [open]);

  const onMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
    } else if (event.key === 'Tab') {
      setOpen(false);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      list[(index + step + list.length) % list.length]?.focus();
    } else if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      list[event.key === 'Home' ? 0 : list.length - 1]?.focus();
    }
  };
  const choose = (action: () => void) => () => {
    close(false);
    action();
  };

  return (
    <header className="topbar">
      <div className="identity">
        <span className="identity-symbol" aria-hidden="true">
          <i />
          <i />
        </span>
        <strong>我的助理</strong>
        <span className="identity-divider" />
        <span className="room-name">私人书房</span>
      </div>
      <div className="top-actions">
        {props.extra}
        <button
          ref={trigger}
          className="icon-button ambient top-menu-button"
          aria-label="更多"
          title="更多"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls="top-menu"
          onClick={() => (open ? close() : setOpen(true))}
        >
          <Ellipsis size={20} />
          {(unseenEvents || !connected) && <span className={`top-menu-dot ${!connected ? 'offline' : ''}`} />}
        </button>
        {open && (
          <div id="top-menu" className="top-menu" role="menu" aria-label="更多" ref={menu} onKeyDown={onMenuKey}>
            <button role="menuitem" className="top-menu-item" onClick={choose(props.openToday)}>
              <Sun size={16} />
              今天
            </button>
            <button role="menuitem" className="top-menu-item" onClick={choose(props.openServices)}>
              <Layers2 size={16} />
              能力{unseenEvents && <span className="service-dot" />}
            </button>
            <button role="menuitem" className="top-menu-item" onClick={choose(props.openGoals)}>
              <Focus size={16} />
              目标
            </button>
            <button role="menuitem" className="top-menu-item native-trigger" onClick={choose(props.openSkills)}>
              <Plug size={16} />
              技能与工具
            </button>
            <button role="menuitem" className="top-menu-item" onClick={choose(props.openMemory)} aria-label="打开记忆">
              <BookOpen size={16} />
              记忆
            </button>
            <button role="menuitem" className="top-menu-item" onClick={choose(props.fullScreen)} aria-label="切换全屏">
              <Maximize2 size={16} />
              全屏
            </button>
            <button role="menuitem" className="top-menu-item" onClick={choose(props.openSettings)} aria-label="打开设置">
              <Settings2 size={16} />
              设置
            </button>
            <span className="top-menu-rule" role="separator" />
            <button
              role="menuitem"
              className={`top-menu-item connection-label ${!connected ? 'disconnected' : ''}`}
              onClick={choose(props.openStatus)}
              title="查看系统状态"
            >
              {!connected ? <WifiOff size={13} /> : <span className="connection-dot" />}
              {connection}
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
