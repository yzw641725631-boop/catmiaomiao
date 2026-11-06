import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {CompanionRuntime} from '../../adapters/runtime.mjs';
import {createCompanionServer} from '../../adapters/server.mjs';
import {fakeReachai,fixtureReachaiConfig} from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';
test('native team goal coordinates an actual specialist file, records completion and restores the same goal after restart',async()=>{
  const rootDir=scratch('native-goals');mkdirSync(rootDir,{recursive:true});let helperId,turn=0;
  const provider=await fakeReachai({chat:(body,event,res)=>{
    assert(!body.tools?.some(tool=>tool.function.name.endsWith('coordinate_bots')),'A native team goal must not mount a competing delegation loop');
    const done=id=>body.messages.some(message=>message.role==='tool'&&message.toolCallId===id);
    const complete=text=>{event({type:'content.delta',text});event({type:'completed',finishReason:'stop'});res.end();turn++;};
    const call=(id,suffix,args)=>{const tool=body.tools?.find(tool=>tool.function.name.endsWith(suffix));assert(tool,'Missing assigned goal tool: '+suffix);event({type:'tool_call.delta',toolCall:{index:0,id,type:'function',name:tool.function.name,arguments:JSON.stringify(args)}});event({type:'completed',finishReason:'tool_calls'});res.end();};
    if(turn===0)return complete(`我会请文档助理先保存合成核对结果。\n<openmaus-goal>{"status":"continue","next":"${helperId}","instruction":"请用 workspace_write_file 新建 goal.md（expected_sha256=null），写入 # 持续目标验收 与 GOAL-84：120+30=150；再用 workspace_check_file 的 utf8 校验，然后回报。","detail":"正在交给文档助理保存和校验。"}</openmaus-goal>`);
    if(turn===1){if(!done('goal_write'))return call('goal_write','workspace_write_file',{path:'goal.md',content:'# 持续目标验收\nGOAL-84：120+30=150。\n',expected_sha256:null});if(!done('goal_check'))return call('goal_check','workspace_check_file',{path:'goal.md',check:'utf8'});return complete('文档助理已实际保存并校验 goal.md，含 GOAL-84。');}
    if(!done('goal_read'))return call('goal_read','workspace_read_file',{path:'goal.md'});
    return complete('已读回实际文件，GOAL-84 金额150，目标完成。\n<openmaus-goal>{"status":"completed","detail":"文档已保存，utf8校验与主助理读回均通过。"}</openmaus-goal>');
  }});
  writeFileSync(join(rootDir,'companion-settings.json'),JSON.stringify({provider:'reachai',reachai:fixtureReachaiConfig(provider.url)}));let runtime=new CompanionRuntime({routineTools:'ask',rootDir}),app=await createCompanionServer({port:5271,runtime});helperId=runtime.current.helperIds[1];let cookie=(await fetch(app.url+'/companion/info')).headers.get('set-cookie').split(';')[0];
  const api=async(method,path,body,status=200)=>{const response=await fetch(app.url+path,{method,headers:{cookie,origin:app.url,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;};
  try{const input={title:'合成持续目标',goal:'核对 GOAL-84 的120+30=150，交给文档助理保存goal.md再校验，主助理读回后完成。',sendId:randomUUID()},created=await api('POST','/companion/goals',input,201),id=created.id;assert.equal((await api('POST','/companion/goals',input,201)).id,id);let latest;const deadline=Date.now()+50000;
    while(Date.now()<deadline){latest=(await api('GET',`/companion/goals/${id}`)).goals[0];for(const message of latest.messages){const card=message.card;if(card?.requestId&&!card.answered&&!card.dismissed&&!card.expired){assert(['workspace_write_file','workspace_check_file','workspace_read_file'].includes(card.tool),JSON.stringify(card));await api('POST',`/api/bots/${message.from.botId}/respond`,{threadId:latest.threadId,requestId:card.requestId,behavior:'allow'});}}if(latest.goalRun?.status==='completed')break;if(['failed','blocked','limit-reached'].includes(latest.goalRun?.status))assert.fail(JSON.stringify(latest));await new Promise(resolve=>setTimeout(resolve,120));}
    assert.equal(latest.goalRun?.status,'completed',JSON.stringify(latest));assert(latest.goalRun.turnCount>=3);const job=runtime.jobs.get(latest.threadId);assert.match(readFileSync(join(job.folder,'goal.md'),'utf8'),/GOAL-84/);const scope=await runtime.workspaceScope(runtime.current,helperId,latest.threadId);assert.equal(scope.root,job.folder);assert.equal(await runtime.workspaceScope(runtime.current,randomUUID(),latest.threadId),null);await api('GET',`/companion/goals/${randomUUID()}`,undefined,404);
    await app.close();runtime=new CompanionRuntime({routineTools:'ask',rootDir});app=await createCompanionServer({port:5271,runtime});cookie=(await fetch(app.url+'/companion/info')).headers.get('set-cookie').split(';')[0];const restored=(await api('GET',`/companion/goals/${id}`)).goals[0];assert.equal(restored.goalRun.status,'completed');assert.equal(restored.threadId,latest.threadId);assert.equal((await api('GET','/companion/goals')).goals.length,1);writeFileSync(join(rootDir,'acceptance.json'),JSON.stringify({passed:true,id,threadId:restored.threadId,turns:restored.goalRun.turnCount,folder:job.folder,restartPreserved:true},null,2));
  }finally{await app.close();await provider.close();}
});
