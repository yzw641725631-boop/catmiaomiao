import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { LocalFolders, readAttachment } from '../../adapters/local-folders.mjs';
import { AssistantServices } from '../../adapters/assistant-services.mjs';
import { PublicWeb, publicUrl, fetchPublic } from '../../adapters/public-web.mjs';
import { scratch } from './scratch.mjs';

const fixture = () => { const root = scratch('services-contract'); mkdirSync(root, { recursive: true }); return root; };
test('folder grants persist, default to read-only, enforce revocation and archive hash-checked writes', async () => {
  const root = fixture(), folder = join(root, 'documents'); mkdirSync(folder); writeFileSync(join(folder, 'notes.md'), '# 原文'); writeFileSync(join(folder, 'tokens.json'), '{}');
  const access = new LocalFolders(join(root, 'store'), join(root, '归档')), grant = access.grant(folder);
  assert.equal(access.list(grant.id).files.length, 1); assert.equal((await access.read(grant.id, 'notes.md')).content, '# 原文');
  assert.throws(() => access.write(grant.id, 'notes.md', 'no', null), /仅可读取/);
  access.revoke(grant.id); assert.throws(() => access.list(grant.id), /撤销/);
  const writable = access.grant(folder, true), original = await access.read(writable.id, 'notes.md');
  assert.throws(() => access.write(writable.id, '../escape.md', 'no', null));
  const edited = access.write(writable.id, 'notes.md', '# 新版', original.sha256); assert(edited.archived);
  assert.throws(() => access.write(writable.id, 'notes.md', 'conflict', original.sha256));
  const again = new LocalFolders(join(root, 'store'), join(root, '归档')); assert.equal(again.listGrants().length, 1); assert.equal((await again.read(writable.id, 'notes.md')).content, '# 新版');
  symlinkSync(folder, join(root, 'linked'), process.platform === 'win32' ? 'junction' : 'dir'); assert.throws(() => access.grant(join(root, 'linked')));
});
test('actual DOCX and PDF parsers extract document text and never permit binary writes', async () => {
  const root=fixture(), folder=join(root,'documents');mkdirSync(folder);
  const require=createRequire(new URL('../package.json',import.meta.url)), mammothRequire=createRequire(require.resolve('mammoth')), JSZip=mammothRequire('jszip');
  const zip=new JSZip();zip.file('[Content_Types].xml','<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
  zip.file('_rels/.rels','<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
  zip.file('word/document.xml','<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>合成文件 SAMPLE-DOCX-42</w:t></w:r></w:p></w:body></w:document>');
  writeFileSync(join(folder,'sample.docx'),await zip.generateAsync({type:'nodebuffer'}));
  const stream='BT /F1 18 Tf 30 100 Td (SAMPLE-PDF-42) Tj ET';
  const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Count 1 /Kids [3 0 R] >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`];
  let pdf='%PDF-1.4\n', offsets=[0];for(let i=0;i<objects.length;i++){offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${objects[i]}\nendobj\n`;}
  const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.slice(1).map(n=>String(n).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  writeFileSync(join(folder,'sample.pdf'),pdf);
  const access=new LocalFolders(join(root,'store'),join(root,'归档')), grant=access.grant(folder,true);
  assert.equal(access.list(grant.id).files.length,2);
  assert.match((await access.read(grant.id,'sample.docx')).text,/SAMPLE-DOCX-42/);
  assert.match((await access.read(grant.id,'sample.pdf')).text,/SAMPLE-PDF-42/);
  assert.throws(()=>access.write(grant.id,'sample.pdf','not a PDF',null),/Only supported text/);
  // Chat attachments: same parser, bare generated names inside the attachments folder only.
  const attachments=join(root,'attachments');mkdirSync(attachments);
  const docx=randomUUID()+'.docx', pdfName=randomUUID()+'.pdf', md=randomUUID()+'.md';
  writeFileSync(join(attachments,docx),readFileSync(join(folder,'sample.docx')));writeFileSync(join(attachments,pdfName),pdf);writeFileSync(join(attachments,md),'# 清单\n蓝莓三盒');
  assert.match((await readAttachment(attachments,'C:\\data\\attachments\\'+docx)).text,/SAMPLE-DOCX-42/);
  assert.match((await readAttachment(attachments,'/data/attachments/'+pdfName)).text,/SAMPLE-PDF-42/);
  assert.equal((await readAttachment(attachments,md)).text,'# 清单\n蓝莓三盒');
  for(const bad of ['../../etc/passwd','..\\..\\Windows\\win.ini','sample.docx',randomUUID()+'.exe',join(folder,'sample.docx'),'']) await assert.rejects(readAttachment(attachments,bad),/只能读取/);
  await assert.rejects(readAttachment(attachments,randomUUID()+'.md'),/不存在/);
});
test('web tools block private IPs, rebinding and private redirects, and retain actual source URLs', async () => {
  for (const url of ['http://127.0.0.1/a','http://2130706433/a','http://10.0.0.1/','http://[::1]/','file:///etc/passwd','https://user:pass@example.com/']) assert.throws(() => publicUrl(url));
  await assert.rejects(fetchPublic('https://public.example/', { resolve: async () => [{address:'127.0.0.1',family:4}] }), /内网/);
  const web = new PublicWeb(async url => ({url, text: url.includes('format=rss') ? '<rss><channel><item><title>官方说明</title><link>https://example.com/guide</link><description>真实检索摘要</description></item></channel></rss>' : '<html><head><title>官方指南</title></head><body><main><h1>官方指南</h1><p>' + '这里是用于校验网页解析的真实正文内容。'.repeat(20) + '</p><script>must not execute</script></main></body></html>'}));
  const search = await web.search('公开查询'); assert.equal(search.results[0].url, 'https://example.com/guide');
  const page = await web.read(search.results[0].url); assert(page.text.includes('真实正文')); assert(!page.text.includes('must not execute')); assert.equal(page.url, search.results[0].url);
});
function runtimeFixture(root) {
  let memory = { text: '# 记忆\n', hash: 'initial' }, sends = [];
  const runtime = {rootDir:root,current:{chiefId:'chief',helperIds:['helper'],companionThreadId:'chat',workThreadIds:[]},closed:false,
    async api(session, method, path, body) { if (path === '/api/bots') return {bots:[{id:'chief',tasks:[{threadId:'chat'}]},{id:'helper',tasks:[{threadId:'child'}]}]}; if(method==='GET') return memory; assert.equal(body.expectedHash,memory.hash); memory={text:body.text,hash:randomUUID()}; return memory; },
    async send(body) { sends.push(body); return {threadId:'work'}; },
    works() { return [{ id: 'work', title: '整理文档', status: 'running' }]; },
    async addToWork(threadId, body) { sends.push({ add: threadId, ...body }); return { delivery: 'steered' }; }};
  return {runtime, get memory(){return memory;},sends};
}
test('preferences require confirmation, survive restart, deduplicate rejection and support forgetting', async () => {
  const root=fixture(), f=runtimeFixture(root), service=new AssistantServices(f.runtime);
  const proposal=service.propose('报告先给结论'); assert.equal(proposal.status,'pending'); assert(!f.memory.text.includes(proposal.text));
  await service.preference(proposal.id,'confirm'); assert(f.memory.text.includes(proposal.text));
  const restarted=new AssistantServices(f.runtime); assert.equal(restarted.snapshot().preferences[0].status,'confirmed');
  await restarted.preference(proposal.id,'forget'); assert(!f.memory.text.includes(proposal.text));
  const rejected=service.propose('推测的偏好'); await service.preference(rejected.id,'reject'); assert.equal(service.propose('推测的偏好').status,'rejected');
});
test('reminders catch up once after restart, coalesce daily misses, pause and create actual background work', async () => {
  const root=fixture(), f=runtimeFixture(root); let now=Date.parse('2026-10-22T01:00:00Z');
  const service=new AssistantServices(f.runtime,{now:()=>now});
  const once=service.createReminder({title:'测试提醒',at:new Date(now+1000).toISOString(),repeat:'once',action:'notify'});
  const daily=service.createReminder({title:'每日研究',at:new Date(now+1000).toISOString(),repeat:'daily',action:'work',task:'生成公开资料简报'});
  service.reminder(daily.id,'pause'); now+=3000; await service.tick(); assert.equal(service.snapshot().events.length,1); assert.equal(f.sends.length,0);
  const restarted=new AssistantServices(f.runtime,{now:()=>now}); await restarted.tick(); assert.equal(restarted.snapshot().events.length,1);
  restarted.reminder(daily.id,'resume'); now+=3*86400000; await restarted.tick(); await restarted.tick();
  assert.equal(f.sends.length,1); assert.equal(f.sends[0].kind,'work'); assert(Date.parse(restarted.snapshot().reminders.find(r=>r.id===daily.id).nextAt)>now);
  assert.equal(restarted.snapshot().reminders.find(r=>r.id===once.id).status,'triggered');
});
test('morning brief is off by default, fires once a day at its time, never right after being switched on late', async () => {
  const root=fixture(), f=runtimeFixture(root);
  const at = (hhmm) => Date.parse(`2026-11-02T${hhmm}:00+08:00`);
  let now = at('07:00'); const service=new AssistantServices(f.runtime,{now:()=>now});
  assert.equal(service.briefSettings().enabled, false);
  await service.briefTick(); assert.equal(f.sends.length, 0);
  service.setBrief({ enabled: true, time: '08:30' });
  now = at('08:29'); await service.briefTick(); assert.equal(f.sends.length, 0);
  now = at('08:31'); await service.briefTick(); await service.briefTick();
  assert.equal(f.sends.length, 1); assert.equal(f.sends[0].kind, 'chat'); assert.match(f.sends[0].text, /^\[早间简报\]/);
  now = at('09:00') + 86400000; await service.briefTick(); assert.equal(f.sends.length, 2);
  service.setBrief({ enabled: false }); now += 86400000; await service.briefTick(); assert.equal(f.sends.length, 2);
  now = at('10:00') + 3 * 86400000; service.setBrief({ enabled: true, time: '08:30' }); await service.briefTick(); assert.equal(f.sends.length, 2, 'switched on after today’s time: starts tomorrow');
  assert.throws(() => service.setBrief({ enabled: true, time: '8:30' }), /时间/); assert.throws(() => service.setBrief({ enabled: 'yes' }), /开启/);
});

test('private service bridge rejects browser origins and unknown task identity; helpers cannot recursively create work', async () => {
  const root=fixture(), f=runtimeFixture(root), service=new AssistantServices(f.runtime); await service.start();
  try {
    const url=service.env('chief','chat').COMPANION_SERVICE_URL;
    assert.equal((await fetch(url+'/call',{method:'POST'})).status,401);
    assert.equal((await fetch(url+'/call',{method:'POST',headers:{authorization:'Bearer '+service.token,origin:'http://untrusted.invalid'}})).status,401);
    await assert.rejects(service.call('folders',{}, {botId:'outside',threadId:'chat'}));
    await assert.rejects(service.call('start_work',{description:'test',request_key:'one'},{botId:'helper',threadId:'child'}),/只有主助理/);
    const result=await service.call('start_work',{description:'test',request_key:'one'},{botId:'chief',threadId:'chat'}); assert.equal(result.threadId,'work');
    await assert.rejects(service.call('add_to_work',{work_id:'work',text:'再加一段总结',request_key:'add-1'},{botId:'helper',threadId:'child'}),/只有主助理/);
    await assert.rejects(service.call('works',{},{botId:'helper',threadId:'child'}),/只有主助理/);
    assert.deepEqual((await service.call('works',{},{botId:'chief',threadId:'chat'})).works.map(work=>work.id),['work']);
    const added=await service.call('add_to_work',{work_id:'work',text:'再加一段总结',request_key:'add-1'},{botId:'chief',threadId:'chat'});
    assert.equal(added.delivery,'steered'); assert.match(added.note,/正在进行的这一步/);
    const forwarded=f.sends.find(item=>item.add==='work'); assert.equal(forwarded.text,'再加一段总结'); assert.match(forwarded.sendId,/^assistant_[0-9a-f]{48}$/);
  } finally {await service.close();}
});
