import assert from 'node:assert/strict';
import {writeFileSync,existsSync} from 'node:fs';
import {join,resolve,sep} from 'node:path';
import {createInterface} from 'node:readline';
import {CompanionRuntime,PROJECT} from '../adapters/runtime.mjs';
import {createCompanionServer} from '../adapters/server.mjs';
import {fakeReachai,fixtureReachaiConfig} from '../app/tests/fixtures/reachai.mjs';
const rootDir=resolve(process.argv[2]||'');assert(rootDir.startsWith(resolve(PROJECT,'evidence')+sep+'native-goals-')||rootDir.startsWith(resolve(PROJECT,'evidence')+sep+'native-routines-'));assert(existsSync(join(rootDir,'acceptance.json')));
const provider=await fakeReachai(),runtime=new CompanionRuntime({rootDir,verificationLabel:'隔离合成验收'});runtime.settingsFile=join(rootDir,'preview-settings.json');writeFileSync(runtime.settingsFile,JSON.stringify({provider:'reachai',reachai:fixtureReachaiConfig(provider.url)}));const input=createInterface({input:process.stdin,output:process.stdout});let app;
try{app=await createCompanionServer({port:5243,runtime});console.log('UI_READY http://127.0.0.1:5243/; isolated scripted provider; quit to close');await new Promise(resolve=>{input.on('line',line=>line.trim()==='quit'&&resolve());input.on('close',resolve);});}finally{input.close();if(app)await app.close();await provider.close();}
