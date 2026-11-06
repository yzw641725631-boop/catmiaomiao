import {MailStorage,MAIL_OWNER,mailRequire,assertMailLibrary} from './mail-storage.mjs';
import {mailProvider} from './mail-accounts.mjs';
import {isAbsolute} from 'node:path';
const {McpEccServer}=mailRequire('@mcp-ecc/mcp-server');
assertMailLibrary('@mcp-ecc/mcp-server','f53c978fd7e0587b5aac00ae1f06122fac75997107e28ec93218a3c29dc286b8');
const {StdioServerTransport}=mailRequire('@modelcontextprotocol/sdk/server/stdio.js');
const {ListToolsRequestSchema,CallToolRequestSchema}=mailRequire('@modelcontextprotocol/sdk/types.js');
const directory=process.env.COMPANION_MAIL_DIRECTORY;if(!directory||!isAbsolute(directory))throw new Error('缺少本地邮箱范围。');
const storage=new MailStorage(directory),view=Object.create(storage);view.getAccount=async id=>{const account=await storage.getAccount(id);return account?.ownerId===MAIL_OWNER&&account.status==='active'?account:null;};view.listAccounts=async()=> (await storage.listAccounts(MAIL_OWNER)).filter(account=>account.status==='active');
class ScopedServer extends McpEccServer {async getOrCreateProviders(id){const account=await view.getAccount(id);if(!account)throw new Error('账户不可用。');const provider=await mailProvider(storage,account);return {mail:provider,calendar:account.provider==='imap'?undefined:provider};}}
const host=new ScopedServer(view,MAIL_OWNER),server=host.getServer(),handlers=server._requestHandlers;
if(!(handlers instanceof Map)||!handlers.has('tools/list')||!handlers.has('tools/call'))throw new Error('固定 MCP 邮箱库的接口不匹配。');
const list=handlers.get('tools/list'),call=handlers.get('tools/call');
const reads=new Set(['accounts.list','accounts.get','mail.listFolders','mail.listMessages','mail.getMessage','mail.searchMessages','calendar.listCalendars','calendar.listEvents','calendar.getEvent','calendar.freeBusy']),writes=new Set(['mail.sendMessage','calendar.createEvent','calendar.updateEvent']);
server.setRequestHandler(ListToolsRequestSchema,async(request,extra)=>{const result=await list(request,extra),canWrite=(await view.listAccounts()).some(account=>account.credentials.config?.allowWrites===true);return {...result,tools:result.tools.filter(tool=>reads.has(tool.name)||canWrite&&writes.has(tool.name))};});
server.setRequestHandler(CallToolRequestSchema,async(request,extra)=>{const name=request.params.name;if(!reads.has(name)&&!writes.has(name))throw new Error('未允许这项邮箱操作。');if(writes.has(name)){const account=await view.getAccount(request.params.arguments?.accountId);if(!account?.credentials.config?.allowWrites)throw new Error('这项账户只允许读取。');}try{const result=await call(request,extra);if(result.isError)throw new Error();return result;}catch{return {isError:true,content:[{type:'text',text:'邮箱或日历调用未完成，请在本地连接页检查账户与授权。'}]};}});
await server.connect(new StdioServerTransport());
process.once('SIGTERM',()=>void server.close().finally(()=>storage.close()).finally(()=>process.exit(0)));
