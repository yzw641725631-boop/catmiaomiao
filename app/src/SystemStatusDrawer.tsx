import { useEffect, useRef, type ReactNode } from 'react';
import { Activity, AlertCircle, CalendarClock, CheckCircle2, Image, Mic2, RefreshCw, Settings2, Volume2, WifiOff, X } from 'lucide-react';
import type { AssistantServicesData, CompanionInfo } from './types.ts';

type SettingTab = 'model' | 'voice' | 'memory' | 'appearance';

type SystemStatusDrawerProps = {
  info: CompanionInfo | null;
  connected: boolean;
  services?: AssistantServicesData;
  error: string;
  retryAvailable: boolean;
  onRefresh: () => Promise<void>;
  onRetry: () => Promise<boolean>;
  onSettings: (tab: SettingTab) => void;
  close: () => void;
};

type StatusTone = 'good' | 'warn' | 'off';

function StatusMark({ tone }: { tone: StatusTone }) {
  return tone === 'good' ? <CheckCircle2 size={16} /> : tone === 'warn' ? <AlertCircle size={16} /> : <WifiOff size={16} />;
}

function statusText(tone: StatusTone) {
  return tone === 'good' ? '正常' : tone === 'warn' ? '需要检查' : '未连接';
}

export function SystemStatusDrawer({ info, connected, services, error, retryAvailable, onRefresh, onRetry, onSettings, close }: SystemStatusDrawerProps) {
  const dialog = useRef<HTMLElement>(null);
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); close(); return; }
      if (event.key !== 'Tab') return;
      const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),a[href]') ?? [])];
      if (!controls.length) return;
      if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) { event.preventDefault(); controls.at(-1)?.focus(); }
      else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); }
    };
    document.addEventListener('keydown', onKey, true);
    return () => { document.removeEventListener('keydown', onKey, true); previous?.focus(); };
  }, [close]);

  const modelReady = Boolean(info?.model.configured && info.model.model);
  const modelHealth = info?.health?.model.state ?? 'unknown';
  const voiceReady = Boolean(info?.asr.configured && info.voice.ready);
  const visionConfigured = Boolean(info?.vision?.configured);
  const visionHealth = info?.health?.vision.state ?? 'unknown';
  const schedulerReady = services?.serviceRunning === true;
  const modelTone: StatusTone = !modelReady ? 'off' : modelHealth === 'degraded' || modelHealth === 'unknown' ? 'warn' : 'good';
  const visionTone: StatusTone = !visionConfigured ? 'off' : visionHealth === 'healthy' ? 'good' : 'warn';
  const rows: Array<{ icon: ReactNode; label: string; detail: string; tone: StatusTone; action?: { label: string; run: () => void } }> = [
    {
      icon: connected ? <Activity size={17} /> : <WifiOff size={17} />,
      label: '本机助理服务',
      detail: connected ? '本地页面与消息流已连接' : '页面正在等待本地服务恢复',
      tone: connected ? 'good' : 'off',
    },
    {
      icon: <Settings2 size={17} />,
      label: 'LLM 模型',
      detail: modelReady ? `${info!.provider === 'reachai' ? 'Saturn Cloud · ' : ''}${info!.model.model}${modelHealth === 'healthy' ? ' · 最近请求成功' : modelHealth === 'degraded' ? ' · 最近请求失败' : ' · 尚无最近请求回执'}` : '还没有可用的模型连接',
      tone: modelTone,
      action: { label: '打开设置', run: () => onSettings('model') },
    },
    {
      icon: <Mic2 size={17} />,
      label: '语音对话',
      detail: voiceReady ? '识别和播报已配置；本地人声检测已启用' : '需要配置识别或播报服务',
      tone: voiceReady ? 'good' : 'warn',
      action: { label: '声音设置', run: () => onSettings('voice') },
    },
    {
      icon: <Image size={17} />,
      label: '图片识别',
      detail: visionConfigured ? visionHealth === 'healthy' ? '最近视觉请求成功；真实图片派工仍需持续复测' : visionHealth === 'degraded' ? '最近视觉请求失败，需检查上游图片上传' : '视觉入口已接入，尚无最近请求回执' : '尚未接入视觉模型',
      tone: visionTone,
    },
    {
      icon: <CalendarClock size={17} />,
      label: '后台例行工作',
      detail: services ? schedulerReady ? '本地调度器已启动，服务关闭后不会继续执行' : '本地调度器没有运行' : '正在读取后台调度状态',
      tone: services ? schedulerReady ? 'good' : 'warn' : 'warn',
    },
  ];

  return <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && close()}>
    <section ref={dialog} className="status-drawer" role="dialog" aria-modal="true" aria-labelledby="status-title" tabIndex={-1}>
      <header className="drawer-header status-drawer-header">
        <div><span className="eyebrow">真实状态 · 当前页面</span><h2 id="status-title">系统状态</h2></div>
        <button className="icon-button" aria-label="关闭系统状态" onClick={close}><X size={20} /></button>
      </header>
      <div className="status-drawer-body">
        <div className="status-summary">
          <span className={`status-summary-icon ${connected ? 'good' : 'off'}`}>{connected ? <CheckCircle2 size={24} /> : <WifiOff size={24} />}</span>
          <div><strong>{connected ? '可以继续对话' : '正在等待本机服务'}</strong><p>{info?.mode === 'fixture' ? '当前是隔离演示模式。' : info?.verificationLabel || '连接状态会随本地服务和模型响应更新。'}</p></div>
        </div>
        {error && <div className="status-error"><AlertCircle size={16} /><span>{error}</span></div>}
        <section className="status-list" aria-label="服务状态">
          {rows.map(row => <article className="status-row" key={row.label}>
            <span className={`status-row-icon ${row.tone}`}>{row.icon}</span>
            <div className="status-row-copy"><strong>{row.label}</strong><p>{row.detail}</p></div>
            <span className={`status-row-state ${row.tone}`}><StatusMark tone={row.tone} />{statusText(row.tone)}</span>
            {row.action && <button className="status-row-action" onClick={row.action.run}>{row.action.label}</button>}
          </article>)}
        </section>
        <section className="status-note"><Volume2 size={15} /><p>语音播报时会暂时停采，当前是半双工。要自然插话，还需要回声消除和播报中抢话验收。</p></section>
        <section className="status-note"><Image size={15} /><p>“已接入”表示本地通道存在，不代表美国视觉服务的真实图片上传已经稳定通过。</p></section>
        <div className="status-actions">
          <button className="secondary-button" onClick={() => void onRefresh()}><RefreshCw size={14} />同步状态</button>
          {retryAvailable && <button className="primary-button" onClick={() => void onRetry()}><RefreshCw size={14} />重试最近消息</button>}
        </div>
      </div>
    </section>
  </div>;
}
