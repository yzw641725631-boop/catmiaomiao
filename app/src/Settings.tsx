import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, Check, LoaderCircle, Mic, SlidersHorizontal, Volume2, X, Brain, Plug, AlertCircle } from 'lucide-react';
import { post, request, RequestError } from './api.ts';
import type { CompanionInfo, MemoryDocument } from './types.ts';
import { ReachaiSettings } from './ReachaiSettings.tsx';
import { MicrophoneSettings } from './MicrophoneSettings.tsx';
import { ChiefStyleSetting } from './ChiefStyleSetting.tsx';

interface MemoryJournalRow {
  id: string; at: number; path: string; actor: 'person' | 'bot' | 'import' | 'upkeep';
  diff: string; added: number; removed: number; canRevert: boolean;
}

type Tab = 'model' | 'voice' | 'memory' | 'appearance';
export function Settings({ info, initialTab, close, refreshed, reduced, setReduced, autoRead, setAutoRead }: {
  info: CompanionInfo; initialTab: Tab; close: () => void; refreshed: () => Promise<void>;
  reduced: boolean; setReduced: (value: boolean) => void; autoRead: boolean; setAutoRead: (value: boolean) => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [connectionType, setConnectionType] = useState<'reachai' | 'compatible'>(info.mode === 'fixture' ? 'reachai' : info.provider);
  const [modelUrl, setModelUrl] = useState(info.provider === 'reachai' ? '' : info.model.url);
  const [modelName, setModelName] = useState(info.provider === 'reachai' ? '' : info.model.model);
  const [key, setKey] = useState('');
  const [asrUrl, setAsrUrl] = useState(info.asr.url);
  const [asrModel, setAsrModel] = useState(info.asr.model);
  const [asrKey, setAsrKey] = useState('');
  const [voiceProvider, setVoiceProvider] = useState(info.voice.provider || 'elevenlabs');
  const [voiceId, setVoiceId] = useState(info.voice.voice);
  const [voiceKey, setVoiceKey] = useState('');
  const [voiceUrl, setVoiceUrl] = useState(info.voice.baseUrl || '');
  const [memory, setMemory] = useState<MemoryDocument | null>(null);
  const [draft, setDraft] = useState('');
  const [conflict, setConflict] = useState<MemoryDocument | null>(null);
  const [journal, setJournal] = useState<MemoryJournalRow[]>([]);
  const [journalError, setJournalError] = useState('');
  const [dirty, setDirty] = useState(false);
  const [confirmClose, setConfirmClose] = useState(false);
  const dialog = useRef<HTMLDivElement>(null);
  const refreshJournal = async () => {
    try {
      const data = await request<{ entries: MemoryJournalRow[] }>(`/api/bots/${info.chiefId}/memory/journal?limit=12`);
      setJournal(data.entries); setJournalError('');
    } catch { setJournalError('记忆历史暂时无法读取，请稍后重试。'); }
  };

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => previous?.focus();
  }, []);
  useEffect(() => {
    setNote(''); setError('');
    if (tab !== 'memory' || memory) return;
    let alive = true;
    request<MemoryDocument>(`/api/bots/${info.chiefId}/memory/file`).then(data => {
      if (alive) { setMemory(data); setDraft(data.text); }
    }).catch(error => alive && setError(error.message));
    void refreshJournal();
    return () => { alive = false; };
  }, [tab, info.chiefId]);

  const run = async (work: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setNote(''); setError('');
    try { await work(); }
    catch (error) { setError(error instanceof Error ? error.message : '保存未完成，请重试。'); }
    finally { setBusy(false); }
  };
  const attemptClose = () => dirty ? setConfirmClose(true) : close();

  return <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && attemptClose()}>
    <div role="dialog" aria-modal="true" aria-labelledby="settings-title" tabIndex={-1} className="settings-drawer" ref={dialog}
      onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); attemptClose(); }
        if (event.key === 'Tab') {
          const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]') ?? [])];
          const first = controls[0], last = controls.at(-1);
          if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last?.focus(); }
          if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
        }
      }}>
      <header className="drawer-header"><div><span className="eyebrow">让相处更合适</span><h2 id="settings-title">助理设置</h2></div><button className="icon-button" onClick={attemptClose} aria-label="关闭设置"><X size={20} /></button></header>
      <nav className="settings-tabs" aria-label="设置分类">
        {([['model', Plug, '模型连接'], ['voice', Volume2, '声音'], ['memory', Brain, '记忆'], ['appearance', SlidersHorizontal, '偏好']] as const).map(([id, Icon, title]) => <button key={id} className={tab === id ? 'selected' : ''} onClick={() => setTab(id)} aria-pressed={tab === id}><Icon size={16} />{title}</button>)}
      </nav>
      <div className="settings-body">
        {tab === 'model' && <><label className="connection-choice">连接方式<select value={connectionType} onChange={event => setConnectionType(event.target.value as 'reachai' | 'compatible')}><option value="reachai">Saturn Cloud · 统一模型与语音</option><option value="compatible">其他兼容 API 服务</option></select></label>{connectionType === 'reachai' ? <ReachaiSettings info={info} refreshed={refreshed} /> : <form onSubmit={event => { event.preventDefault(); run(async () => {
          await post('/companion/settings/model', { url: modelUrl.trim(), model: modelName.trim(), key: key.trim() }); setKey(''); await refreshed(); setNote('模型连接已保存。现在的对话会使用你的服务。');
        }); }}>
          <h3>连接你的模型</h3><p>支持兼容 API 的服务。连接后使用独立的本地数据目录，保留真实对话与记忆。</p>
          <label>服务地址<input required type="url" value={modelUrl} onChange={e => setModelUrl(e.target.value)} placeholder="https://你的服务地址/v1" autoComplete="off" /></label>
          <label>模型名称<input required value={modelName} onChange={e => setModelName(e.target.value)} placeholder="填写服务提供的模型名" autoComplete="off" /></label>
          <label>API 密钥<input type="password" value={key} onChange={e => setKey(e.target.value)} placeholder={info.model.configured ? '已保存；留空保留原密钥' : '在此填写，不会回显'} autoComplete="new-password" /></label>
          <p className="field-note">密钥只保存在本项目的本地服务中，不写入浏览器存储或工作日志。无需密钥的本地服务会使用非秘密占位值。</p>
          {info.mode === 'fixture' && <div className="inline-info">当前是隔离演示。连接后会进入独立的真实会话，演示记录不混入你的记忆。</div>}
          <button className="primary-button" disabled={busy}>{busy ? <LoaderCircle className="spin" size={16} /> : <Plug size={16} />}保存并连接</button>
        </form>}</>}
        {tab === 'voice' && <>
          <MicrophoneSettings />
          {info.provider === 'reachai' ? <ReachaiSettings info={info} refreshed={refreshed} voiceOnly /> : <><form onSubmit={event => { event.preventDefault(); run(async () => {
            await post('/companion/settings/asr', { url: asrUrl.trim(), model: asrModel.trim(), key: asrKey.trim() }); setAsrKey(''); await refreshed(); setNote('语音输入已保存。点击主界面的麦克风即可说话。');
          }); }}>
            <h3><Mic size={18} />语音输入</h3><p>使用你指定的语音识别服务。只有点击麦克风录音后，声音才会发送到该地址。</p>
            <label>转写接口完整地址<input required type="url" value={asrUrl} onChange={e => setAsrUrl(e.target.value)} placeholder="https://语音服务/v1/audio/transcriptions" /></label>
            <label>识别模型<input required value={asrModel} onChange={e => setAsrModel(e.target.value)} placeholder="填写语音服务的模型名" /></label>
            <label>语音识别密钥<input type="password" value={asrKey} onChange={e => setAsrKey(e.target.value)} placeholder={info.asr.configured ? '留空保留原密钥' : '本地服务可留空'} autoComplete="new-password" /></label>
            <button className="secondary-button" disabled={busy}>保存语音输入</button>
          </form>
          <form className="separated-form" onSubmit={event => { event.preventDefault(); run(async () => {
            const tts = { provider: voiceProvider, voice: voiceId, ...(voiceKey ? voiceProvider === 'fish' ? { fishKey: voiceKey } : { key: voiceKey } : {}), ...(voiceProvider === 'chatterbox' ? { baseUrl: voiceUrl } : {}) };
            await request('/api/config', { method: 'PUT', body: JSON.stringify({ tts }) }); setVoiceKey(''); await refreshed(); setNote('助理声音已保存。');
          }); }}>
            <h3><Volume2 size={18} />助理声音</h3>
            <label>声音服务<select value={voiceProvider} onChange={e => setVoiceProvider(e.target.value)}><option value="elevenlabs">ElevenLabs</option><option value="fish">Fish Audio</option><option value="chatterbox">本地 Chatterbox 兼容服务</option></select></label>
            {voiceProvider === 'chatterbox' ? <label>语音服务地址<input required type="url" value={voiceUrl} onChange={e => setVoiceUrl(e.target.value)} placeholder="http://127.0.0.1:端口" /></label> : <label>声音服务密钥<input type="password" value={voiceKey} onChange={e => setVoiceKey(e.target.value)} placeholder="留空保留已保存的密钥" autoComplete="new-password" /></label>}
            <label>声音 ID<input required value={voiceId} onChange={e => setVoiceId(e.target.value)} placeholder="在所选服务中获取声音 ID" /></label>
            <button className="secondary-button" disabled={busy}>保存助理声音</button>
          </form></>}
          <p className="field-note">语音对话只需开启一次，说完停顿 2 秒自动发送；回复播完继续听下一句。点击“转为打字”关闭麦克风。打开设置时暂停倾听，关闭设置后继续；文字草稿保留。</p>
          <label className="switch-row"><span>也读出打字对话的回复<small>语音回复自动播报；历史记录不会重播</small></span><input type="checkbox" checked={autoRead} onChange={e => setAutoRead(e.target.checked)} /></label>
        </>}
        {tab === 'memory' && <>
          <h3>她记得的事</h3><p>偏好与长期信息可以在这里检查和纠正。保存时会校验版本，避免覆盖刚更新的记忆。</p>
          {!memory && !error ? <p className="loading-line"><LoaderCircle size={16} className="spin" />正在读取记忆…</p> : <>
            <label className="sr-only" htmlFor="memory-content">助理记忆内容</label><textarea id="memory-content" className="memory-editor" value={draft} onChange={e => { setDraft(e.target.value); setDirty(true); }} spellCheck={false} placeholder="当前还没有长期记忆。" />
            {conflict && <div className="conflict-box"><strong>记忆刚刚发生了变化</strong><p>你的编辑仍在上方。对照下面的当前版本合并后再保存。</p><pre>{conflict.text}</pre><button className="secondary-button" onClick={() => { setMemory(conflict); setConflict(null); setNote('已采用当前版本号，请合并内容后保存。'); }}>保留编辑并采用当前版本号</button></div>}
            <button className="primary-button" disabled={busy || !dirty || !!conflict} onClick={() => run(async () => {
              try {
                const saved = await request<MemoryDocument>(`/api/bots/${info.chiefId}/memory/file`, { method: 'PUT', body: JSON.stringify({ text: draft, expectedHash: memory?.hash }) });
                setMemory(saved); setDirty(false); setNote('记忆已保存。'); await refreshJournal();
              } catch (error) {
                if (error instanceof RequestError && error.status === 409) { setConflict(await request<MemoryDocument>(`/api/bots/${info.chiefId}/memory/file`)); return; }
                throw error;
              }
            })}><Check size={16} />保存记忆</button>
          </>}
          <div className="memory-history"><h3>最近的记忆变化</h3>
            {journalError ? <p className="field-note">{journalError}<button className="text-button" onClick={refreshJournal}>重新读取</button></p> : journal.length === 0 ? <p className="field-note">还没有记录到记忆修改。</p> : journal.map(row => <details className="memory-change" key={row.id}>
              <summary><span>{row.actor === 'person' ? '你修改了记忆' : row.actor === 'bot' ? '助理更新了记忆' : '记忆发生了变化'}<small>{new Date(row.at).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })} · {row.path}</small></span><span className="change-count">+{row.added} / −{row.removed}</span></summary>
              <pre>{row.diff || '没有文本差异'}</pre>
              {row.path === (memory?.path || 'MEMORY.md') && <button className="secondary-button" disabled={busy || dirty || !row.canRevert} onClick={() => run(async () => {
                try {
                  const restored = await post<MemoryDocument>(`/api/bots/${info.chiefId}/memory/journal/${encodeURIComponent(row.id)}/revert`, {});
                  setMemory(restored); setDraft(restored.text); setConflict(null); setNote('已撤销这次记忆修改，历史仍然保留。');
                } finally { await refreshJournal(); }
              })}>撤销这次修改</button>}
              {dirty ? <p className="field-note">先保存或关闭当前编辑，再撤销历史修改。</p> : !row.canRevert && <p className="field-note">记忆已有后续修改，当前无法直接撤销这一条。</p>}
            </details>)}
          </div>
          {info.mode === 'fixture' && <p className="field-note">这是演示环境的记忆；正式连接使用独立目录。</p>}
        </>}
        {tab === 'appearance' && <>
          <ChiefStyleSetting />
          <h3>自在一点</h3>
          <label className="switch-row"><span>减少动态效果<small>保持人物清晰，关闭场景过渡动效</small></span><input type="checkbox" checked={reduced} onChange={e => setReduced(e.target.checked)} /></label>
          <div className="appearance-preview"><img src="/assets/companion-v1.png" alt="已确认的主助理形象" /><div><strong>私人书房</strong><p>沿用已确认的暖色书房和人物外观。</p><small>当前人物为分层静态图，实时口型尚未启用。</small></div></div>
          <p className="field-note">按 F11 或点击右上角可切换全屏；纯净视图会收起一般记录，后台任务继续。</p>
        </>}
        {note && <p className="feedback success" role="status"><Check size={16} />{note}</p>}
        {error && <p className="feedback error" role="alert"><AlertCircle size={16} />{error}</p>}
        {confirmClose && <div className="conflict-box"><strong>记忆还有未保存的编辑</strong><p>继续编辑可以保留这次修改。</p><div className="button-row"><button className="secondary-button" onClick={() => setConfirmClose(false)}><ArrowLeft size={16} />继续编辑</button><button className="danger-text" onClick={close}>放弃修改并关闭</button></div></div>}
      </div>
    </div>
  </div>;
}
