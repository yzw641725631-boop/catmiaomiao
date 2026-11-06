import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyState, conversationRows } from '../src/projection.ts';
import { workEntries, workRows, workStatus, activityTitle } from '../src/work.ts';
test('work view includes delegated chat work, keeps nested ownership and exposes real success and failure steps', () => {
  const info={chiefId:'chief',helperIds:['writer'],companionThreadId:'chat',workThreadIds:['work']};
  const state={...emptyState(),bots:{chief:{id:'chief',name:'主助理',tasks:[{threadId:'work',title:'报告',createdAt:1}]},writer:{id:'writer',name:'文档助理',tasks:[{threadId:'child',createdAt:2,openedBy:{botId:'chief',threadId:'work',kind:'work'}},{threadId:'chat-child',createdAt:3,openedBy:{botId:'chief',threadId:'chat'}},{threadId:'foreign',createdAt:4,openedBy:{botId:'someone-else',threadId:'work',kind:'work'}}]}},messages:{child:[{id:'write',at:4,role:'bot',kind:'activity',tool:{name:'workspace_write_file',ok:true}},{id:'reply',at:5,role:'bot',kind:'text',text:'真实结果'}],foreign:[{id:'leak',at:6,role:'bot',kind:'text',text:'别的任务'}],'chat-child':[{id:'approval',at:7,role:'bot',kind:'options',card:{requestId:'allow'}}]}};
  assert.deepEqual(workEntries(info,state).map(row=>row.task.threadId),['chat-child','work']);
  assert.deepEqual(workRows(info,state,'work').map(row=>row.message.id),['write','reply']);
  assert.equal(workRows(info,state,'work')[0].workThreadId,'work');
  assert(conversationRows(info,state).some(row=>row.message.id==='approval'));
  assert(!workRows(info,state,'foreign').length);
  assert.equal(activityTitle(state.messages.child[0]),'保存工作产物');
});
test('a waiting handoff is not complete and the latest terminal failure remains failed', () => {
  const success={kind:'text',turnTerminal:true,turnSucceeded:true,role:'bot'};
  const failure={kind:'activity',tool:{ok:false,terminal:true},role:'bot'};
  assert.equal(workStatus({waitingForTeammates:true},[success]),'等待小助理');
  assert.equal(workStatus({},[success,failure]),'未完成');
  assert.equal(workStatus({activity:'waiting-on-you'},[]),'等待你确认');
  assert.equal(workStatus({},[{kind:'text',role:'user',requestCancelled:true}]),'已停止');
  assert.equal(workStatus({},[success]),'已回复');
  assert.equal(workStatus({},[{kind:'activity',tool:{name:'workspace_write_file',ok:true}},{kind:'activity',tool:{name:'workspace_check_file',ok:true}},success]),'已交付');
});
