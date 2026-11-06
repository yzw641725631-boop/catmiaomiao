import {spawn} from 'node:child_process';
import {createInterface} from 'node:readline';
import {randomUUID} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {fail} from './endpoints.mjs';

export const VISION_MODEL='deepseek-v4.1-flash-vision-exp';
export function hasImages(body){return body.messages?.some(message=>Array.isArray(message.content)&&message.content.some(part=>part.type==='image_url'));}
export function validateVisionRequest(body){
  if(!Array.isArray(body?.messages)||body.messages.length>2000)throw fail('图片消息格式无效。');
  let images=0,bytes=0;
  for(const message of body.messages){
    if(!['system','developer','user','assistant','tool'].includes(message.role))throw fail('图片消息角色无效。');
    if(!Array.isArray(message.content))continue;
    for(const part of message.content){
      if(part.type==='text'&&typeof part.text==='string')continue;
      const url=part.image_url?.url;
      if(part.type!=='image_url'||typeof url!=='string'||!/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+=*$/.test(url))throw fail('只接受本次上传的图片，不能读取远程图片地址。');
      images++;bytes+=url.length;if(images>8||bytes>28*1024*1024)throw fail('图片数量或体积超出本次识别限制。',413);
    }
  }
  if(!images)throw fail('本次没有图片。');
  const {stream_options,...request}=body;
  return {...request,model:VISION_MODEL,stream:false};
}
export class VisionTransport{
  constructor(options={}){this.options=options;this.pending=new Map();this.child=null;this.starting=null;}
  async start(){
    if(this.starting)return this.starting;
    this.starting=new Promise((resolve,reject)=>{
      const child=spawn(this.options.python||'C:\\Users\\Administrator\\.workbuddy\\binaries\\python\\versions\\3.14.3\\python.exe',['-u',fileURLToPath(new URL('./vision-transport.py',import.meta.url))],{windowsHide:true,stdio:['pipe','pipe','pipe'],env:{...process.env,PYTHONIOENCODING:'utf-8'}});this.child=child;
      const timer=setTimeout(()=>{reject(fail('美国视觉服务连接超时，请稍后再试。',504));this.close();},35000);
      let ready=false;
      createInterface({input:child.stdout}).on('line',line=>{
        let row;try{row=JSON.parse(line);}catch{return;}
        if(row.ready){ready=true;clearTimeout(timer);resolve();return;}
        if(row.fatal){clearTimeout(timer);reject(fail('美国视觉服务当前未连接。',503));this.close();return;}
        const request=this.pending.get(row.id);if(!request)return;this.pending.delete(row.id);request.cleanup();
        if(row.error){const upload=row.error.code==='VISION_IMAGE_UPLOAD_FAILED';request.reject(fail(upload?'美国视觉服务上传图片失败，图片仍保留在记录里。请待模型服务恢复后重新发送。':`图片识别服务暂未完成请求（${row.error.status||502}）。请稍后再试，图片仍保留。`,row.error.status||502,upload?'VISION_IMAGE_UPLOAD_FAILED':'VISION_UPSTREAM_ERROR'));}else request.resolve(row.result);
      });
      child.stderr.on('data',()=>{});
      const ended=()=>{clearTimeout(timer);if(!ready)reject(fail('美国视觉服务未连接。',503));for(const request of this.pending.values()){request.cleanup();request.reject(fail('图片识别连接已中断，图片仍保留。',502));}this.pending.clear();this.child=null;this.starting=null;};
      child.once('exit',ended);child.once('error',ended);child.stdin.on('error',()=>{});
    });
    return this.starting;
  }
  async complete(body,signal){
    const request=validateVisionRequest(body);await this.start();if(signal?.aborted)throw signal.reason;
    if(this.pending.size>=2)throw fail('已有两张图片正在处理，请稍等。',429);
    return new Promise((resolve,reject)=>{
      const id=randomUUID(),cancel=()=>{const pending=this.pending.get(id);if(!pending)return;this.pending.delete(id);pending.cleanup();reject(signal?.reason||fail('图片识别已停止。',499));};
      const timer=setTimeout(()=>{this.pending.delete(id);cleanup();reject(fail('图片识别超时，图片仍保留。',504));},180000);
      const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',cancel);};
      this.pending.set(id,{resolve,reject,cleanup});signal?.addEventListener('abort',cancel,{once:true});
      this.child.stdin.write(JSON.stringify({id,body:request})+'\n',error=>{if(error){this.pending.delete(id);cleanup();reject(fail('图片识别连接中断。',502));}});
    });
  }
  close(){this.child?.stdin.end();this.child?.kill();this.child=null;this.starting=null;for(const request of this.pending.values()){request.cleanup();request.reject(fail('视觉服务已停止。',503));}this.pending.clear();}
}
