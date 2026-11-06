import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { writeFileAtomic } from '../upstream/OpenMausBot/server/atomic.ts';
import { fail } from './endpoints.mjs';

const flags = ['readReplies', 'reducedMotion', 'pureView'];
const fields = [...flags, 'speechRate', 'voiceId'];

// GUI and conversational tools share one persisted source. Credentials and
// model/access configuration are deliberately absent from this interface.
export class ConversationSettings {
  constructor(runtime) { this.runtime = runtime; this.listeners = new Set(); }
  read() { return existsSync(this.runtime.settingsFile) ? JSON.parse(readFileSync(this.runtime.settingsFile, 'utf8')) : {}; }
  snapshot() {
    const saved = this.read(), preferences = saved.interaction || {};
    return { revision: Number.isSafeInteger(preferences.revision) ? preferences.revision : 0,
      preferences: Object.fromEntries(flags.filter(key => typeof preferences[key] === 'boolean').map(key => [key, preferences[key]])),
      voice: { provider: this.runtime.activeProvider(), speechRate: saved.reachai?.speed ?? 1, voiceId: saved.reachai?.voice || '', configured: this.runtime.activeProvider() === 'reachai' && !!saved.reachai?.ttsId } };
  }
  update(patch) {
    if (!patch || typeof patch !== 'object' || Array.isArray(patch) || !Object.keys(patch).length || Object.keys(patch).some(key => !fields.includes(key))) throw fail('请指定要修改的声音或显示偏好。');
    for (const key of flags) if (Object.hasOwn(patch, key) && typeof patch[key] !== 'boolean') throw fail('偏好开关需要明确开启或关闭。');
    if (Object.hasOwn(patch, 'speechRate') && (typeof patch.speechRate !== 'number' || !Number.isFinite(patch.speechRate) || patch.speechRate < 0.5 || patch.speechRate > 2)) throw fail('语速需要在 0.5 到 2 倍之间。');
    if (Object.hasOwn(patch, 'voiceId') && (typeof patch.voiceId !== 'string' || patch.voiceId.length > 200 || /[\x00-\x1f\x7f\u2028\u2029]/.test(patch.voiceId))) throw fail('请提供有效的音色 ID，或留空使用默认音色。');
    if (this.runtime.switching || !this.runtime.current || this.runtime.current.closed) throw fail('助理正在重新连接，请稍后修改。', 409);
    const saved = this.read(), changesVoice = Object.hasOwn(patch, 'speechRate') || Object.hasOwn(patch, 'voiceId');
    if (changesVoice && (this.runtime.activeProvider() !== 'reachai' || !saved.reachai?.ttsId)) throw fail('当前还没有可调整的 Saturn Cloud 声音连接。', 409);
    const before = saved.interaction || {}, next = { ...saved, interaction: { ...before, revision: (Number.isSafeInteger(before.revision) ? before.revision : 0) + 1 } };
    for (const key of flags) if (Object.hasOwn(patch, key)) next.interaction[key] = patch[key];
    if (changesVoice) next.reachai = { ...saved.reachai,
      ...(Object.hasOwn(patch, 'speechRate') ? { speed: patch.speechRate } : {}),
      ...(Object.hasOwn(patch, 'voiceId') ? { voice: patch.voiceId.trim() } : {}) };
    mkdirSync(dirname(this.runtime.settingsFile), { recursive: true });
    writeFileAtomic(this.runtime.settingsFile, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
    this.emit();
    return { saved: true, changed: Object.keys(patch), settings: this.snapshot() };
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { const snapshot = this.snapshot(); for (const listener of this.listeners) { try { listener(snapshot); } catch {} } }
}
