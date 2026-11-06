import { cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { CHIEF_TOOL_SCOPE, SPECIALIST_TOOL_SCOPE } from './team.mjs';
import { fail } from './endpoints.mjs';
import { writeFileAtomic } from '../upstream/OpenMausBot/server/atomic.ts';

const NAME = /^[a-z][a-z0-9_-]{0,31}$/;
const RESERVED = new Set(['agents', 'workspace', 'assistant', 'computer', 'browser', 'composio', 'data', 'highlevel']);
export class NativeCapabilities {
  constructor(runtime) {
    this.runtime = runtime;
    this.file = join(runtime.rootDir, 'native-capabilities.json'); this.busy = false;
    this.data = existsSync(this.file) ? JSON.parse(readFileSync(this.file, 'utf8')) : { version: 1, bots: {} };
    this.data.bots ||= {};
  }
  settings(botId, chief = false) {
    const saved = this.data.bots[botId] || {};
    const servers = Array.isArray(saved.mcpServers) ? saved.mcpServers.filter(name => NAME.test(name) && !RESERVED.has(name)) : [];
    return { computer: saved.computer === true ? 'local' : saved.browser === true ? 'browser' : 'off', browser: saved.browser === true, composio: false,
      approvalMode: 'ask', mcpServers: servers,
      toolScope: { allow: [...(chief ? CHIEF_TOOL_SCOPE : SPECIALIST_TOOL_SCOPE).allow,
        ...(saved.browser||saved.computer?['mcp:agents:select_computer']:[]), ...(saved.browser ? ['mcp:browser:*'] : []), ...(saved.computer ? ['mcp:computer:*'] : []), ...servers.map(name => `mcp:${name}:*`)] } };
  }
  permissions(botId){const saved=this.data.bots[botId]||{};return {browser:saved.browser===true&&saved.permissions?.browser==='full'?'full':'ask',computer:saved.computer===true&&saved.permissions?.computer==='full'?'full':'ask'};}
  async member(botId, idle = false) {
    const session = this.runtime.current;
    if (!session || session.closed) throw fail('助理还未连接。', 503);
    const bots = await this.runtime.refreshTeam(session);
    if (![session.chiefId, ...session.helperIds].includes(botId)) throw fail('这位助理不属于当前团队。', 403);
    const bot = bots.find(item => item.id === botId);
    if (!bot || bot.hidden) throw fail('这位助理当前不可用。', 404);
    if (idle && bot.tasks.some(task => task.busy || task.waitingForTeammates)) throw fail('请先等这位助理完成当前工作，再调整工具。', 409);
    return bot;
  }
  async snapshot() {
    const session = this.runtime.current, bots = await this.runtime.refreshTeam(session);
    const members = [session.chiefId, ...session.helperIds];
    const mcp = await this.runtime.api(session, 'GET', '/api/mcp/servers');
    return { ...mcp, bots: bots.filter(bot => members.includes(bot.id)).sort((a,b)=>Number(b.id===session.chiefId)-Number(a.id===session.chiefId)).map(bot => ({ id: bot.id, name: bot.name, ...this.settings(bot.id, bot.id === session.chiefId), permissions:this.permissions(bot.id) })),
      browserEngine: 'chrome', computer: this.runtime.desktopHost?.status() || { state: 'not-installed', ready: false } };
  }
  async prompt() {
    const session=this.runtime.current,bots=await this.runtime.refreshTeam(session),catalog=await this.runtime.api(session,'GET','/api/mcp/servers');
    const ids=new Set([session.chiefId,...session.helperIds]);
    const surfaceNote='每轮原生执行只挂载一个工作位置。若同时允许本机和浏览器，默认使用本机；需要网页工具时先调用 select_computer 选择 browser，再按原生恢复后的工具目录执行。select_computer 不能增加权限。需要新的定时工作时，主助理在主对话用 assistant_create_routine；原来的提醒工具仅用于通知或兼容既有提醒。生成 Word/Excel 用 workspace_create_document/workspace_create_spreadsheet，返回真实路径和校验回执。';
    const rows=bots.filter(bot=>ids.has(bot.id)).map(bot=>{const settings=this.settings(bot.id,bot.id===session.chiefId),permissions=this.permissions(bot.id);return `${bot.name}：专用浏览器${settings.browser?'已允许（'+(permissions.browser==='full'?'完全允许，无需逐次确认':'每次询问')+'）':'未允许'}；本机电脑${settings.computer==='local'&&this.runtime.desktopHost?.status().ready?'已允许且驱动已连接（'+(permissions.computer==='full'?'完全允许，无需逐次确认':'每次询问')+'）':'未就绪'}；外部工具连接：${settings.mcpServers.filter(name=>catalog.servers.some(server=>server.name===name&&server.enabled)).join('、')||'无'}。`;});
    rows.push(surfaceNote);
    rows.push('电脑工具返回 background_unavailable 时，只有明确未送达的按键才可按驱动提示使用 delivery_mode=foreground 补试；其他失败先核对实际状态，避免重复操作。浏览器返回 refused 或 browser_consent_required 表示未取得页面，不得当作成功或绕过授权。地址栏写入成功不代表已跳转，必须核对实际页面内容；连续读取相同状态时要修正失败的操作，无法推进就说明卡点并停止。多步电脑与网页操作交给独立工作，主对话保持可交流。');
    return '\n[当前实际工具分配]\n'+rows.join('\n')+'\n用户要求保存或更新做法时，先用 skills_list 避免重名，再用 skill_manage 提交完整 SKILL.md；新提议等待用户在原生卡片确认，不能说已启用。使用相关已启用技能时，用 assistant_skill_read 按名字读取正文，返回的 references 可用同一工具的 reference 参数读取；技能不能扩大工具权限。只有被允许使用浏览器的助理才能用 browser 工具，采用独立资料而非用户现有浏览器。已允许的本机操作优先使用 UIA 文本，get_window_state 可设 capture_mode=ax、include_screenshot=false；需要图像时以实际模型能力和工具返回为准。外部工具的发送、支付、删除等仍需明确任务授权与原生确认；电脑和专用浏览器以当前逐助理设置的操作权限为准，完全允许模式下不要重复口头询问。接入工具不等于已经执行。';
  }
  save() { mkdirSync(this.runtime.rootDir, { recursive: true }); writeFileAtomic(this.file, JSON.stringify(this.data, null, 2) + '\n', { mode: 0o600 }); }
  matches(bot, legacy = false) {
    const expected = this.settings(bot.id);
    const prior = { allow: expected.toolScope.allow.filter(name => !['mcp:agents:skills_list', 'mcp:agents:skill_manage'].includes(name)) };
    return !bot.chiefOfStaff && bot.approvalMode === 'ask' && bot.computer === expected.computer && bot.browser === expected.browser && bot.composio === false && JSON.stringify(bot.mcpServers) === JSON.stringify(expected.mcpServers) && (JSON.stringify(bot.toolScope) === JSON.stringify(expected.toolScope) || legacy && JSON.stringify(bot.toolScope) === JSON.stringify(prior));
  }
  async configure(botId, body) {
    if (this.busy) throw fail('工具正在保存，请稍后再试。', 409);
    if (!body || Object.keys(body).some(key => !['browser', 'computer', 'mcpServers','permissions'].includes(key)) || typeof body.browser !== 'boolean' || typeof body.computer !== 'boolean' || !Array.isArray(body.mcpServers) || body.mcpServers.length > 20 || body.mcpServers.some(name => typeof name !== 'string' || !NAME.test(name) || RESERVED.has(name))) throw fail('工具设置无效。');
    if(body.permissions!==undefined&&(!body.permissions||Array.isArray(body.permissions)||typeof body.permissions!=='object'||Object.keys(body.permissions).some(key=>!['computer','browser'].includes(key))||Object.values(body.permissions).some(value=>!['ask','full'].includes(value))))throw fail('请选择每次询问或完全允许。');
    this.busy = true;
    try {
      const member=await this.member(botId),priorSettings=this.settings(botId),priorPermissions=this.permissions(botId);
      const resourceChange=body.browser!==priorSettings.browser||body.computer!==(priorSettings.computer==='local')||JSON.stringify([...new Set(body.mcpServers)].sort())!==JSON.stringify([...priorSettings.mcpServers].sort());
      if(resourceChange&&member.tasks.some(task=>task.busy||task.waitingForTeammates))throw fail('请先等这位助理完成当前工作，再调整使用的工具。授权模式可以单独保存。',409);
      if (body.computer && priorSettings.computer!=='local' && !this.runtime.desktopHost?.status().ready) throw fail('请先在电脑页安装并启动本机驱动。', 409);
      const session = this.runtime.current;
      const catalog = await this.runtime.api(session, 'GET', '/api/mcp/servers');
      if (body.mcpServers.some(name => !catalog.servers.some(server => server.name === name && server.enabled))) throw fail('先添加、测试并启用所选工具连接。', 409);
      const previous = this.data.bots[botId];
      this.data.bots[botId] = { browser: body.browser, computer: body.computer, mcpServers: [...new Set(body.mcpServers)],permissions:{browser:body.browser?body.permissions?.browser||priorPermissions.browser:'ask',computer:body.computer?body.permissions?.computer||priorPermissions.computer:'ask'} };
      let applied;
      try { applied = resourceChange?await this.runtime.api(session, 'PATCH', `/api/bots/${botId}`, this.settings(botId, botId === session.chiefId)):{bot:member}; }
      catch (error) { if (previous) this.data.bots[botId] = previous; else delete this.data.bots[botId]; throw error; }
      try {this.save();}catch {
        const unsaved=this.data.bots[botId];if(previous)this.data.bots[botId]=previous;else delete this.data.bots[botId];
        try{if(resourceChange)await this.runtime.api(session,'PATCH',`/api/bots/${botId}`,this.settings(botId,botId===session.chiefId));}
        catch{this.data.bots[botId]=unsaved;throw fail('当前工具设置已生效，但未能保存到本地，请重试保存。',503);}
        throw fail('工具设置未能保存，已恢复原来的分配，请重试。',503);
      }
      await this.runtime.refreshTeam(session);
      return { bot: applied.bot };
    } finally { this.busy = false; }
  }
  archiveNative(label) {
    const destination = join(this.runtime.archiveRoot, 'native-settings', `${Date.now()}-${label}-${randomUUID()}`);
    mkdirSync(destination, { recursive: true });
    for (const name of ['config.json', 'workspaces', 'skill-state']) {
      const source = join(this.runtime.current.dataDir, name);
      if (existsSync(source)) cpSync(source, join(destination, name), { recursive: true, dereference: false });
    }
  }
  async skills(botId, action, body, name) {
    await this.member(botId);
    if (name && !/^[a-z0-9-]{1,64}$/.test(name)) throw fail('技能名称无效。');
    let method = 'GET', path = `/api/bots/${botId}/skills${name ? '/' + name : ''}`;
    if (action === 'import') { method = 'POST'; this.archiveNative('skill-import'); }
    else if (action === 'toggle') { method = 'PATCH'; if (!name || typeof body?.enabled !== 'boolean' || Object.keys(body).length !== 1) throw fail('技能开关无效。'); }
    else if (action === 'create') {
      if (typeof body?.text !== 'string' || !body.text.trim() || body.text.length > 100000) throw fail('请填写 SKILL.md，最多十万字。');
      const parsed = /^---\r?\n[\s\S]*?\bname:\s*['"]?([a-z0-9-]+)['"]?\s*\r?\n/.exec(body.text);
      if (!parsed) throw fail('SKILL.md 需要 YAML name 和 description。');
      const existing = await this.runtime.api(this.runtime.current, 'GET', `/api/bots/${botId}/skills`);
      if (existing.skills.some(skill => skill.name === parsed[1])) throw fail('已有同名技能；在对话中请助理更新它，保留版本审核。', 409);
      path = `/api/bots/${botId}/skill-template`; method = 'POST'; body = { name: parsed[1], text: body.text, source: 'local-import', enabled: false };
      this.archiveNative('skill-create');
    } else if (action !== 'list' && action !== 'read') throw fail('技能操作无效。');
    return this.runtime.api(this.runtime.current, method, path, method === 'GET' ? undefined : body);
  }
  async mcp(method, suffix, body) {
    if (!/^\/servers(?:\/(?:import|[a-z][a-z0-9_-]{0,31})(?:\/(?:test|sign-in|sign-out)(?:\/[a-f0-9-]{36})?)?)?$/.test(suffix) || !['GET','POST','PUT','PATCH'].includes(method)) throw fail('工具连接操作无效。');
    if (method !== 'GET' && !suffix.includes('/test') && !suffix.includes('/sign-')) this.archiveNative('mcp-update');
    return this.runtime.api(this.runtime.current, method, '/api/mcp' + suffix, body);
  }
}
