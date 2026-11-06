import { test } from 'node:test';
import assert from 'node:assert/strict';
import { visibleMessageText, applyFrame, emptyState, mergeMessage, speechText, captionText, safeMessageUrl, conversationRows, displayMessages, helperQuestionAnswered } from '../src/projection.ts';

test('message patches replace by stable id, preserving chronological order', () => {
  const first = { id: 'a', at: 2, role: 'bot', kind: 'text', text: 'before' };
  const earlier = { id: 'b', at: 1, role: 'user', kind: 'text', text: 'question' };
  const list = mergeMessage(mergeMessage([], first), earlier);
  const result = mergeMessage(list, { ...first, text: 'after' });
  assert.equal(result.length, 2);
  assert.equal(result[0].id, 'b'); assert.equal(result[1].text, 'after');
});

test('delta never overwrites a persisted terminal answer from the same turn', () => {
  let state = applyFrame(emptyState(), { kind: 'runtime', event: { type: 'content.delta', threadId: 't', turnId: 'turn', streamKind: 'assistant_text', delta: 'first' } });
  assert.equal(state.streams.t.text, 'first');
  state = applyFrame(state, { kind: 'message', threadId: 't', message: { id: 'm', at: 1, role: 'bot', kind: 'text', text: 'complete', turnId: 'turn', turnTerminal: true } });
  assert.equal(state.streams.t, undefined);
  state = applyFrame(state, { kind: 'runtime', event: { type: 'content.delta', threadId: 't', turnId: 'turn', streamKind: 'assistant_text', delta: 'replayed' } });
  assert.equal(state.streams.t, undefined);
});

test('a task error removes only its own streaming text', () => {
  const state = { ...emptyState(), streams: { one: { turnId: 'a', text: 'a' }, two: { turnId: 'b', text: 'b' } } };
  const after = applyFrame(state, { kind: 'runtime', event: { type: 'runtime.error', threadId: 'one', message: 'failed' } });
  assert.equal(after.streams.one, undefined); assert.equal(after.streams.two.text, 'b');
});

test('speech skips code and visible captions remain short', () => {
  assert.equal(speechText('结果 [文档](report.md)\n```ts\nsecret implementation\n```'), '结果 文档\n（代码见工作记录）');
  assert.equal(captionText('测'.repeat(100)).length, 62);
});

test('message links retain authorized Windows file references and refuse executable schemes', () => {
  assert.equal(safeMessageUrl('C:/work/report.md'), 'C:/work/report.md');
  assert.equal(safeMessageUrl('javascript:alert(1)'), '');
  assert.equal(safeMessageUrl('data:text/html,unsafe'), '');
  assert.equal(safeMessageUrl('//external.invalid/tracker'), '');
});

test('helper approval cards retain the actual owning bot/thread and the parent work evidence', () => {
  const info = { chiefId: 'chief', helperIds: ['writer'], companionThreadId: 'chat', workThreadIds: ['work'] };
  const card = { id: 'permission', kind: 'options', role: 'bot', at: 2, card: { requestId: 'request' } };
  const state = { ...emptyState(), bots: { chief: { id: 'chief', name: '主助理' }, writer: { id: 'writer', name: '文档助理', tasks: [{ threadId: 'child', openedBy: { kind: 'work', botId: 'chief', threadId: 'work' } }, { threadId: 'foreign', openedBy: { kind: 'work', botId: 'someone-else', threadId: 'work' } }] } }, messages: { child: [card, { id: 'helper-text', at: 3, kind: 'text', role: 'bot', text: 'internal' }], foreign: [{ ...card, id: 'foreign-permission' }] } };
  const rows = conversationRows(info, state);
  assert.equal(rows.length, 1); assert.equal(rows[0].botId, 'writer'); assert.equal(rows[0].threadId, 'child'); assert.equal(rows[0].workThreadId, 'work'); assert.equal(rows[0].name, '文档助理');
});

test('native helper questions remain visible until the helper thread actually receives the answer', () => {
  const question = { id: 'q', kind: 'activity', at: 10, role: 'bot', tool: { name: '文档助理 needs your input: 需要补充资料', ok: true }, threadRef: { botId: 'writer', threadId: 'child' } };
  assert.equal(displayMessages([question]).length, 1);
  assert.equal(helperQuestionAnswered(question, { ...emptyState(), messages: { child: [{ role: 'user', at: 1 }] } }), false);
  assert.equal(helperQuestionAnswered(question, { ...emptyState(), messages: { child: [{ role: 'user', at: 11 }] } }), true);
});

test('work display hides only the known adapter envelope and preserves unrecognized user or bot text',()=>{
 const text='请整理笔记。',envelope='\n\n本次工作唯一指定目录：J:\\synthetic\n主助理与本次派遣的小助理都有绑定该目录的 workspace 文件工具。';
 const user={id:'a',at:1,role:'user',kind:'text',sendId:'known',text:text+envelope};
 assert.equal(visibleMessageText(user),text);assert.equal(visibleMessageText({...user,sendId:undefined}),user.text);assert.equal(visibleMessageText({...user,role:'bot'}),user.text);
 const ordinary=text+'\n\n本次工作唯一指定目录：这是我要求保留的原文';assert.equal(visibleMessageText({...user,text:ordinary}),ordinary);
});
