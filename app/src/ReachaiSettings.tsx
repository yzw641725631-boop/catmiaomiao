import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertCircle, Check, LoaderCircle, Plug, RefreshCw, Square, Volume2 } from 'lucide-react';
import { post, request } from './api.ts';
import { SpeechController } from './speech.ts';
import type { PlaybackState } from './speech.ts';
import type { CompanionInfo, ReachaiInstance } from './types.ts';

export function ReachaiSettings({ info, refreshed, voiceOnly = false }: { info: CompanionInfo; refreshed: () => Promise<void>; voiceOnly?: boolean }) {
  const saved = info.reachai;
  const [url, setUrl] = useState(saved.url);
  const [key, setKey] = useState('');
  const [llmId, setLlmId] = useState(saved.llmId);
  const [asrId, setAsrId] = useState(saved.asrId);
  const [ttsId, setTtsId] = useState(saved.ttsId);
  const [voice, setVoice] = useState(saved.voice);
  const [speed, setSpeed] = useState(saved.speed);
  const [asrMode, setAsrMode] = useState(saved.asrMode);
  const [instances, setInstances] = useState<ReachaiInstance[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [feedbackAt, setFeedbackAt] = useState<'catalog' | 'save'>('catalog');
  const [playback, setPlayback] = useState<PlaybackState>({ status: 'idle', caption: '' });
  const speaker = useMemo(() => new SpeechController(setPlayback), []);
  const requestId = useRef(0);
  const abortLoad = useRef<AbortController | null>(null);
  const keyAvailable = !!key.trim() || (saved.keySaved && url.trim().replace(/\/$/, '') === saved.url);
  useEffect(() => { if (!saving) setSpeed(saved.speed); }, [saved.speed]);
  useEffect(() => { if (!saving) setVoice(saved.voice); }, [saved.voice]);

  const load = async (auto = false) => {
    const id = ++requestId.current;
    abortLoad.current?.abort();
    const abort = new AbortController(); abortLoad.current = abort;
    setLoading(true); setFeedbackAt('catalog'); setError(''); setNote('');
    try {
      const data = await request<{ instances: ReachaiInstance[] }>('/companion/reachai/instances', { method: 'POST', body: JSON.stringify({ url: url.trim(), key: key.trim() }), signal: abort.signal });
      if (id !== requestId.current) return;
      setInstances(data.instances); setLoaded(true);
      const active = (model: string, type: ReachaiInstance['modelType']) => data.instances.some(row => row.id === model && row.modelType === type && row.status === 'ACTIVE');
      if (!active(llmId, 'LLM')) {
        if (voiceOnly) setError('当前 LLM 已不可用，请到“模型连接”中重新选择，再保存声音。');
        else setLlmId(data.instances.find(row => row.modelType === 'LLM' && row.status === 'ACTIVE')?.id || '');
      }
      if (!auto) setNote('模型列表已更新。请选择要使用的实例，再保存连接。');
    } catch (error) { if (!abort.signal.aborted && id === requestId.current) setError(error instanceof Error ? error.message : '模型列表暂时无法读取。'); }
    finally { if (id === requestId.current) setLoading(false); }
  };
  useEffect(() => {
    if (saved.keySaved) void load(true);
    return () => { requestId.current++; abortLoad.current?.abort(); speaker.stop(); };
  }, []);

  const changedAddress = (value: string) => { abortLoad.current?.abort(); requestId.current++; setLoading(false); setUrl(value); setLoaded(false); setInstances([]); setNote(''); };
  const selector = (type: ReachaiInstance['modelType'], value: string, set: (id: string) => void, title: string, optional = false) => <label>{title}
    <select value={value} onChange={event => set(event.target.value)} required={!optional} disabled={saving || loading}>
      <option value="">{optional ? '暂不启用' : loaded ? '请选择可用实例' : '先读取可用模型'}</option>
      {value && !instances.some(item => item.id === value) && <option value={value}>{loaded ? '已保存实例 · 当前不可用' : '已保存的实例 · 等待读取名称'}</option>}
      {instances.filter(item => item.modelType === type).map(item => <option key={item.id} value={item.id} disabled={item.status !== 'ACTIVE'}>{item.name}{item.status !== 'ACTIVE' ? ' · 已停用' : ''}</option>)}
    </select>
    {loaded && !instances.some(item => item.modelType === type && item.status === 'ACTIVE') && <small className="field-note">平台暂未提供可用的 {type} 实例。</small>}
  </label>;

  return <form className="reachai-form" onSubmit={async event => {
    event.preventDefault(); if (saving || loading) return;
    speaker.stop(); setSaving(true); setFeedbackAt('save'); setError(''); setNote('');
    try {
      await post('/companion/settings/reachai', { url: url.trim(), key: key.trim(), llmId, asrId, ttsId, voice: voice.trim(), speed, asrMode });
      setKey(''); await refreshed(); setNote('Saturn Cloud 设置已保存。模型与语音请求会使用所选实例；实际响应将在对话中验证。');
    } catch (error) { setError(error instanceof Error ? error.message : '连接未保存，请重试。'); }
    finally { setSaving(false); }
  }}>
    <div className="service-heading"><span className="service-mark"><Plug size={21} /></span><div><h3>{voiceOnly ? 'Saturn Cloud 声音' : '连接 Saturn Cloud'}</h3><p>模型与声音统一管理，相处的记忆留在这台电脑。</p></div></div>
    {!voiceOnly && <>
      <label>平台地址<input type="url" required autoComplete="off" value={url} onChange={event => changedAddress(event.target.value)} placeholder="https://saturn.starhubs.online" disabled={saving} /></label>
      <label>平台 API 密钥<input type="password" value={key} onChange={event => { abortLoad.current?.abort(); requestId.current++; setLoading(false); setKey(event.target.value); setLoaded(false); setInstances([]); }} placeholder={saved.keySaved ? '已保存；同一平台留空保留' : '仅在本地保存，不会回显'} autoComplete="new-password" disabled={saving} /></label>
      <p className="field-note">使用有 model:read、model:invoke 权限的 API Key。更换平台地址时需重新填写。</p>
    </>}
    <button type="button" className="secondary-button" disabled={saving || loading || !keyAvailable} onClick={() => load()}>{loading ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{loading ? '正在读取可用模型…' : '读取可用模型'}</button>
    {feedbackAt === 'catalog' && note && <p className="feedback success catalog-feedback" role="status"><Check size={16} />{note}</p>}
    {feedbackAt === 'catalog' && error && <p className="feedback error catalog-feedback" role="alert"><AlertCircle size={16} />{error}</p>}
    <div className="reachai-models">
      {!voiceOnly && selector('LLM', llmId, setLlmId, '主助理与小助理使用的 LLM')}
      {selector('ASR', asrId, setAsrId, '录音转写模型', true)}
      <label>语音输入方式<select value={asrMode} onChange={event => setAsrMode(event.target.value as 'file' | 'realtime')} disabled={saving}><option value="file">录音结束后识别</option><option value="realtime">实时识别 · 平台统一引擎</option></select></label>
      {asrMode === 'realtime' && <p className="field-note">实时模式使用平台统一流式识别引擎。上方 ASR 实例用于录音转写，不改变实时引擎。</p>}
      {selector('TTS', ttsId, setTtsId, '助理声音模型', true)}
      <label>音色<input value={voice} onChange={event => setVoice(event.target.value)} placeholder="留空使用模型默认音色" disabled={saving} /></label>
      <label>语速<span className="range-setting"><input type="range" min="0.5" max="2" step="0.05" value={speed} onChange={event => setSpeed(Number(event.target.value))} disabled={saving} /><output>{speed.toFixed(2)}×</output></span></label>
    </div>
    {info.mode === 'fixture' && <p className="inline-info">保存后进入独立的真实会话，演示记录不会混入长期记忆。</p>}
    <div className="button-row"><button className="primary-button" disabled={saving || loading || !llmId || !keyAvailable}>{saving ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />}{saving ? '正在保存连接…' : '保存并使用 Saturn Cloud'}</button>
      {info.provider === 'reachai' && info.voice.ready && <button type="button" className="secondary-button" onClick={() => playback.status !== 'idle' ? speaker.stop() : void speaker.speak('你好，我在这里。有什么事需要我帮你？')}>{playback.status !== 'idle' ? <Square size={14} /> : <Volume2 size={16} />}{playback.status !== 'idle' ? '停止试听' : '试听已保存的声音'}</button>}
    </div>
    {playback.status !== 'idle' && <p className="field-note" role="status">{playback.status === 'preparing' ? '正在准备声音…' : playback.caption}</p>}
    {feedbackAt === 'save' && note && <p className="feedback success" role="status"><Check size={16} />{note}</p>}
    {(feedbackAt === 'save' && error || playback.error) && <p className="feedback error" role="alert"><AlertCircle size={16} />{feedbackAt === 'save' && error || playback.error}</p>}
  </form>;
}
