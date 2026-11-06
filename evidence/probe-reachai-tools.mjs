import fs from 'node:fs/promises';
import { ReachAIClient, gatewayEvents } from '../adapters/reachai.mjs';
import { redactSecretsInText } from '../upstream/OpenMausBot/server/redact.ts';

const project = 'J:/agent_project/projects/openmaus-assistant';
const settings = JSON.parse(await fs.readFile(project + '/runtime/companion-settings.json', 'utf8')).reachai;
const client = new ReachAIClient(settings);
const catalog = JSON.parse(await fs.readFile(project + '/upstream/OpenMausBot/server/drivers/agents-catalog-goldens/bridged.tools-list.json', 'utf8'));
const list = Array.isArray(catalog) ? catalog : catalog.tools;
const tool = list.find(item => item.name === 'coordinate_bots');
if (!tool) throw new Error('Native coordination schema missing');
const functionName = 'agents_coordinate_bots';
const models = await client.instances();
const results = await Promise.allSettled(models.filter(row => row.modelType === 'LLM' && row.status === 'ACTIVE' && !row.name.startsWith('kms-')).map(async model => {
  const result = { model: { id: model.id, name: model.name, modelName: model.modelName } };
  const started = Date.now();
  const body = {
    modelInstanceId: model.id,
    messages: [{ role: 'user', content: 'Call agents_coordinate_bots once. Set bot_ids to the JSON array ["probe-a", "probe-b"], and message to "probe". Omit every optional property. Do not explain. This is only a protocol probe and will not execute tools.' }],
    tools: [{ type: 'function', function: { name: functionName, description: tool.description, parameters: tool.inputSchema } }],
    toolChoice: { type: 'function', function: { name: functionName } },
    options: { temperature: 0, max_tokens: 512 },
  };
  try {
    const response = await client.fetch('/model/chat/stream/events', { body, timeout: 90000, accept: 'text/event-stream' });
    if (!response.ok) {
      result.httpError = { status: response.status, body: redactSecretsInText(await response.text()).split(settings.key).join('[redacted]').slice(0, 600) };
      result.passed = false;
      console.log(JSON.stringify(result));
      return result;
    }
    const calls = new Map();
    for await (const event of gatewayEvents(response)) {
      if (event.type === 'error') { result.error = { code: event.code, message: redactSecretsInText(String(event.message || '')).split(settings.key).join('[redacted]').slice(0, 200) }; break; }
      if (event.type === 'tool_call.delta') {
        const delta = event.toolCall;
        if (!delta) continue;
        const call = calls.get(delta.index) || { name: '', arguments: '' };
        if (delta.name) call.name += delta.name;
        if (delta.arguments) call.arguments += delta.arguments;
        calls.set(delta.index, call);
      }
      if (event.type === 'completed') result.finishReason = event.finishReason;
    }
    result.calls = [...calls.values()].map(call => {
      let args; try { args = JSON.parse(call.arguments); } catch {}
      return { ...call, botIdsType: Array.isArray(args?.bot_ids) ? 'array' : typeof args?.bot_ids, keys: Object.keys(args || {}), valid: Array.isArray(args?.bot_ids) && args.bot_ids.join(',') === 'probe-a,probe-b' && args.message === 'probe' && Object.keys(args).every(key => ['bot_ids', 'message'].includes(key)) };
    });
    result.passed = result.calls.length === 1 && result.calls[0].valid && result.finishReason === 'tool_calls';
  } catch (error) { result.error = { message: error.message, status: error.status }; result.passed = false; }
  result.elapsedMs = Date.now() - started;
  console.log(JSON.stringify(result));
  return result;
}));
const output = project + '/evidence/reachai-live-20261022/tool-probe-' + new Date().toISOString().replace(/[:.]/g, '-') + '.json';
await fs.writeFile(output, JSON.stringify(results.map(row => row.status === 'fulfilled' ? row.value : { error: 'Probe did not finish' }), null, 2) + '\n');
console.log(JSON.stringify({ evidence: output }));
