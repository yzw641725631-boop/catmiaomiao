import { displayMessages, helperQuestionPending, visibleMessageText, type ConversationState } from './projection.ts';
import type { CompanionInfo, WireMessage, WireTask } from './types.ts';
export function workStatus(task: WireTask, messages: WireMessage[]) {
  const user = messages.findLast(item => item.role === 'user');
  if (user?.requestCancelled) return '已停止';
  if (task.activity === 'waiting-on-you') return '等待你确认';
  if (messages.some(item => item.kind === 'options' && item.card?.requestId && !item.card.answered && !item.card.expired && !item.card.dismissed)) return '等待你确认';
  if (task.busy) return '正在处理';
  if (task.waitingForTeammates) return '等待小助理';
  const final = messages.findLast(item => item.turnTerminal || item.tool?.terminal || item.threadRef && item.tool?.ok === false || item.kind === 'digest' && typeof item.turnSucceeded === 'boolean');
  if (final?.turnSucceeded === false || final?.tool?.ok === false) return '未完成';
  if (!final) return '等待安排';
  // A successful model turn can also say "I cannot access your files". Only
  // actual save + validation receipts justify a delivered artifact label.
  const generated=messages.some(m=>['workspace_create_document','workspace_create_spreadsheet'].includes(m.tool?.name||'')&&m.tool?.ok===true);
  return generated||messages.some(m => m.tool?.name === 'workspace_write_file' && m.tool.ok === true) && messages.some(m => m.tool?.name === 'workspace_check_file' && m.tool.ok === true) ? '已交付' : '已回复';
}
export function workAttention(info: CompanionInfo | null, state: ConversationState, root: string) {
  const rows = workRows(info, state, root), threads = new Set([root, ...rows.map(row => row.threadId)]);
  return Object.entries(state.messages).flatMap(([threadId, messages]) => messages.filter(message => helperQuestionPending(message, state) && threads.has(message.threadRef!.threadId)).map(message => ({ threadId, message, botId: info!.chiefId, name: state.bots[info!.chiefId]?.name || '主助理', ...(info!.workThreadIds.includes(threadId) ? { workThreadId: threadId } : {}) })));
}
export function workTitle(task: WireTask, messages: WireMessage[]) {
  const first = messages.find(message => message.role === 'user' && message.text);
  const title = visibleMessageText(first || { id: '', at: 0, kind: 'text', role: 'user', text: task.title }).split(/\n\n本次工作唯一指定目录：/)[0];
  const label=title.replace(/\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\b/gi, '').replace(/data:[^\s]+/g,'附带网页').replace(/\s+/g, ' ').trim() || task.title;
  return label.length>72?label.slice(0,72)+'…':label;
}
export function workReplies(rows: ReturnType<typeof workRows>) {
  const latest = new Map<string, typeof rows[number]>();
  for (const row of rows) if (row.message.role === 'bot' && row.message.kind === 'text' && row.message.text?.trim() && !row.message.aside) latest.set(row.botId, row);
  return [...latest.values()].sort((a, b) => a.message.at - b.message.at);
}
export function workExcerpt(messages:WireMessage[]){const reply=messages.findLast(message=>message.role==='bot'&&message.kind==='text'&&message.turnTerminal)?.text||'';return reply.split(/\n\s*\n/)[0].replace(/^#{1,6}\s+/gm,'').replace(/\*\*|__|`/g,'').replace(/\[([^\]]+)\]\([^)]+\)/g,'$1').slice(0,110);}
export function artifactSource(rows: ReturnType<typeof workRows>, filePath: string) {
  const normalized = filePath.replaceAll('\\', '/');
  for (const row of [...workReplies(rows)].reverse()) for (const match of row.message.text!.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const path = match[1].replace(/^<|>$/g, ''), canonical = path.replaceAll('\\', '/');
    if (/^https?:|^\/\//i.test(path) || /^[a-z][a-z0-9+.-]*:/i.test(path) && !/^[a-z]:[\\/]/i.test(path)) continue;
    if (canonical === normalized || canonical.endsWith('/' + normalized)) return { ...row, downloadPath: path };
  }
  return undefined;
}
export function workEntries(info: CompanionInfo | null, state: ConversationState) {
  if (!info) return [];
  const entries = (state.bots[info.chiefId]?.tasks || []).filter(task => info.workThreadIds.includes(task.threadId)).map(task => ({ task, botId: info.chiefId, name: state.bots[info.chiefId]?.name || '主助理', evidence: true }));
  for (const botId of info.helperIds) for (const task of state.bots[botId]?.tasks || []) {
    if (task.openedBy?.botId === info.chiefId && task.openedBy.threadId === info.companionThreadId && !task.archivedAt) entries.push({ task, botId, name: state.bots[botId].name, evidence: false });
  }
  return entries.sort((a, b) => b.task.createdAt - a.task.createdAt);
}
export function workRows(info: CompanionInfo | null, state: ConversationState, root: string) {
  const entry = workEntries(info, state).find(item => item.task.threadId === root);
  if (!info || !entry) return [];
  const owners = new Map([[root, { botId: entry.botId, name: entry.name, ...(entry.evidence ? { workThreadId: root } : {}) }]]);
  for (let depth = 0; depth < 16; depth++) {
    let changed = false;
    for (const botId of info.helperIds) for (const task of state.bots[botId]?.tasks || []) {
      if (owners.has(task.threadId) || !task.openedBy?.threadId) continue;
      const parent = owners.get(task.openedBy.threadId);
      if (!parent || parent.botId !== task.openedBy.botId) continue;
      owners.set(task.threadId, { botId, name: state.bots[botId].name, ...(entry.evidence ? { workThreadId: root } : {}) }); changed = true;
    }
    if (!changed) break;
  }
  const rows = [...owners].flatMap(([threadId, owner]) => displayMessages(state.messages[threadId] || [], true).map(message => ({ threadId, message, ...owner })));
  for (const [threadId, messages] of Object.entries(state.messages)) if (!owners.has(threadId)) for (const message of messages) {
    const target = message.threadRef && owners.get(message.threadRef.threadId);
    if (target && target.botId === message.threadRef!.botId && message.tool?.ok === false && /failed:|timed out|已过期/i.test(message.tool.name)) rows.push({ threadId, message, botId: info.chiefId, name: state.bots[info.chiefId]?.name || '主助理' });
  }
  return rows.sort((a, b) => a.message.at - b.message.at || a.message.id.localeCompare(b.message.id));
}
export function activityTitle(message: WireMessage) {
  const name = message.tool?.name || message.text || '工作步骤';
  const known: Record<string, string> = { workspace_list_files:'查看任务文件',workspace_read_file:'读取任务文件',workspace_write_file:'保存工作产物',workspace_check_file:'校验文件',assistant_folders:'查看已接入文件夹',assistant_folder_files:'查看文档清单',assistant_folder_read:'阅读文档',assistant_folder_write:'保存文档',assistant_web_search:'检索公开资料',assistant_web_read:'阅读来源网页',assistant_remember_preference:'提出偏好建议',assistant_create_reminder:'保存提醒',assistant_reminders:'查看提醒',assistant_start_work:'创建独立工作',agents_coordinate_bots:'派遣小助理',agents_list_bots:'查看可用小助理' };
  if (known[name]) return known[name];
  const native:Record<string,string>={workspace_create_document:'生成并校验 Word 文档',workspace_create_spreadsheet:'生成并校验 Excel 表格',assistant_skill_read:'读取已启用技能',assistant_create_routine:'安排例行工作',assistant_routines:'查看例行执行',assistant_manage_routine:'调整例行工作',browser_agent_browser_open:'打开专用网页',browser_agent_browser_fill:'填写网页内容',browser_agent_browser_click:'操作网页',browser_agent_browser_read:'读取实际网页结果',agents_skills_list:'查看已有技能',agents_skill_manage:'提出技能做法'};
  if(native[name])return native[name];
  if (name === 'agents_create_bot' || name === 'create_bot') return '创建小助理';
  if (/网页验证|upstream_web_verification/i.test(name)) return '模型上游需要网页验证';
  if (/美国视觉服务上传图片失败|VISION_IMAGE_UPLOAD_FAILED/i.test(name)) return '视觉服务上传图片失败';
  if (/图片识别服务暂未完成|VISION_UPSTREAM_ERROR/i.test(name)) return '图片识别暂未完成';
  if (/HTTP\s*50[234]/i.test(name)) return '模型服务暂未完成请求';
  if (/schema|arguments/i.test(name)) return '工具参数未通过检查';
  if (/needs your input/i.test(name)) return '小助理需要补充说明';
  if (/failed|error:/i.test(name)) return '这一步没有完成';
  if (/Sent to|Resumed with/i.test(name)) return /Sent to/i.test(name) ? '已发出委派' : '已收到小助理回执';
  return name.length > 90 ? name.slice(0, 90) + '…' : name;
}
