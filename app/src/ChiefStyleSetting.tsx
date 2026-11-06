import { useEffect, useState, type FormEvent } from 'react';
import { Check } from 'lucide-react';
import { post, request } from './api.ts';

type Style = { preset: '' | 'concise' | 'warm' | 'detailed'; text: string };
const PRESETS: Array<[Style['preset'], string, string]> = [
  ['', '默认', '按主助理原来的方式'],
  ['concise', '简洁', '先给结论，少铺垫'],
  ['warm', '温和', '亲切一些，先回应感受'],
  ['detailed', '详细', '讲清理由和步骤'],
];

/** 主助理的说话风格：一组预设加一句补充，保存后对新回复生效。 */
export function ChiefStyleSetting() {
  const [style, setStyle] = useState<Style>();
  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    request<Style>('/companion/style').then(setStyle).catch(() => setError('暂时读不到说话风格，请稍后再打开。'));
  }, []);
  if (!style) return error ? <p className="feedback error">{error}</p> : null;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true); setNote(''); setError('');
    try { setStyle(await post<Style>('/companion/style', style)); setNote('已保存，从下一条回复开始生效。'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '没有保存成功，请重试。'); }
    finally { setSaving(false); }
  };
  return (
    <form className="style-setting" onSubmit={save}>
      <h3>说话风格</h3>
      <p className="field-note">主助理之后的回复会按这里的方式说话，已有的对话不变。</p>
      <div className="style-presets" role="radiogroup" aria-label="说话风格">
        {PRESETS.map(([id, label, hint]) => (
          <button
            key={id || 'default'}
            type="button"
            role="radio"
            aria-checked={style.preset === id}
            className={`style-chip ${style.preset === id ? 'selected' : ''}`}
            onClick={() => setStyle({ ...style, preset: id })}
          >
            <strong>{label}</strong>
            <small>{hint}</small>
          </button>
        ))}
      </div>
      <label className="style-extra">
        补充一句（可选）
        <textarea rows={2} maxLength={200} value={style.text} placeholder="比如：少用感叹号，称呼我小林" onChange={event => setStyle({ ...style, text: event.target.value })} />
        <small>{style.text.length} / 200</small>
      </label>
      <div className="button-row">
        <button className="primary-button" disabled={saving}>{saving ? '正在保存…' : '保存说话风格'}</button>
      </div>
      {note && <p className="feedback success" role="status"><Check size={16} />{note}</p>}
      {error && <p className="feedback error" role="alert">{error}</p>}
    </form>
  );
}
