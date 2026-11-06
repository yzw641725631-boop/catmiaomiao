import {mkdirSync,copyFileSync,readFileSync,writeFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),require=createRequire(join(root,'package.json'));
const vad=dirname(require.resolve('@ricky0123/vad-web/package.json')),vadRequire=createRequire(join(vad,'package.json')),ort=resolve(dirname(vadRequire.resolve('onnxruntime-web/wasm')),'..');
const output=join(root,'public/audio/vad');mkdirSync(output,{recursive:true});
const files=[['silero_vad_v5.onnx',vad],['vad.worklet.bundle.min.js',vad],['ort-wasm-simd-threaded.wasm',ort],['ort-wasm-simd-threaded.mjs',ort]];
const manifest={vad:JSON.parse(readFileSync(join(vad,'package.json'))).version,onnxruntime:JSON.parse(readFileSync(join(ort,'package.json'))).version,files:[]};
for(const [name,folder] of files){const source=join(folder,'dist',name);copyFileSync(source,join(output,name));manifest.files.push({name,sha256:createHash('sha256').update(readFileSync(source)).digest('hex')});}
writeFileSync(join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({vad:manifest.vad,onnxruntime:manifest.onnxruntime,files:files.length}));
