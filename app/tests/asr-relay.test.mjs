import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { installRealtimeAsr, WebSocket, WebSocketServer } from '../../adapters/realtime-asr.mjs';
const until = async predicate => { const deadline = Date.now() + 3000; while (!predicate()) { assert(Date.now() < deadline, 'ASR relay timed out'); await new Promise(resolve => setTimeout(resolve, 5)); } };

test('ASR relay preserves an end receipt on an already-finalized VAD segment without duplicating text', async () => {
  const provider = createServer(), providerSockets = new WebSocketServer({ server: provider }); let startFrame;
  providerSockets.on('connection', socket => socket.on('message', (bytes, binary) => {
    if (binary) { socket.send(JSON.stringify({ type: 'final', segment: 0, reason: 'vad', text: '完整的一句话' })); return; }
    const message = JSON.parse(bytes.toString());
    if (message.type === 'start') { startFrame = message; socket.send(JSON.stringify({ type: 'ready' })); }
    if (message.type === 'end') socket.send(JSON.stringify({ type: 'final', segment: 0, reason: 'end', text: '完整的一句话' }));
  }));
  await new Promise(resolve => provider.listen(0, '127.0.0.1', resolve));
  const server = createServer(), relay = installRealtimeAsr(server, () => ({ url: `http://127.0.0.1:${provider.address().port}`, key: 'fixture-not-real' }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new WebSocket(`ws://127.0.0.1:${server.address().port}/companion/asr/stream`), events = [];
  client.on('message', bytes => events.push(JSON.parse(bytes.toString())));
  try {
    await once(client, 'open'); client.send(JSON.stringify({ type: 'start' })); await until(() => events.some(event => event.type === 'ready'));
    assert.equal(startFrame.vad.silence_duration_ms, 2000);
    client.send(Buffer.alloc(1280)); await until(() => events.some(event => event.reason === 'vad'));
    client.send(JSON.stringify({ type: 'end' })); await until(() => events.some(event => event.reason === 'end'));
    assert.equal(events.filter(event => event.text === '完整的一句话').length, 1); assert.equal(events.find(event => event.reason === 'end').text, '');
  } finally {
    client.terminate(); await relay.close(); await new Promise(resolve => server.close(resolve));
    for (const socket of providerSockets.clients) socket.terminate(); await new Promise(resolve => providerSockets.close(resolve)); await new Promise(resolve => provider.close(resolve));
  }
});
