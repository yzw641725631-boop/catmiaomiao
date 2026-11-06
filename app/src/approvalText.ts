// Plain-language titles and summaries for tool approval cards.
export const workspaceApproval: Record<string, string> = {
  workspace_list_files: '查看本次工作目录',
  workspace_read_file: '读取工作文件',
  workspace_write_file: '保存工作文件',
  workspace_check_file: '校验工作文件',
  assistant_folders: '查看已接入的文件夹',
  assistant_folder_files: '列出已授权目录的文档',
  assistant_folder_read: '读取你授权的文档',
  assistant_folder_write: '保存到已授权文件夹',
  assistant_web_search: '检索公开网页',
  assistant_web_read: '阅读来源网页',
  assistant_remember_preference: '提出一项偏好建议',
  assistant_create_reminder: '安排提醒或后台工作',
  assistant_start_work: '创建独立工作',
  assistant_cancel_reminder: '取消提醒',
  assistant_reminders: '查看已有提醒',
};
export function fileApprovalDetails(tool?: string, subtitle?: string) {
  if (!tool || !workspaceApproval[tool]) return null;
  if (tool === 'workspace_list_files') return { summary: '仅查看这项任务指定目录中的文本文件。', content: '' };
  try {
    const args = JSON.parse(subtitle || '');
    if (tool === 'assistant_folders') return { summary: '仅查看你在能力面板中接入的目录列表。', content: '' };
    if (tool === 'assistant_folder_files')
      return { summary: '列出已授权文件夹中的文档名称、格式和大小。', content: '' };
    if (tool === 'assistant_folder_read')
      return { summary: `读取 ${args.path}，内容将用于当前模型任务。`, content: '' };
    if (tool === 'assistant_folder_write')
      return { summary: `保存 ${args.path}，覆盖前保留原文件。`, content: args.content || '' };
    if (tool === 'assistant_web_search') return { summary: `检索：${args.query}`, content: '' };
    if (tool === 'assistant_web_read') return { summary: `阅读：${args.url}`, content: '' };
    if (tool === 'assistant_remember_preference')
      return { summary: '添加到待确认偏好，确认后才写入长期记忆。', content: args.text || '' };
    if (tool === 'assistant_create_reminder')
      return {
        summary: `${args.title} · ${new Date(args.at).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })} · ${args.repeat === 'daily' ? '每天' : '一次'}`,
        content: args.task || '',
      };
    if (tool === 'assistant_start_work')
      return { summary: '新建独立工作，执行过程和结果将在工作页展示。', content: args.description || '' };
    if (typeof args.path !== 'string') return null;
    if (tool === 'workspace_write_file' && typeof args.content === 'string')
      return {
        summary: `${args.expected_sha256 === null ? '新建' : '更新'} ${args.path}${args.expected_sha256 !== null ? '，旧版本会先归档' : ''}。`,
        content: args.content,
      };
    if (tool === 'workspace_read_file') return { summary: `读取本次工作目录中的 ${args.path}。`, content: '' };
    const checks: Record<string, string> = {
      utf8: 'UTF-8 文本校验',
      json: 'JSON 格式校验',
      javascript_syntax: 'JavaScript 语法检查',
    };
    if (checks[args.check]) return { summary: `${args.path} · ${checks[args.check]}`, content: '' };
  } catch {}
  return null;
}
