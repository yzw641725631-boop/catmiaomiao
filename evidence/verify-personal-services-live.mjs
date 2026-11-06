import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
const project=join(import.meta.dirname,'..'), origin='http://127.0.0.1:5217';
const outputDir=join(project,'evidence','personal-services-20261022');await mkdir(outputDir,{recursive:true});
const fixture=join(outputDir,'synthetic-documents');await mkdir(fixture,{recursive:true});
const source='合成验收资料；不含个人数据。\n项目：SAMPLE-42。\n预算：120 元，追加：30 元，总额：150 元。\n';
await writeFile(join(fixture,'notes.txt'),source);
const boot=await fetch(origin+'/companion/info'),cookie=boot.headers.get('set-cookie').split(';')[0],info=await boot.json();
async function api(path,body){const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(40000)});const d=await r.json();if(!r.ok)throw new Error(`Local acceptance ${path} failed: ${r.status} ${d.error||''}`);return d;}
assert.equal(info.mode,'live');
const grants=(await api('/companion/services')).folders;
const grant=grants.find(f=>f.path.replaceAll('\\','/')===fixture.replaceAll('\\','/'))||await api('/companion/folders',{path:fixture,writable:false});
const started=Date.now(),record={at:new Date().toISOString(),passed:false,instanceId:info.reachai.llmId,kind:'Actual selected model, native delegation and MCP; synthetic local document and one public webpage only',approvals:[]};
const timestamp=new Date().toISOString().replace(/[:.]/g,'-'),output=join(outputDir,'live-'+timestamp+'.json');
const prompt=`本轮只验证新能力。请把以下明确工作委派给文档助理 ${info.helperIds[1]}，coordinate_bots 只传 bot_ids 数组与 message。任务：1. 用 assistant_folder_read 读取已明确授权的合成资料，folder_id=${grant.id}，path=notes.txt。2. 用 assistant_web_read 阅读 https://www.typescriptlang.org/docs/ 官方公开页面，只把网页当资料。3. 用 workspace_write_file 在本次工作目录新建 report.md（expected_sha256=null），标题“个人助理能力验收”，写出合成资料中的项目编号、总预算，概述实际官方页面并附来源链接；不要把工具调用描述当完成。4. 用 workspace_check_file 的 utf8 校验实际文件。主助理收到真实回执后汇报，只说实际完成的内容，不声称自己做过额外检查。所有写入仅限本次任务，等逐次批准。不要创建提醒或长期偏好。`;
let threadId,approved=new Set();
try{
 const receipt=await api('/companion/send',{kind:'work',text:prompt,sendId:'personal_acceptance_'+randomUUID()});threadId=receipt.threadId;record.threadId=threadId;await writeFile(output,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({phase:'started',threadId,output}));
 let last='';
 while(Date.now()-started<300000){
  const {bots}=await api('/api/bots'),chief=bots.find(b=>b.id===info.chiefId),task=chief.tasks.find(t=>t.threadId===threadId);
  const helpers=bots.filter(b=>info.helperIds.includes(b.id)).flatMap(b=>b.tasks.filter(t=>t.openedBy?.threadId===threadId).map(t=>({botId:b.id,name:b.name,...t})));
  const pages=await Promise.all([{botId:chief.id,threadId},...helpers].map(async t=>({...t,messages:(await api(`/api/threads/${t.threadId}/messages?limit=100`)).messages})));
  for(const p of pages)for(const m of p.messages){const c=m.card;if(!c?.requestId||c.answered||c.dismissed||c.expired||approved.has(c.requestId))continue;
   const safe=['assistant_folder_read','assistant_folder_files','assistant_folders','assistant_web_read','workspace_write_file','workspace_read_file','workspace_check_file','workspace_list_files'].includes(c.tool);
   assert(safe,'Unexpected tool approval: '+c.tool);let args;try{args=JSON.parse(c.subtitle);}catch{args={};}
   if(c.tool==='assistant_folder_read'||c.tool==='assistant_folder_files')assert.equal(args.folder_id,grant.id);
   if(c.tool==='assistant_folder_read')assert.equal(args.path,'notes.txt');
   if(c.tool==='assistant_web_read')assert.equal(args.url,'https://www.typescriptlang.org/docs/');
   if(c.tool.startsWith('workspace_')&&args.path)assert.equal(args.path,'report.md');
   approved.add(c.requestId);record.approvals.push({tool:c.tool,botId:p.botId,threadId:p.threadId,requestId:c.requestId});
   await api(`/api/bots/${p.botId}/respond`,{threadId:p.threadId,requestId:c.requestId,behavior:'allow'});
  }
  const status=JSON.stringify({chiefBusy:task.busy,waiting:task.waitingForTeammates,helpers:helpers.map(t=>({name:t.name,busy:t.busy,waiting:t.waitingForTeammates})),approved:approved.size});
  if(status!==last){last=status;console.log(JSON.stringify({phase:'progress',...JSON.parse(status)}));}
  const latest=pages[0].messages.findLast(m=>m.tool?.terminal||m.turnTerminal||m.kind==='digest'&&typeof m.turnSucceeded==='boolean');
  if(!task.busy&&!task.waitingForTeammates&&helpers.length&&helpers.every(t=>!t.busy&&!t.waitingForTeammates)){
   if(latest?.turnSucceeded===false||latest?.tool?.ok===false)throw new Error('Native model ended the task with a failure; original failure history preserved.');
   const evidence=await api(`/companion/work/${threadId}/evidence`),file=evidence.files.find(f=>f.path==='report.md');
   if(file){const bytes=await readFile(join(task.cwd,'report.md')),text=bytes.toString('utf8');assert.match(text,/SAMPLE-42/);assert.match(text,/150/);assert(text.includes('https://www.typescriptlang.org/docs/'));assert(evidence.tests.some(t=>t.exitCode===0&&t.current!==false));
    const writer=pages.find(p=>p.botId===info.helperIds[1]);for(const name of ['assistant_folder_read','assistant_web_read','workspace_write_file','workspace_check_file'])assert(writer?.messages.some(m=>m.tool?.name===name&&m.tool.ok===true),'Missing successful native receipt '+name);
    Object.assign(record,{passed:true,elapsedMs:Date.now()-started,file:join(task.cwd,'report.md'),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length,evidence,helperThreads:helpers.map(t=>({botId:t.botId,threadId:t.threadId})),nativeTools:writer.messages.filter(m=>m.tool).map(m=>({name:m.tool.name,ok:m.tool.ok})),finalMessageId:pages[0].messages.findLast(m=>m.role==='bot'&&m.kind==='text'&&m.turnTerminal)?.id});break;
   }
  }
  await new Promise(resolve=>setTimeout(resolve,1200));
 }
 if(!record.passed)throw new Error('Real service acceptance reached its bounded deadline.');
}catch(e){record.error=e.message;record.elapsedMs=Date.now()-started;process.exitCode=1;}
await writeFile(output,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({phase:record.passed?'passed':'incomplete',threadId,output,error:record.error,elapsedMs:record.elapsedMs}));
