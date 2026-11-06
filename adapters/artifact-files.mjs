import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, openSync, fstatSync, closeSync, constants } from 'node:fs';
import { extname } from 'node:path';
import { WorkspaceFiles } from './workspace-files.mjs';

const require = createRequire(new URL('../app/package.json', import.meta.url));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const text = (value, max) => typeof value === 'string' && value.trim() && value.length <= max;
export class ArtifactFiles extends WorkspaceFiles {
  constructor(options) { super({...options, readFormats:['.docx','.xlsx']}); }
  raw(path) {
    const target = this.target(path);
    if (!['.docx','.xlsx'].includes(extname(path).toLowerCase())) throw new Error('仅支持本次生成的 Word 和 Excel。');
    const fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try { const stat=fstatSync(fd); if(!stat.isFile()||stat.nlink!==1||stat.size>8000000)throw new Error('文件大小或类型无效。'); return readFileSync(fd); } finally { closeSync(fd); }
  }
  async document(args) {
    if(!text(args.title,200)||!Array.isArray(args.sections)||!args.sections.length||args.sections.length>40||args.sections.some(row=>!row||Object.keys(row).some(key=>!['heading','text'].includes(key))||row.heading!==undefined&&!text(row.heading,200)||!text(row.text,8000))||extname(args.path).toLowerCase()!=='.docx')throw new Error('请提供 docx 路径、标题和最多 40 段正文。');
    const { Document, Packer, Paragraph, TextRun, HeadingLevel }=require('docx');
    const children=[new Paragraph({text:args.title,heading:HeadingLevel.TITLE})];
    for(const section of args.sections){if(section.heading)children.push(new Paragraph({text:section.heading,heading:HeadingLevel.HEADING_1}));for(const line of section.text.split('\n'))children.push(new Paragraph({children:[new TextRun(line)],spacing:{after:160}}));}
    const document=new Document({creator:'我的助理',title:args.title,sections:[{properties:{},children}]});
    const bytes=await Packer.toBuffer(document);
    const extracted=await require('mammoth').extractRawText({buffer:bytes});
    if(!extracted.value.includes(args.title)||args.sections.some(row=>!extracted.value.includes(row.text.split('\n')[0])))throw new Error('生成后读取校验失败。');
    return this.commitArtifact(args.path,bytes,{kind:'document',title:args.title,paragraphs:args.sections.length,check:'DOCX 重新读取标题与各段正文'});
  }
  async spreadsheet(args) {
    const scalar=value=>value===null||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value)||typeof value==='string'&&value.length<=4000;
    if(!text(args.title,100)||!Array.isArray(args.columns)||!args.columns.length||args.columns.length>20||args.columns.some(value=>!text(value,100))||!Array.isArray(args.rows)||args.rows.length>1000||args.rows.some(row=>!Array.isArray(row)||row.length!==args.columns.length||row.some(value=>!scalar(value)))||extname(args.path).toLowerCase()!=='.xlsx')throw new Error('请提供 xlsx 路径、表头和最多 1000 行数据。单元格支持文字、数字、布尔值。');
    const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();book.creator='我的助理';book.title=args.title;
    const sheet=book.addWorksheet(args.title.replace(/[\\/*?:\[\]]/g,' ').slice(0,31)||'结果');
    sheet.columns=args.columns.map(name=>({header:name,width:Math.min(36,Math.max(18,name.length*2+3))}));sheet.addRows(args.rows);
    sheet.views=[{state:'frozen',ySplit:1}];sheet.autoFilter={from:{row:1,column:1},to:{row:args.rows.length+1,column:args.columns.length}};
    sheet.getRow(1).font={bold:true,color:{argb:'FFFFFFFF'}};sheet.getRow(1).fill={type:'pattern',pattern:'solid',fgColor:{argb:'FF59684C'}};
    const bytes=Buffer.from(await book.xlsx.writeBuffer()),verified=new ExcelJS.Workbook();await verified.xlsx.load(bytes);
    const actual=verified.worksheets[0];
    if(actual.rowCount!==args.rows.length+1||actual.getCell(1,1).value!==args.columns[0]||args.rows.some((row,r)=>row.some((value,c)=>value!==actual.getCell(r+2,c+1).value)))throw new Error('生成后表格读取校验失败。');
    return this.commitArtifact(args.path,bytes,{kind:'spreadsheet',title:args.title,rows:args.rows.length,columns:args.columns.length,check:'XLSX 重新读取所有表头与单元格'});
  }
  commitArtifact(path,bytes,detail) {
    const release=this.lock();try {const target=this.target(path,true);if(existsSync(target))throw new Error('已有同名文件；请保留原文件并使用新名称。');if(bytes.length>8000000)throw new Error('文件超过 8 MB。');this.assertRoot();this.target(path);writeFileSync(target,bytes,{flag:'wx',mode:0o600});const result={path,sha256:sha(bytes),bytes:bytes.length,...detail};this.record({operation:'create_artifact',...result,exitCode:0});return {...result,absolutePath:target,verified:true};}finally{release();}
  }
  listArtifacts() {
    let entries=[];try{entries=readFileSync(this.ledger,'utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));}catch(error){if(error.code!=='ENOENT')throw error;}
    return entries.filter(item=>item.operation==='create_artifact').map(item=>{try {const bytes=this.raw(item.path);return {...item,current:sha(bytes)===item.sha256};}catch{return {...item,current:false};}});
  }
  verified(path,expected) {const row=this.listArtifacts().findLast(row=>row.path===path&&row.sha256===expected);if(!row?.current)throw new Error('文件已变化或不属于本次生成结果，请重新读取。');const bytes=this.raw(path);if(sha(bytes)!==expected)throw new Error('文件已经变化。');return {row,bytes};}
  async preview(path,expected) {
    const {row,bytes}=this.verified(path,expected);
    if(row.kind==='document'){const result=await require('mammoth').extractRawText({buffer:bytes});return {...row,text:result.value.slice(0,200000)};}
    const ExcelJS=require('exceljs'),book=new ExcelJS.Workbook();await book.xlsx.load(bytes);
    return {...row,sheets:book.worksheets.map(sheet=>({name:sheet.name,rows:Array.from({length:Math.min(1001,sheet.rowCount)},(_,r)=>Array.from({length:Math.min(20,sheet.columnCount)},(_,c)=>{const value=sheet.getCell(r+1,c+1).value;return typeof value==='object'&&value!==null?JSON.stringify(value):value;}))}))};
  }
}
