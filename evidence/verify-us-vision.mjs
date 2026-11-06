import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {VisionTransport} from '../adapters/vision.mjs';
const service=new VisionTransport(),started=Date.now(),directory=new URL('./interaction-vision-20261023/',import.meta.url);mkdirSync(directory,{recursive:true});
const output=new URL('vision-live-'+new Date().toISOString().replace(/[:.]/g,'-')+'.json',directory),record={isolated:true,model:'deepseek-v4.1-flash-vision-exp',passed:false};
try{
 const response=await service.complete({messages:[{role:'user',content:[{type:'text',text:'请仅根据图片，写出图片中的标识、计算结果，并描述底部两种图形及颜色。不要猜测看不到的内容。'},{type:'image_url',image_url:{url:'data:image/png;base64,'+readFileSync(new URL('vision-fixture.png',directory)).toString('base64')}}]}],max_tokens:500},AbortSignal.timeout(180000));
 const text=response.choices?.[0]?.message?.content||'';record.answer=text;record.passed=/ORBIT\s*84/i.test(text)&&/150/.test(text)&&/红|red/i.test(text)&&/蓝|blue/i.test(text);
}catch(error){record.error=error.message;}finally{service.close();record.elapsedMs=Date.now()-started;writeFileSync(output,JSON.stringify(record,null,2));console.log(JSON.stringify({output:output.pathname,...record}));if(!record.passed)process.exitCode=1;}
