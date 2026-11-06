import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {SurfaceGrants} from '../../adapters/surface-grants.mjs';
import {NativeCapabilities} from '../../adapters/native-capabilities.mjs';
import { scratch } from './scratch.mjs';

test('surface permission binds native descriptor identity to one assistant and checks live revocation',()=>{
 const root=scratch('surface-grants');mkdirSync(root,{recursive:true});const file=join(root,'grants.json'),id=randomUUID(),other=randomUUID(),computer={scope:'local-computer'},browser={},stranger={scope:'local-computer'};
 const grants=new SurfaceGrants(file);grants.bind({localComputer:computer,browser},id);grants.bind({localComputer:stranger},other);
 const save=record=>writeFileSync(file,JSON.stringify({bots:{[id]:record}}));
 save({computer:true,browser:true});assert(!grants.allows('computer',computer,{hostComputer:true}));
 save({computer:true,browser:true,permissions:{computer:'full',browser:'ask'}});
 assert(grants.allows('computer',computer,{hostComputer:true}));assert(!grants.allows('browser',browser,{builtInBrowser:true}));
 assert(!grants.allows('computer',{...computer},{hostComputer:true}));assert(!grants.allows('computer',stranger,{hostComputer:true}));assert(!grants.allows('computer',computer,{}));assert(!grants.allows('custom',computer,{hostComputer:true}));
 save({computer:true,browser:true,permissions:{computer:'ask',browser:'full'}});assert(!grants.allows('computer',computer,{hostComputer:true}));assert(grants.allows('browser',browser,{builtInBrowser:true}));
 save({computer:false,browser:false,permissions:{computer:'full',browser:'full'}});assert(!grants.allows('browser',browser,{builtInBrowser:true}));
 writeFileSync(file,'invalid');assert(!grants.allows('computer',computer,{hostComputer:true}));
});

test('permission mode saves per assistant, survives reload, can change while busy and rolls back on failure',async()=>{
 const rootDir=scratch('surface-config');mkdirSync(rootDir,{recursive:true});const id=randomUUID(),helper=randomUUID(),bots=[{id,name:'主助理',tasks:[]},{id:helper,name:'小助理',tasks:[]}];let patches=0;
 const runtime={rootDir,current:{chiefId:id,helperIds:[helper]},refreshTeam:async()=>bots,desktopHost:{status:()=>({ready:true})},api:async(_session,method)=>{if(method==='PATCH'){patches++;return {bot:bots[0]};}return {servers:[]};}};
 const caps=new NativeCapabilities(runtime),config={browser:true,computer:true,mcpServers:[]};
 await caps.configure(id,config);assert.equal(patches,1);assert.deepEqual(caps.permissions(id),{browser:'ask',computer:'ask'});
 bots[0].tasks=[{busy:true}];await caps.configure(id,{...config,permissions:{computer:'full',browser:'ask'}});assert.equal(patches,1,'mode change does not reset a running bot');assert.equal(caps.settings(id).approvalMode,'ask','external MCP remains in native ask mode');
 assert.deepEqual(new NativeCapabilities(runtime).permissions(id),{browser:'ask',computer:'full'});assert.deepEqual(caps.permissions(helper),{browser:'ask',computer:'ask'});
 await assert.rejects(caps.configure(id,{...config,browser:false}),error=>error.status===409);
 for(const permissions of [null,[],{computer:'never'},{external:'full'}])await assert.rejects(caps.configure(id,{...config,permissions}),/请选择/);
 const before=readFileSync(caps.file,'utf8');caps.save=()=>{throw new Error('synthetic disk failure');};await assert.rejects(caps.configure(id,{...config,permissions:{computer:'ask'}}),/恢复原来/);assert.equal(caps.permissions(id).computer,'full');assert.equal(readFileSync(caps.file,'utf8'),before);
});
