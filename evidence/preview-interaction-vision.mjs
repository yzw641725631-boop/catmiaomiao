import {CompanionRuntime,PROJECT,SETTINGS_FILE} from '../adapters/runtime.mjs';
import {createCompanionServer} from '../adapters/server.mjs';
import {join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {VisionTransport} from '../adapters/vision.mjs';
const rootDir=process.argv[2]||join(PROJECT,'runtime/isolated-interaction-'+new Date().toISOString().replace(/[:.]/g,'-'));mkdirSync(rootDir,{recursive:true});
if(!rootDir.startsWith(join(PROJECT,'runtime','isolated-interaction-')))throw new Error('QA requires an isolated directory');
class VerificationVision extends VisionTransport {async complete(body,signal){writeFileSync(join(rootDir,'synthetic-vision-request.json'),JSON.stringify(body,null,2));return super.complete(body,signal);}}
const runtime=new CompanionRuntime({rootDir,verificationLabel:'隔离验收',visionTransport:new VerificationVision()});runtime.settingsFile=SETTINGS_FILE;
const app=await createCompanionServer({port:5280,runtime});
console.log(JSON.stringify({url:app.url,rootDir,mode:runtime.current.mode}));process.stdin.setEncoding('utf8');process.stdin.resume();
await new Promise(resolve=>process.stdin.on('data',value=>value.includes('quit')&&resolve()));await app.close();process.stdin.pause();
