import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { ReachAIClient, gatewayEvents } from '../adapters/reachai.mjs';
import { workspaceTools } from '../adapters/workspace-files.mjs';
const project = join(import.meta.dirname, '..'), settings = JSON.parse(await readFile(join(project, 'runtime/companion-settings.json'), 'utf8')).reachai;
const client = new ReachAIClient(settings), models = await client.instances();
const tool = workspaceTools.find(tool => tool.name === 'write_file');
const results = await Promise.allSettled(models.filter(model => model.status === 'ACTIVE' && model.modelType === 'LLM' && [settings.llmId, 'agens'].some(value => value === model.id || value === model.name)).map(async model => {
  const result = { id: model.id, name: model.name, modelName: model.modelName, passed: false };
  try {
    const body = { modelInstanceId: model.id, messages: [{ role: 'user', content: 'Protocol probe only; no tools will execute. Call workspace_write_file with path="probe.md", content="# Probe", expected_sha256=null (JSON null). Use no other fields.' }], tools: [{ type: 'function', function: { name: 'workspace_write_file', description: tool.description, parameters: tool.inputSchema } }], toolChoice: { type: 'function', function: { name: 'workspace_write_file' } }, options: { temperature: 0, max_tokens: 512 } };
    const calls = new Map();
    for await (const event of gatewayEvents(await client.fetch('/model/chat/stream/events', { body, timeout: 60000, accept: 'text/event-stream' }))) {
      if (event.type === 'error') { result.error = event.code; break; }
      if (event.type === 'tool_call.delta') { const delta = event.toolCall, call = calls.get(delta.index) || { name: '', arguments: '' }; call.name += delta.name || ''; call.arguments += delta.arguments || ''; calls.set(delta.index, call); }
      if (event.type === 'completed') result.finishReason = event.finishReason;
    }
    const call = [...calls.values()][0]; let args; try { args = JSON.parse(call?.arguments); } catch {}
    result.passed = calls.size === 1 && call.name === 'workspace_write_file' && args?.path === 'probe.md' && args?.content === '# Probe' && args?.expected_sha256 === null && result.finishReason === 'tool_calls';
    result.argumentTypes = args ? Object.fromEntries(Object.entries(args).map(([key, value]) => [key, value === null ? 'null' : Array.isArray(value) ? 'array' : typeof value])) : null;
  } catch (error) { result.error = error.code || error.status || error.message; }
  console.log(JSON.stringify(result)); return result;
}));
const output = join(project, 'evidence/windows-files-20261022/model-probe-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json');
await mkdir(join(project, 'evidence/windows-files-20261022'), { recursive: true }); await writeFile(output, JSON.stringify(results.map(row => row.status === 'fulfilled' ? row.value : { error: 'Probe failed' }), null, 2) + '\n');
console.log(JSON.stringify({ output }));
