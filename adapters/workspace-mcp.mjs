import { WorkspaceFiles, workspaceTools } from './workspace-files.mjs';
import { createInterface } from 'node:readline';
import { ArtifactFiles } from './artifact-files.mjs';

const files = new WorkspaceFiles({ root: process.env.COMPANION_WORK_ROOT, archive: process.env.COMPANION_WORK_ARCHIVE, ledger: process.env.COMPANION_WORK_LEDGER, botId: process.env.COMPANION_WORK_BOT, threadId: process.env.COMPANION_WORK_THREAD });
const artifacts = new ArtifactFiles({root:files.root,archive:files.archive,ledger:files.ledger,botId:files.botId,threadId:files.threadId});
let chain = Promise.resolve();
async function handle(line) {
  if (Buffer.byteLength(line) > 300000) throw new Error('MCP frame too large.');
  const request = JSON.parse(line);
  if (request.jsonrpc !== '2.0' || request.id === undefined) return;
  let result;
  if (request.method === 'initialize') result = { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'companion-assigned-workspace', version: '1.0.0' } };
  else if (request.method === 'tools/list') result = { tools: workspaceTools };
  else if (request.method === 'ping') result = {};
  else if (request.method === 'tools/call') {
    try {const name=request.params?.name,args=request.params?.arguments; result = { content: [{ type: 'text', text: JSON.stringify(await (name==='create_document'?artifacts.document(args):name==='create_spreadsheet'?artifacts.spreadsheet(args):files.call(name,args))) }] }; }
    catch (error) { result = { isError: true, content: [{ type: 'text', text: error.message }] }; }
  } else { process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, error: { code: -32601, message: 'Method not supported' } }) + '\n'); return; }
  process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) + '\n');
}
const input = createInterface({ input: process.stdin, crlfDelay: Infinity });
input.on('line', line => { chain = chain.then(() => handle(line)).catch(error => { process.stderr.write(error.message + '\n'); process.exitCode = 1; input.close(); }); });
