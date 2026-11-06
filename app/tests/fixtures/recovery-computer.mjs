import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const target = { pid: { type: 'integer' }, window_id: { type: 'integer' } };
const tools = [
  { name: 'press_key', inputSchema: { type: 'object', additionalProperties: false, properties: { ...target, key: { type: 'string' }, delivery_mode: { type: 'string', enum: ['background', 'foreground'] } }, required: ['pid', 'window_id', 'key'] } },
  { name: 'get_window_state', inputSchema: { type: 'object', additionalProperties: false, properties: { ...target, query: { type: 'string' }, include_screenshot: { type: 'boolean' } }, required: ['pid', 'window_id'] } },
  { name: 'get_browser_state', inputSchema: { type: 'object', properties: target, required: ['pid', 'window_id'] } },
];
let observations = 0;
for await (const line of createInterface({ input: process.stdin })) {
  let rpc;
  try { rpc = JSON.parse(line); } catch { continue; }
  if (rpc.id === undefined) continue;
  let result;
  if (rpc.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'synthetic-recovery-computer', version: '1' } };
  else if (rpc.method === 'tools/list') result = { tools };
  else if (rpc.method === 'tools/call') {
    const { name, arguments: args } = rpc.params;
    appendFileSync(process.env.RECOVERY_FIXTURE_CALLS, JSON.stringify({ name, args }) + '\n');
    if (name === 'press_key') result = args.delivery_mode === 'foreground'
      ? { content: [{ type: 'text', text: 'SYNTHETIC-KEY-DELIVERED' }] }
      : { isError: true, content: [{ type: 'text', text: 'Background delivery unavailable' }], structuredContent: { code: 'background_unavailable', escalation: { recommended: 'foreground' } } };
    else if (name === 'get_window_state') result = { content: [{ type: 'text', text: 'Synthetic window' }], structuredContent: { pid: 84, window_id: 150, snapshot_id: 's' + ++observations, elements: [{ role: 'Edit', label: 'URL', value: 'fixture', element_token: 's' + observations + ':6' }] } };
    else result = { isError: false, content: [{ type: 'text', text: 'refused (browser_consent_required)' }], structuredContent: { status: 'refused', refusal: { code: 'browser_consent_required' } } };
  } else result = {};
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: rpc.id, result }) + '\n');
}
