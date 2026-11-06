import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceSession } from '../../adapters/voice-session.mjs';
import { CompanionRuntime } from '../../adapters/runtime.mjs';
import { ContinuousVoice } from '../src/continuousVoice.ts';
import { VoiceReplies } from '../src/voiceReplies.ts';
import { visibleMessageText, emptyState, helperQuestionExpired } from '../src/projection.ts';
import { artifactSource, workAttention, workReplies, workRows } from '../src/work.ts';

test('one voice owner spans utterances and an old browser cannot renew, release or transcribe after takeover', () => {
  let now=1000,changes=0;const voice=new VoiceSession({now:()=>now,changed:()=>changes++});
  const a='a'.repeat(36),b='b'.repeat(36); voice.act('claim',a);voice.assert(a);
  voice.act('renew',a);voice.act('claim',b);assert.equal(changes,2);
  assert.throws(()=>voice.assert(a),/另一个页面/);assert.throws(()=>voice.act('renew',a),/另一个页面/);
  voice.act('release',a);voice.assert(b);now+=45001;assert.throws(()=>voice.assert(b),/暂停/);
});
test('an ASR completion is consumed once and missing model replies release voice waiting without replay', async () => {
  let handler, sends=0,captures=0;const errors=[];
  const voice=new ContinuousVoice({capture(h){handler=h;captures++;return{cancel(){},async finish(){}};},async submit(_,arm){sends++;arm('send');return true;},async speak(){},stopSpeech(){},changed(){},failed(message){errors.push(message);}},15,false);
  try{voice.start();handler.complete('原始语音');handler.complete('重复回调');await new Promise(r=>setTimeout(r,360));assert.equal(sends,1);assert.equal(captures,2);assert.equal(voice.phase,'listening');assert.match(errors[0],/不会重复发送/);}finally{voice.stop();}
});
test('a proven reply to this voice request speaks even when an older handoff keeps native requestPending true', () => {
  const replies=new VoiceReplies();replies.arm('voice');
  const result=replies.takeResult({chat:[{id:'u',role:'user',kind:'text',sendId:'voice',requestPending:true},{id:'r',role:'bot',kind:'text',text:'这是当前问题的答复',requestMessageId:'u',turnTerminal:true,turnSucceeded:true}]});
  assert.equal(result.reply.id,'r');assert.equal(replies.takeResult({chat:[]}),null);
});
test('the reading view hides only adapter context and exposes actual helper replies and pending questions', () => {
  const text='我的问题\n\n[本地助理能力说明，时间]\n你有 assistant 工具：内部提示';
  assert.equal(visibleMessageText({role:'user',text,sendId:'send'}),'我的问题');assert.equal(visibleMessageText({role:'bot',text}),text);
  const info={chiefId:'chief',helperIds:['writer'],companionThreadId:'chat',workThreadIds:[]};
  const question={id:'q',at:2,role:'bot',kind:'activity',tool:{name:'文档助理 needs your input: 需要目录'},threadRef:{botId:'writer',threadId:'child'}};
  const state={...emptyState(),bots:{chief:{id:'chief'},writer:{id:'writer',name:'文档助理',tasks:[{threadId:'child',openedBy:{botId:'chief',threadId:'chat'}}]}},messages:{chat:[question],child:[{id:'answer',at:3,role:'bot',kind:'text',text:'还未读取目录',turnTerminal:true}]}};
  assert.equal(workAttention(info,state,'child').length,1);assert.equal(workReplies(workRows(info,state,'child'))[0].message.text,'还未读取目录');
  state.messages.child.push({id:'user',at:4,role:'user',kind:'text',text:'补充信息'});assert.equal(workAttention(info,state,'child').length,0);
});
test('live status explicitly reports an unanswered helper question instead of pretending that the helper is running', async () => {
  const runtime=new CompanionRuntime({routineTools:'ask',rootDir:'not-used'}),session={chiefId:'chief',helperIds:['writer'],companionThreadId:'chat'};
  runtime.services.folders.listGrants=()=>[];
  runtime.api=async(_,__,path)=>path==='/api/bots'?{bots:[{id:'writer',name:'文档助理',tasks:[{threadId:'child',title:'桌面文档',busy:false}]}]}:{messages:path.includes('/chat/')?[{at:10,threadRef:{botId:'writer',threadId:'child'},tool:{name:'文档助理 needs your input: 需要目录'}}]:[{role:'user',at:1}]};
  const note=await runtime.liveWorkNote(session);assert.match(note,/没有正在执行/);assert.match(note,/等用户补充信息/);assert.match(note,/不能把测试文件夹当成用户桌面/);
});
test('native handoff timeout closes its old question and a finished helper is not left in the pending badge', () => {
  const info={chiefId:'chief',helperIds:['writer'],companionThreadId:'chat',workThreadIds:[]};
  const question={id:'q',at:2,role:'bot',kind:'activity',tool:{name:'文档助理 needs your input: 需要目录'},threadRef:{botId:'writer',threadId:'child'}};
  const state={...emptyState(),bots:{chief:{id:'chief'},writer:{id:'writer',name:'文档助理',tasks:[{threadId:'child',openedBy:{botId:'chief',threadId:'chat'}}]}},messages:{chat:[question,{id:'timeout',at:4,role:'bot',kind:'activity',tool:{name:'文档助理 — failed: the person did not answer',ok:false},threadRef:{botId:'writer',threadId:'child'}}],child:[{id:'answer',at:3,role:'bot',kind:'text',text:'还未读取目录',turnTerminal:true,turnSucceeded:true}]}};
  assert.equal(helperQuestionExpired(question,state),true);assert.equal(workAttention(info,state,'child').length,0);assert(workRows(info,state,'child').some(row=>row.message.id==='timeout'));
});
test('artifact downloads use the exact native message link rather than an unproven relative path', () => {
  const rows=[{botId:'writer',threadId:'child',name:'文档助理',message:{id:'reply',role:'bot',kind:'text',text:'已保存 [报告](J:/work/report.md)，参考 [网页](https://example.com/report.md)。'}}];
  assert.equal(artifactSource(rows,'report.md').downloadPath,'J:/work/report.md');assert.equal(artifactSource(rows,'report.md').message.id,'reply');assert.equal(artifactSource(rows,'other.md'),undefined);
});
