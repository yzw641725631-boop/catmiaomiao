import {test} from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {ArtifactFiles} from '../../adapters/artifact-files.mjs';
import {CompanionRuntime} from '../../adapters/runtime.mjs';
import {createCompanionServer} from '../../adapters/server.mjs';
import {fakeReachai,fixtureReachaiConfig} from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';
const options=()=>{const root=scratch('artifacts');mkdirSync(join(root,'work'),{recursive:true});return {root:join(root,'work'),archive:join(root,'归档'),ledger:join(root,'ledger.jsonl'),botId:randomUUID(),threadId:randomUUID()};};
test('DOCX and XLSX are real binaries, reopened content matches literal Chinese/numeric cells',async()=>{
  const files=new ArtifactFiles(options());
  const doc=await files.document({path:'成果/核对报告.docx',title:'合成资料核对',sections:[{heading:'核对结论',text:'SAMPLE-84\n120 + 30 = 150。'}]});
  assert(doc.verified);assert.equal(readFileSync(doc.absolutePath).subarray(0,2).toString(),'PK');assert((await files.preview(doc.path,doc.sha256)).text.includes('SAMPLE-84'));
  const table=await files.spreadsheet({path:'成果/核对表.xlsx',title:'核对结果',columns:['项目','金额','已核对'],rows:[['第一项',120,true],['第二项',30,false],['=SUM(1,2)',150,null]]});
  const preview=await files.preview(table.path,table.sha256);assert.deepEqual(preview.sheets[0].rows,[['项目','金额','已核对'],['第一项',120,true],['第二项',30,false],['=SUM(1,2)',150,null]]);assert.equal(files.listArtifacts().length,2);
});
test('generated artifacts preserve existing bytes and reject traversal, unsupported cells and changed hashes',async()=>{
  const files=new ArtifactFiles(options()),input={path:'报告.docx',title:'资料',sections:[{text:'ORIGINAL-84'}]};const receipt=await files.document(input),original=readFileSync(receipt.absolutePath);
  await assert.rejects(()=>files.document({...input,sections:[{text:'REPLACED'}]}),/已有同名/);assert.deepEqual(readFileSync(receipt.absolutePath),original);
  await assert.rejects(()=>files.document({...input,path:'../别处.docx'}));
  await assert.rejects(()=>files.spreadsheet({path:'结果.xlsx',title:'表',columns:['字段'],rows:[[{formula:'WEBSERVICE("https://example.com")'}]]}));
  writeFileSync(receipt.absolutePath,'CHANGED');await assert.rejects(()=>files.preview(receipt.path,receipt.sha256),/变化/);
});
test('native scheduled work binds its own workspace, generates actual document/table, survives restart without duplicate legacy dispatch',async()=>{
  const rootDir=scratch('native-routines');mkdirSync(rootDir,{recursive:true});
  const provider=await fakeReachai({chat:async(body,event,res)=>{
    const done=id=>body.messages.some(message=>message.role==='tool'&&message.toolCallId===id);
    const next=!done('native_doc')?['native_doc','workspace_create_document',{path:'定时核对.docx',title:'例行核对报告',sections:[{text:'ROUTINE-84：120 + 30 = 150。'}]}]:!done('native_sheet')?['native_sheet','workspace_create_spreadsheet',{path:'定时核对.xlsx',title:'例行核对',columns:['项目','金额'],rows:[['合成甲',120],['合成乙',30],['合计',150]]}]:null;
    if(next){const tool=body.tools.find(tool=>tool.function.name.endsWith(next[1]));assert(tool,'Native scheduled task is missing actual file tool '+next[1]);event({type:'tool_call.delta',toolCall:{index:0,id:next[0],type:'function',name:tool.function.name,arguments:JSON.stringify(next[2])}});event({type:'completed',finishReason:'tool_calls'});}else{event({type:'content.delta',text:'例行工作实际生成并读取校验了 Word 和 Excel。ROUTINE-84。'});event({type:'completed',finishReason:'stop'});}res.end();
  }});
  writeFileSync(join(rootDir,'companion-settings.json'),JSON.stringify({provider:'reachai',reachai:fixtureReachaiConfig(provider.url)}));
  let runtime=new CompanionRuntime({routineTools:'ask',rootDir}),app=await createCompanionServer({port:5268,runtime});
  let cookie=(await fetch(app.url+'/companion/info')).headers.get('set-cookie').split(';')[0];
  const api=async(method,path,body,status=200)=>{const response=await fetch(app.url+path,{method,headers:{cookie,origin:app.url,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});const value=await response.json();assert.equal(response.status,status,JSON.stringify(value));return value;};
  try{
    const created=await api('POST','/companion/routines',{title:'合成例行验收',task:'实际生成 Word 和 Excel，不访问真实资料。',at:new Date(Date.now()+2200).toISOString(),repeat:'once',continuity:true},201),id=created.routine.id;
    let run,threadId,completed=false;const deadline=Date.now()+50000;
    while(Date.now()<deadline){const data=await api('GET','/companion/routines');run=data.runs.find(row=>row.routineId===id);threadId=run?.threadId;
      if(threadId){const page=await api('GET',`/api/threads/${threadId}/messages?limit=100`);for(const message of page.messages){const card=message.card;if(card?.requestId&&!card.answered&&!card.dismissed&&!card.expired){assert(/workspace_create_(document|spreadsheet)/.test(card.tool||card.title||card.subtitle||''),JSON.stringify(card));await api('POST',`/api/bots/${runtime.current.chiefId}/respond`,{threadId,requestId:card.requestId,behavior:'allow'});}}}
      if(run?.status==='completed'){completed=true;break;}if(run?.status==='failed')assert.fail(JSON.stringify(run));await new Promise(resolve=>setTimeout(resolve,120));
    }
    assert(completed,'Native routine did not complete: '+JSON.stringify(run));assert(runtime.current.workThreadIds.includes(threadId));
    const artifacts=await api('GET',`/companion/work/${threadId}/artifacts`);assert.equal(artifacts.artifacts.length,2);assert(artifacts.artifacts.every(file=>file.current));
    const preview=await api('POST',`/companion/work/${threadId}/artifacts/preview`,artifacts.artifacts[0]);assert(preview.text.includes('ROUTINE-84'));
    assert.equal(runtime.services.data.events.length,0);assert.equal(runtime.services.data.reminders.length,0);
    await api('POST',`/companion/routines/${id}/pause`,{});await api('POST',`/companion/routines/${randomUUID()}/run`,{},404);
    await app.close();runtime=new CompanionRuntime({routineTools:'ask',rootDir});app=await createCompanionServer({port:5268,runtime});cookie=(await fetch(app.url+'/companion/info')).headers.get('set-cookie').split(';')[0];
    const restored=await api('GET','/companion/routines');assert.equal(restored.runs.filter(row=>row.routineId===id).length,1);assert.equal(restored.routines.find(row=>row.id===id).enabled,false);assert.equal((await api('GET',`/companion/work/${threadId}/artifacts`)).artifacts.length,2);
    writeFileSync(join(rootDir,'acceptance.json'),JSON.stringify({passed:true,routineId:id,threadId,artifacts:artifacts.artifacts.map(({path,sha256,bytes})=>({path,sha256,bytes})),legacyDispatches:0,restartPreserved:true},null,2));
  }finally{await app.close();await provider.close();}
});
