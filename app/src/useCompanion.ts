import { useCallback, useEffect, useRef, useState } from 'react';
import type { CompanionInfo, ConversationSettings, ConversationSettingsPatch, ServerFrame, WireBot, WireMessage } from './types.ts';
import { request, post } from './api.ts';
import { applyFrame, emptyState, mergeMessage } from './projection.ts';
import type { SpecialistDraft } from './TeamDrawer.tsx';
import {imagePrompt,type ImageDraft} from './imageAttachments.tsx';

export function useCompanion() {
  const [info, setInfo] = useState<CompanionInfo | null>(null);
  const [state, setState] = useState(emptyState);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState('');
  const busySend = useRef(false);
  const infoRef = useRef(info); infoRef.current = info;
  const pendingSend = useRef<{ text: string; kind: string; sendId: string; inputSource: 'voice' | 'text'; replyToId?: string } | null>(null);
  const refreshSerial = useRef(0);
  const snapshot = useRef<{ serial: number; frames: ServerFrame[] } | null>(null);
  const [historyMore, setHistoryMore] = useState<Record<string, boolean>>({});
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [retrying, setRetrying] = useState<string[]>([]);
  const [retryAvailable, setRetryAvailable] = useState(false);
  const retrySendIds = useRef(new Map<string, string>());
  const stateRef = useRef(state); stateRef.current = state;

  const applySettings = useCallback((settings: ConversationSettings) => {
    setInfo(previous => {
      if (!previous || (previous.interaction?.revision ?? -1) > settings.revision) return previous;
      const next = { ...previous, interaction: settings,
        ...(previous.provider === 'reachai' && settings.voice.provider === 'reachai' ? { reachai: { ...previous.reachai, speed: settings.voice.speechRate, voice: settings.voice.voiceId } } : {}) };
      infoRef.current = next; return next;
    });
  }, []);
  const updateSettings = async (patch: ConversationSettingsPatch) => {
    const receipt = await post<{ saved: boolean; settings: ConversationSettings }>('/companion/settings/conversation', patch);
    applySettings(receipt.settings); return receipt.settings;
  };

  const refresh = useCallback(async () => {
    const serial = ++refreshSerial.current;
    snapshot.current = { serial, frames: [] };
    try {
    const nextInfo = await request<CompanionInfo>('/companion/info');
    const data = await request<{ bots: WireBot[] }>('/api/bots');
    const selected = data.bots.filter(bot => [nextInfo.chiefId, ...nextInfo.helperIds].includes(bot.id));
    const threadIds = [...new Set([nextInfo.companionThreadId, ...nextInfo.workThreadIds, ...selected.flatMap(bot => (bot.tasks ?? []).filter(task => task.openedBy).map(task => task.threadId))])];
    const histories = await Promise.all(threadIds.map(async threadId => {
      const page = await request<{ messages: WireMessage[]; hasMore?: boolean }>(`/api/threads/${threadId}/messages?limit=100`);
      return [threadId, page] as const;
    }));
    if (serial !== refreshSerial.current) return;
    if (infoRef.current?.sessionId === nextInfo.sessionId && (infoRef.current.interaction?.revision ?? -1) > (nextInfo.interaction?.revision ?? -1)) {
      nextInfo.interaction = infoRef.current.interaction;
      if (nextInfo.provider === 'reachai' && nextInfo.interaction?.voice.provider === 'reachai') nextInfo.reachai = { ...nextInfo.reachai, speed: nextInfo.interaction.voice.speechRate, voice: nextInfo.interaction.voice.voiceId };
    }
    setInfo(nextInfo); infoRef.current = nextInfo;
    const frames = snapshot.current?.serial === serial ? snapshot.current.frames : [];
    setHistoryMore(Object.fromEntries(histories.map(([threadId, page]) => [threadId, !!page.hasMore])));
    setState(() => frames.reduce(applyFrame, { bots: Object.fromEntries(selected.map(bot => [bot.id, bot])), messages: Object.fromEntries(histories.map(([threadId, page]) => [threadId, page.messages])), streams: {} }));
    } finally { if (snapshot.current?.serial === serial) snapshot.current = null; }
  }, []);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    const connect = async () => {
      try { await refresh(); }
      catch (error) { if (active) { setError(error instanceof Error ? error.message : '正在重新连接本地助理。'); timer = setTimeout(connect, 1500); } }
    };
    void connect();
    return () => { active = false; clearTimeout(timer); refreshSerial.current++; };
  }, [refresh]);

  useEffect(() => {
    if (!info) return;
    let alive = true;
    let reconnectTimer: ReturnType<typeof window.setTimeout> | undefined;
    let rosterTimer: ReturnType<typeof window.setTimeout> | undefined;
    const seen = new Set<string>();
    const stream = new EventSource('/api/events?screens=off');
    stream.onopen = () => {
      if (!alive) return;
      window.clearTimeout(reconnectTimer); reconnectTimer = undefined;
      setConnected(true);
    };
    stream.onerror = () => {
      if (!alive) return;
      setConnected(false);
      if (reconnectTimer !== undefined) return;
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = undefined;
        // A restarted local server rotates its HttpOnly capability. Renew it through /companion/info
        // before EventSource can reconnect, retaining the existing messages and the input draft.
        if (alive) refresh().catch(() => {});
      }, 1000);
    };
    stream.onmessage = event => {
      if (!alive) return;
      let frame: ServerFrame | { kind: 'hello'; resumed: boolean } | { kind: 'ping' };
      try { frame = JSON.parse(event.data); } catch { return; }
      if (frame.kind === 'hello' && !frame.resumed) {
        refresh().catch(error => alive && setError(error.message)); return;
      }
      if (frame.kind === 'ping' || frame.kind === 'hello') return;
      // The notification center listens for this to refresh without polling faster.
      if (frame.kind === 'notify') { window.dispatchEvent(new CustomEvent('companion:notify', { detail: frame.notification })); return; }
      if((frame.kind==='routine'||frame.kind==='routine.run')&&rosterTimer===undefined)rosterTimer=window.setTimeout(()=>{rosterTimer=undefined;if(alive)void refresh().catch(()=>{});},400);
      if (frame.kind === 'bot' && infoRef.current && ![infoRef.current.chiefId, ...infoRef.current.helperIds].includes(frame.bot.id) && rosterTimer === undefined) rosterTimer = window.setTimeout(() => { rosterTimer = undefined; if (alive) void refresh().catch(() => {}); }, 120);
      if (event.lastEventId) {
        if (seen.has(event.lastEventId)) return;
        seen.add(event.lastEventId);
        if (seen.size > 1500) seen.delete(seen.values().next().value!);
      }
      if (snapshot.current) snapshot.current.frames.push(frame);
      setState(previous => applyFrame(previous, frame));
    };
    return () => { alive = false; window.clearTimeout(reconnectTimer); window.clearTimeout(rosterTimer); stream.close(); setConnected(false); };
  }, [info?.sessionId, refresh]);

  useEffect(() => {
    if (!info) return;
    const stream = new EventSource('/companion/settings/events');
    stream.onmessage = event => {
      try { const settings: ConversationSettings = JSON.parse(event.data); if (Number.isSafeInteger(settings.revision) && settings.preferences && settings.voice) applySettings(settings); } catch {}
    };
    return () => stream.close();
  }, [info?.sessionId, applySettings]);

  useEffect(() => {
    if (!info) return;
    // Repair a dropped message patch without discarding drafts or resending a turn.
    const timer = setInterval(() => void refresh().catch(() => {}), 15000);
    return () => clearInterval(timer);
  }, [info?.sessionId, refresh]);

  const send = async (text: string, kind: 'chat' | 'work', onSending?: (sendId: string) => void,images:ImageDraft[]=[],inputSource:'voice'|'text'='text', replyToId?: string) => {
    if (kind !== 'chat') replyToId = undefined;
    if(images.length)text=imagePrompt(text,images);
    if (busySend.current || !infoRef.current) return false;
    busySend.current = true; setSending(true); setError(''); setNotice(''); setRetryAvailable(false);
    const old = pendingSend.current;
    const submission = old?.text === text && old.kind === kind && old.inputSource === inputSource && old.replyToId === replyToId ? old : { text, kind, inputSource, sendId: crypto.randomUUID().replaceAll('-', ''), ...(replyToId ? { replyToId } : {}) };
    pendingSend.current = submission;
    onSending?.(submission.sendId);
    try {
      const receipt = await post<{ threadId: string; queued?: boolean; steered?: boolean; info: CompanionInfo }>('/companion/send', submission);
      setInfo(receipt.info); infoRef.current = receipt.info;
      setNotice(receipt.queued ? '消息已排队，助理空闲后会继续。' : receipt.steered ? '已补充到正在进行的回复。' : kind === 'work' ? '任务已交给主助理安排，你可以继续聊天。' : '');
      pendingSend.current = null;
      setRetryAvailable(false);
      try { await refresh(); } catch { setNotice('消息已接受，记录正在重新同步。请勿重复发送。'); }
      return true;
    } catch (error) {
      setError(error instanceof Error ? error.message : '消息未发送，内容已保留。');
      setRetryAvailable(true);
      return false;
    } finally { busySend.current = false; setSending(false); }
  };

  const retryLastSend = async () => {
    const pending = pendingSend.current;
    if (!pending || busySend.current) return false;
    return send(pending.text, pending.kind as 'chat' | 'work', undefined, [], pending.inputSource, pending.replyToId);
  };

  const stopTask = async (botId: string, threadId: string) => {
    try { await post(`/api/bots/${botId}/interrupt`, { threadId }); await refresh(); setNotice('已停止所选任务。'); }
    catch (error) { setError(error instanceof Error ? error.message : '停止失败，请重试。'); }
  };
  const createSpecialist = async (input: SpecialistDraft) => {
    const receipt = await post<{ botId: string; name: string; info: CompanionInfo }>('/companion/team/specialists', input);
    setInfo(receipt.info); infoRef.current = receipt.info;
    await refresh();
    return { botId: receipt.botId, name: receipt.name };
  };
  const renameAssistant = async (botId: string, name: string) => {
    const receipt = await post<{ botId: string; name: string }>('/companion/team/rename', { botId, name });
    await refresh();
    return receipt;
  };
  const respond = async (botId: string, threadId: string, requestId: string, behavior: string, message?: string, reviewedSha256?: string) => {
    await post(`/api/bots/${botId}/respond`, { threadId, requestId, behavior, message, ...(reviewedSha256?{reviewedSha256}:{}) }); await refresh();
  };
  const replyToHelper = async (threadId: string, questionId: string, text: string, sendId: string) => {
    await post(`/companion/work/${threadId}/reply`, { questionId, text, sendId }); await refresh();
  };
  const additionIds = useRef(new Map<string, string>());
  /** Send a follow-up to work already handed off; returns what happened to it. */
  const addToWork = async (threadId: string, text: string) => {
    const key = threadId + '\n' + text;
    const sendId = additionIds.current.get(key) || crypto.randomUUID(); additionIds.current.set(key, sendId);
    const receipt = await post<{ delivery: 'steered' | 'queued' | 'started' }>(`/companion/work/${threadId}/add`, { text, sendId });
    additionIds.current.delete(key); await refresh();
    return { steered: '已补充，正在进行的这一步会用上。', queued: '已补充，排在当前这一步之后。', started: '已补充，主助理接着处理。' }[receipt.delivery];
  };
  /** 👍/👎 answer the reply (a turn starts or queues); the others are noted for the next turn. */
  const react = async (messageId: string, emoji: string, on?: boolean) => {
    const result = await post<{ delivery: string }>(`/companion/messages/${messageId}/reactions`, { emoji, ...(on === undefined ? {} : { on }) });
    setNotice(result.delivery === 'started' || result.delivery === 'queued' ? '已把回应交给主助理。' : on === false ? '已取消回应。' : '');
    await refresh();
  };
  const retryWork = async (threadId: string) => {
    if (retrying.includes(threadId)) return;
    const sendId = retrySendIds.current.get(threadId) || crypto.randomUUID(); retrySendIds.current.set(threadId, sendId);
    setRetrying(previous => [...previous, threadId]);
    try {
      await post(`/companion/work/${threadId}/retry`, { sendId });
      retrySendIds.current.delete(threadId); await refresh(); setNotice('已继续原任务，之前的失败记录保留。');
    } catch (error) { setError(error instanceof Error ? error.message : '重试未完成，请稍后再试。'); }
    finally { setRetrying(previous => previous.filter(id => id !== threadId)); }
  };
  const loadOlder = async () => {
    if (loadingHistory) return;
    setLoadingHistory(true);
    try {
      for (const threadId of Object.keys(historyMore).filter(id => historyMore[id])) {
        const first = stateRef.current.messages[threadId]?.[0];
        if (!first) continue;
        const page = await request<{ messages: WireMessage[]; hasMore?: boolean }>(`/api/threads/${threadId}/messages?limit=100&before=${encodeURIComponent(first.id)}`);
        setState(previous => ({ ...previous, messages: { ...previous.messages, [threadId]: page.messages.reduce(mergeMessage, previous.messages[threadId] ?? []) } }));
        setHistoryMore(previous => ({ ...previous, [threadId]: !!page.hasMore }));
      }
    } catch (error) { setError(error instanceof Error ? error.message : '更早记录读取失败。'); }
    finally { setLoadingHistory(false); }
  };
  return { info, state, connected, error, setError, sending, notice, setNotice, refresh, send, retryLastSend, retryAvailable, createSpecialist, renameAssistant, updateSettings, stopTask, respond, replyToHelper, retryWork, addToWork, react, retrying, loadOlder, hasOlder: Object.values(historyMore).some(Boolean), loadingHistory };
}
