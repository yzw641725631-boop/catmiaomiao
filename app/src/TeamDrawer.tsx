import { useEffect, useRef, useState } from 'react';
import { ArrowRight, Check, LoaderCircle, Pencil, Plus, UserRound, X } from 'lucide-react';
import type { WireBot } from './types.ts';

export interface SpecialistDraft { sendId: string; name: string; role: string; instructions: string }
export function TeamDrawer({ chief, bots, create, rename, close, assign }: { chief?: WireBot; bots: WireBot[]; create(input: SpecialistDraft): Promise<{ botId: string; name: string }>; rename(botId: string, name: string): Promise<{ name: string }>; close(): void; assign(bot: WireBot): void }) {
  const [editing, setEditing] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [created, setCreated] = useState('');
  const [name, setName] = useState(''), [role, setRole] = useState(''), [instructions, setInstructions] = useState('');
  const [renaming, setRenaming] = useState<string | null>(null), [newName, setNewName] = useState(''), [renamed, setRenamed] = useState('');
  const renameInput = useRef<HTMLInputElement>(null);
  const attempt = useRef<{ fingerprint: string; id: string } | null>(null), submitting = useRef(false);
  const dialog = useRef<HTMLElement>(null), nameInput = useRef<HTMLInputElement>(null), restoreFocus = useRef(true);
  useEffect(() => { const prior = document.activeElement as HTMLElement | null; dialog.current?.focus(); return () => { if (restoreFocus.current) prior?.focus(); }; }, []);
  useEffect(() => { if (editing && !busy) nameInput.current?.focus(); else dialog.current?.focus(); }, [editing, busy]);
  useEffect(() => { if (renaming && !busy) { renameInput.current?.focus(); renameInput.current?.select(); } }, [renaming, busy]);
  const saveName = async (bot: WireBot) => {
    if (submitting.current || !newName.trim()) return;
    submitting.current = true; setBusy(true); setError('');
    try { const result = await rename(bot.id, newName.trim()); setRenamed(`已改名为 ${result.name}`); setRenaming(null); }
    catch (error) { setError(error instanceof Error ? error.message : '改名未完成，请重试。'); }
    finally { submitting.current = false; setBusy(false); }
  };
  const member = (bot: WireBot, isChief = false) => <article className="team-member" key={bot.id}>
    <span className="team-member-avatar"><UserRound size={20} /></span><div>
      {renaming === bot.id ? <form className="team-rename-form" onSubmit={event => { event.preventDefault(); void saveName(bot); }}>
        <label htmlFor={`rename-${bot.id}`}>助理名字</label><input id={`rename-${bot.id}`} ref={renameInput} required maxLength={80} value={newName} disabled={busy} onChange={event => setNewName(event.target.value)} />
        <div className="button-row"><button className="primary-button" disabled={busy || !newName.trim()}>{busy ? <LoaderCircle size={14} className="spin" /> : <Check size={14} />}保存名字</button><button className="text-button" type="button" disabled={busy} onClick={() => { setRenaming(null); setError(''); }}>取消</button></div>
      </form> : <div className="team-name-row"><h3>{bot.name}</h3><button className="icon-button" disabled={busy} aria-label={`修改${bot.name}的名字`} onClick={() => { setRenaming(bot.id); setNewName(bot.name); setError(''); setRenamed(''); setCreated(''); setEditing(false); }}><Pencil size={14} /></button></div>}
      <p>{isChief ? '主助理 · 和你交流、协调团队' : bot.title || bot.description || '协助主助理完成工作'}</p><small>{bot.busy ? '正在工作' : isChief ? '随时可以和我聊' : '可以安排工作'}</small>
    </div>
    {!isChief && renaming !== bot.id && <button className="team-assign" disabled={busy} onClick={() => { restoreFocus.current = false; assign(bot); }} aria-label={`给${bot.name}安排工作`}><span>安排工作</span><ArrowRight size={16} /></button>}
  </article>;
  const submit = async () => {
    if (submitting.current || !name.trim() || !role.trim()) return;
    const workStyle = instructions.trim() || `用中文完成${role.trim()}。先说明结论和实际结果，依据需要列出来源；遇到缺失信息向主助理说明。只使用任务中已经接通和授权的工具，完成后回报主助理。`;
    const fingerprint = JSON.stringify([name.trim(), role.trim(), workStyle]);
    if (attempt.current?.fingerprint !== fingerprint) attempt.current = { fingerprint, id: crypto.randomUUID() };
    submitting.current = true; setBusy(true); setError('');
    try { const result = await create({ sendId: attempt.current.id, name: name.trim(), role: role.trim(), instructions: workStyle }); setCreated(result.name); setEditing(false); setName(''); setRole(''); setInstructions(''); attempt.current = null; }
    catch (error) { setError(error instanceof Error ? error.message : '创建未完成，请重试。'); }
    finally { submitting.current = false; setBusy(false); }
  };
  return <div className="modal-backdrop" onClick={event => event.target === event.currentTarget && !busy && close()}>
    <section className="settings-drawer team-drawer" role="dialog" aria-modal="true" aria-labelledby="team-title" tabIndex={-1} ref={dialog} onKeyDown={event => {
      if (event.key === 'Escape') { event.stopPropagation(); if (!busy) { if (renaming) { setRenaming(null); setError(''); } else close(); } }
      if (event.key === 'Tab') { const controls = [...(dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),textarea:not(:disabled)') || [])]; if (event.shiftKey && (document.activeElement === controls[0] || document.activeElement === dialog.current)) { event.preventDefault(); controls.at(-1)?.focus(); } else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus(); } }
    }}>
      <header className="drawer-header"><div><span className="eyebrow">一起把事情做好</span><h2 id="team-title">我的助理 <small>{bots.length + (chief ? 1 : 0)}</small></h2></div><button className="icon-button" aria-label="关闭小助理面板" disabled={busy} onClick={close}><X size={20} /></button></header>
      <div className="settings-content team-content">
        <p className="team-intro">给每位小助理一个明确的职责，主助理会把合适的工作交给他们。也可以直接在对话里说“帮我创建一位……助理”。</p>
        {created && <p className="feedback success" role="status"><Check size={16} />{created} 已加入，可以安排工作了。</p>}
        {renamed && <p className="feedback success" role="status"><Check size={16} />{renamed}</p>}
        {chief && <div className="team-chief">{member(chief, true)}</div>}
        {!editing && <button className="team-create-button" disabled={busy} onClick={() => { setEditing(true); setRenaming(null); setError(''); setCreated(''); setRenamed(''); }}><Plus size={18} />添加小助理</button>}
        {editing && <form className="team-create-form" onSubmit={event => { event.preventDefault(); void submit(); }}>
          <h3>认识一位新小助理</h3>
          <label>名字<input ref={nameInput} required maxLength={80} value={name} disabled={busy} onChange={event => setName(event.target.value)} placeholder="例如：行程助理" /></label>
          <label>负责什么<input required maxLength={120} value={role} disabled={busy} onChange={event => setRole(event.target.value)} placeholder="例如：规划行程、比较交通和住宿" /></label>
          <label>如何工作 <span>选填</span><textarea rows={4} maxLength={1000} value={instructions} disabled={busy} onChange={event => setInstructions(event.target.value)} placeholder="例如：先给我两种选择，再详细安排，列出信息来源。" /></label>
          <div className="button-row"><button className="primary-button" disabled={busy || !name.trim() || !role.trim()}>{busy ? <LoaderCircle size={16} className="spin" /> : <Plus size={16} />}{busy ? '正在创建…' : '创建小助理'}</button><button className="text-button" type="button" disabled={busy} onClick={() => setEditing(false)}>取消</button></div>
        </form>}
        {error && <p className="feedback error" role="alert">{error}</p>}
        <div className="team-member-list">{bots.map(bot => member(bot))}</div>
      </div>
    </section>
  </div>;
}
