import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CompanionRuntime,PROJECT} from '../adapters/runtime.mjs';
import {createCompanionServer} from '../adapters/server.mjs';
import {fakeReachai,fixtureReachaiConfig} from '../app/tests/fixtures/reachai.mjs';
const rootDir=join(PROJECT,'evidence','hierarchy-qa-'+randomUUID());mkdirSync(rootDir,{recursive:true});
const provider=await fakeReachai({chat:async(body,event,res)=>{
 writeFileSync(join(rootDir,'synthetic-latest-chat.json'),JSON.stringify(body,null,2));
 const user=body.messages.filter(message=>message.role==='user').at(-1)?.content?.split('\n\n[本地助理能力说明')[0].split('\n\n本次工作唯一指定目录：')[0].split('\n\n').at(-1)||'',done=id=>body.messages.some(message=>message.role==='tool'&&message.toolCallId===id);
 const call=(id,name,args)=>{const selected=body.tools.find(tool=>tool.function.name.endsWith('_'+name)||tool.function.name===name);if(!selected)throw new Error('Missing fixture tool '+name);event({type:'tool_call.delta',toolCall:{index:0,id,type:'function',name:selected.function.name,arguments:JSON.stringify(args)}});event({type:'completed',finishReason:'tool_calls'});res.end();};
 if(user.includes('待确认清单')&&!done('pending_write'))return call('pending_write','workspace_write_file',{path:'待确认清单.md',expected_sha256:null,content:'# 清单\n这是隔离验收资料。'});
 if(user.includes('比较候选方案')){event({type:'error',message:'合成测试：资料来源暂时无法读取'});res.end();return;}
 if(user.includes('每周阅读笔记')){
  if(!done('save_note'))return call('save_note','workspace_write_file',{path:'本周阅读.md',expected_sha256:null,content:'# 本周阅读笔记\n\n## 三个值得记住的想法\n\n- 把注意力留给最重要的一件事。\n- 工作结束后留一点时间复盘。\n- 为下周保留一段不被打断的时间。\n\n## 下一步\n\n周五回顾，并整理成自己的做法。'});
  if(!done('check_note'))return call('check_note','workspace_check_file',{path:'本周阅读.md',check:'utf8'});
 }
 const text=user.includes('每周阅读笔记')?'笔记整理好了，按「想法、行动、下次回顾」排好了顺序。\n\n你可以直接打开 [本周阅读.md](本周阅读.md)，需要调整的地方随时告诉我。':'我在。你的工作会继续在后台进行，我们可以接着聊。\n\n动态里能看到每位助理的进展，打开一项工作就能读到回复与成果。';
 event({type:'content.delta',text});event({type:'completed',finishReason:'stop'});res.end();
}});
writeFileSync(join(rootDir,'companion-settings.json'),JSON.stringify({provider:'reachai',reachai:fixtureReachaiConfig(provider.url)}));
const runtime=new CompanionRuntime({rootDir,routineTools:'ask',verificationLabel:'隔离合成验收'}),app=await createCompanionServer({port:5280,runtime});
const boot=await fetch(app.url+'/companion/info'),cookie=boot.headers.get('set-cookie').split(';')[0],info=await boot.json();
const api=async(method,path,body)=>{const res=await fetch(app.url+path,{method,headers:{cookie,origin:app.url,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const json=await res.json();if(!res.ok)throw new Error(JSON.stringify(json));return json;};
const pause=()=>new Promise(resolve=>setTimeout(resolve,100));
async function send(text,kind='work',settle=true){const receipt=await api('POST','/companion/send',{kind,text,sendId:randomUUID()});if(!settle)return receipt;for(let n=0;n<400;n++){const list=(await api('GET',`/api/threads/${receipt.threadId}/messages?limit=200`)).messages;for(const message of list){const card=message.card;if(card?.requestId&&!card.answered&&!card.expired&&!card.dismissed){if(!/workspace_(write|check)_file/.test(card.tool))throw new Error('Unexpected fixture approval');await api('POST',`/api/bots/${info.chiefId}/respond`,{threadId:receipt.threadId,requestId:card.requestId,behavior:'allow'});}}const bots=(await api('GET','/api/bots')).bots,task=bots.find(b=>b.id===info.chiefId).tasks.find(t=>t.threadId===receipt.threadId);if(!task.busy&&list.some(m=>m.turnTerminal||m.tool?.terminal))return receipt;await pause();}throw new Error('Fixture task did not settle');}
await send('请整理每周阅读笔记，写成一份便于回看的文档。');await send('比较候选方案，查明资料是否齐全。');await send('文档已经交给你，我可以继续跟你聊吗？','chat');await send('请准备待确认清单。','work',false);
writeFileSync(join(rootDir,'preview.json'),JSON.stringify({rootDir,chiefId:info.chiefId,url:app.url,scriptedModel:true,syntheticOnly:true},null,2));console.log(JSON.stringify({rootDir,url:app.url,ready:true}));process.stdin.setEncoding('utf8');process.stdin.resume();await new Promise(resolve=>process.stdin.on('data',text=>text.includes('quit')&&resolve()));await app.close();await provider.close();process.stdin.pause();
