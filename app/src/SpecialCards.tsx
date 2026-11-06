import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Check, ExternalLink, KeyRound, LogIn, Phone, X } from 'lucide-react';
import { post } from './api.ts';
import type { WireMessage } from './types.ts';

type Node = { type: string; id?: string; children?: Node[]; [prop: string]: unknown };
const str = (value: unknown) => (typeof value === 'string' ? value : typeof value === 'number' ? String(value) : '');
const kids = (node: Node) => (Array.isArray(node.children) ? node.children : []);

/** Read-only view of a bot widget. Fields and buttons are shown as text: answers go back through the conversation. */
function WidgetNode({ node }: { node: Node }): ReactNode {
  const children = kids(node).map((child, index) => <WidgetNode key={child.id || index} node={child} />);
  switch (node.type) {
    case 'Card':
    case 'Box':
    case 'Col':
    case 'Form':
    case 'Transition':
      return <div className="widget-stack">{children}</div>;
    case 'Row':
      return <div className="widget-row">{children}</div>;
    case 'ListView':
      return <ul className="widget-list">{kids(node).map((child, index) => <li key={child.id || index}><WidgetNode node={child} /></li>)}</ul>;
    case 'ListViewItem':
      return <div className="widget-row">{children}</div>;
    case 'Title':
      return <h4 className="widget-title">{str(node.value)}</h4>;
    case 'Text':
    case 'Markdown':
      return <p className="widget-text">{str(node.value)}</p>;
    case 'Caption':
    case 'Label':
      return <p className="widget-caption">{str(node.value)}</p>;
    case 'Badge':
      return <span className="widget-badge">{str(node.label)}</span>;
    case 'Divider':
      return <hr className="widget-divider" />;
    case 'Progress': {
      const value = Math.max(0, Math.min(100, Number(node.value) || 0));
      return (
        <div className="widget-progress">
          {str(node.label) && <span>{str(node.label)}</span>}
          <progress max={100} value={value} aria-label={str(node.label) || '进度'} />
        </div>
      );
    }
    case 'Table':
      return <WidgetTable node={node} />;
    case 'Chart':
      return <WidgetChart node={node} />;
    case 'Button':
      return <span className="widget-choice">{str(node.label)}</span>;
    case 'Select':
    case 'RadioGroup':
    case 'DatePicker':
    case 'TimePicker':
    case 'DayPicker':
    case 'Checkbox':
    case 'Input':
    case 'Textarea':
      return <p className="widget-caption">{str(node.label) || '需要填写的内容'}：请直接在对话里告诉助理。</p>;
    default:
      return children.length ? <div className="widget-stack">{children}</div> : null;
  }
}

function cellText(cell: Node): string {
  return kids(cell).map(child => str(child.value) || str(child.label) || cellText(child)).filter(Boolean).join(' ');
}

function WidgetTable({ node }: { node: Node }) {
  const rows = kids(node);
  const header = rows.find(row => row.header === true);
  const body = rows.filter(row => row !== header);
  return (
    <div className="widget-table-wrap">
      <table className="widget-table">
        {header && (
          <thead>
            <tr>{kids(header).map((cell, index) => <th key={cell.id || index} scope="col">{cellText(cell)}</th>)}</tr>
          </thead>
        )}
        <tbody>
          {body.map((row, index) => (
            <tr key={row.id || index}>{kids(row).map((cell, column) => <td key={cell.id || column}>{cellText(cell)}</td>)}</tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Bars, lines and areas from the normalised chart spec (data rows, series by dataKey, xAxis.dataKey). */
function WidgetChart({ node }: { node: Node }) {
  const data = (Array.isArray(node.data) ? node.data : []) as Array<Record<string, unknown>>;
  const series = (Array.isArray(node.series) ? node.series : []) as Array<{ type?: string; dataKey: string; label?: string }>;
  const xKey = str((node.xAxis as { dataKey?: string } | undefined)?.dataKey);
  const values = data.flatMap(row => series.map(item => Number(row[item.dataKey]))).filter(Number.isFinite);
  if (!data.length || !series.length || !values.length) return null;
  const max = Math.max(0, ...values), min = Math.min(0, ...values), span = max - min || 1;
  const width = 480, height = 180, left = 8, bottom = 22, top = 10;
  const plot = { w: width - left * 2, h: height - bottom - top };
  const step = plot.w / data.length;
  const y = (value: number) => top + plot.h - ((value - min) / span) * plot.h;
  const bars = series.filter(item => (item.type || 'bar') === 'bar');
  const barWidth = Math.max(4, (step * 0.7) / Math.max(1, bars.length));
  const summary = data.map(row => `${str(row[xKey])} ${series.map(item => `${item.label || item.dataKey} ${str(row[item.dataKey])}`).join('，')}`).join('；');
  return (
    <figure className="widget-chart">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label={summary}>
        <line x1={left} x2={width - left} y1={y(0)} y2={y(0)} className="chart-axis" />
        {data.map((row, index) => (
          <g key={index}>
            {bars.map((item, n) => {
              const value = Number(row[item.dataKey]);
              if (!Number.isFinite(value)) return null;
              const x = left + index * step + (step - barWidth * bars.length) / 2 + n * barWidth;
              return <rect key={item.dataKey} x={x} y={Math.min(y(value), y(0))} width={barWidth - 2} height={Math.abs(y(0) - y(value))} rx={3} className={`chart-series-${n}`} />;
            })}
            <text x={left + index * step + step / 2} y={height - 6} textAnchor="middle" className="chart-label">{str(row[xKey]).slice(0, 8)}</text>
          </g>
        ))}
        {series.filter(item => item.type === 'line' || item.type === 'area').map((item, n) => {
          const points = data.map((row, index) => [left + index * step + step / 2, y(Number(row[item.dataKey]) || 0)]);
          return <polyline key={item.dataKey} points={points.map(point => point.join(',')).join(' ')} className={`chart-line chart-series-${n + bars.length}`} />;
        })}
      </svg>
      {series.length > 1 && <figcaption>{series.map(item => item.label || item.dataKey).join(' · ')}</figcaption>}
    </figure>
  );
}

type CardRef = { botId: string; threadId: string; messageId: string };

/** Chinese names for upstream's credential targets (shared/credential-request.ts); its labels and descriptions are English. */
const SECRET_NAMES: Record<string, [string, string]> = {
  xaiApiKey: ['xAI API 密钥', '用于 Grok 模型。'],
  boxToken: ['Box 令牌', '用于连接 Box 云盘。'],
  opencodeGoApiKey: ['OpenCode Go 密钥', '用于 OpenCode Go 模型。'],
  ttsKey: ['语音播报密钥', '用于朗读回复。'],
  fishAudioKey: ['Fish Audio 密钥', '用于 Fish Audio 声音。'],
  openaiImageApiKey: ['OpenAI 生图密钥', '用于生成图片。'],
  onePasswordToken: ['1Password 服务令牌', '用于读取你保存在 1Password 的登录。'],
};

/** Secure key entry. The value is read from the input once at submit, posted, and the input is cleared; it is never kept in React state. */
function SecretCard({ message, card }: { message: WireMessage; card: CardRef }) {
  const secret = message.secret!;
  const [label, purpose] = SECRET_NAMES[secret.target] || [secret.label, secret.description];
  const input = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<'idle' | 'saving' | 'saved' | 'dismissed'>(secret.provided ? 'saved' : secret.dismissed ? 'dismissed' : 'idle');
  const [error, setError] = useState('');
  if (secret.superseded) return <p className="card-quiet">这张密钥卡已被新的请求代替。</p>;
  if (state === 'saved') return <p className="card-quiet"><Check size={13} />{label}已安全保存，助理可以使用但看不到它。</p>;
  if (state === 'dismissed') return <p className="card-quiet"><X size={13} />已跳过这次密钥填写。</p>;
  const save = async (event: FormEvent) => {
    event.preventDefault();
    const field = input.current;
    const value = field?.value.trim() || '';
    if (!value || state === 'saving') return;
    if (field) field.value = '';
    setState('saving'); setError('');
    try { await post('/companion/cards/secret', { ...card, value }); setState('saved'); }
    catch (reason) { setState('idle'); setError(reason instanceof Error ? reason.message : '没有保存成功，请重试。'); }
  };
  const dismiss = async () => {
    try { await post('/companion/cards/secret/dismiss', card); setState('dismissed'); }
    catch (reason) { setError(reason instanceof Error ? reason.message : '没有完成，请重试。'); }
  };
  return (
    <form className="special-card secret-card" onSubmit={save} autoComplete="off">
      <div className="special-card-head"><KeyRound size={16} /><strong>需要你填写：{label}</strong></div>
      <p>{purpose}助理可以使用，但看不到它。</p>
      <label className="sr-only" htmlFor={'secret-' + message.id}>{label}</label>
      <input id={'secret-' + message.id} ref={input} type="password" autoComplete="off" spellCheck={false} maxLength={4096} placeholder="粘贴后点保存" />
      <p className="card-help">只保存在这台电脑的助理服务里，不会显示在对话或日志中。{secret.helpUrl && <a href={secret.helpUrl} target="_blank" rel="noreferrer noopener">在哪里获取<ExternalLink size={12} /></a>}</p>
      <div className="special-card-actions">
        <button className="primary-button" disabled={state === 'saving'}>{state === 'saving' ? '正在保存…' : '保存'}</button>
        <button type="button" className="secondary-button" onClick={() => void dismiss()}>先不填</button>
      </div>
      {error && <p className="feedback error" role="alert">{error}</p>}
    </form>
  );
}

function SignInCard({ message, card }: { message: WireMessage; card: CardRef }) {
  const signIn = message.signIn!;
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'cancelled'>(signIn.done ? 'done' : signIn.cancelled ? 'cancelled' : 'idle');
  const [error, setError] = useState('');
  if (signIn.superseded) return <p className="card-quiet">这次登录请求已被新的请求代替。</p>;
  if (state === 'done') return <p className="card-quiet"><Check size={13} />已完成 {signIn.site} 的登录，助理接着处理。</p>;
  if (state === 'cancelled') return <p className="card-quiet"><X size={13} />已取消 {signIn.site} 的登录。</p>;
  const answer = async (value: 'done' | 'cancel') => {
    setState('busy'); setError('');
    try { await post('/companion/cards/sign-in', { ...card, answer: value }); setState(value === 'done' ? 'done' : 'cancelled'); }
    catch (reason) { setState('idle'); setError(reason instanceof Error ? reason.message : '没有完成，请重试。'); }
  };
  return (
    <div className="special-card signin-card">
      <div className="special-card-head"><LogIn size={16} /><strong>需要你登录 {signIn.site}</strong></div>
      {signIn.reason && <p>{signIn.reason}</p>}
      <p className="card-help">在助理使用的浏览器里自己登录，助理看不到密码。登录好再点“已完成登录”。</p>
      <div className="special-card-actions">
        <button className="primary-button" disabled={state === 'busy'} onClick={() => void answer('done')}>已完成登录</button>
        <button className="secondary-button" disabled={state === 'busy'} onClick={() => void answer('cancel')}>取消</button>
      </div>
      {error && <p className="feedback error" role="alert">{error}</p>}
    </div>
  );
}

/** One card for the special kinds; returns null for kinds it does not handle. */
export function SpecialCard({ message, botId, threadId }: { message: WireMessage; botId: string; threadId: string }) {
  const card = { botId, threadId, messageId: message.id };
  if (message.kind === 'widget' && message.widget?.root) {
    const settled = message.widget.settled;
    return (
      <div className="special-card widget-card">
        <WidgetNode node={message.widget.root as Node} />
        {settled && <p className="card-quiet"><Check size={13} />已选择：{settled.label}</p>}
      </div>
    );
  }
  if (message.kind === 'secret' && message.secret) return <SecretCard message={message} card={card} />;
  if (message.kind === 'signin' && message.signIn) return <SignInCard message={message} card={card} />;
  if (message.kind === 'connector') return <p className="card-quiet">助理想连接 {message.connector?.label || '一个应用'}，这里暂时不能连接，可在对话里改用其他方式。</p>;
  if (message.kind === 'call') return <p className="card-quiet"><Phone size={13} />有一次通话记录，这里不显示通话内容。</p>;
  if (message.kind === 'screen') return <p className="card-quiet">助理分享了一个画面，这里暂不显示。</p>;
  if (message.kind === 'compaction') return <p className="card-quiet">较早的对话已整理成摘要，助理仍然记得要点。</p>;
  return null;
}
