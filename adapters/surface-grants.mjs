import {readFileSync} from 'node:fs';

// The descriptor identity is registered only from the parent's verified turn
// scope. A custom MCP server cannot acquire a grant by copying a server name.
export class SurfaceGrants {
  constructor(file){this.file=file;this.owners=new WeakMap();}
  bind(integrations,botId){
    if(!/^[a-f0-9-]{36}$/.test(botId||''))return;
    if(integrations.localComputer?.scope==='local-computer')this.owners.set(integrations.localComputer,{botId,kind:'computer'});
    if(integrations.browser)this.owners.set(integrations.browser,{botId,kind:'browser'});
  }
  allows(server,descriptor,flags={}){
    const owner=descriptor&&this.owners.get(descriptor);if(!owner||server!==owner.kind)return false;
    if(owner.kind==='computer'&&!flags.hostComputer||owner.kind==='browser'&&!flags.builtInBrowser)return false;
    try{const saved=JSON.parse(readFileSync(this.file,'utf8')).bots?.[owner.botId];return saved?.[owner.kind]===true&&saved.permissions?.[owner.kind]==='full';}catch{return false;}
  }
}
