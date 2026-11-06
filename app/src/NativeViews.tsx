import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Globe2, Hand, LoaderCircle, Monitor, Play, RefreshCw, X } from 'lucide-react';
import { post, request } from './api.ts';
import type { CapabilityBot, CapabilityData } from './NativeHub.tsx';

function useSurfaceDialog() {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => prior?.focus();
  }, []);
  const trap = (event: React.KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const controls = [
      ...(dialog.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),[tabindex="0"]',
      ) || []),
    ];
    if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) {
      event.preventDefault();
      controls.at(-1)?.focus();
    } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
      event.preventDefault();
      controls[0]?.focus();
    }
  };
  return { dialog, trap };
}

export function NativeBrowserView({ bot, close }: { bot: CapabilityBot; close(): void }) {
  const { dialog, trap } = useSurfaceDialog();
  const [frame, setFrame] = useState(''),
    [url, setUrl] = useState(''),
    [address, setAddress] = useState(''),
    [viewer, setViewer] = useState(''),
    [owned, setOwned] = useState(false),
    [connected, setConnected] = useState(false);
  const [status, setStatus] = useState('正在连接专用浏览器…'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [attempt, setAttempt] = useState(0);
  const [tabs, setTabs] = useState<Array<{ tabId: string; title: string; url: string; active: boolean }>>([]);
  const dimensions = useRef({ width: 1280, height: 720 }),
    viewerId = useRef(''),
    inputQueue = useRef(Promise.resolve()),
    operation = useRef(false);
  const stage = useRef<HTMLDivElement>(null),
    [bounds, setBounds] = useState({ width: 980, height: 480 }),
    ownedNow = useRef(false),
    pressed = useRef(new Map<string, { key: string; code: string; windowsVirtualKeyCode: number }>()),
    lastMove = useRef(0);
  ownedNow.current = owned;
  useEffect(() => {
    if (!stage.current) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect) setBounds({ width: rect.width, height: rect.height });
    });
    observer.observe(stage.current);
    return () => observer.disconnect();
  }, []);
  const ratio = Math.min(bounds.width / dimensions.current.width, bounds.height / dimensions.current.height);
  const screenSize = { width: dimensions.current.width * ratio, height: dimensions.current.height * ratio };
  const send = (body: Record<string, unknown>) =>
    post(`/api/bots/${bot.id}/browser/action`, { ...body, viewerId: viewerId.current });
  const input = (body: Record<string, unknown>) => {
    if (!owned || !viewerId.current) return;
    inputQueue.current = inputQueue.current
      .then(() => (ownedNow.current && viewerId.current ? send(body) : undefined))
      .then(() => {})
      .catch((error) => setError(error.message));
  };
  const remoteKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!owned || event.key === 'Escape' || event.key === 'Tab' || event.nativeEvent.isComposing) return;
    event.preventDefault();
    event.stopPropagation();
    if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)
      input({ type: 'input_keyboard', eventType: 'char', text: event.key });
    else {
      const key = { key: event.key, code: event.code, windowsVirtualKeyCode: event.keyCode };
      pressed.current.set(event.code, key);
      input({
        type: 'input_keyboard',
        eventType: 'keyDown',
        ...key,
        modifiers:
          (event.altKey ? 1 : 0) + (event.ctrlKey ? 2 : 0) + (event.metaKey ? 4 : 0) + (event.shiftKey ? 8 : 0),
      });
    }
  };
  const remoteKeyUp = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const key = pressed.current.get(event.code);
    if (!key) return;
    pressed.current.delete(event.code);
    input({ type: 'input_keyboard', eventType: 'keyUp', ...key });
  };
  const releaseKeys = () => {
    for (const key of pressed.current.values()) input({ type: 'input_keyboard', eventType: 'keyUp', ...key });
    pressed.current.clear();
  };
  const act = async (body: Record<string, unknown>) => {
    if (operation.current || !viewerId.current) return;
    operation.current = true;
    setBusy(true);
    setError('');
    try {
      await send(body);
    } catch (error) {
      setError(error instanceof Error ? error.message : '浏览器操作未完成。');
    } finally {
      operation.current = false;
      setBusy(false);
    }
  };
  useEffect(() => {
    let active = true;
    setConnected(false);
    setOwned(false);
    setViewer('');
    viewerId.current = '';
    setError('');
    setStatus('正在连接专用浏览器…');
    const stream = new EventSource(`/api/bots/${bot.id}/browser/live`);
    const listen = (name: string, handler: (data: Record<string, any>) => void) =>
      stream.addEventListener(name, (event) => {
        if (!active) return;
        try {
          handler(JSON.parse((event as MessageEvent).data));
        } catch {
          setError('浏览器返回了无法读取的状态。');
        }
      });
    listen('ready', (data) => {
      viewerId.current = data.viewerId;
      setViewer(data.viewerId);
      setConnected(true);
      setStatus('正在获取画面…');
    });
    listen('waiting', () => setStatus('正在等待浏览器可用…'));
    listen('control', (data) => setOwned(data.owned === true && data.controlling === true));
    listen('tabs', (data) => setTabs(Array.isArray(data.tabs) ? data.tabs : []));
    listen('url', (data) => {
      if (typeof data.url === 'string') {
        setUrl(data.url);
        setAddress(data.url);
      }
    });
    listen('frame', (data) => {
      if (typeof data.data !== 'string' || data.data.length > 5 * 1024 * 1024 || !/^[A-Za-z0-9+/]+=*$/.test(data.data))
        return;
      if (
        data.metadata?.deviceWidth > 0 &&
        data.metadata.deviceWidth <= 8192 &&
        data.metadata?.deviceHeight > 0 &&
        data.metadata.deviceHeight <= 8192
      )
        dimensions.current = { width: data.metadata.deviceWidth, height: data.metadata.deviceHeight };
      setFrame(`data:image/${data.format === 'png' ? 'png' : 'jpeg'};base64,${data.data}`);
      setConnected(true);
      setStatus('实时画面');
      if (viewerId.current)
        void send({ type: 'ack', seq: data.seq }).catch((error) => active && setError(error.message));
    });
    listen('asleep', () => {
      setConnected(false);
      setStatus('浏览器已休息，重新连接后继续。');
    });
    listen('gone', (data) => {
      setConnected(false);
      setOwned(false);
      viewerId.current = '';
      setStatus(typeof data.reason === 'string' ? data.reason : '浏览器已关闭。');
      stream.close();
    });
    stream.onerror = () => {
      if (active) {
        setConnected(false);
        setOwned(false);
        viewerId.current = '';
        setStatus('连接已断开，保留最后一帧。');
        setError('浏览器暂时无法连接，可以重试。');
        stream.close();
      }
    };
    return () => {
      active = false;
      stream.close();
      viewerId.current = '';
    };
  }, [bot.id, attempt]);
  const position = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(dimensions.current.width - 1, ((event.clientX - rect.left) * dimensions.current.width) / rect.width),
      ),
      y: Math.max(
        0,
        Math.min(dimensions.current.height - 1, ((event.clientY - rect.top) * dimensions.current.height) / rect.height),
      ),
    };
  };
  return (
    <div className="modal-backdrop surface-backdrop">
      <section
        className="surface-view"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="browser-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            close();
          } else trap(event);
        }}
      >
        <header className="surface-header">
          <div>
            <span className="eyebrow">{bot.name}的工作现场</span>
            <h2 id="browser-title">
              <Globe2 size={19} />
              专用浏览器
            </h2>
          </div>
          <div>
            <button
              className="secondary-button"
              disabled={!viewer || busy}
              onClick={() => void act({ type: owned ? 'release' : 'take' })}
            >
              {owned ? <Play size={15} /> : <Hand size={15} />} {owned ? '交还助理' : '接管浏览器'}
            </button>
            <button className="icon-button" aria-label="关闭浏览器查看" onClick={close}>
              <X size={20} />
            </button>
          </div>
        </header>
        <div className="browser-toolbar">
          <button
            className="icon-button"
            aria-label="浏览器后退"
            disabled={!owned || busy}
            onClick={() => void act({ type: 'back' })}
          >
            <ArrowLeft size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="浏览器前进"
            disabled={!owned || busy}
            onClick={() => void act({ type: 'forward' })}
          >
            <ArrowRight size={16} />
          </button>
          <button
            className="icon-button"
            aria-label="刷新浏览器页面"
            disabled={!owned || busy}
            onClick={() => void act({ type: 'reload' })}
          >
            <RefreshCw size={15} />
          </button>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void act({ type: 'navigate', url: address });
            }}
          >
            <input
              aria-label="浏览器地址"
              value={address}
              disabled={!owned || busy}
              placeholder={url || '接管后输入网址'}
              onChange={(event) => setAddress(event.target.value)}
            />
            <button className="text-button" disabled={!owned || busy}>
              前往
            </button>
          </form>
        </div>
        {!!tabs.length && (
          <div className="browser-tabs">
            {tabs.map((tab) => (
              <button
                key={tab.tabId}
                title={tab.url}
                className={tab.active ? 'active' : ''}
                disabled={!owned || busy}
                onClick={() => void act({ type: 'tab-select', tabId: tab.tabId })}
              >
                {tab.title || '新标签页'}
              </button>
            ))}
          </div>
        )}
        {error && (
          <p className="surface-feedback" role="alert">
            {error}
            <button className="text-button" onClick={() => setAttempt((value) => value + 1)}>
              重新连接
            </button>
          </p>
        )}
        <div className={`browser-stage ${owned ? 'controlling' : ''}`} ref={stage}>
          {frame ? (
            <div
              className="browser-screen"
              role="application"
              aria-label="浏览器画面，接管后可以点击与输入"
              tabIndex={owned ? 0 : -1}
              style={screenSize}
              onPointerDown={(event) => {
                if (!owned) return;
                event.preventDefault();
                event.currentTarget.focus();
                event.currentTarget.setPointerCapture(event.pointerId);
                input({
                  type: 'input_mouse',
                  eventType: 'mousePressed',
                  ...position(event),
                  button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
                  clickCount: 1,
                });
              }}
              onPointerMove={(event) => {
                if (owned && event.buttons && Date.now() - lastMove.current > 45) {
                  lastMove.current = Date.now();
                  input({
                    type: 'input_mouse',
                    eventType: 'mouseMoved',
                    ...position(event),
                    button: event.buttons === 2 ? 'right' : 'left',
                  });
                }
              }}
              onPointerUp={(event) => {
                if (!owned) return;
                input({
                  type: 'input_mouse',
                  eventType: 'mouseReleased',
                  ...position(event),
                  button: event.button === 2 ? 'right' : event.button === 1 ? 'middle' : 'left',
                  clickCount: 1,
                });
                if (event.currentTarget.hasPointerCapture(event.pointerId))
                  event.currentTarget.releasePointerCapture(event.pointerId);
              }}
              onPointerCancel={(event) =>
                input({
                  type: 'input_mouse',
                  eventType: 'mouseReleased',
                  ...position(event),
                  button: 'left',
                  clickCount: 1,
                })
              }
              onContextMenu={(event) => owned && event.preventDefault()}
              onWheel={(event) => {
                if (owned)
                  input({
                    type: 'input_mouse',
                    eventType: 'mouseWheel',
                    ...position(event),
                    deltaX: Math.max(-10000, Math.min(10000, event.deltaX)),
                    deltaY: Math.max(-10000, Math.min(10000, event.deltaY)),
                  });
              }}
              onKeyDown={remoteKeyDown}
              onKeyUp={remoteKeyUp}
              onBlur={releaseKeys}
              onPaste={(event) => {
                if (!owned) return;
                event.preventDefault();
                const value = event.clipboardData.getData('text');
                if (value.length > 100000) {
                  setError('粘贴内容过长，请分段输入。');
                  return;
                }
                const points = Array.from(value);
                for (let index = 0; index < points.length; index += 2000)
                  input({
                    type: 'input_keyboard',
                    eventType: 'char',
                    text: points.slice(index, index + 2000).join(''),
                  });
              }}
              onCompositionEnd={(event) => {
                if (event.data) input({ type: 'input_keyboard', eventType: 'char', text: event.data });
              }}
            >
              <img src={frame} alt="助理专用浏览器的实时页面" draggable={false} />
            </div>
          ) : (
            <div className="surface-empty">
              <LoaderCircle size={28} className={connected ? 'spin' : ''} />
              <h3>{status}</h3>
              <p>这里显示实际浏览器，页面和登录记录保存在独立资料中。</p>
            </div>
          )}
        </div>
        <footer className="surface-footer">
          <span className={`status-dot ${connected ? 'online' : ''}`} />
          {status}
          <span>{owned ? '你正在操作，助理等待交还。' : '可以观看助理工作，需要时接管。'}</span>
        </footer>
      </section>
    </div>
  );
}

function desktopLease() {
  try {
    let id = sessionStorage.getItem('companion.desktop-control-lease');
    if (!id) {
      id = crypto.randomUUID();
      sessionStorage.setItem('companion.desktop-control-lease', id);
    }
    return id;
  } catch {
    return crypto.randomUUID();
  }
}
export function NativeComputerView({
  bot,
  close,
  changed,
}: {
  bot: CapabilityBot;
  close(): void;
  changed(): Promise<void>;
}) {
  const { dialog, trap } = useSurfaceDialog(),
    lease = useRef(desktopLease());
  const [status, setStatus] = useState<CapabilityData['computer']>(),
    [frame, setFrame] = useState<{ data: string; mime: string; at: number }>(),
    [control, setControl] = useState<{ held: boolean; owned?: boolean; helpReason?: string }>({ held: false });
  const [watching, setWatching] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    submitting = useRef(false);
  useEffect(() => {
    let active = true;
    void request<CapabilityData['computer']>('/companion/desktop')
      .then((value) => active && setStatus(value))
      .catch((error) => active && setError(error.message));
    const check = () =>
      post<typeof control>(`/api/bots/${bot.id}/computer/control`, { action: 'check', controlLeaseId: lease.current })
        .then((value) => active && setControl(value))
        .catch(() => {});
    void check();
    const timer = setInterval(check, 2000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [bot.id]);
  useEffect(() => {
    if (!watching || !status?.ready || bot.computer !== 'local') return;
    let active = true;
    const abort = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const update = async () => {
      try {
        const next = await request<NonNullable<typeof frame>>(`/companion/desktop/${bot.id}/frame`, {
          signal: abort.signal,
        });
        if (active) {
          setFrame(next);
          setError('');
        }
      } catch (error) {
        if (active) setError(error instanceof Error ? error.message : '画面暂时无法更新。');
      } finally {
        if (active) timer = setTimeout(update, 1500);
      }
    };
    void update();
    return () => {
      active = false;
      abort.abort();
      clearTimeout(timer);
    };
  }, [watching, status?.ready, bot.id, bot.computer]);
  const action = async (name: 'install' | 'start' | 'stop') => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      setStatus(
        await request<CapabilityData['computer']>('/companion/desktop', {
          method: 'POST',
          body: JSON.stringify({ action: name }),
          signal: AbortSignal.timeout(180000),
        }),
      );
      await changed();
    } catch (error) {
      setError(error instanceof Error ? error.message : '电脑连接未完成。');
      setStatus(await request<CapabilityData['computer']>('/companion/desktop').catch(() => undefined));
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const take = async () => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    try {
      setControl(
        await post(`/api/bots/${bot.id}/computer/control`, {
          action: control.owned ? 'release' : 'take',
          controlLeaseId: lease.current,
        }),
      );
    } catch (error) {
      setError(error instanceof Error ? error.message : '接管状态未能更新。');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="modal-backdrop surface-backdrop">
      <section
        className="surface-view"
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="computer-title"
        tabIndex={-1}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            if (!busy) close();
          } else trap(event);
        }}
      >
        <header className="surface-header">
          <div>
            <span className="eyebrow">{bot.name} · 本机工作</span>
            <h2 id="computer-title">
              <Monitor size={20} />
              这台电脑
            </h2>
          </div>
          <div>
            {status?.ready && bot.computer === 'local' && (
              <button
                className="secondary-button"
                disabled={busy || (control.held && !control.owned)}
                onClick={() => void take()}
              >
                {control.owned ? <Play size={15} /> : <Hand size={15} />}{' '}
                {control.owned ? '交还助理' : control.held ? '其他窗口正在接管' : '接管电脑'}
              </button>
            )}
            <button className="icon-button" disabled={busy} aria-label="关闭电脑查看" onClick={close}>
              <X size={20} />
            </button>
          </div>
        </header>
        {error && (
          <p className="surface-feedback" role="alert">
            {error}
          </p>
        )}
        <div className="computer-stage">
          {watching && frame ? (
            <img src={`data:${frame.mime};base64,${frame.data}`} alt="这台电脑的当前屏幕" />
          ) : (
            <div className="surface-empty">
              <Monitor size={30} />
              <h3>{status?.ready ? '本机驱动已连接' : busy ? '正在准备本机驱动…' : '连接这台 Windows 电脑'}</h3>
              <p>
                {status?.ready
                  ? bot.computer === 'local'
                    ? '查看屏幕后可观看工作。接管时助理会暂停输入，你可以直接在桌面操作。'
                    : '连接已准备好。回到“分配本领”，勾选允许这位助理使用。'
                  : '使用 Cua Driver 0.28.2 的本机宿主，安装和启动后再选择哪些助理可以使用。'}
              </p>
              <div className="button-row">
                {!status?.ready && (
                  <button className="primary-button" disabled={busy} onClick={() => void action('start')}>
                    {busy ? <LoaderCircle size={16} className="spin" /> : null}
                    {busy ? '正在准备…' : '准备并启动连接'}
                  </button>
                )}
                {status?.ready && bot.computer === 'local' && (
                  <button className="primary-button" onClick={() => setWatching(true)}>
                    查看屏幕
                  </button>
                )}
                {status?.ready && (
                  <button className="text-button" disabled={busy} onClick={() => void action('stop')}>
                    关闭电脑连接
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
        <footer className="surface-footer">
          <span className={`status-dot ${status?.ready ? 'online' : ''}`} />
          {status?.ready ? '驱动已连接' : status?.state === 'failed' ? '连接失败' : '尚未连接'}
          <span>
            {control.owned
              ? '你已接管。完成桌面操作后点击“交还助理”。'
              : watching
                ? '正在查看真实屏幕。'
                : '屏幕仅在你打开查看后获取。'}
          </span>
          {watching && (
            <button className="text-button" onClick={() => setWatching(false)}>
              停止观看
            </button>
          )}
        </footer>
      </section>
    </div>
  );
}
