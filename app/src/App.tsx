import { useCallback, useEffect, useRef, useState } from 'react';
import { lazyNamed } from './lazyNamed.tsx';
import { AlertCircle, Bell, ChevronRight, Focus, Layers2, MessageCircle } from 'lucide-react';
import { MessageMarkdown } from './MessageMarkdown.ts';
import { useCompanion } from './useCompanion.ts';
import {
  conversationRows,
  helperQuestionAnswered,
  helperQuestionExpired,
  helperQuestionPending,
  isHelperQuestion,
  visibleMessageText,
} from './projection.ts';
import { SearchPanel, type SearchHit } from './SearchPanel.tsx';
import { NotificationCenter, type NotificationItem } from './NotificationCenter.tsx';
import type { AssistantServicesData, ConversationSettingsPatch, WorkEvidence } from './types.ts';
import { request } from './api.ts';
import { workAttention, workEntries, workRows, workStatus as jobStatus } from './work.ts';
import { WorkDetail } from './WorkDetail.tsx';
import type { CapabilityBot } from './NativeHub.tsx';
import { uploadAttachment, type ImageDraft } from './imageAttachments.tsx';
import { WorkActivityList, type ActivityFilter } from './WorkActivityList.tsx';
import { ChatMessage } from './ChatMessage.tsx';
import { TopBar } from './TopBar.tsx';
import { TimelinePanel } from './TimelinePanel.tsx';
import { ChatTimeline } from './ChatTimeline.tsx';
import { TeamDock } from './TeamDock.tsx';
import { ActivityLine, Caption, activityFor, captionFor } from './Caption.tsx';
import { Composer, ComposerFeedback } from './Composer.tsx';
import { EvidenceDrawer } from './EvidenceDrawer.tsx';
import { useOverlays } from './useOverlays.ts';
import { useVoice, type VoiceRuntime } from './useVoice.ts';

// Drawers and full-screen views are not on the first screen: load each on first open.
const Settings = lazyNamed(() => import('./Settings.tsx'), 'Settings');
const ServicesDrawer = lazyNamed(() => import('./ServicesDrawer.tsx'), 'ServicesDrawer');
const TeamDrawer = lazyNamed(() => import('./TeamDrawer.tsx'), 'TeamDrawer');
const TodayDrawer = lazyNamed(() => import('./TodayDrawer.tsx'), 'TodayDrawer');
const NativeHub = lazyNamed(() => import('./NativeHub.tsx'), 'NativeHub');
const NativeBrowserView = lazyNamed(() => import('./NativeViews.tsx'), 'NativeBrowserView');
const NativeComputerView = lazyNamed(() => import('./NativeViews.tsx'), 'NativeComputerView');
const SystemStatusDrawer = lazyNamed(() => import('./SystemStatusDrawer.tsx'), 'SystemStatusDrawer');

function readPreference(key: string, fallback: boolean) {
  try {
    const value = localStorage.getItem(key);
    return value === null ? fallback : value === 'true';
  } catch {
    return fallback;
  }
}

export function App() {
  const backend = useCompanion();
  const { info, state, connected, sending } = backend;
  const [draft, setDraft] = useState(() => {
    try {
      return sessionStorage.getItem('companion.draft') || '';
    } catch {
      return '';
    }
  });
  const [kind, setKind] = useState<'chat' | 'work'>('chat');
  const [replyTo, setReplyTo] = useState<{ id: string; name: string; text: string } | null>(null);
  const [searching, setSearching] = useState(false);
  const [images, setImages] = useState<ImageDraft[]>([]);
  const [imageUploading, setImageUploading] = useState(false);
  const imagesRef = useRef(images);
  imagesRef.current = images;
  const [pure, setPure] = useState(false);
  const [panel, setPanel] = useState(() => innerWidth >= 1100 && innerHeight >= 600);
  const [tab, setTab] = useState<'all' | 'work'>('all');
  const overlays = useOverlays();
  const { settings, setSettings, statusOpen, setStatusOpen, servicesTab, setServicesTab } = overlays;
  const { teamOpen, setTeamOpen, nativeOpen, setNativeOpen, surface, setSurface } = overlays;
  const [servicesData, setServicesData] = useState<AssistantServicesData>();
  const [selectedWork, setSelectedWork] = useState<string | null>(null);
  const [activityFilter, setActivityFilter] = useState<ActivityFilter>('all');
  const [expanded, setExpanded] = useState(false);
  const [reduced, setReduced] = useState(() =>
    readPreference('companion.reduced-motion', matchMedia('(prefers-reduced-motion: reduce)').matches),
  );
  const [autoRead, setAutoRead] = useState(() => readPreference('companion.auto-read', false));
  const saveSettings = (patch: ConversationSettingsPatch) => {
    void backend
      .updateSettings(patch)
      .catch((error) => backend.setError(error instanceof Error ? error.message : '偏好未能保存，请重试。'));
  };
  const changePure = (value: boolean) => {
    if (value !== pure) saveSettings({ pureView: value });
  };
  const terminalSeen = useRef(new Set<string>());
  const [pinned, setPinned] = useState(true);
  const [newMessages, setNewMessages] = useState(0);
  const feed = useRef<HTMLDivElement>(null);
  const feedContent = useRef<HTMLDivElement>(null);
  const followPinned = useRef(pinned);
  followPinned.current = pinned;
  const feedInputUntil = useRef(0);
  const workScroll = useRef(0);
  const workOpener = useRef<string | undefined>(undefined);
  const selectWork = (id: string | null) => {
    if (id) {
      workScroll.current = feed.current?.scrollTop || 0;
      workOpener.current = id;
    }
    setSelectedWork(id);
  };
  const markFeedInput = () => {
    feedInputUntil.current = performance.now() + 2000;
  };
  const composer = useRef<HTMLTextAreaElement>(null);
  const renderedIds = useRef(new Set<string>());
  const baseline = useRef(false);
  const lastSession = useRef('');
  const [activeEvidence, setActiveEvidence] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<WorkEvidence | null>(null);
  const [evidenceError, setEvidenceError] = useState('');
  const [evidenceLoading, setEvidenceLoading] = useState(false);
  const evidenceDialog = useRef<HTMLElement>(null);
  const voiceRuntime = useRef<VoiceRuntime>({ backend, kind, info, settings: !!settings });
  voiceRuntime.current = { backend, kind, info, settings: !!settings };
  const refreshServices = useCallback(async () => {
    const data = await request<AssistantServicesData>('/companion/services');
    setServicesData(data);
    const current = voiceRuntime.current.info;
    if (current && data.workThreadIds.join() !== current.workThreadIds.join())
      await voiceRuntime.current.backend.refresh();
  }, []);
  useEffect(() => {
    if (!info) return;
    let alive = true;
    const update = () => {
      if (alive) void refreshServices().catch(() => {});
    };
    update();
    const timer = setInterval(update, 4000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [info?.sessionId, refreshServices]);
  const voice = useVoice({
    runtime: voiceRuntime,
    imagesRef,
    backend,
    info,
    connected,
    sending,
    settings,
    setSettings,
    setPinned,
    setPanel,
    setTab,
    setSelectedWork,
    setImages,
    setKind,
    setDraft,
  });
  const { playback, speaker, micState, elapsed, micLevel, voicePhase, voiceSession, voiceOwnership } = voice;
  const { interimSpeech, record, cancelRecording, play } = voice;

  useEffect(() => {
    try {
      sessionStorage.setItem('companion.draft', draft);
    } catch {}
  }, [draft]);
  useEffect(() => {
    try {
      localStorage.setItem('companion.reduced-motion', String(reduced));
    } catch {}
  }, [reduced]);
  useEffect(() => {
    try {
      localStorage.setItem('companion.auto-read', String(autoRead));
    } catch {}
  }, [autoRead]);
  useEffect(() => {
    const preferences = info?.interaction?.preferences;
    if (typeof preferences?.readReplies === 'boolean') setAutoRead(preferences.readReplies);
    if (typeof preferences?.reducedMotion === 'boolean') setReduced(preferences.reducedMotion);
    if (typeof preferences?.pureView === 'boolean') setPure(preferences.pureView);
  }, [info?.interaction?.revision]);
  useEffect(() => {
    if (!activeEvidence) return;
    const previous = document.activeElement as HTMLElement | null;
    evidenceDialog.current?.focus();
    const trap = (event: KeyboardEvent) => {
      if (event.key !== 'Tab') return;
      const controls = [
        ...(evidenceDialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),summary,a[href]') ?? []),
      ];
      if (
        event.shiftKey &&
        (document.activeElement === controls[0] || document.activeElement === evidenceDialog.current)
      ) {
        event.preventDefault();
        controls.at(-1)?.focus();
      } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
        event.preventDefault();
        controls[0]?.focus();
      }
    };
    document.addEventListener('keydown', trap);
    return () => {
      document.removeEventListener('keydown', trap);
      previous?.focus();
    };
  }, [activeEvidence]);

  const chief = info ? state.bots[info.chiefId] : undefined;
  const rows = conversationRows(info, state);
  const entries = workEntries(info, state);
  const jobs = entries.map((entry) => entry.task);
  const chatRows = rows.filter((row) => row.threadId === info?.companionThreadId && row.message.kind !== 'digest');
  const selectedEntry = entries.find((entry) => entry.task.threadId === selectedWork);
  const details = selectedWork ? workRows(info, state, selectedWork) : [];
  const entryStatus = (entry: (typeof entries)[number]) =>
    workAttention(info, state, entry.task.threadId).length
      ? '需要补充'
      : jobStatus(
          entry.task,
          workRows(info, state, entry.task.threadId).map((row) => row.message),
        );
  const busyCount = entries.filter((entry) => ['正在处理', '等待小助理'].includes(entryStatus(entry))).length;
  const chatBusy = !!chief?.tasks?.find((task) => task.threadId === info?.companionThreadId)?.busy;
  const activeStream = info ? state.streams[info.companionThreadId] : null;
  const lastReply = [...rows]
    .reverse()
    .find(
      (row) => row.threadId === info?.companionThreadId && row.message.role === 'bot' && row.message.kind === 'text',
    );
  const pendingRows = rows.filter(
    (row) =>
      (row.message.kind === 'options' &&
        row.message.card?.requestId &&
        !row.message.card.answered &&
        !row.message.card.dismissed &&
        !row.message.card.expired) ||
      helperQuestionPending(row.message, state),
  );
  const pendingApproval = pendingRows[0];
  const unreadReminder = servicesData?.events.findLast((event) => !event.seen);
  const helperState = (botId: string) => {
    const bot = state.bots[botId],
      tasks = bot?.tasks || [];
    const waiting = pendingRows.find((row) => row.message.threadRef?.botId === botId && isHelperQuestion(row.message));
    const task = waiting
      ? tasks.find((item) => item.threadId === waiting.message.threadRef?.threadId)
      : tasks.find((item) => item.busy || item.activity === 'waiting-on-you') ||
        [...tasks]
          .filter((item) => item.openedBy)
          .sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt))[0];
    const root = entries.find(
      (entry) =>
        entry.task.threadId === task?.threadId ||
        workRows(info, state, entry.task.threadId).some((row) => row.threadId === task?.threadId),
    )?.task.threadId;
    return {
      bot,
      task,
      root,
      status: waiting ? '需要你补充信息' : task ? jobStatus(task, state.messages[task.threadId] || []) : '等待安排',
    };
  };
  const managePermissions = overlays.managePermissions;
  const renderRow = ({ threadId, message, botId, name, workThreadId }: (typeof rows)[number]) => (
    <ChatMessage
      key={message.id}
      message={message}
      threadId={threadId}
      botId={botId}
      name={isHelperQuestion(message) ? message.from?.name || name : name}
      work={!!workThreadId}
      speak={play}
      questionAnswered={helperQuestionAnswered(message, state)}
      questionExpired={helperQuestionExpired(message, state)}
      replyToHelper={(text, sendId) => backend.replyToHelper(workThreadId || threadId, message.id, text, sendId)}
      respond={async (requestId, behavior, answer, reviewedSha256) =>
        backend.respond(botId, threadId, requestId, behavior, answer, reviewedSha256)
      }
      managePermissions={() => managePermissions(botId)}
      openEvidence={() => showEvidence(workThreadId || threadId)}
      {...(threadId === info?.companionThreadId && message.role === 'bot' && message.kind === 'text' && message.text
        ? {
            reply: () => {
              setKind('chat');
              setReplyTo({ id: message.id, name, text: preview(visibleMessageText(message)) });
              composer.current?.focus();
            },
            react: (emoji: string) =>
              backend
                .react(message.id, emoji, message.reactions?.some((item) => item.by === 'user' && item.emoji === emoji) ? false : undefined)
                .catch((error) => backend.setError(error instanceof Error ? error.message : '回应没有送达。')),
          }
        : {})}
      quoted={quotedFor(threadId, message)}
    />
  );
  function preview(text: string) {
    const line = text.replace(/<attached-(?:image|file)[^>]*\/>/g, '').replace(/\s+/g, ' ').trim();
    return line.length > 60 ? line.slice(0, 60) + '…' : line;
  }
  function quotedFor(threadId: string, message: (typeof rows)[number]['message']) {
    if (!message.replyToId) return undefined;
    const target = state.messages[threadId]?.find((item) => item.id === message.replyToId);
    if (!target?.text) return undefined;
    return { name: target.role === 'bot' ? chief?.name || '主助理' : '你', text: preview(visibleMessageText(target)) };
  }
  /** Bring one message into view in the record panel and mark it briefly. */
  function reveal(messageId: string) {
    let tries = 0;
    const find = () => {
      const element = document.getElementById('message-' + messageId);
      if (element) {
        element.scrollIntoView({ block: 'center', behavior: reduced ? 'auto' : 'smooth' });
        element.classList.add('message-found');
        setTimeout(() => element.classList.remove('message-found'), 2400);
      } else if (++tries < 20) setTimeout(find, 150);
      else backend.setNotice('这条记录在更早的历史里，点“查看更早记录”后再找。');
    };
    setTimeout(find, 50);
  }
  const [todayOpen, setTodayOpen] = useState(false);
  const openPlace = (place: { threadId?: string; workThreadId?: string }) => {
    if (place.workThreadId) return openWork(place.workThreadId);
    changePure(false);
    setPanel(true);
    setTab('all');
    selectWork(null);
  };
  const openSearchHit = (hit: SearchHit) => {
    setSearching(false);
    changePure(false);
    setPanel(true);
    setPinned(false);
    if (hit.where === 'work' && hit.workThreadId) {
      setTab('work');
      selectWork(hit.workThreadId);
    } else {
      setTab('all');
      selectWork(null);
    }
    reveal(hit.messageId);
  };
  const openNotification = (item: NotificationItem) => {
    if (item.workThreadId) return openWork(item.workThreadId);
    if (item.source === 'reminder') return setServicesTab('reminders');
    changePure(false);
    setPanel(true);
    setTab('all');
    selectWork(null);
  };
  const caption = captionFor({
    micState,
    interimSpeech,
    elapsed,
    playback,
    streamText: activeStream?.text,
    chatBusy,
    viewingWork: tab === 'work' && !!selectedWork,
    lastReply: lastReply?.message,
  });
  const personaState = !connected
    ? 'offline'
    : micState === 'recording'
      ? 'listening'
      : playback.status === 'speaking'
        ? 'speaking'
        : chatBusy
          ? 'thinking'
          : 'idle';
  useEffect(() => {
    if (!info) return;
    if (lastSession.current !== info.sessionId) {
      lastSession.current = info.sessionId;
      baseline.current = false;
      renderedIds.current.clear();
      terminalSeen.current.clear();
      voiceSession.pause();
      if (connected && !settings) voiceSession.resume();
      speaker.stop();
    }
    const fresh = rows.filter((row) => !renderedIds.current.has(row.message.id));
    const completed = rows.filter(
      (row) =>
        row.message.role === 'bot' &&
        row.message.kind === 'text' &&
        row.message.turnTerminal &&
        row.message.turnSucceeded === true,
    );
    if (connected && !settings) {
      voiceSession.receive(state.messages);
      const autoReply =
        !voiceSession.enabled && info.voice.ready && micState === 'idle' && baseline.current && autoRead
          ? [...completed]
              .reverse()
              .find(
                (row) =>
                  row.threadId === info.companionThreadId &&
                  !terminalSeen.current.has(row.message.id) &&
                  row.message.at > Date.now() - 60000,
              )?.message
          : null;
      if (autoReply?.text) void speaker.speak(autoReply.text);
    }
    completed.forEach((row) => terminalSeen.current.add(row.message.id));
    fresh.forEach((row) => renderedIds.current.add(row.message.id));
    baseline.current = true;
    if (!pinned && fresh.length) setNewMessages((count) => count + fresh.length);
    if (pinned && feed.current) {
      feed.current.scrollTop = feed.current.scrollHeight;
      setNewMessages(0);
    }
  }, [
    state.messages,
    info?.sessionId,
    info?.voice.ready,
    autoRead,
    connected,
    micState,
    pinned,
    settings,
    servicesTab,
    teamOpen,
    nativeOpen,
    surface,
  ]);
  useEffect(() => {
    const followConversation = tab === 'all';
    setPinned(followConversation);
    setNewMessages(0);
    if (feed.current)
      feed.current.scrollTop = followConversation ? feed.current.scrollHeight : selectedWork ? 0 : workScroll.current;
    if (tab === 'work' && !selectedWork)
      requestAnimationFrame(() => {
        if (workOpener.current)
          feed.current
            ?.querySelector<HTMLElement>('[data-work-id="' + CSS.escape(workOpener.current) + '"]')
            ?.focus({ preventScroll: true });
      });
  }, [tab, selectedWork]);
  useEffect(() => {
    const element = feed.current,
      content = feedContent.current;
    if (!element || !content) return;
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (followPinned.current && tab === 'all') element.scrollTop = element.scrollHeight;
      });
    });
    observer.observe(element);
    observer.observe(content);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, [panel, pure, tab, selectedWork]);

  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || settings || servicesTab || teamOpen || nativeOpen || surface) return;
      if (statusOpen) {
        setStatusOpen(false);
        return;
      }
      if (activeEvidence) {
        setActiveEvidence(null);
        return;
      }
      if (playback.status !== 'idle') {
        speaker.stop();
        return;
      }
      if (pure) changePure(false);
    };
    window.addEventListener('keydown', escape);
    return () => window.removeEventListener('keydown', escape);
  }, [
    settings,
    servicesTab,
    teamOpen,
    nativeOpen,
    surface,
    statusOpen,
    activeEvidence,
    playback.status,
    pure,
    speaker,
  ]);

  const submit = async () => {
    const text = draft.trim();
    if ((!text && !images.length) || sending || imageUploading || micState !== 'idle') return;
    voiceSession.stop();
    voiceOwnership.release();
    const sent = await backend.send(text, kind, undefined, images, 'text', kind === 'chat' ? replyTo?.id : undefined);
    if (sent) {
      setDraft('');
      setImages([]);
      setReplyTo(null);
      setKind('chat');
      setPinned(true);
      setSelectedWork(null);
      if (!pure) {
        setPanel(true);
        setTab(kind === 'work' ? 'work' : 'all');
      }
      composer.current?.focus();
    }
  };
  const addImages = async (files: File[]) => {
    if (imageUploading || sending) return;
    if (images.length + files.length > 4) {
      backend.setError('一次最多添加 4 个图片或文件。');
      return;
    }
    setImageUploading(true);
    backend.setError('');
    try {
      for (const file of files) {
        const image = await uploadAttachment(file);
        setImages((current) => [...current, image]);
      }
    } catch (error) {
      backend.setError(error instanceof Error ? error.message : '图片或文件未添加。');
    } finally {
      setImageUploading(false);
    }
  };
  const showEvidence = async (threadId: string) => {
    setActiveEvidence(threadId);
    setEvidence(null);
    setEvidenceError('');
    setEvidenceLoading(true);
    try {
      setEvidence(await request<WorkEvidence>(`/companion/work/${threadId}/evidence`));
    } catch (error) {
      setEvidenceError(error instanceof Error ? error.message : '工作明细暂不可用。');
    } finally {
      setEvidenceLoading(false);
    }
  };
  const fullScreen = async () => {
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await document.documentElement.requestFullscreen();
    } catch {
      backend.setError('当前窗口不允许全屏，可在 Chrome 或 Edge 中按 F11。');
    }
  };
  const openWork = (threadId?: string) => {
    changePure(false);
    setPanel(true);
    setTab('work');
    selectWork(threadId || null);
    setExpanded(true);
  };
  const onFeedScroll = () => {
    const element = feed.current;
    if (element) {
      const atEnd = element.scrollHeight - element.scrollTop - element.clientHeight < 60;
      if (atEnd || performance.now() < feedInputUntil.current) setPinned(atEnd);
    }
  };
  const loadOlder = async () => {
    const element = feed.current;
    const before = element?.scrollHeight ?? 0;
    setPinned(false);
    await backend.loadOlder();
    requestAnimationFrame(() => {
      if (element) element.scrollTop += element.scrollHeight - before;
    });
  };
  const jumpToNew = () => {
    setPinned(true);
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
    setNewMessages(0);
  };
  const openSurface = (kind: 'browser' | 'computer', botId: string) => {
    void request<{ bots: CapabilityBot[] }>('/companion/capabilities')
      .then((data) => {
        const bot = data.bots.find((bot) => bot.id === botId);
        if (bot) setSurface({ kind, bot });
      })
      .catch(() => setNativeOpen(true));
  };
  const unseenEvents = !!servicesData?.events.some((event) => !event.seen);
  // The record panel floats as a small card in the companion state; expanding it or opening a work gives it full height.
  const floating = panel && !pure && !expanded && !selectedWork;
  const sceneClass = `sanctuary ${pure ? 'pure' : ''} ${reduced ? 'reduced-motion' : ''} ${panel && !pure ? 'panel-open' : ''} ${expanded && panel ? 'work-view' : ''} ${floating ? 'panel-floating' : ''}`;
  const activity = activityFor({
    voicePhase,
    micState,
    speaking: playback.status !== 'idle',
    chatBusy,
    busyHelpers: (info?.helperIds || []).filter((id) => helperState(id).task?.busy).map((id) => state.bots[id]?.name || '小助理'),
    workCount: busyCount,
  });
  return (
    <main
      className={sceneClass}
      data-persona-state={personaState}
      data-voice-state={voicePhase}
      onDragOver={(event) => {
        if (event.dataTransfer.types.includes('Files')) event.preventDefault();
      }}
      onDrop={(event) => {
        if (event.dataTransfer.files.length) {
          event.preventDefault();
          void addImages([...event.dataTransfer.files]);
        }
      }}
    >
      <div className="room-layer" aria-hidden="true" />
      <div className="scene-shade" aria-hidden="true" />
      <div className="portrait-layer">
        <img src="/assets/companion-v1.png" alt="主助理坐在书房中，面对你倾听" draggable={false} />
      </div>
      <TopBar
        info={info}
        connected={connected}
        unseenEvents={unseenEvents}
        openServices={() => setServicesTab(unseenEvents ? 'reminders' : 'folders')}
        openGoals={() => overlays.openNative('goals')}
        openSkills={() => overlays.openNative('skills')}
        openStatus={() => setStatusOpen(true)}
        openToday={() => setTodayOpen(true)}
        openMemory={() => setSettings('memory')}
        fullScreen={fullScreen}
        openSettings={() => setSettings('model')}
        extra={info ? <NotificationCenter openItem={openNotification} /> : undefined}
      />
      {unreadReminder && !pure && (
        <button className="reminder-toast" onClick={() => setServicesTab('reminders')}>
          <Bell size={17} />
          <span>
            <strong>{unreadReminder.title}</strong>
            <small>{unreadReminder.action === 'work' ? '后台工作已发起，点击查看' : '提醒时间到了'}</small>
          </span>
          <ChevronRight size={15} />
        </button>
      )}

      {!pure &&
        (panel ? (
          <TimelinePanel
            info={info}
            connected={connected}
            expanded={expanded}
            toggleExpanded={() => setExpanded((value) => !value)}
            collapse={() => setPanel(false)}
            tab={tab}
            setTab={setTab}
            chiefName={chief?.name}
            openTeam={() => setTeamOpen(true)}
            chatBusy={chatBusy}
            recording={micState === 'recording'}
            jobCount={jobs.length}
            pendingCount={pendingRows.length}
            openPending={() => openWork()}
            feedRef={feed}
            feedContentRef={feedContent}
            markFeedInput={markFeedInput}
            onFeedScroll={onFeedScroll}
            newMessages={newMessages}
            jumpToNew={jumpToNew}
            refresh={() => void backend.refresh()}
            openMemory={() => setSettings('memory')}
            openSearch={() => setSearching((value) => !value)}
            search={searching ? <SearchPanel close={() => setSearching(false)} open={openSearchHit} /> : undefined}
          >
            {tab === 'all' ? (
              <ChatTimeline
                hasOlder={backend.hasOlder}
                loadingHistory={backend.loadingHistory}
                loadOlder={loadOlder}
                empty={rows.length === 0}
                busyCount={busyCount}
                openWork={() => openWork()}
                rows={chatRows}
                renderRow={renderRow}
                streamText={activeStream?.text}
                chiefName={chief?.name}
                chatBusy={chatBusy}
              />
            ) : selectedEntry ? (
              <>
                <WorkDetail
                  key={selectedEntry.task.threadId}
                  entry={selectedEntry}
                  rows={details}
                  questions={[
                    ...workAttention(info, state, selectedEntry.task.threadId),
                    ...details.filter(
                      (row) =>
                        row.message.kind === 'options' &&
                        row.message.card?.requestId &&
                        !row.message.card.answered &&
                        !row.message.card.dismissed &&
                        !row.message.card.expired,
                    ),
                  ]}
                  status={entryStatus(selectedEntry)}
                  back={() => selectWork(null)}
                  stop={() => void backend.stopTask(selectedEntry.botId, selectedEntry.task.threadId)}
                  retry={
                    selectedEntry.evidence && entryStatus(selectedEntry) === '未完成'
                      ? () => void backend.retryWork(selectedEntry.task.threadId)
                      : undefined
                  }
                  inspect={() => void showEvidence(selectedEntry.task.threadId)}
                  openFolders={() => setServicesTab('folders')}
                  renderRow={renderRow}
                  openSurface={openSurface}
                  addToWork={
                    selectedEntry.botId === info?.chiefId && info.workThreadIds.includes(selectedEntry.task.threadId)
                      ? (text) => backend.addToWork(selectedEntry.task.threadId, text)
                      : undefined
                  }
                />
                {Object.entries(state.streams)
                  .filter(([threadId]) => threadId === selectedWork || details.some((row) => row.threadId === threadId))
                  .map(([threadId, stream]) => (
                    <div className="message-content work-stream" key={threadId}>
                      <span className="field-note">正在生成…</span>
                      <MessageMarkdown text={stream.text} />
                    </div>
                  ))}
              </>
            ) : (
              <>
                <WorkActivityList
                  filter={activityFilter}
                  setFilter={setActivityFilter}
                  entries={entries}
                  messages={state.messages}
                  status={entryStatus}
                  open={selectWork}
                  attention={pendingRows.map(renderRow)}
                  attentionCount={pendingRows.length}
                />
              </>
            )}
          </TimelinePanel>
        ) : (
          <button className="restore-panel ambient-button" onClick={() => setPanel(true)}>
            <MessageCircle size={17} />
            对话与工作{busyCount > 0 && <span>{busyCount}</span>}
          </button>
        ))}

      {!pure && info && (
        <TeamDock
          helperIds={info.helperIds}
          helperState={helperState}
          busyCount={busyCount}
          openTeam={() => setTeamOpen(true)}
          openWork={openWork}
          stopTask={backend.stopTask}
        />
      )}

      <div className="conversation-center">
        {pure && pendingApproval && (
          <button
            className="attention-pill"
            onClick={() => {
              changePure(false);
              setPanel(true);
              setTab('all');
            }}
          >
            <AlertCircle size={15} />
            有一项操作等待你确认
            <ChevronRight size={14} />
          </button>
        )}
        <ActivityLine text={activity} />
        <Caption
          personaState={personaState}
          caption={caption}
          speaking={playback.status !== 'idle'}
          stopSpeaking={() => speaker.stop()}
        />
        <Composer
          micState={micState}
          micLevel={micLevel}
          elapsed={elapsed}
          voicePhase={voicePhase}
          record={record}
          cancelRecording={cancelRecording}
          chooseMicrophone={() => setSettings('voice')}
          images={images}
          imageUploading={imageUploading}
          removeImage={(id) => setImages((current) => current.filter((image) => image.id !== id))}
          addImages={(files) => void addImages(files)}
          composerRef={composer}
          draft={draft}
          setDraft={setDraft}
          kind={kind}
          setKind={setKind}
          sending={sending}
          connected={connected}
          submit={submit}
          replyTo={kind === 'chat' && replyTo ? replyTo : undefined}
          cancelReply={() => setReplyTo(null)}
        />
        {(backend.error || backend.notice) && (
          <ComposerFeedback
            error={backend.error}
            notice={backend.notice}
            retryAvailable={backend.retryAvailable}
            checkMicrophone={() => setSettings('voice')}
            openStatus={() => setStatusOpen(true)}
            retry={() => void backend.retryLastSend()}
            dismiss={() => {
              backend.setError('');
              backend.setNotice('');
            }}
          />
        )}
      </div>
      <button
        className={`pure-toggle ambient-button ${pure ? 'active' : ''}`}
        onClick={() => changePure(!pure)}
        aria-pressed={pure}
      >
        {pure ? <Layers2 size={17} /> : <Focus size={18} />}
        {pure ? '恢复面板' : '纯净视图'}
      </button>
      {!pure && rows.length === 0 && (
        <button
          className="suggestion ambient-button"
          onClick={() => {
            setDraft('帮我调研并整理一份文档');
            setKind('work');
            composer.current?.focus();
          }}
        >
          <span>试试交给小助理</span>
          <ChevronRight size={14} />
        </button>
      )}

      {todayOpen && (
        <TodayDrawer close={() => setTodayOpen(false)} openPlace={openPlace} openReminders={() => setServicesTab('reminders')} />
      )}
      {statusOpen && (
        <SystemStatusDrawer
          info={info}
          connected={connected}
          services={servicesData}
          error={backend.error}
          retryAvailable={backend.retryAvailable}
          onRefresh={backend.refresh}
          onRetry={backend.retryLastSend}
          onSettings={(tab) => {
            setStatusOpen(false);
            setSettings(tab);
          }}
          close={() => setStatusOpen(false)}
        />
      )}
      {settings && info && (
        <Settings
          info={info}
          initialTab={settings}
          close={() => setSettings(null)}
          refreshed={backend.refresh}
          reduced={reduced}
          setReduced={(value) => saveSettings({ reducedMotion: value })}
          autoRead={autoRead}
          setAutoRead={(value) => saveSettings({ readReplies: value })}
        />
      )}
      {servicesTab && (
        <ServicesDrawer
          initialTab={servicesTab}
          data={servicesData}
          close={() => setServicesTab(null)}
          refresh={refreshServices}
          onWork={async (text) => {
            const sent = await backend.send(text, 'work');
            if (sent) {
              openWork();
              await refreshServices();
            }
            return sent;
          }}
        />
      )}
      {teamOpen && info && (
        <TeamDrawer
          chief={chief}
          bots={info.helperIds.flatMap((id) => (state.bots[id] ? [state.bots[id]] : []))}
          create={backend.createSpecialist}
          rename={backend.renameAssistant}
          close={() => setTeamOpen(false)}
          assign={(bot) => {
            setTeamOpen(false);
            setDraft(`请让${bot.name}帮我`);
            setKind('work');
            composer.current?.focus();
          }}
        />
      )}
      {nativeOpen && (
        <NativeHub
          initialTab={overlays.nativeTab}
          initialBotId={overlays.nativeBot}
          renderRow={renderRow}
          close={() => setNativeOpen(false)}
          changed={backend.refresh}
          viewBrowser={(bot) => {
            setNativeOpen(false);
            setSurface({ kind: 'browser', bot });
          }}
          viewComputer={(bot) => {
            setNativeOpen(false);
            setSurface({ kind: 'computer', bot });
          }}
        />
      )}
      {surface?.kind === 'browser' && <NativeBrowserView bot={surface.bot} close={() => setSurface(null)} />}
      {surface?.kind === 'computer' && (
        <NativeComputerView bot={surface.bot} changed={backend.refresh} close={() => setSurface(null)} />
      )}
      {activeEvidence && (
        <EvidenceDrawer
          dialogRef={evidenceDialog}
          close={() => setActiveEvidence(null)}
          loading={evidenceLoading}
          error={evidenceError}
          evidence={evidence}
        />
      )}
    </main>
  );
}
