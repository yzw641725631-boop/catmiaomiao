import { useEffect, useRef, useState } from 'react';
import { LoaderCircle, Mic, RefreshCw, Square } from 'lucide-react';
import { MicrophoneProbe, selectedMicrophone, selectMicrophone, type InputLevel } from './microphone.ts';

export function MicrophoneSettings() {
  const [deviceId, setDeviceId] = useState(selectedMicrophone);
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [testing, setTesting] = useState(false);
  const [level, setLevel] = useState<InputLevel | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState(false);
  const probe = useRef<MicrophoneProbe | null>(null);
  const mounted = useRef(true);
  const refresh = async () => {
    try { const all = await navigator.mediaDevices?.enumerateDevices(); if (mounted.current) setDevices((all || []).filter(device => device.kind === 'audioinput' && !!device.deviceId)); }
    catch { if (mounted.current) { setMessage('设备列表暂时无法读取，请先允许使用麦克风。'); setError(true); } }
  };
  const stop = () => { probe.current?.cancel(); probe.current = null; setTesting(false); };
  useEffect(() => {
    mounted.current = true; void refresh();
    const media = navigator.mediaDevices; media?.addEventListener('devicechange', refresh);
    return () => { mounted.current = false; probe.current?.cancel(); media?.removeEventListener('devicechange', refresh); };
  }, []);
  const test = async () => {
    if (testing) { stop(); setMessage('本地测试已停止。'); return; }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.AudioWorkletNode) { setError(true); setMessage('当前窗口不支持麦克风采集，请使用新版 Chrome / Edge。'); return; }
    setTesting(true); setLevel(null); setError(false); setMessage('请对着耳机麦克风说话，观察音量条。测试 15 秒后自动停止。');
    const session = new MicrophoneProbe(value => { if (mounted.current) setLevel(value); }, (text, failed) => { if (mounted.current) { probe.current = null; setTesting(false); setMessage(text); setError(failed); } });
    probe.current = session; await session.start(deviceId); if (mounted.current) void refresh();
  };
  const db = level?.rms ? `${(20 * Math.log10(level.rms)).toFixed(0)} dBFS` : '无信号';
  return <section className="microphone-settings" aria-labelledby="microphone-title">
    <h3 id="microphone-title"><Mic size={18} />麦克风</h3>
    <p>选择你正在使用的耳机输入。测试只检查本机音量，不保存或上传声音。</p>
    <label>输入设备<select aria-label="麦克风输入设备" value={deviceId} disabled={testing} onChange={event => { const id = event.target.value; selectMicrophone(id); setDeviceId(id); setLevel(null); setMessage('输入设备已保存，下次录音使用此麦克风。'); setError(false); }}>
      <option value="">系统默认麦克风</option>
      {deviceId && !devices.some(device => device.deviceId === deviceId) && <option value={deviceId}>已选麦克风 · 需重新读取设备</option>}
      {devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `麦克风 ${index + 1}`}</option>)}
    </select></label>
    <div className="button-row"><button className="secondary-button" type="button" disabled={testing} onClick={refresh}><RefreshCw size={14} />重新读取设备</button><button className="secondary-button" type="button" onClick={test}>{testing ? <Square size={14} /> : <Mic size={14} />}{testing ? '停止测试' : '测试麦克风'}</button></div>
    <div className="microphone-meter-row"><meter aria-label="麦克风输入音量" min={0} max={100} value={level?.percent || 0} /><output>{testing && !level ? <><LoaderCircle size={12} className="spin" />等待音频…</> : db}</output></div>
    {level && <p className="field-note microphone-reading">当前输入：{level.label} · {level.muted ? '设备已静音' : level.rms >= 0.003 ? '收到声音' : level.rms > 0.00005 ? '声音较小' : '暂未收到声音'} · 已采集 {level.seconds.toFixed(1)} 秒</p>}
    {message && <p className={`feedback ${error ? 'error' : 'success'}`} role={error ? 'alert' : 'status'}>{message}</p>}
  </section>;
}
