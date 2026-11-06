import { SPECIAL_KINDS } from './specialKinds.ts';
import type { CompanionInfo, WireBot, WireMessage, ServerFrame } from './types.ts';

export interface ConversationState {
  bots: Record<string, WireBot>;
  messages: Record<string, WireMessage[]>;
  streams: Record<string, { turnId: string; text: string }>;
}
export const emptyState = (): ConversationState => ({ bots: {}, messages: {}, streams: {} });

export function mergeMessage(list: WireMessage[], message: WireMessage): WireMessage[] {
  const position = list.findIndex(item => item.id === message.id);
  const next = position < 0 ? [...list, message] : list.map((item, i) => i === position ? message : item);
  return next.sort((a, b) => a.at - b.at || a.id.localeCompare(b.id));
}

export function applyFrame(state: ConversationState, frame: ServerFrame): ConversationState {
  if (frame.kind === 'bot') return { ...state, bots: { ...state.bots, [frame.bot.id]: frame.bot } };
  if (frame.kind === 'bot.deleted') {
    const bots = { ...state.bots }; delete bots[frame.botId]; return { ...state, bots };
  }
  if (frame.kind === 'message' || frame.kind === 'message.patch') {
    const streams = { ...state.streams };
    if (frame.message.role === 'bot' && frame.message.kind === 'text') delete streams[frame.threadId];
    return { ...state, streams, messages: { ...state.messages, [frame.threadId]: mergeMessage(state.messages[frame.threadId] ?? [], frame.message) } };
  }
  if (frame.kind === 'runtime') {
    const event = frame.event;
    if (event.type === 'content.delta' && event.streamKind === 'assistant_text') {
      const prior = state.streams[event.threadId];
      const turnId = event.turnId ?? '';
      const completed = (state.messages[event.threadId] ?? []).some(item => item.role === 'bot' && item.turnId === turnId && item.turnTerminal);
      if (completed) return state;
      return { ...state, streams: { ...state.streams, [event.threadId]: { turnId, text: (prior?.turnId === turnId ? prior.text : '') + event.delta } } };
    }
    if (event.type === 'turn.completed' || event.type === 'runtime.error') {
      const streams = { ...state.streams }; delete streams[event.threadId]; return { ...state, streams };
    }
  }
  return state;
}

export function displayMessages(messages: WireMessage[], steps = false): WireMessage[] {
  return messages.filter(item => (item.kind === 'text' && !item.aside && !item.roomRequest) || item.kind === 'options' || item.kind === 'digest' || SPECIAL_KINDS.has(item.kind) || item.kind === 'activity' && (steps || item.tool?.ok === false || isHelperQuestion(item)));
}

export function isHelperQuestion(message: WireMessage) { return message.kind === 'activity' && !!message.threadRef && !!message.tool?.name.includes(' needs your input: '); }
export function helperQuestionAnswered(message: WireMessage, state: ConversationState) { return !!message.threadRef && (state.messages[message.threadRef.threadId] ?? []).some(item => item.role === 'user' && item.at > message.at); }
export function helperQuestionExpired(message: WireMessage, state: ConversationState) { return !!message.threadRef && Object.values(state.messages).some(messages => messages.some(item => item.at > message.at && item.threadRef?.botId === message.threadRef!.botId && item.threadRef?.threadId === message.threadRef!.threadId && item.tool?.ok === false && /failed:.*(?:person did not answer|timed out|cancelled)|已过期|等待.*超时/i.test(item.tool.name))); }
export function helperQuestionPending(message: WireMessage, state: ConversationState) { return isHelperQuestion(message) && !helperQuestionAnswered(message, state) && !helperQuestionExpired(message, state); }

export function visibleMessageText(message: WireMessage): string {
  const text = message.text || '';
  if (message.role !== 'user' || !message.sendId) return text;
  // Hide only the adapter's known appended envelope; retain the native transcript.
  const marker = text.indexOf('\n\n[本地助理能力说明，');
  const visible=marker >= 0 && text.slice(marker).includes('你有 assistant 工具：') ? text.slice(0, marker) : text;
  const directory=visible.indexOf('\n\n本次工作唯一指定目录：');
  return directory>=0&&visible.slice(directory).includes('主助理与本次派遣的小助理都有绑定该目录的 workspace 文件工具。')?visible.slice(0,directory):visible;
}

export function conversationRows(info: Pick<CompanionInfo, 'chiefId' | 'helperIds' | 'companionThreadId' | 'workThreadIds'> | null, state: ConversationState) {
  if (!info) return [];
  const owners = new Map<string, { botId: string; name: string; workThreadId?: string }>();
  for (const threadId of [info.companionThreadId, ...info.workThreadIds]) owners.set(threadId, { botId: info.chiefId, name: state.bots[info.chiefId]?.name || '主助理', ...(threadId !== info.companionThreadId ? { workThreadId: threadId } : {}) });
  for (let depth = 0; depth < 16; depth++) {
    let changed = false;
    for (const botId of info.helperIds) for (const task of state.bots[botId]?.tasks ?? []) {
      if (owners.has(task.threadId) || !task.openedBy?.threadId) continue;
      const parent = owners.get(task.openedBy.threadId);
      if (!parent || parent.botId !== task.openedBy.botId) continue;
      owners.set(task.threadId, { botId, name: state.bots[botId].name, ...(parent.workThreadId ? { workThreadId: parent.workThreadId } : {}) }); changed = true;
    }
    if (!changed) break;
  }
  return [...owners].flatMap(([threadId, owner]) => displayMessages(state.messages[threadId] ?? [])
    .filter(message => owner.botId === info.chiefId || message.kind === 'options' || message.kind === 'secret' || message.kind === 'signin')
    .map(message => ({ threadId, message, ...owner })))
    .sort((a, b) => a.message.at - b.message.at || a.message.id.localeCompare(b.message.id));
}

export function taskLabel(task: { busy?: boolean; waitingForTeammates?: boolean; activity?: string; closedBy?: unknown }): string {
  if (task.activity === 'waiting-on-you') return '等待你确认';
  if (task.busy) return '正在处理';
  if (task.waitingForTeammates) return '等待小助理';
  if (task.closedBy) return '已结束';
  return '空闲';
}

export function speechText(text: string): string {
  return text.replace(/```[\s\S]*?```/g, '（代码见工作记录）').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*_>`]/g, '').trim();
}

export function captionText(text: string): string {
  const plain = speechText(text).replace(/\s+/g, ' ');
  return plain.length > 62 ? plain.slice(0, 61) + '…' : plain;
}

export function safeMessageUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || /^[a-z]:[\\/]/i.test(url)) return url;
  if (/^[a-z][a-z0-9+.-]*:/i.test(url) || url.startsWith('//')) return '';
  return url;
}
