import { createRequire } from 'node:module';
import { gatewayError } from './reachai.mjs';

// Reuse the fixed upstream dependency; no extra browser or native runtime is installed.
const require = createRequire(new URL('../upstream/OpenMausBot/package.json', import.meta.url));
const { WebSocket, WebSocketServer } = require('ws');
export { WebSocket, WebSocketServer };

export function installRealtimeAsr(server, authorize) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  const active = new Set();
  const upgrade = (request, socket, head) => {
    let config;
    try { config = authorize(request); }
    catch (error) { socket.end(`HTTP/1.1 ${[401, 403, 409].includes(error.status) ? error.status : 400} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); return; }
    if (active.size >= 2) { socket.end('HTTP/1.1 429 Too Many Requests\r\nConnection: close\r\nContent-Length: 0\r\n\r\n'); return; }
    wss.handleUpgrade(request, socket, head, client => {
      const address = new URL('/model/audio/transcriptions/stream', config.url); address.protocol = address.protocol === 'https:' ? 'wss:' : 'ws:';
      const upstream = new WebSocket(address, { headers: { authorization: `Bearer ${config.key}` }, followRedirects: false, handshakeTimeout: 10000, maxPayload: 128 * 1024, perMessageDeflate: false });
      const session = { client, upstream }; active.add(session);
      let closed = false, started = false, ready = false, ended = false, endAcknowledged = false, startFrame = null, audioBytes = 0, textChars = 0;
      const finals = new Set();
      const send = value => { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify(value)); };
      const close = () => {
        if (closed) return; closed = true; active.delete(session); clearTimeout(timer);
        if (upstream.readyState !== WebSocket.CLOSED) upstream.terminate();
        if (client.readyState === WebSocket.OPEN) client.close(1000); else if (client.readyState !== WebSocket.CLOSED) client.terminate();
      };
      const error = (message, code = 'ASR_STREAM_FAILED') => { send({ type: 'error', code, message }); close(); };
      const timer = setTimeout(() => error('本次录音已达到时长上限，请重新开始。', 'ASR_SESSION_LIMIT'), 75000);
      timer.unref();
      const flushStart = () => { if (!closed && startFrame && upstream.readyState === WebSocket.OPEN) { upstream.send(JSON.stringify(startFrame)); startFrame = null; } };
      upstream.on('open', flushStart);
      upstream.on('unexpected-response', (_request, response) => { response.resume(); error(gatewayError(response.statusCode).message, 'ASR_AUTH_REJECTED'); });
      upstream.on('error', () => !closed && error('无法连接实时识别服务，请检查平台连接。'));
      upstream.on('close', () => !closed && error('实时识别连接已结束，已识别文字仍保留。', 'ASR_CONNECTION_CLOSED'));
      upstream.on('message', (bytes, binary) => {
        if (closed || binary) return;
        let event; try { event = JSON.parse(bytes.toString()); } catch { error('实时识别返回格式无效。'); return; }
        if (!event || typeof event !== 'object' || Array.isArray(event) || typeof event.type !== 'string') { error('实时识别返回格式无效。'); return; }
        if (event.type === 'error') { error('实时识别服务未完成这次识别，请稍后重试。'); return; }
        if (event.type === 'ready' && started && !ready) { ready = true; send({ type: 'ready', sample_rate: 16000 }); return; }
        if (!ready) return;
        if (['partial', 'final', 'speech_started', 'speech_stopped'].includes(event.type)) {
          if (!Number.isSafeInteger(event.segment) || event.segment < 0) { error('实时识别缺少句子标识。'); return; }
          if (event.type === 'final') {
            if (finals.has(event.segment)) {
              // The end acknowledgement may reuse a segment already finalized by VAD.
              // Preserve completion while keeping its text deduplicated.
              if (ended && !endAcknowledged && event.reason === 'end') { endAcknowledged = true; send({ type: 'final', segment: event.segment, text: '', reason: 'end' }); }
              return;
            }
            textChars += typeof event.text === 'string' ? event.text.length : 0;
            if (finals.size >= 300 || textChars > 20000) { error('本次识别内容已达到上限，已识别文字仍保留。', 'ASR_TEXT_LIMIT'); return; }
            finals.add(event.segment);
            if (ended && event.reason === 'end') endAcknowledged = true;
          }
          if (finals.has(event.segment) && event.type === 'partial') return;
          send({ type: event.type, segment: event.segment, ...(typeof event.text === 'string' ? { text: event.text.slice(0, 20000) } : {}), ...(['end', 'vad', 'max_utterance'].includes(event.reason) ? { reason: event.reason } : {}) });
        }
      });
      client.on('message', (bytes, binary) => {
        if (closed) return;
        if (binary) {
          if (!ready || ended || bytes.length % 2) { error('录音格式或状态无效。', 'ASR_BAD_AUDIO'); return; }
          audioBytes += bytes.length;
          if (audioBytes > 65 * 16000 * 2 || upstream.bufferedAmount > 256 * 1024) { error('识别服务处理较慢，请结束本次录音后重试。', 'ASR_BACKPRESSURE'); return; }
          if (upstream.readyState === WebSocket.OPEN) upstream.send(bytes, { binary: true });
          return;
        }
        if (bytes.length > 8192) { error('录音控制消息过大。'); return; }
        let message; try { message = JSON.parse(bytes.toString()); } catch { error('录音控制格式无效。'); return; }
        if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.type !== 'string') { error('录音控制格式无效。'); return; }
        if (message.type === 'start' && !started) {
          started = true;
          const hotwords = Array.isArray(message.hotwords) ? message.hotwords.filter(word => typeof word === 'string' && word.length <= 32).slice(0, 50) : [];
          // The deployed stream endpoint uses one fixed engine and ignores model_instance_id.
          startFrame = { type: 'start', language: 'zh', sample_rate: 16000, encoding: 'pcm_s16le', channels: 1, vad: { enabled: true, silence_duration_ms: 2000 }, hotwords };
          flushStart();
        } else if (message.type === 'end' && ready && !ended) { ended = true; upstream.send(JSON.stringify({ type: 'end' })); }
        else if (message.type === 'cancel') { if (ready && upstream.readyState === WebSocket.OPEN) upstream.send(JSON.stringify({ type: 'cancel' })); send({ type: 'cancelled' }); close(); }
        else error('录音控制状态无效。', 'ASR_BAD_STATE');
      });
      client.on('error', close); client.on('close', close);
    });
  };
  server.on('upgrade', upgrade);
  return {
    reset(message = '连接设置已更新') { for (const { client, upstream } of active) { if (client.readyState === WebSocket.OPEN) client.send(JSON.stringify({ type: 'error', message })); client.close(1012, 'Voice session changed'); upstream.terminate(); } },
    async close() { server.off('upgrade', upgrade); for (const { client, upstream } of active) { client.terminate(); upstream.terminate(); } await new Promise(resolve => wss.close(resolve)); },
  };
}
