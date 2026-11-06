import { createInterface } from 'node:readline';
import { assistantTools } from './assistant-services.mjs';
const url = process.env.COMPANION_SERVICE_URL;
if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(url || '') || !process.env.COMPANION_SERVICE_TOKEN) throw new Error('Missing private service capability');
let chain = Promise.resolve();
async function handle(line) {
  if (Buffer.byteLength(line) > 300000) throw new Error('MCP frame too large');
  const request = JSON.parse(line); if (request.jsonrpc !== '2.0' || request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'personal-assistant-services', version: '1.0.0' } };
  else if (request.method === 'tools/list') result = { tools: assistantTools };
  else if (request.method === 'ping') result = {};
  else if (request.method === 'tools/call') {
    try {
      const response = await fetch(url + '/call', { method: 'POST', headers: { authorization: 'Bearer ' + process.env.COMPANION_SERVICE_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify({ name: request.params?.name, args: request.params?.arguments, actor: { botId: process.env.COMPANION_SERVICE_BOT, threadId: process.env.COMPANION_SERVICE_THREAD } }), signal: AbortSignal.timeout(60000) });
      const data = await response.json(); if (!response.ok) throw new Error(data.error || '能力调用未完成。');
      result = { content: [{ type: 'text', text: JSON.stringify(data.result) }] };
    } catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
  } else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not supported' } }) + '\n'); return; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => { chain = chain.then(() => handle(line)).catch(() => { process.exitCode = 1; input.close(); }); });
