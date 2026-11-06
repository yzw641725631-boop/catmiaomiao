import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CompanionRuntime } from '../../adapters/runtime.mjs';
import { createCompanionServer } from '../../adapters/server.mjs';
import { fakeReachai, fixtureReachaiConfig } from './fixtures/reachai.mjs';
import { scratch } from './scratch.mjs';

test('native model tools reach granted files, research, preference, reminder and independent work through the real MCP bridge', async () => {
  const rootDir=scratch('services-native'), docs=join(rootDir,'documents'); mkdirSync(docs,{recursive:true}); writeFileSync(join(docs,'notes.md'),'# 合成文档\n合同编号 SAMPLE-42。');
  let grant;
  const steps=()=>[
    ['folders',{}],['folder_files',{folder_id:grant.id}],['folder_read',{folder_id:grant.id,path:'notes.md'}],
    ['web_search',{query:'public fixture research'}],['web_read',{url:'https://example.com/official'}],
    ['remember_preference',{text:'隔离测试偏好，报告先写结论'}],['create_reminder',{title:'隔离测试提醒',at:new Date(Date.now()+86400000).toISOString(),repeat:'once',action:'notify'}],
    ['start_work',{description:'NATIVE_BACKGROUND 只回复后台任务已接收，不用工具。',request_key:'native-service-work'}],
  ];
  const provider=await fakeReachai({chat(body,event,res){
    const user=body.messages.filter(row=>row.role==='user').at(-1)?.content||'';
    if(user.includes('NATIVE_SERVICES')) {
      const n=body.messages.filter(row=>row.role==='tool'&&row.toolCallId?.startsWith('service_step_')).length;
      const step=steps()[n];
      if(step){const selected=body.tools?.find(row=>row.function.name.endsWith('assistant_'+step[0]));
        if(!selected)event({type:'content.delta',text:'MISSING_SERVICE_TOOL '+step[0]});
        else event({type:'tool_call.delta',toolCall:{index:0,id:'service_step_'+n,type:'function',name:selected.function.name,arguments:JSON.stringify(step[1])}});
        event({type:'completed',finishReason:selected?'tool_calls':'stop'});res.end();return;
      }
    }
    event({type:'content.delta',text:user.includes('NATIVE_SERVICES')?'NATIVE_SERVICES_DONE':'NATIVE_BACKGROUND_DONE'});event({type:'completed',finishReason:'stop'});res.end();
  }});
  const runtime=new CompanionRuntime({routineTools:'ask',rootDir}); let app;
  runtime.services.web={async search(){return {results:[{title:'合成来源',url:'https://example.com/official'}]};},async read(){return {url:'https://example.com/official',text:'合成来源正文，仅验证集成接口。'};}};
  writeFileSync(join(rootDir,'companion-settings.json'),JSON.stringify({provider:'reachai',reachai:fixtureReachaiConfig(provider.url)}));
  try {
    app=await createCompanionServer({port:5232,runtime}); const boot=await fetch(app.url+'/companion/info'),cookie=boot.headers.get('set-cookie').split(';')[0],info=await boot.json();
    const api=async(method,path,body,status=200)=>{const response=await fetch(app.url+path,{method,headers:{cookie,origin:app.url,'content-type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
    assert.equal((await fetch(app.url+'/companion/services')).status,401);
    const bad=await api('POST','/companion/folders',{path:'not-an-absolute-path'},400); assert.match(bad.error,/完整路径/);
    grant=await api('POST','/companion/folders',{path:docs});
    await api('POST','/companion/send',{kind:'chat',sendId:'native_services_0001',text:'NATIVE_SERVICES 验证所有能力。'},202);
    const approved=new Set(); let messages=[];
    const end=Date.now()+60000;
    while(Date.now()<end){
      messages=(await api('GET',`/api/threads/${info.companionThreadId}/messages?limit=100`)).messages;
      for(const m of messages){const c=m.card;if(c?.requestId&&!c.answered&&!c.dismissed&&!c.expired&&!approved.has(c.requestId)){
        assert(c.tool?.startsWith('assistant_'), 'Only synthetic assistant tools may be approved'); approved.add(c.requestId);
        await api('POST',`/api/bots/${info.chiefId}/respond`,{threadId:info.companionThreadId,requestId:c.requestId,behavior:'allow'});
      }}
      const missing=messages.find(m=>m.text?.includes('MISSING_SERVICE_TOOL'));assert(!missing,missing?.text);
      if(messages.some(m=>m.text==='NATIVE_SERVICES_DONE'&&m.turnTerminal))break;
      await new Promise(resolve=>setTimeout(resolve,150));
    }
    assert(messages.some(m=>m.text==='NATIVE_SERVICES_DONE'&&m.turnTerminal&&m.turnSucceeded));
    for(const [name]of steps())assert(messages.some(m=>m.tool?.name==='assistant_'+name&&m.tool.ok===true),'Missing successful '+name);
    assert(messages.some(m=>m.tool?.name==='assistant_folder_read'&&m.tool.output?.includes('SAMPLE-42')));
    const saved=await api('GET','/companion/services');assert.equal(saved.preferences.length,1);assert.equal(saved.preferences[0].status,'pending');assert.equal(saved.reminders.length,1);assert.equal(saved.workThreadIds.length,1);
    const job=runtime.jobs.get(saved.workThreadIds[0]);assert(job?.sourceSendId);
    await api('POST',`/companion/preferences/${saved.preferences[0].id}/confirm`,{});
    assert((await api('GET',`/api/bots/${info.chiefId}/memory/file`)).text.includes('隔离测试偏好'));
    const original={folder:job.folder,threadId:job.threadId,sendId:job.sourceSendId,text:job.userText};
    await app.close();app=null;
    const reopened=new CompanionRuntime({routineTools:'ask',rootDir});
    try{await reopened.start();assert.equal(reopened.services.snapshot().folders.length,1);assert.equal(reopened.services.snapshot().preferences[0].status,'confirmed');
      const result=await reopened.send({kind:'work',sendId:original.sendId,text:original.text});assert.equal(result.threadId,original.threadId);assert.equal(reopened.current.workThreadIds.length,1);assert.equal(reopened.jobs.get(result.threadId).folder,original.folder);
    }finally{await reopened.close();}
  }finally{if(app)await app.close();await provider.close();}
});
