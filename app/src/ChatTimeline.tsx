import type { ComponentProps } from 'react';
import { ChevronRight, LoaderCircle, MessageCircle } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown.ts';
import { ConversationFeed } from './ConversationFeed.tsx';

type ChatTimelineProps = {
  hasOlder: boolean;
  loadingHistory: boolean;
  loadOlder: () => void;
  empty: boolean;
  busyCount: number;
  openWork: () => void;
  rows: ComponentProps<typeof ConversationFeed>['rows'];
  renderRow: ComponentProps<typeof ConversationFeed>['render'];
  streamText?: string;
  chiefName?: string;
  chatBusy: boolean;
};

/** Conversation tab of the record panel: older-history button, empty state, messages and the live reply. */
export function ChatTimeline(props: ChatTimelineProps) {
  const { busyCount, streamText } = props;
  return (
    <>
      {props.hasOlder && (
        <button className="older-messages" disabled={props.loadingHistory} onClick={props.loadOlder}>
          {props.loadingHistory ? '正在读取…' : '查看更早记录'}
        </button>
      )}
      {props.empty && (
        <div className="empty-conversation">
          <MessageCircle size={28} strokeWidth={1.2} />
          <h2>从一句话开始</h2>
          <p>聊聊今天，或把一件事交给我。</p>
          <span>对话和工作都会留在这里</span>
        </div>
      )}
      {busyCount > 0 && (
        <button className="conversation-work-link" onClick={props.openWork}>
          <LoaderCircle size={13} className="spin" />
          <span>{busyCount} 项工作在后台进行</span>
          <ChevronRight size={13} />
        </button>
      )}
      <ConversationFeed rows={props.rows} render={props.renderRow} />
      {streamText && (
        <div className="message assistant streaming">
          <div className="message-avatar">
            <span />
          </div>
          <div className="message-main">
            <strong>{props.chiefName || '主助理'}</strong>
            <div className="message-content">
              <MessageMarkdown text={streamText} />
              <i className="text-caret" />
            </div>
          </div>
        </div>
      )}
      {props.chatBusy && !streamText && (
        <div className="thinking-line">
          <span />
          <span />
          <span />
          <small>正在回应你</small>
        </div>
      )}
    </>
  );
}
