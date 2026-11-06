import { createHash } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fail } from './endpoints.mjs';

const ID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
export const SPECIALIST_TOOL_SCOPE = { allow: [
  ...['list_bots', 'coordinate_bots', 'create_options_card', 'memory_update', 'tool_result_read', 'skills_list', 'skill_manage'].map(name => 'mcp:agents:' + name),
  'mcp:workspace:*', 'mcp:assistant:*',
] };
// Widgets (tables, charts, choices) only for the Chief: the specialists' saved scope stays unchanged, so existing helpers still match it.
export const CHIEF_TOOL_SCOPE = { allow: [...SPECIALIST_TOOL_SCOPE.allow, 'mcp:agents:create_bot', 'mcp:agents:show_widget', 'mcp:agents:update_widget'] };
export function renameInput(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => !['botId', 'name'].includes(key)) || typeof body.botId !== 'string' || !ID.test(body.botId)) throw fail('请选择本团队的助理。');
  if (typeof body.name !== 'string' || !body.name.trim() || body.name.length > 80 || /[\x00-\x1f\x7f\u2028\u2029]/.test(body.name)) throw fail('名字需要 1–80 字，并保持在一行。');
  return { botId: body.botId, name: body.name.trim() };
}
export function specialistSettings() {
  return { approvalMode: 'ask', toolScope: structuredClone(SPECIALIST_TOOL_SCOPE),
    computer: 'off', browser: false, composio: false, mcpServers: [], chiefOfStaff: false };
}
export function recordSpecialists(path, chiefId, botIds, requestId) {
  const ids = [...new Set(botIds)].filter(id => ID.test(id) && id !== chiefId);
  if (!ID.test(chiefId) || !ids.length) return;
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify({ chiefId, botIds: ids, requestId, at: Date.now() }) + '\n', { mode: 0o600 });
}
export function recordedSpecialists(path, chiefId) {
  if (!existsSync(path)) return [];
  const ids = new Set();
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line) continue;
    try { const row = JSON.parse(line); if (row.chiefId === chiefId && Array.isArray(row.botIds)) for (const id of row.botIds) if (typeof id === 'string' && ID.test(id) && id !== chiefId) ids.add(id); } catch {}
  }
  return [...ids];
}
export function specialistInput(body) {
  if (!body || !ID.test(body.sendId || '') || Object.keys(body).some(key => !['sendId', 'name', 'role', 'instructions'].includes(key))) throw fail('小助理创建请求无效。');
  const result = { sendId: body.sendId };
  for (const [key, label, limit] of [['name', '名字', 80], ['role', '职责', 120], ['instructions', '工作方式', 1000]]) {
    const value = body[key];
    if (typeof value !== 'string' || !value.trim() || value.trim().length > limit || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value) || key !== 'instructions' && /[\r\n]/.test(value)) throw fail(`请填写有效的${label}，最多 ${limit} 字。`);
    result[key] = value.trim();
  }
  return result;
}
export const specialistFingerprint = ({ name, role, instructions }) => createHash('sha256').update(JSON.stringify([name, role, instructions])).digest('hex');
