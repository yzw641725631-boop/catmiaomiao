import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContinuousVoice } from '../src/continuousVoice.ts';

const next = () => new Promise(resolve => setTimeout(resolve, 330));
const settled = () => new Promise(resolve => setImmediate(resolve));
function fixture({ submitResult = true, holdSpeech = false,concurrent=false } = {}) {
  const captures = [], sends = [], spoken = [], errors = [], phases = []; let endSpeech;
  const voice = new ContinuousVoice({
    capture: handlers => { const item = { handlers, stopped: false, cancel() { this.stopped = true; }, async finish() {} }; captures.push(item); return item; },
    submit: async (text, arm) => { const id = 'send-' + sends.length; sends.push({ id, text }); arm(id); return submitResult; },
    speak: async text => { spoken.push(text); if (holdSpeech) await new Promise(resolve => { endSpeech = resolve; }); },
    stopSpeech() {}, changed: phase => phases.push(phase), failed: (message, draft) => errors.push({ message, draft }),
  },45000,concurrent);
  return { voice, captures, sends, spoken, errors, phases, endSpeech: () => endSpeech?.() };
}
const history = (sendId, success = true) => ({ chat: [
  { id: 'u', role: 'user', kind: 'text', sendId, requestPending: false },
  success ? { id: 'r', role: 'bot', kind: 'text', text: '这是对应回复', requestMessageId: 'u', turnTerminal: true, turnSucceeded: true } : { id: 'e', role: 'bot', kind: 'activity', tool: { name: 'error: upstream HTTP 502', ok: false, terminal: true }, requestMessageId: 'u', turnSucceeded: false },
] });

test('a continuous conversation sends one utterance, waits for its own reply and resumes after speech', async () => {
  const env = fixture();
  try {
    env.voice.start(); env.captures[0].handlers.complete('第一句'); await settled();
    assert.equal(env.voice.phase, 'waiting'); assert.equal(env.sends.length, 1); assert.equal(env.captures.length, 1);
    env.voice.receive(history('other')); assert.equal(env.spoken.length, 0);
    env.voice.receive(history('send-0')); env.voice.receive(history('send-0')); await next();
    assert.deepEqual(env.spoken, ['这是对应回复']); assert.equal(env.captures.length, 2); assert.equal(env.voice.phase, 'listening');
    env.captures[1].handlers.complete('第二句'); await settled(); assert.equal(env.sends.length, 2);
  } finally { env.voice.stop(); }
});
test('switching to typing cancels the mic and late ASR or TTS cannot reopen it', async () => {
  const env = fixture({ holdSpeech: true });
  env.voice.start(); env.captures[0].handlers.complete('一句'); await settled(); env.voice.receive(history('send-0'));
  env.voice.stop(); env.endSpeech(); env.captures[0].handlers.complete('迟到'); await next();
  assert.equal(env.voice.phase, 'off'); assert.equal(env.captures.length, 1); assert.equal(env.sends.length, 1);
});
test('opening settings pauses capture, closing resumes, and explicit typing stops further resumes', () => {
  const env = fixture(); env.voice.start(); env.voice.pause(); assert(env.captures[0].stopped);
  env.captures[0].handlers.complete('已取消的声音'); assert.equal(env.sends.length, 0);
  env.voice.resume(); assert.equal(env.captures.length, 2); env.voice.stop(); env.voice.resume(); assert.equal(env.captures.length, 2);
});
test('an idle microphone renews without sending silence or leaving voice mode', async () => {
  const env = fixture();
  try { env.voice.start(); env.captures[0].handlers.noSpeech(); await next(); assert.equal(env.captures.length, 2); assert.equal(env.sends.length, 0); assert.deepEqual(env.errors, []); }
  finally { env.voice.stop(); }
});
test('a model 502 is reported and voice listening resumes without replaying a request', async () => {
  const env = fixture();
  try { env.voice.start(); env.captures[0].handlers.complete('问题'); await settled(); env.voice.receive(history('send-0', false)); await next(); assert.equal(env.captures.length, 2); assert.equal(env.sends.length, 1); assert.equal(env.spoken.length, 0); assert.match(env.errors[0].message, /模型上游/); }
  finally { env.voice.stop(); }
});
test('a terminal failure resumes listening while the native delegated request remains pending', async () => {
  const env = fixture();
  try {
    env.voice.start(); env.captures[0].handlers.complete('请文档助理处理'); await settled();
    const messages = history('send-0', false);
    messages.chat[0].requestPending = true;
    messages.chat.splice(1, 0, { id: 'delegated', role: 'bot', kind: 'text', text: '已经派遣文档助理。', requestMessageId: 'u', turnTerminal: true, turnSucceeded: true });
    env.voice.receive(messages); await next();
    assert.equal(env.captures.length, 2); assert.equal(env.sends.length, 1); assert.equal(env.spoken.length, 0); assert.equal(env.voice.phase, 'listening');
    env.voice.receive(messages); assert.equal(env.errors.length, 1);
  } finally { env.voice.stop(); }
});
test('a failed send preserves text and a background task does not block the next voice input', async () => {
  const failed = fixture({ submitResult: false }), background = fixture({ submitResult: 'background' });
  try {
    failed.voice.start(); failed.captures[0].handlers.complete('保留这句');
    background.voice.start(); background.captures[0].handlers.complete('交给小助理'); await next();
    assert.equal(failed.errors[0].draft, '保留这句'); assert.equal(failed.captures.length, 2); assert.equal(background.captures.length, 2);
  } finally { failed.voice.stop(); background.voice.stop(); }
});

test('voice accepts a second utterance while the first reply is still pending and plays each proven reply once',async()=>{
 const env=fixture({concurrent:true});
 try{
  env.voice.start();env.captures[0].handlers.complete('安排工作');await next();
  assert.equal(env.voice.phase,'listening');assert.equal(env.captures.length,2);
  env.captures[1].handlers.complete('工作时继续聊天');await next();assert.equal(env.sends.length,2);assert.equal(env.voice.phase,'listening');
  env.voice.receive(history('send-0'));await next();assert.equal(env.spoken.length,1);assert.equal(env.voice.phase,'listening');
  env.voice.receive(history('send-0'));assert.equal(env.spoken.length,1);
  env.voice.receive(history('send-1'));await next();assert.equal(env.spoken.length,2);assert.equal(env.sends.length,2);
 }finally{env.voice.stop();}
});

test('a returning reply waits until the person finishes speaking without discarding the current utterance',async()=>{
 const env=fixture({concurrent:true});
 try{
  env.voice.start();env.captures[0].handlers.complete('先处理这个');await next();
  env.captures[1].handlers.activity();env.voice.receive(history('send-0'));assert.equal(env.spoken.length,0);assert.equal(env.captures[1].stopped,false);
  env.captures[1].handlers.complete('补充一句');await next();assert.equal(env.sends.length,2);assert.equal(env.spoken.length,1);assert.equal(env.voice.phase,'listening');
  env.voice.stop();const captures=env.captures.length;env.voice.receive(history('send-1'));await next();assert.equal(env.captures.length,captures);assert.equal(env.spoken.length,1);
 }finally{env.voice.stop();}
});
