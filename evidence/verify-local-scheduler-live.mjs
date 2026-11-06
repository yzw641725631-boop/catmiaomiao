import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const origin='http://127.0.0.1:5217',boot=await fetch(origin+'/companion/info'),cookie=boot.headers.get('set-cookie').split(';')[0];
async function api(path,body){const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{origin,cookie,'content-type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});assert(r.ok);return r.json();}
const at=new Date(Date.now()+5000).toISOString(),started=Date.now();
const row=await api('/companion/reminders',{title:'后台触发验收（测试）',at,repeat:'once',action:'work',task:'后台触发验收，这是合成测试：请只回复“后台任务已自动触发”。不要派工、使用工具、读取个人资料或修改任何配置。'});
console.log(JSON.stringify({phase:'scheduled',id:row.id,at}));
let event,reply;
while(Date.now()-started<90000){const state=await api('/companion/services');event=state.events.find(e=>e.reminderId===row.id);if(event?.threadId){
 const p=await api(`/api/threads/${event.threadId}/messages?limit=100`);reply=p.messages.find(m=>m.kind==='text'&&m.role==='bot'&&m.turnTerminal&&m.turnSucceeded===true);if(reply)break;
}await new Promise(resolve=>setTimeout(resolve,1000));}
const record={at:new Date().toISOString(),kind:'Local service scheduler without an open application page request; synthetic task only',reminderId:row.id,due:at,triggeredAt:event?.at,threadId:event?.threadId,replyId:reply?.id,passed:!!reply,elapsedMs:Date.now()-started};
const dir=join(import.meta.dirname,'personal-services-20261022');await mkdir(dir,{recursive:true});const output=join(dir,'scheduler-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json');await writeFile(output,JSON.stringify(record,null,2)+'\n');console.log(JSON.stringify({output,...record}));if(!record.passed)process.exitCode=1;
