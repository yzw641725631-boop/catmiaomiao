import { createServer } from 'node:http';

export const REACHAI_FIXTURE_KEY = 'reachai-fixture-key-never-real';
const ok = data => ({ code: 200, message: 'success', data });
const instances = [
  { id: 'fixture-llm', name: '本地契约 LLM', modelType: 'LLM', modelName: 'fixture-chat', provider: 'fixture', status: 'ACTIVE', connection: { apiKey: 'never-forward-connection-secrets' } },
  { id: 'fixture-asr', name: '本地契约 ASR', modelType: 'ASR', modelName: 'fixture-asr', provider: 'fixture', status: 'ACTIVE' },
  { id: 'fixture-tts', name: '本地契约 TTS', modelType: 'TTS', modelName: 'fixture-tts', provider: 'fixture', status: 'ACTIVE' },
  { id: 'inactive-llm', name: '停用模型', modelType: 'LLM', status: 'DISABLED' },
  { id: 'fixture-llm-alt', name: '本地契约备用 LLM', modelType: 'LLM', modelName: 'fixture-chat-alt', provider: 'fixture', status: 'ACTIVE' },
];
export async function fakeReachai({ chat, onRequest } = {}) {
  const requests = [];
  const server = createServer(async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    let body;
    try { body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined; }
    catch { res.writeHead(400); res.end(); return; }
    const row = { path: req.url, body, authorized: req.headers.authorization === `Bearer ${REACHAI_FIXTURE_KEY}` };
    requests.push(row); onRequest?.(row, req, res);
    res.setHeader('content-type', 'application/json');
    if (!row.authorized) { res.end(JSON.stringify({ code: 401, message: 'Do not echo credential: ' + REACHAI_FIXTURE_KEY, data: null })); return; }
    if (req.url === '/model/instances') { res.end(JSON.stringify(ok(instances))); return; }
    if (req.url === '/model/audio/transcriptions') { res.end(JSON.stringify(ok({ text: '今天先处理重要的事。', language: 'zh' }))); return; }
    if (req.url === '/model/audio/speech') {
      if (body.input === 'business-error') { res.end(JSON.stringify({ code: 429, message: REACHAI_FIXTURE_KEY, data: null })); return; }
      if (body.input === 'json-audio') { res.end(JSON.stringify(ok({ format: 'mp3', audioBase64: Buffer.from('ID3fixture').toString('base64') }))); return; }
      res.writeHead(200, { 'content-type': 'audio/mpeg', 'X-ReachAI-Audio-Format': 'mp3' });
      res.write('ID3fixture-part-one'); setTimeout(() => { if (!res.destroyed) res.end('-part-two'); }, 40); return;
    }
    if (req.url === '/model/chat') { res.end(JSON.stringify(ok({ content: '本地契约回复', finishReason: 'stop', usage: { promptTokens: 4, completionTokens: 5 } }))); return; }
    if (req.url === '/model/chat/stream/events') {
      const event = value => res.write(`data:${JSON.stringify(value)}\r\n\r\n`);
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      if (chat) { await chat(body, event, res); return; }
      event({ type: 'content.delta', text: '本地契约流回复' }); event({ type: 'completed', finishReason: 'stop' }); res.end(); return;
    }
    res.writeHead(404); res.end(JSON.stringify({ code: 404, message: 'unknown route', data: null }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, url: `http://127.0.0.1:${server.address().port}`, async close() { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } };
}

export const fixtureReachaiConfig = url => ({ url, key: REACHAI_FIXTURE_KEY, llmId: 'fixture-llm', asrId: 'fixture-asr', ttsId: 'fixture-tts', voice: 'fixture-voice', speed: 1.1, asrMode: 'file' });
