import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompanionRuntime, PROJECT } from '../../adapters/runtime.mjs';
import { createCompanionServer } from '../../adapters/server.mjs';
import { skillProposal } from '../src/skillUi.ts';
import { fakeReachai, fixtureReachaiConfig } from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';

const slug='synthetic-review', skill='# 核对步骤\n先写结论，再核对 SAMPLE-84。详见 references/example.md。\n';
const skillMd='---\nname: '+slug+'\ndescription: 核对隔离验收合成资料\n---\n\n'+skill;
const waitFor=async(read,accept,label,ms=45000)=>{const deadline=Date.now()+ms;let value;while(Date.now()<deadline){value=await read();if(await accept(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail(label+'\n'+JSON.stringify(value).slice(-2500));};
const complete=(event,res,text='隔离验收工具已返回。')=>{event({type:'content.delta',text});event({type:'completed',finishReason:'stop'});res.end();};
function call(body,event,res,id,name,args){
  const selected=body.tools?.find(tool=>tool.function.name===name||tool.function.name.endsWith('_'+name));
  assert(selected,'Missing actual mounted tool: '+name);
  event({type:'tool_call.delta',toolCall:{index:0,id,type:'function',name:selected.function.name,arguments:JSON.stringify(args)}});event({type:'completed',finishReason:'tool_calls'});res.end();
}
async function harness(chat,port){
  const rootDir=scratch('native-capabilities');mkdirSync(rootDir,{recursive:true});
  const provider=await fakeReachai({chat});writeFileSync(join(rootDir,'companion-settings.json'),JSON.stringify({provider:'reachai',reachai:fixtureReachaiConfig(provider.url)}));
  const runtime=new CompanionRuntime({routineTools:'ask',rootDir});const app=await createCompanionServer({port,runtime});
  const boot=await fetch(app.url+'/companion/info'),cookie=boot.headers.get('set-cookie').split(';')[0],info=await boot.json();
  const api=async(method,path,body,status=200)=>{const response=await fetch(app.url+path,{method,headers:{cookie,origin:app.url,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;};
  const messages=async thread=>(await api('GET',`/api/threads/${thread}/messages?limit=200`)).messages;
  const settle=async(botId,threadId,allowed=[])=>waitFor(async()=>{
    const list=await messages(threadId);
    for(const message of list){const card=message.card;if(card?.requestId&&!card.answered&&!card.dismissed&&!card.expired&&card.requestType!=='question'&&!card.skillRequest){assert(allowed.some(name=>(card.tool||'').includes(name)),'Unbounded test approval: '+card.tool);await api('POST',`/api/bots/${botId}/respond`,{threadId,requestId:card.requestId,behavior:'allow'});}}
    const bots=(await api('GET','/api/bots')).bots,task=bots.find(bot=>bot.id===botId).tasks.find(task=>task.threadId===threadId);
    return {list,task};
  },value=>{const user=value.list.findLast(message=>message.role==='user'),terminal=value.list.findLast(message=>message.turnTerminal||message.tool?.terminal);if(!value.task.busy&&!value.task.waitingForTeammates&&terminal?.requestMessageId===user?.id){assert(terminal.turnSucceeded===true||terminal.tool?.ok===true,'Native turn failed: '+JSON.stringify(value.list.filter(message=>message.tool?.ok===false)).slice(-2000));return true;}return false;},'Native turn did not settle');
  return {rootDir,runtime,app,provider,api,info,messages,settle,cookie,close:async()=>{await app.close();await provider.close();}};
}

test('native skill receipt requires a displayed hash and a real applied answer',()=>{
  const card={requestId:randomUUID(),skillRequest:{version:1,name:slug,action:'create',preview:skillMd,sha256:'a'.repeat(64),warnings:[]}};
  assert.equal(skillProposal(card).status,'等待你确认');assert.equal(skillProposal(card).hash,'a'.repeat(64));
  assert.equal(skillProposal({...card,answered:'yes'}).applied,false);
  assert.equal(skillProposal({...card,answered:'allow'}).status,'已启用');
  assert.equal(skillProposal({...card,skillRequest:{...card.skillRequest,sha256:undefined}}).hash,undefined);
  assert.equal(skillProposal({...card,expired:true}).status,'提议已过期');
});

test('native skill proposals stay inactive until hash review; enabled instructions and references work in the next task', {timeout:150000},async()=>{
  let phase='learn';
  const h=await harness((body,event,res)=>{
    const user=body.messages.filter(message=>message.role==='user').at(-1)?.content||'';
    const done=id=>body.messages.some(message=>message.role==='tool'&&message.toolCallId===id);
    if(phase==='learn'&&!done('learn_native'))return call(body,event,res,'learn_native','skill_manage',{action:'create',skill_md:skillMd,source:'conversation',gist:'核对合成资料的方法',references:[{path:'references/example.md',content:'# 合成示例\nREFERENCE-84：120 + 30 = 150。\n'}]});
    if(phase==='use'){
      if(!done('read_skill'))return call(body,event,res,'read_skill','assistant_skill_read',{name:slug});
      if(!done('read_reference'))return call(body,event,res,'read_reference','assistant_skill_read',{name:slug,reference:'references/example.md'});
      assert(body.messages.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('REFERENCE-84')));
    }
    if(phase==='update'&&!done('update_native'))return call(body,event,res,'update_native','skill_manage',{action:'update',skill_name:slug,skill_md:skillMd.replace('先写结论','先核对数字'),source:'conversation',gist:'更新合成核对顺序'});
    complete(event,res);
  },5261);
  try{
    const {api,info,runtime,messages}=h;
    await api('POST','/companion/send',{kind:'chat',text:'LEARN_NATIVE',sendId:randomUUID()},202);
    const proposal=await waitFor(()=>messages(info.companionThreadId),list=>list.some(message=>message.card?.skillRequest),'Native proposal missing');
    const card=proposal.find(message=>message.card?.skillRequest).card;
    assert(!card.answered);assert.equal((await api('GET',`/companion/skills/${info.chiefId}`)).skills.some(skill=>skill.name===slug),false);
    await api('POST',`/api/bots/${info.chiefId}/respond`,{threadId:info.companionThreadId,requestId:card.requestId,behavior:'allow'},409);
    await api('POST',`/api/bots/${info.chiefId}/respond`,{threadId:info.companionThreadId,requestId:card.requestId,behavior:'allow',reviewedSha256:'0'.repeat(64)},409);
    await api('POST',`/api/bots/${info.chiefId}/respond`,{threadId:info.companionThreadId,requestId:card.requestId,behavior:'allow',reviewedSha256:card.skillRequest.sha256});
    await h.settle(info.chiefId,info.companionThreadId);
    assert((await api('GET',`/companion/skills/${info.chiefId}`)).skills.some(skill=>skill.name===slug&&skill.enabled));
    const root=await runtime.services.call('skill_read',{name:slug},{botId:info.chiefId,threadId:info.companionThreadId});
    assert.equal(root.text,skillMd);assert.deepEqual(root.references,['references/example.md']);
    await assert.rejects(runtime.services.call('skill_read',{name:slug,reference:'../MEMORY.md'},{botId:info.chiefId,threadId:info.companionThreadId}),/路径/);
    phase='use';const work=await api('POST','/companion/send',{kind:'work',text:'USE_NATIVE',sendId:randomUUID()},202);
    await h.settle(info.chiefId,work.threadId,['skill_read']);
    phase='update';await api('POST','/companion/send',{kind:'chat',text:'UPDATE_NATIVE',sendId:randomUUID()},202);
    const update=await waitFor(()=>messages(info.companionThreadId),list=>list.some(message=>message.card?.skillRequest?.action==='update'),'Native update missing');
    const change=update.find(message=>message.card?.skillRequest?.action==='update').card;
    const file=join(runtime.current.dataDir,'workspaces',info.chiefId,'skills',slug,'SKILL.md');
    runtime.capabilities.archiveNative('synthetic-concurrent-edit');writeFileSync(file,skillMd.replace('先写结论','并发修改保留'));
    await api('POST',`/api/bots/${info.chiefId}/respond`,{threadId:info.companionThreadId,requestId:change.requestId,behavior:'allow',reviewedSha256:change.skillRequest.sha256},422);
    assert.match(readFileSync(file,'utf8'),/并发修改保留/);
    await api('PATCH',`/companion/skills/${info.chiefId}/${slug}`,{enabled:false});
    await assert.rejects(runtime.services.call('skill_read',{name:slug},{botId:info.chiefId,threadId:info.companionThreadId}),/尚未启用/);
    await api('GET',`/companion/skills/${randomUUID()}`,undefined,403);
  }finally{await h.close();}
});

test('native MCP import, real handshake, per-specialist mount and redacted secrets survive restart', {timeout:150000},async()=>{
  let h,helperId;const requests=[];
  h=await harness((body,event,res)=>{
    requests.push(body);
    const user=body.messages.filter(message=>message.role==='user').at(-1)?.content||'';
    if(user.includes('MCP_NATIVE_CALL')&&!body.messages.some(message=>message.role==='tool'&&message.toolCallId==='mcp_notes'))return call(body,event,res,'mcp_notes','fixture_notes_read_notes',{});
    complete(event,res);
  },5262);
  try{
    const {api,info,runtime}=h,callFile=join(h.rootDir,'actual-mcp-call.json'),resultFile=join(h.rootDir,'mcp-result.txt');writeFileSync(resultFile,'ACTUAL-MCP-84');
    const created=await api('POST','/companion/team/specialists',{sendId:randomUUID(),name:'工具验收助理',role:'核对隔离工具连接',instructions:'只使用测试授权的工具。'},201);helperId=created.botId;
    await api('POST',`/companion/capabilities/bots/${helperId}`,{browser:false,computer:true,mcpServers:[]},409);
    const imported=await api('POST','/companion/mcp/servers/import',{json:JSON.stringify({mcpServers:{fixture_notes:{command:process.execPath,args:['--experimental-strip-types',join(PROJECT,'upstream/OpenMausBot/server/testing/fake-mcp-server.ts')],env:{FAKE_MCP_CALL_FILE:callFile,FAKE_MCP_RESULT_FILE:resultFile,TEST_ONLY_SECRET:'synthetic-secret-84'},enabled:true}}})});
    assert.equal(imported.servers[0].enabled,false);assert(!JSON.stringify(imported).includes('synthetic-secret-84'));
    assert.equal((await api('POST','/companion/mcp/servers/fixture_notes/test',{})).ok,true);assert(!existsSync(callFile));
    await api('PATCH','/companion/mcp/servers/fixture_notes',{enabled:true});
    await api('POST',`/companion/capabilities/bots/${helperId}`,{browser:false,computer:false,mcpServers:['fixture_notes']});
    const snapshot=await api('GET','/companion/capabilities');assert(snapshot.bots.find(bot=>bot.id===helperId).mcpServers.includes('fixture_notes'));assert(!snapshot.bots.find(bot=>bot.id===info.chiefId).mcpServers.length);
    assert((await runtime.info()).helperIds.includes(helperId));
    const task=(await runtime.api(runtime.current,'POST',`/api/bots/${helperId}/tasks`,{title:'MCP调用验收'})).task;
    await runtime.api(runtime.current,'POST',`/api/bots/${helperId}/messages`,{threadId:task.threadId,text:'MCP_NATIVE_CALL',sendId:randomUUID()});
    await h.settle(helperId,task.threadId,['read_notes']);assert.equal(JSON.parse(readFileSync(callFile,'utf8')).name,'read_notes');
    assert(requests.some(body=>body.messages.some(message=>message.role==='tool'&&JSON.stringify(message.content).includes('ACTUAL-MCP-84'))));
    await api('POST',`/companion/capabilities/bots/${helperId}`,{browser:false,computer:false,mcpServers:['agents']},400);
    await h.app.close();const restarted=new CompanionRuntime({routineTools:'ask',rootDir:h.rootDir});
    try{await restarted.start();assert((await restarted.info()).helperIds.includes(helperId));assert.deepEqual(restarted.capabilities.settings(helperId).mcpServers,['fixture_notes']);}finally{await restarted.close();}
  }finally{if(!h.runtime.closed)await h.app.close();await h.provider.close();}
});

test('legacy busy turns are stopped through native interruption before startup access migration without losing history', {timeout:100000},async()=>{
  const h=await harness((body,event,res)=>{
    if(!body.tools.some(tool=>tool.function.name.endsWith('assistant_web_search'))){event({type:'content.delta',text:'合成旧工作等待中。'});return;}
    if(!body.messages.some(message=>message.role==='tool'&&message.toolCallId==='legacy_pending'))return call(body,event,res,'legacy_pending','assistant_web_search',{query:'SYNTHETIC-STARTUP-84'});
    complete(event,res);
  },5268);
  const helperId=h.info.helperIds[0],session=h.runtime.current;
  try{
    await h.runtime.api(session,'PATCH',`/api/bots/${helperId}`,{browser:true});
    const task=(await h.runtime.api(session,'POST',`/api/bots/${helperId}/tasks`,{title:'旧版启动恢复验收'})).task;
    await h.runtime.api(session,'POST',`/api/bots/${helperId}/messages`,{threadId:task.threadId,text:'SYNTHETIC-STARTUP-84',sendId:randomUUID()});
    const before=await waitFor(async()=>({messages:await h.messages(task.threadId),bots:(await h.api('GET','/api/bots')).bots}),value=>value.bots.find(bot=>bot.id===helperId).busy&&value.messages.some(message=>message.card?.requestId),'Legacy turn did not wait for a real approval');
    await assert.rejects(h.runtime.api(session,'PATCH',`/api/bots/${helperId}`,h.runtime.capabilities.settings(helperId)),error=>error.status===409&&/browser access/.test(error.message));
    const dynamicId=(await h.api('POST','/companion/team/specialists',{sendId:randomUUID(),name:'旧版权限助理',role:'合成恢复验收',instructions:'只处理合成资料。'},201)).botId;
    const legacyScope={allow:h.runtime.capabilities.settings(dynamicId).toolScope.allow.filter(name=>!['mcp:agents:skills_list','mcp:agents:skill_manage'].includes(name))};
    await h.runtime.api(session,'PATCH',`/api/bots/${dynamicId}`,{toolScope:legacyScope});
    const dynamicTask=(await h.runtime.api(session,'POST',`/api/bots/${dynamicId}/tasks`,{title:'旧工具范围迁移验收'})).task;
    await h.runtime.api(session,'POST',`/api/bots/${dynamicId}/messages`,{threadId:dynamicTask.threadId,text:'SYNTHETIC-STARTUP-84',sendId:randomUUID()});
    await waitFor(async()=>(await h.runtime.api(session,'GET','/api/bots')).bots.find(bot=>bot.id===dynamicId),bot=>bot.busy,'Legacy dynamic turn did not become busy');
    await assert.rejects(h.runtime.api(session,'PATCH',`/api/bots/${dynamicId}`,h.runtime.capabilities.settings(dynamicId)),error=>error.status===409&&/tool selection/i.test(error.message));
    const historyIds=before.messages.map(message=>message.id);
    await h.runtime.createTeam(session,JSON.parse(readFileSync(h.runtime.sessionFile,'utf8')));
    const helper=(await h.api('GET','/api/bots')).bots.find(bot=>bot.id===helperId);
    assert.equal(helper.busy,false);assert.equal(helper.browser,false);assert.equal(helper.computer,'off');
    const history=await h.messages(task.threadId);
    assert(historyIds.every(id=>history.some(message=>message.id===id)));
    assert(!history.some(message=>message.card?.answered==='allow'));
    assert(history.some(message=>message.turnTerminal||message.tool?.terminal||message.requestCancelled));
    const migrations=readFileSync(join(h.rootDir,'logs/startup-migrations.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert.equal(migrations.length,2);assert.deepEqual(migrations[0].threadIds,[task.threadId]);assert.deepEqual(migrations[1].threadIds,[dynamicTask.threadId]);
    assert(session.helperIds.includes(dynamicId));
    await h.app.close();const reopened=new CompanionRuntime({routineTools:'ask',rootDir:h.rootDir});
    try{
      const restored=await reopened.start();assert.equal(restored.chiefId,h.info.chiefId);assert.equal(restored.companionThreadId,h.info.companionThreadId);assert(restored.helperIds.includes(helperId));assert(restored.helperIds.includes(dynamicId));
      const page=await reopened.api(reopened.current,'GET',`/api/threads/${task.threadId}/messages?limit=200`);
      assert(historyIds.every(id=>page.messages.some(message=>message.id===id)));
      writeFileSync(join(h.rootDir,'startup-recovery-acceptance.json'),JSON.stringify({isolated:true,historyPreserved:true,stoppedThroughNativeApi:true,originalIdentityRestored:true,unapprovedToolWasNotRun:true,migrations},null,2));
    }finally{await reopened.close();}
  }finally{if(!h.runtime.closed)await h.app.close();await h.provider.close();}
});

test('a native turn starting during workspace initialization can be stopped before access migration without deadlocking startup', {timeout:90000},async()=>{
  const h=await harness((body,event,res)=>complete(event,res),5269);
  const helperId=h.info.helperIds[0];let reopened,earlyThread,history;
  try{
    await h.runtime.api(h.runtime.current,'PATCH',`/api/bots/${helperId}`,{browser:true});
    await h.app.close();
    reopened=new CompanionRuntime({routineTools:'ask',rootDir:h.rootDir});
    const createTeam=reopened.createTeam.bind(reopened);
    reopened.createTeam=async(session,saved)=>{
      earlyThread=(await reopened.api(session,'POST',`/api/bots/${helperId}/tasks`,{title:'合成启动并发恢复'})).task.threadId;
      await reopened.api(session,'POST',`/api/bots/${helperId}/messages`,{threadId:earlyThread,text:'STARTUP_GATED_84',sendId:randomUUID()});
      await waitFor(async()=>[...session.pendingWorkspaceRequests.values()],requests=>requests.some(request=>request.botId===helperId),'Early native turn did not reach the workspace initialization gate');
      history=(await reopened.api(session,'GET',`/api/threads/${earlyThread}/messages?limit=200`)).messages;
      return createTeam(session,saved);
    };
    const start=Date.now(),restored=await reopened.start();
    const migrations=readFileSync(join(h.rootDir,'logs/startup-migrations.jsonl'),'utf8').trim().split('\n').map(JSON.parse);
    assert(migrations.some(row=>row.botId===helperId&&row.threadIds.includes(earlyThread)));
    assert.equal(restored.chiefId,h.info.chiefId);assert.equal(restored.companionThreadId,h.info.companionThreadId);
    const bots=(await reopened.api(reopened.current,'GET','/api/bots')).bots,helper=bots.find(bot=>bot.id===helperId);
    assert.equal(helper.browser,false);assert.equal(helper.busy,false);
    const page=await reopened.api(reopened.current,'GET',`/api/threads/${earlyThread}/messages?limit=200`);
    assert(history.every(message=>page.messages.some(current=>current.id===message.id)));
    writeFileSync(join(h.rootDir,'gated-startup-recovery-acceptance.json'),JSON.stringify({isolated:true,historyPreserved:true,identityPreserved:true,startedMs:Date.now()-start,migrations},null,2));
  }finally{if(reopened)await reopened.close();if(!h.runtime.closed)await h.app.close();await h.provider.close();}
});

test('actual Windows CUA host mounts through native approvals and preserves human control leases', {timeout:150000,skip:process.platform!=='win32'||!existsSync(join(PROJECT,'runtime/components/cua-driver-0.28.2/component.json'))},async()=>{
  let actualResult=false,screenCall='screen_size';
  const h=await harness((body,event,res)=>{
    if(!body.messages.some(message=>message.role==='tool'&&message.toolCallId===screenCall))return call(body,event,res,screenCall,'computer_get_screen_size',{});
    actualResult=body.messages.some(message=>message.role==='tool'&&message.toolCallId===screenCall&&/width|height|\d+\s*[x×]\s*\d+/i.test(JSON.stringify(message.content)));
    complete(event,res);
  },5263);
  try{
    const {api,info}=h;
    const ready=await api('POST','/companion/desktop',{action:'start'});assert(ready.ready);
    await api('POST',`/companion/capabilities/bots/${info.chiefId}`,{browser:false,computer:true,mcpServers:[]});
    await api('POST','/companion/send',{kind:'chat',text:'只读取屏幕尺寸的合成验收',sendId:randomUUID()},202);
    const result=await h.settle(info.chiefId,info.companionThreadId,['get_screen_size']);assert(actualResult);assert(result.list.some(message=>message.kind==='activity'&&message.tool?.ok===true));
    screenCall='screen_size_full';await api('POST',`/companion/capabilities/bots/${info.chiefId}`,{browser:false,computer:true,mcpServers:[],permissions:{computer:'full'}});
    const fullSend=await api('POST','/companion/send',{kind:'chat',text:'合成尺寸验收 FULL',sendId:randomUUID()},202);
    const full=await h.settle(info.chiefId,info.companionThreadId,[]);const fullUser=full.list.find(message=>message.sendId===fullSend.sendId)||full.list.findLast(message=>message.role==='user');
    assert(!full.list.some(message=>message.kind==='options'&&message.requestMessageId===fullUser.id),'full mode should not create another approval');assert(actualResult);
    screenCall='screen_size_ask_again';await api('POST',`/companion/capabilities/bots/${info.chiefId}`,{browser:false,computer:true,mcpServers:[],permissions:{computer:'ask'}});
    await api('POST','/companion/send',{kind:'chat',text:'合成尺寸验收 REVOKE',sendId:randomUUID()},202);
    const revoked=await h.settle(info.chiefId,info.companionThreadId,['get_screen_size']);const lastUser=revoked.list.findLast(message=>message.role==='user');assert(revoked.list.some(message=>message.card?.answered==='allow'&&message.requestMessageId===lastUser.id),'revocation must restore native approvals');
    writeFileSync(join(h.rootDir,'surface-approval-acceptance.json'),JSON.stringify({metadataOnly:true,noScreenshotOrInput:true,askThenFullThenAsk:true,perAssistant:true},null,2));
    const lease=randomUUID(),control=await api('POST',`/api/bots/${info.chiefId}/computer/control`,{action:'take',controlLeaseId:lease});assert(control.held&&control.owned);
    const refused=await api('POST',`/api/bots/${info.chiefId}/computer/control`,{action:'release',controlLeaseId:randomUUID()});assert(refused.held&&!refused.released);
    const released=await api('POST',`/api/bots/${info.chiefId}/computer/control`,{action:'release',controlLeaseId:lease});assert(!released.held&&released.released);
    await api('GET',`/companion/desktop/${randomUUID()}/frame`,undefined,403);
    await api('POST','/companion/desktop',{action:'stop'});assert(!(await api('GET','/companion/desktop')).ready);
  }finally{await h.close();}
});

test('native Chrome performs a real synthetic form task and exposes the same live browser with take and release', {timeout:150000},async()=>{
  const html='<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>独立浏览器验收</title><body><h1>专用浏览器验收</h1><form onsubmit="event.preventDefault();document.getElementById(\'result\').textContent=\'已完成：\'+document.getElementById(\'note\').value"><label>验收文本<input id="note"></label><button id="submit">生成结果</button></form><p id="result">等待提交</p></body></html>';
  let actualRead=false;
  const h=await harness((body,event,res)=>{
    const done=id=>body.messages.some(message=>message.role==='tool'&&message.toolCallId===id);
    if(!done('browser_open'))return call(body,event,res,'browser_open','agent_browser_open',{url:'data:text/html;charset=utf-8,'+encodeURIComponent(html)});
    if(!done('browser_fill'))return call(body,event,res,'browser_fill','agent_browser_fill',{selector:'#note',text:'BROWSER-84'});
    if(!done('browser_click'))return call(body,event,res,'browser_click','agent_browser_click',{selector:'#submit'});
    if(!done('browser_read'))return call(body,event,res,'browser_read','agent_browser_read',{selector:'#result'});
    actualRead=body.messages.some(message=>message.role==='tool'&&message.toolCallId==='browser_read'&&JSON.stringify(message.content).includes('BROWSER-84'));
    complete(event,res,'专用浏览器已完成合成表单，结果 BROWSER-84。');
  },5264);
  const abort=new AbortController();
  try{
    const {api,info}=h;
    await api('POST',`/companion/capabilities/bots/${info.chiefId}`,{browser:true,computer:false,mcpServers:[]});
    await api('POST','/companion/send',{kind:'work',text:'BROWSER_ACCEPTANCE 合成表单',sendId:randomUUID()},202).then(receipt=>h.settle(info.chiefId,receipt.threadId,['agent_browser_open','agent_browser_fill','agent_browser_click','agent_browser_read']));
    assert(actualRead,'Native browser did not return the form result');
    const response=await fetch(h.app.url+`/api/bots/${info.chiefId}/browser/live`,{headers:{cookie:h.cookie},signal:abort.signal});assert.equal(response.status,200);
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',viewer,frame;
    const timeout=setTimeout(()=>abort.abort(),15000);
    try{
      while(!viewer||!frame){const chunk=await reader.read();assert(!chunk.done,'Browser stream ended');buffer+=decoder.decode(chunk.value,{stream:true});let split;while((split=buffer.indexOf('\n\n'))>=0){const event=buffer.slice(0,split);buffer=buffer.slice(split+2);const type=event.split('\n').find(line=>line.startsWith('event:'))?.slice(6).trim(),dataLine=event.split('\n').find(line=>line.startsWith('data:'));if(!dataLine)continue;const data=JSON.parse(dataLine.slice(5));if(type==='ready')viewer=data.viewerId;if(type==='frame')frame=data;}}
      assert(frame.data.length>500);assert(frame.metadata.deviceWidth>0);
      await api('POST',`/api/bots/${info.chiefId}/browser/action`,{type:'ack',viewerId:viewer,seq:frame.seq});
      await api('POST',`/api/bots/${info.chiefId}/browser/action`,{type:'take',viewerId:viewer});
      await api('POST',`/api/bots/${info.chiefId}/browser/action`,{type:'release',viewerId:viewer});
      writeFileSync(join(h.rootDir,'browser-acceptance.json'),JSON.stringify({actualFormResult:'BROWSER-84',frameBytes:Buffer.from(frame.data,'base64').length,metadata:frame.metadata,takeAndRelease:true,isolated:true},null,2));
    }finally{clearTimeout(timeout);abort.abort();await reader.cancel().catch(()=>{});}
  }finally{abort.abort();await h.close();}
});
