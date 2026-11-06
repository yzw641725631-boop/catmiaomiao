import {fileURLToPath} from 'node:url';

const assistantRead = new Set(['folders','folder_files','folder_read','web_search','web_read','skill_read','reminders','preferences','routines','goals','start_work','remember_preference','rename_assistant','app_settings','manage_preference','manage_reminder']);
const assignedFiles = new Set(['list_files','read_file','write_file','check_file','create_document','create_spreadsheet']);
export function routineToolAllowed(server,name,descriptor) {
  if(!descriptor||descriptor.command!==process.execPath||descriptor.args?.length!==1)return false;
  if(server==='workspace'&&descriptor.args[0]===fileURLToPath(new URL('./workspace-mcp.mjs',import.meta.url))&&descriptor.env?.COMPANION_WORK_ROOT&&descriptor.env?.COMPANION_WORK_BOT&&descriptor.env?.COMPANION_WORK_THREAD)return assignedFiles.has(name);
  if(server==='assistant'&&descriptor.args[0]===fileURLToPath(new URL('./assistant-mcp.mjs',import.meta.url))&&/^http:\/\/127\.0\.0\.1:\d+$/.test(descriptor.env?.COMPANION_SERVICE_URL||'')&&descriptor.env?.COMPANION_SERVICE_TOKEN)return assistantRead.has(name);
  return false;
}
