import type { ReactNode, RefObject } from 'react';
import { ArrowDown, BookOpen, Expand, MessageCircle, Minus, Pencil, Search, WifiOff } from 'lucide-react';
import type { CompanionInfo } from './types.ts';

type TimelinePanelProps = {
  info: CompanionInfo | null;
  connected: boolean;
  expanded: boolean;
  toggleExpanded: () => void;
  collapse: () => void;
  tab: 'all' | 'work';
  setTab: (tab: 'all' | 'work') => void;
  chiefName?: string;
  openTeam: () => void;
  chatBusy: boolean;
  recording: boolean;
  jobCount: number;
  pendingCount: number;
  openPending: () => void;
  feedRef: RefObject<HTMLDivElement | null>;
  feedContentRef: RefObject<HTMLDivElement | null>;
  markFeedInput: () => void;
  onFeedScroll: () => void;
  newMessages: number;
  jumpToNew: () => void;
  refresh: () => void;
  openMemory: () => void;
  /** The search panel, when open; it replaces the feed. */
  search?: ReactNode;
  openSearch: () => void;
  children: ReactNode;
};

/** The floating record panel: heading, conversation/activity tabs, scrolling feed and footer. */
export function TimelinePanel(props: TimelinePanelProps) {
  const { info, connected, expanded, tab, chiefName, chatBusy, recording, markFeedInput } = props;
  return (
    <section className={`timeline-panel ${expanded ? 'expanded' : ''}`} aria-label="对话与工作记录">
      <div className="timeline-heading">
        <div className="chat-window-identity">
          <span className="chat-window-avatar">
            <MessageCircle size={18} />
          </span>
          <div>
            <h1>
              {tab === 'all' ? (
                <button
                  className="chat-identity-name"
                  onClick={props.openTeam}
                  aria-label={`修改${chiefName || '主助理'}的名字`}
                >
                  {chiefName || '主助理'}
                  <Pencil size={13} />
                </button>
              ) : (
                '助理动态'
              )}
            </h1>
            <p>
              <span className={`status-dot ${connected ? 'online' : ''}`} />
              {!connected
                ? '正在重连'
                : chatBusy && tab === 'all'
                  ? recording
                    ? '在处理，也在听你说'
                    : '正在处理，可以继续发消息'
                  : tab === 'all'
                    ? '随时可以和我聊'
                    : '小助理的回复与交付'}
            </p>
          </div>
        </div>
        <div className="timeline-actions">
          <button
            className="icon-button"
            onClick={props.openSearch}
            title="搜索对话和工作"
            aria-label="搜索对话和工作"
            aria-pressed={!!props.search}
          >
            <Search size={16} />
          </button>
          <button
            className="icon-button"
            onClick={props.toggleExpanded}
            title={expanded ? '恢复面板宽度' : '展开工作台'}
            aria-label={expanded ? '恢复面板宽度' : '展开工作台'}
          >
            <Expand size={16} />
          </button>
          <button className="icon-button" onClick={props.collapse} title="收起记录" aria-label="收起记录">
            <Minus size={18} />
          </button>
        </div>
      </div>
      <nav className="timeline-tabs" aria-label="记录筛选">
        <button
          className={tab === 'all' ? 'selected' : ''}
          onClick={() => props.setTab('all')}
          aria-pressed={tab === 'all'}
        >
          对话
        </button>
        <button
          className={tab === 'work' ? 'selected' : ''}
          onClick={() => props.setTab('work')}
          aria-pressed={tab === 'work'}
        >
          动态{props.jobCount > 0 && <span>{props.jobCount}</span>}
        </button>
        {props.pendingCount > 0 ? (
          <button className="pending-link" onClick={props.openPending}>
            待处理 {props.pendingCount}
          </button>
        ) : (
          <span className="today-label">
            {new Date().toLocaleDateString('zh-CN', { month: 'long', day: 'numeric' })}
          </span>
        )}
      </nav>
      {!connected && (
        <div className="connection-warning">
          <WifiOff size={14} />
          正在重新连接，已有记录仍保留。
        </div>
      )}
      {props.search}
      <div
        hidden={!!props.search}
        className="timeline-feed"
        ref={props.feedRef}
        onWheel={markFeedInput}
        onTouchMove={markFeedInput}
        onPointerDown={markFeedInput}
        onPointerMove={(event) => {
          if (event.buttons) markFeedInput();
        }}
        onKeyDown={markFeedInput}
        onScroll={props.onFeedScroll}
      >
        <div className="timeline-content" ref={props.feedContentRef}>
          {props.children}
        </div>
      </div>
      {props.newMessages > 0 && tab === 'all' && (
        <button className="new-messages" onClick={props.jumpToNew}>
          <ArrowDown size={14} />
          {props.newMessages} 条新记录
        </button>
      )}
      <footer className="timeline-footer">
        <span className={`status-dot ${connected ? 'online' : ''}`} />
        {info?.mode === 'fixture' ? '隔离演示' : connected ? '已连接 · 记录保存在本地' : '等待连接'}
        <button onClick={props.refresh}>同步记录</button>
        <button onClick={props.openMemory}>
          记忆
          <BookOpen size={12} />
        </button>
      </footer>
    </section>
  );
}
