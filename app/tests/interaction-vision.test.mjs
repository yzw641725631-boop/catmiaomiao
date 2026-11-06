import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {CompanionRuntime,PROJECT} from '../../adapters/runtime.mjs';
import {createCompanionServer} from '../../adapters/server.mjs';
import {routineToolAllowed} from '../../adapters/routine-tool-policy.mjs';
import {injectRoutineToolPolicy} from '../../adapters/workspace-hook.mjs';
import {validateVisionRequest} from '../../adapters/vision.mjs';
import {fakeReachai,fixtureReachaiConfig} from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';
const wait=async(read,accept,label)=>{const deadline=Date.now()+35000;let value;while(Date.now()<deadline){value=await read();if(accept(value))return value;await new Promise(resolve=>setTimeout(resolve,100));}assert.fail(label+' '+JSON.stringify(value).slice(-1500));};
const done=(event,res,text)=>{event({type:'content.delta',text});event({type:'completed',finishReason:'stop'});res.end();};
const call=(body,event,res,id,name,args)=>{const tool=body.tools.find(tool=>tool.function.name===name||tool.function.name.endsWith('_'+name));assert(tool,'Missing tool '+name);event({type:'tool_call.delta',toolCall:{index:0,id,type:'function',name:tool.function.name,arguments:JSON.stringify(args)}});event({type:'completed',finishReason:'tool_calls'});res.end();};
test('routine grants only cover owned, scoped services, retaining approvals for external writes and computer actions',()=>{
 const workspace={command:process.execPath,args:[fileURLToPath(new URL('../../adapters/workspace-mcp.mjs',import.meta.url))],env:{COMPANION_WORK_ROOT:'synthetic',COMPANION_WORK_BOT:'bot',COMPANION_WORK_THREAD:'thread'}};
 assert(routineToolAllowed('workspace','write_file',workspace));assert(!routineToolAllowed('workspace','delete_file',workspace));assert(!routineToolAllowed('workspace','write_file',{...workspace,args:['C:/untrusted/workspace-mcp.mjs']}));
 const assistant={command:process.execPath,args:[fileURLToPath(new URL('../../adapters/assistant-mcp.mjs',import.meta.url))],env:{COMPANION_SERVICE_URL:'http://127.0.0.1:5200',COMPANION_SERVICE_TOKEN:'synthetic'}};
 assert(routineToolAllowed('assistant','web_search',assistant));assert(routineToolAllowed('assistant','start_work',assistant));assert(!routineToolAllowed('assistant','folder_write',assistant));assert(!routineToolAllowed('assistant','create_routine',assistant));assert(!routineToolAllowed('personal_mail','send_email',assistant));assert(!routineToolAllowed('computer','click',workspace));
 const source=readFileSync(join(PROJECT,'upstream/OpenMausBot/server/drivers/chat-mcp-tools.ts'),'utf8');assert.doesNotThrow(()=>injectRoutineToolPolicy(source));assert.throws(()=>injectRoutineToolPolicy(source+'\n'),/Pinned/);
 const image={messages:[{role:'user',content:[{type:'image_url',image_url:{url:'data:image/png;base64,iVBORw0KGgo='}}]}]};assert.doesNotThrow(()=>validateVisionRequest(image));assert.throws(()=>validateVisionRequest({messages:[{role:'user',content:[{type:'image_url',image_url:{url:'http://127.0.0.1/private'}}]}]}),/远程图片/);
 const normalized=validateVisionRequest({...image,stream:true,stream_options:{include_usage:true},tools:[{type:'function',function:{name:'synthetic_tool'}}]});assert.equal(normalized.stream,false);assert(!('stream_options' in normalized),'Nonstream vision must not carry streaming-only options');assert.equal(normalized.tools[0].function.name,'synthetic_tool');
});
test('uploaded image bytes reach the vision provider through the native conversation and remain viewable, with no text-only fallback', {timeout:90000},async()=>{
 const rootDir=scratch('interaction-image');mkdirSync(rootDir,{recursive:true});const requests=[];let uploadFails=false;
 const vision={async complete(body){requests.push(body);if(uploadFails)throw Object.assign(new Error('美国视觉服务上传图片失败，图片仍保留在记录里。'),{status:500,code:'VISION_IMAGE_UPLOAD_FAILED'});return {id:'synthetic-vision',choices:[{index:0,message:{role:'assistant',content:'ORBIT 84：120 + 30 = 150，红色方形和蓝色圆形。'},finish_reason:'stop'}]};},close(){}};
 const provider=await fakeReachai();writeFileSync(join(rootDir,'companion-settings.json'),JSON.stringify({provider:'reachai',reachai:fixtureReachaiConfig(provider.url)}));let app;
 try{
  app=await createCompanionServer({port:5278,runtime:new CompanionRuntime({rootDir,visionTransport:vision,routineTools:'assist'})});const boot=await fetch(app.url+'/companion/info'),cookie=boot.headers.get('set-cookie').split(';')[0],info=await boot.json();
  const api=async(method,path,body)=>{const response=await fetch(app.url+path,{method,headers:{cookie,origin:app.url,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert(response.ok,JSON.stringify(data));return data;};
  const bytes=readFileSync(join(PROJECT,'evidence/interaction-vision-20261023/vision-fixture.png'));
  assert.equal((await fetch(app.url+'/api/attachments',{method:'POST',headers:{origin:app.url,'content-type':'image/png'},body:bytes})).status,401);
  const upload=await fetch(app.url+'/api/attachments?uploadId='+randomUUID(),{method:'POST',headers:{cookie,origin:app.url,'content-type':'image/png'},body:bytes});assert.equal(upload.status,201);const saved=await upload.json();
  const downloaded=await fetch(app.url+'/api/attachments/'+saved.path.split(/[\\/]/).at(-1),{headers:{cookie}});assert(Buffer.from(await downloaded.arrayBuffer()).equals(bytes));
  await api('POST','/companion/send',{kind:'chat',sendId:randomUUID(),text:`识别图中的内容\n\n<attached-image path="${saved.path}" name="验收图.png" />`});
  const page=await wait(()=>api('GET',`/api/threads/${info.companionThreadId}/messages?limit=100`),page=>page.messages.some(message=>message.turnTerminal&&/ORBIT 84/.test(message.text||'')),'Vision terminal reply missing');
  assert(requests.length);const image=requests[0].messages.flatMap(message=>Array.isArray(message.content)?message.content:[]).find(part=>part.type==='image_url');assert(image);assert(Buffer.from(image.image_url.url.split(',')[1],'base64').equals(bytes));
  assert(!provider.requests.some(request=>request.path==='/model/chat/stream/events'));
  assert(!requests[0].tools.some(tool=>tool.function.name.endsWith('coordinate_bots')),'Main chat must start independent work rather than block on delegation');
  uploadFails=true;
  await api('POST','/companion/send',{kind:'chat',sendId:randomUUID(),text:`隔离上传故障\n\n<attached-image path="${saved.path}" name="验收图.png" />`});
  await wait(()=>api('GET',`/api/threads/${info.companionThreadId}/messages?limit=100`),page=>page.messages.some(message=>message.tool?.ok===false&&message.tool.name.includes('美国视觉服务上传图片失败')),'Vision upload failure must remain visible');
  assert(!provider.requests.some(request=>request.path==='/model/chat/stream/events'),'A failed image must never silently fall back to a blind text model');
  assert(readFileSync(join(rootDir,'logs/model-requests.jsonl'),'utf8').includes('VISION_IMAGE_UPLOAD_FAILED'));
  writeFileSync(join(rootDir,'acceptance.json'),JSON.stringify({syntheticVisionProvider:true,uploadedBytesMatched:true,nativeReply:page.messages.findLast(message=>message.turnTerminal)?.text,mainChatDelegationSeparated:true},null,2));
 }finally{if(app)await app.close();await provider.close();}
});
test('an independent native job creates its scoped file without clicks while the main chat replies before the job ends', {timeout:90000},async()=>{
 const rootDir=scratch('interaction-concurrent');mkdirSync(rootDir,{recursive:true});let release;const gate=new Promise(resolve=>release=resolve);let holding=false;
 const provider=await fakeReachai({chat(body,event,res){const user=(body.messages.filter(message=>message.role==='user').at(-1)?.content||'').split('[end of recalled passages — the message follows]').at(-1);
  if(user.includes('PARALLEL_CHAT_84'))return done(event,res,'可以继续聊，后台工作还在进行。');
  if(user.includes('START_BACKGROUND_84')){
   if(!body.messages.some(message=>message.role==='tool'&&message.toolCallId==='start_background'))return call(body,event,res,'start_background','assistant_start_work',{description:'WORK_LONG_84 保存合成文件并保持工作进行中。',request_key:'parallel-natural-84'});
   return done(event,res,'后台工作已经安排，你可以继续和我聊天。');
  }
  if(user.includes('WORK_LONG_84')){
   if(!body.messages.some(message=>message.role==='tool'&&message.toolCallId==='routine_write'))return call(body,event,res,'routine_write','workspace_write_file',{path:'parallel.md',content:'# 合成并行验收\nPARALLEL-84\n',expected_sha256:null});
   holding=true;return gate.then(()=>done(event,res,'后台文件已保存。'));
  }return done(event,res,'合成回复');
 }});writeFileSync(join(rootDir,'companion-settings.json'),JSON.stringify({provider:'reachai',reachai:fixtureReachaiConfig(provider.url)}));let app;
 try{
  app=await createCompanionServer({port:5279,runtime:new CompanionRuntime({rootDir,routineTools:'assist'})});const boot=await fetch(app.url+'/companion/info'),cookie=boot.headers.get('set-cookie').split(';')[0],info=await boot.json();
  const api=async(method,path,body)=>{const response=await fetch(app.url+path,{method,headers:{cookie,origin:app.url,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert(response.ok,JSON.stringify(data));return data;};
  await api('POST','/companion/send',{kind:'chat',sendId:randomUUID(),text:'START_BACKGROUND_84 帮我后台保存合成文件，我要继续聊天。'});
  await wait(()=>api('GET',`/api/threads/${info.companionThreadId}/messages?limit=100`),page=>page.messages.some(message=>message.turnTerminal&&message.text?.includes('后台工作已经安排')),'Main conversation did not return after starting independent work');
  assert.equal(app.runtime.jobs.size,1,'Natural-language work must create one independent job');
  const work=[...app.runtime.jobs.values()][0];
  await wait(async()=>holding,value=>value,'Routine workspace call did not run without an approval click');
  assert(existsSync(join(app.runtime.jobs.get(work.threadId).folder,'parallel.md')));
  const receipt=await api('POST','/companion/send',{kind:'chat',sendId:randomUUID(),text:'PARALLEL_CHAT_84 后台工作中，我还可以和你聊吗？'});assert(!receipt.queued);
  const page=await wait(()=>api('GET',`/api/threads/${info.companionThreadId}/messages?limit=100`),page=>page.messages.some(message=>message.turnTerminal&&message.text?.includes('可以继续聊')),'Main chat stayed blocked by background work');
  const bots=(await api('GET','/api/bots')).bots;assert(bots.find(bot=>bot.id===info.chiefId).tasks.find(task=>task.threadId===work.threadId).busy);
  const workMessages=await api('GET',`/api/threads/${work.threadId}/messages?limit=100`);assert(!workMessages.messages.some(message=>message.card?.requestId));
  writeFileSync(join(rootDir,'acceptance.json'),JSON.stringify({naturalChatStartedWork:true,parallelChatReply:page.messages.findLast(message=>message.turnTerminal)?.text,workStillBusy:true,routineFileWritten:true,approvalClicks:0},null,2));
 }finally{release();if(app)await app.close();await provider.close();}
});
