import { registerHooks } from 'node:module';
import { createHash, randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { recordSpecialists, specialistSettings } from './team.mjs';
import { existsSync, readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {routineToolAllowed} from './routine-tool-policy.mjs';
import {SurfaceGrants} from './surface-grants.mjs';
import {ToolRecovery} from './tool-recovery.mjs';

// An opt-in launch adapter for the pinned OSS source. The checkout stays unchanged.
const entry = new URL('../upstream/OpenMausBot/server/index.ts', import.meta.url).href;
const digest = 'bfbe941957ed0269ecf19128743e1b70b22bd94c25d5e77300a3a62c74b07809';
const anchor = '      applyAgentsBridge(threadId, integrations, cfg, bot, turnEngine(instance, providerConfigs(), registry.lastSnapshot(instance.instanceId), cwd));';
const storeEntry = new URL('../upstream/OpenMausBot/server/store.ts', import.meta.url).href;
const storeDigest = '4fbd16bca4c705399657cacb64c6252901c46dad27d20b1a133b6380e8545a35';
const chatToolsEntry=new URL('../upstream/OpenMausBot/server/drivers/chat-mcp-tools.ts',import.meta.url).href;
export function injectRoutineToolPolicy(source){
  if(createHash('sha256').update(source).digest('hex')!=='e6994c7d967ec663c2ab9258d5a76602fcfbb0a63d74eb698b6b9b5ebed427d4')throw new Error('Pinned native tool approval changed; review routine grants.');
  const anchor='if (!tool?.searched || tool.name !== CALL_TOOL) return { title: name, input: args, ask: true, ...(grant ? { grant } : {}) };';
  if(source.split(anchor).length!==2)throw new Error('Native routine grant anchor changed.');
  const registry='  const registered = new Map<string, RegisteredTool>();';
  const invoke='        const result = await tool.client.call("tools/call", { name: tool.name, arguments: args }, AbortSignal.any([signal, callSignal]), callTimeoutMs);';
  const finish='          ...(images.length ? { images } : {}) };';
  for(const entry of [registry,invoke,finish])if(source.split(entry).length!==2)throw new Error('Native tool recovery anchor changed.');
  return source.replace(anchor,'if (!tool?.searched || tool.name !== CALL_TOOL) return { title: name, input: args, ask: !globalThis[Symbol.for("companion.routine-tool-policy")]?.(tool?.server, tool?.name, servers.find(row => row[0] === tool?.server)?.[1], {hostComputer:tool?.hostComputer,builtInBrowser:tool?.builtInBrowser}), ...(grant ? { grant } : {}) };')
    .replace(registry,registry+'\n  const companionRecovery = globalThis[Symbol.for("companion.tool-recovery")]?.(integrations);')
    .replace(invoke,'        const run = async (parameters: Record<string, unknown>) => {\n        validate(name, parameters);\n        const result = await tool.client.call("tools/call", { name: tool.name, arguments: parameters }, AbortSignal.any([signal, callSignal]), callTimeoutMs);')
    .replace(finish,finish+'\n        };\n        return companionRecovery ? await companionRecovery.execute({server:tool.server,name:tool.name,hostComputer:tool.hostComputer,builtInBrowser:tool.builtInBrowser},args,AbortSignal.any([signal,callSignal]),run) : await run(args);');
}
export function injectTeamHook(source) {
  if (createHash('sha256').update(source).digest('hex') !== storeDigest) throw new Error('Pinned OpenMausBot store changed; review specialist creation before launching.');
  const normalized = source.replaceAll('\r\n', '\n');
  const defaults = '          autoApprove: false, composio: false, approvePeerComms: false,';
  const commit = '    this.saveBots(nextBots);\n    this.bots = nextBots;\n    for (const bot of changed) {';
  if (normalized.split(defaults).length !== 2 || normalized.split(commit).length !== 2) throw new Error('Specialist creation anchors changed.');
  return normalized.replace(defaults, defaults + '\n          ...globalThis[Symbol.for("companion.specialist.defaults")](),')
    .replace(commit, '    globalThis[Symbol.for("companion.specialists.created")](request, result);\n' + commit);
}
export function injectWorkspaceHook(source) {
  if (createHash('sha256').update(source).digest('hex') !== digest || source.split(anchor).length !== 2) throw new Error('Pinned OpenMausBot entry changed; review the workspace integration before launching.');
  const normalized=source.replaceAll('\r\n','\n');
  const skillReview='        const direct = appliesDirectly(from.id, fromThreadId);\n        const persistence = skillProposalPersistence(from.id, fromThreadId, !direct);';
  if(normalized.split(skillReview).length!==2)throw new Error('Native skill review anchor changed.');
  const routineTask='    const task = store.createTask(botId, title, false);';
  if(normalized.split(routineTask).length!==2)throw new Error('Native routine task anchor changed.');
  const roomAnchor=anchor.trimStart();
  const roomLine='  '+roomAnchor;
  if(normalized.split('\n'+roomLine+'\n').length!==2)throw new Error('Native room integration anchor changed.');
  const roomScope='const roomToolScope = toolScopeForTurn(readyBot.id),';
  if(normalized.split(roomScope).length!==2)throw new Error('Native goal tool scope anchor changed.');
  const chatScope='const toolScope = toolScopeForTurn(bot.id);';
  if(normalized.split(chatScope).length!==2)throw new Error('Native conversation scope anchor changed.');
  return normalized.replace(anchor, anchor + '\n      await globalThis[Symbol.for("companion.workspace.integration")]?.(bot.id, threadId, integrations);')
    .replace('\n'+roomLine+'\n','\n'+roomLine+'\n  await globalThis[Symbol.for("companion.workspace.integration")]?.(bot.id, threadId, integrations);\n')
    .replace(roomScope,'const roomToolScope = globalThis[Symbol.for("companion.goal.tool-scope")](threadId, toolScopeForTurn(readyBot.id)),')
    .replace(chatScope,'const toolScope = globalThis[Symbol.for("companion.chat.tool-scope")](threadId, toolScopeForTurn(bot.id));')
    .replace(routineTask,'    const task = globalThis[Symbol.for("companion.routine.task")]?.(botId, title, run, store) ?? store.createTask(botId, title, false);')
    .replace(skillReview,'        const direct = null;\n        const persistence = skillProposalPersistence(from.id, fromThreadId, !direct);');
}

export function installWorkspaceHook() {
  if (!process.env.COMPANION_TEAM_LEDGER) throw new Error('Specialist registry was not supplied by the companion host.');
  globalThis[Symbol.for('companion.specialist.defaults')] = specialistSettings;
  const surfaces=new SurfaceGrants(process.env.COMPANION_CAPABILITIES_FILE);
  globalThis[Symbol.for('companion.tool-recovery')]=integrations=>new ToolRecovery({allowForeground:()=>surfaces.allows('computer',integrations?.localComputer,{hostComputer:true})});
  globalThis[Symbol.for('companion.routine-tool-policy')]=(server,name,descriptor,flags)=>surfaces.allows(server,descriptor,flags)||(process.env.COMPANION_ROUTINE_TOOLS!=='ask'&&routineToolAllowed(server,name,descriptor));
  globalThis[Symbol.for('companion.routine.task')] = (botId,title,run,store) => {
    const file=process.env.COMPANION_WORKFLOWS;
    if(!file||!existsSync(file)||!run?.routineId)return null;
    const registered=JSON.parse(readFileSync(file,'utf8')).routines?.some(row=>row.id===run.routineId&&row.botId===botId);
    if(!registered)return null;
    const folder=join(process.env.COMPANION_ROUTINE_WORK_ROOT,randomUUID());mkdirSync(folder,{recursive:true});
    return store.createTask(botId,title,false,undefined,undefined,undefined,undefined,folder);
  };
  globalThis[Symbol.for('companion.specialists.created')] = (request, result) => recordSpecialists(process.env.COMPANION_TEAM_LEDGER, request.botId, result.bots.filter(bot => bot.action === 'created').map(bot => bot.id), request.requestId);
  registerHooks({ load(url, context, nextLoad) {
    const result = nextLoad(url, context);
    if (url === entry) return { ...result, source: injectWorkspaceHook(Buffer.from(result.source).toString('utf8')) };
    if (url === storeEntry) return { ...result, source: injectTeamHook(Buffer.from(result.source).toString('utf8')) };
    if(url===chatToolsEntry)return {...result,source:injectRoutineToolPolicy(Buffer.from(result.source).toString('utf8'))};
    return result;
  } });
  const pending = new Map();
  let mainThread='';
  globalThis[Symbol.for('companion.chat.tool-scope')]=(threadId,scope)=>threadId===mainThread?{...scope,deny:[...scope?.deny||[],'mcp:agents:coordinate_bots']}:scope;
  const goalThreads=new Set();
  globalThis[Symbol.for('companion.goal.tool-scope')]=(threadId,scope)=>goalThreads.has(threadId)?{...scope,deny:[...scope?.deny||[],'mcp:agents:coordinate_bots']}:scope;
  process.on('message', message => {
    if(message?.type==='companion:main-thread'&&/^[a-f0-9-]{36}$/.test(message.threadId||'')){mainThread=message.threadId;return;}
    if (message?.type !== 'companion:workspace:result') return;
    const request = pending.get(message.requestId);
    if (!request) return;
    pending.delete(message.requestId); clearTimeout(request.timer);
    if (message.error) request.reject(new Error(message.error)); else request.resolve(message.scope);
  });
  globalThis[Symbol.for('companion.workspace.integration')] = async (botId, threadId, integrations) => {
    const requestId = randomUUID();
    const scope = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Workspace scope lookup timed out.')); }, 15000);
      pending.set(requestId, { resolve, reject, timer });
      process.send({ type: 'companion:workspace:request', requestId, botId, threadId }, error => {
        if (!error) return;
        pending.delete(requestId); clearTimeout(timer); reject(new Error('Workspace parent disconnected.'));
      });
    });
    if (!scope) return;
    if(scope.services?.COMPANION_SERVICE_BOT===botId)surfaces.bind(integrations,botId);
    if(scope.goal)goalThreads.add(threadId);
    integrations.custom = { ...integrations.custom };
    if (scope.services) integrations.custom.assistant = {
      command: process.execPath, args: [fileURLToPath(new URL('./assistant-mcp.mjs', import.meta.url))], env: scope.services,
    };
    if (scope.root) integrations.custom.workspace = {
      command: process.execPath, args: [fileURLToPath(new URL('./workspace-mcp.mjs', import.meta.url))],
      env: { COMPANION_WORK_ROOT: scope.root, COMPANION_WORK_ARCHIVE: scope.archive, COMPANION_WORK_LEDGER: scope.ledger, COMPANION_WORK_BOT: botId, COMPANION_WORK_THREAD: threadId },
    };
  };
}
