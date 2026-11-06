import {readFileSync,writeFileSync} from 'node:fs';
import {VisionTransport,VISION_MODEL} from '../adapters/vision.mjs';
const path=process.argv[2];if(!path?.includes('isolated-interaction-'))throw new Error('Use a synthetic isolated request');
const body=JSON.parse(readFileSync(path,'utf8'));delete body.stream_options;
const vision=new VisionTransport(),start=Date.now(),record={isolated:true,model:VISION_MODEL,toolCount:body.tools?.length||0,removed:['stream_options'],passed:false};
try{const result=await vision.complete({...body,max_tokens:700},AbortSignal.timeout(180000));record.answer=result.choices?.[0]?.message;record.passed=/150/.test(record.answer?.content||'');}catch(error){record.error=error.message;}finally{vision.close();record.elapsedMs=Date.now()-start;const output=new URL('./interaction-vision-20261023/native-vision-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',import.meta.url);writeFileSync(output,JSON.stringify(record,null,2));console.log(JSON.stringify({output:output.pathname,...record}));process.exitCode=record.passed?0:1;}
