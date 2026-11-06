import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {CompanionRuntime,PROJECT,SETTINGS_FILE} from '../adapters/runtime.mjs';
import {createCompanionServer} from '../adapters/server.mjs';

const stamp=new Date().toISOString().replace(/[:.]/g,'-'),rootDir=join(PROJECT,'runtime','isolated-native-'+stamp),directory=join(PROJECT,'evidence','native-integrations-20261023');mkdirSync(directory,{recursive:true});
const output=join(directory,'live-'+stamp+'.json'),record={isolated:true,rootDir,startedAt:new Date().toISOString(),passed:false,approvals:[]},runtime=new CompanionRuntime({rootDir});runtime.settingsFile=SETTINGS_FILE;
let app;const start=Date.now();
try{
  app=await createCompanionServer({port:5241,runtime});const session=runtime.current,info=await runtime.info();assert.equal(info.mode,'live');Object.assign(record,{chiefId:info.chiefId,companionThreadId:info.companionThreadId,instanceId:info.reachai.llmId});
  const api=(method,path,body)=>runtime.api(session,method,path,body),messages=async thread=>(await api('GET',`/api/threads/${thread}/messages?limit=100`)).messages;
  const approved=new Set(),deadline=Date.now()+300000;
  async function settle(threadId,{skill=false}={}){while(Date.now()<deadline){const {bots}=await api('GET','/api/bots'),chief=bots.find(bot=>bot.id===info.chiefId),task=chief.tasks.find(task=>task.threadId===threadId);const actors=[{botId:info.chiefId,threadId},...bots.filter(bot=>session.helperIds.includes(bot.id)).flatMap(bot=>bot.tasks.filter(task=>task.openedBy?.threadId===threadId).map(task=>({botId:bot.id,threadId:task.threadId})))];
    for(const actor of actors)for(const message of await messages(actor.threadId)){const card=message.card;if(!card?.requestId||card.answered||card.expired||card.dismissed||approved.has(card.requestId))continue;let hash;
      if(card.skillRequest){assert(skill);assert.equal(card.skillRequest.name,'synthetic-reconciliation');assert.match(card.skillRequest.preview,/SAMPLE-84/);hash=card.skillRequest.sha256;assert.match(hash,/^[a-f0-9]{64}$/);record.skill={requestId:card.requestId,sha256:hash,preview:card.skillRequest.preview};}
      else{assert(/^(assistant_skill_read|workspace_(create_document|create_spreadsheet|read_file|list_files|write_file|check_file)|(?:browser_)?agent_browser_(open|read|fill|click|snapshot|screenshot|list_tabs))$/.test(card.tool||''),'Unexpected tool '+card.tool);}
      approved.add(card.requestId);record.approvals.push({tool:card.tool,botId:actor.botId,threadId:actor.threadId,requestId:card.requestId});await api('POST',`/api/bots/${actor.botId}/respond`,{threadId:actor.threadId,requestId:card.requestId,behavior:'allow',...(hash?{reviewedSha256:hash}:{})});
    }
    const page=await messages(threadId),latestUser=page.findLast(message=>message.role==='user'),terminal=page.findLast(message=>(message.turnTerminal||message.tool?.terminal)&&message.requestMessageId===latestUser?.id);
    if(!task.busy&&!task.waitingForTeammates&&terminal){assert.notEqual(terminal.turnSucceeded,false,'Real model turn failed');assert.notEqual(terminal.tool?.ok,false);return {page,terminal};}await new Promise(resolve=>setTimeout(resolve,650));
  }throw new Error('Actual model integration exceeded bounded deadline');}
  await runtime.send({kind:'chat',sendId:randomUUID(),text:'独立合成验收。请实际用 skill_manage 创建 synthetic-reconciliation 技能，description 为“核对合成金额并生成真实文档”。完整 SKILL.md 正文必须含 SAMPLE-84，步骤为：先核对 120+30=150，再用 workspace_create_document 和 workspace_create_spreadsheet 生成真实 Word 和 Excel，读取实际回执再汇报。不创建助理、偏好、提醒或例行工作。'});
  console.log(JSON.stringify({phase:'skill',output}));await settle(info.companionThreadId,{skill:true});const skills=await runtime.capabilities.skills(info.chiefId,'list');assert(skills.skills.some(skill=>skill.name==='synthetic-reconciliation'&&skill.enabled));
  await runtime.capabilities.configure(info.chiefId,{browser:true,computer:false,mcpServers:[]});
  const html='<!doctype html><html lang="zh"><meta charset="utf-8"><title>隔离合成验收</title><style>body{font:20px system-ui;padding:48px;background:#f6f4ef}input,button{font:inherit;padding:12px}output{display:block;margin-top:24px}</style><h1>合成资料核对</h1><p>预算120元，追加30元。</p><label>编号 <input id="note" aria-label="编号"></label><button id="submit" onclick="document.querySelector(\'#result\').textContent=document.querySelector(\'#note\').value+\'：实际网页核对通过，120+30=150。\'">核对</button><output id="result"></output></html>';
  const url='data:text/html;charset=utf-8,'+encodeURIComponent(html);
  const work=await runtime.send({kind:'work',sendId:randomUUID(),text:`这是独立合成验收。主助理已允许专用浏览器。请先读取已启用的 synthetic-reconciliation 技能。然后主助理实际用 agent_browser_open 打开以下 data 页面（不需要检索），agent_browser_fill 在 #note 填 SAMPLE-84，agent_browser_click 点 #submit，agent_browser_read 读取 #result。页面：${url}\n将实际核对结果用 workspace_create_document 生成 native-report.docx、workspace_create_spreadsheet 生成 native-report.xlsx，表头“项目、金额”，预算120、追加30、合计150。由你自己操作浏览器，生成文件可以派给文档助理，请转交绑定目录并使用对应工具。只处理这些合成数据，不访问外网或用户资料，不操作本机桌面，不创建其他成员或提醒。收到文件实际生成校验回执再汇报可打开链接。`});record.workThreadId=work.threadId;console.log(JSON.stringify({phase:'browser-and-artifacts',threadId:work.threadId}));const final=await settle(work.threadId);
  const files=runtime.artifactFiles(work.threadId),artifacts=files.listArtifacts();assert(artifacts.some(file=>file.path==='native-report.docx'&&file.current));assert(artifacts.some(file=>file.path==='native-report.xlsx'&&file.current));
  const texts=[];for(const file of artifacts){const preview=await files.preview(file.path,file.sha256);texts.push(JSON.stringify(preview));}
  assert(texts.some(text=>text.includes('SAMPLE-84')));assert(texts.every(text=>text.includes('150')));
  const threads=[work.threadId,...(await api('GET','/api/bots')).bots.flatMap(bot=>bot.tasks.filter(task=>task.openedBy?.threadId===work.threadId).map(task=>task.threadId))],tools=[];
  for(const thread of threads)for(const message of await messages(thread))if(message.tool)tools.push({threadId:thread,name:message.tool.name,ok:message.tool.ok});
  assert(tools.some(tool=>tool.name==='assistant_skill_read'&&tool.ok===true));assert(tools.some(tool=>tool.name.endsWith('agent_browser_read')&&tool.ok===true));
  Object.assign(record,{passed:true,elapsedMs:Date.now()-start,artifacts:artifacts.map(({path,sha256,bytes,kind})=>({path,sha256,bytes,kind})),finalReply:final.terminal.text,tools,modelErrors:readFileSync(join(rootDir,'logs/model-requests.jsonl'),'utf8').trim().split('\n').map(JSON.parse).filter(event=>event.result==='failed')});
  writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({phase:'passed',output,elapsedMs:record.elapsedMs}));
  if(process.argv.includes('--hold')){console.log('UI_READY 5241; enter quit to close');process.stdin.setEncoding('utf8');process.stdin.resume();await new Promise(resolve=>process.stdin.on('data',value=>value.includes('quit')&&resolve()));}
}catch(error){record.error=error.message;record.elapsedMs=Date.now()-start;writeFileSync(output,JSON.stringify(record,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({phase:'incomplete',output,error:record.error}));process.exitCode=1;}finally{if(app)await app.close();process.stdin.pause();}
