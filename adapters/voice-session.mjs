export class VoiceSession {
  constructor({ now = () => Date.now(), changed = () => {} } = {}) { this.now = now; this.changed = changed; this.owner = null; }
  act(action, id) {
    if (!/^[a-f0-9-]{36}$/.test(id || '')) throw Object.assign(new Error('语音会话无效，请刷新页面。'), { status: 400 });
    if (action === 'claim') {
      if (this.owner?.id !== id) { this.owner = { id, until: this.now() + 45000 }; this.changed(); }
      else this.owner.until = this.now() + 45000;
      return { active: true };
    }
    if (action === 'release') { if (this.owner?.id === id) { this.owner = null; this.changed(); } return { active: false }; }
    if (action !== 'renew') throw Object.assign(new Error('语音动作无效。'), { status: 400 });
    this.assert(id); this.owner.until = this.now() + 45000; return { active: true };
  }
  assert(id) { if (!this.owner || this.owner.id !== id || this.owner.until <= this.now()) throw Object.assign(new Error('语音已切换到另一个页面或已暂停，请在当前页面重新开启。'), { status: 409 }); }
}
