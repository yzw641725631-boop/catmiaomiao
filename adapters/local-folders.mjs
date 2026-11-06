import { randomUUID, createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, lstatSync, constants, openSync, fstatSync, closeSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, extname, resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { WorkspaceFiles } from './workspace-files.mjs';

const binary = ['.pdf', '.docx'];
/** Parse PDF/DOCX bytes in a disposable child process that sees bytes only, no paths or credentials. */
export function parseDocument(bytes, extension) {
  return new Promise((accept, reject) => {
    const env = { PATH: dirname(process.execPath) }; for (const key of ['SYSTEMROOT', 'WINDIR']) if (process.env[key]) env[key] = process.env[key];
    const child = spawn(process.execPath, ['--max-old-space-size=256', fileURLToPath(new URL('./document-reader.mjs', import.meta.url))], { env, windowsHide: true, timeout: 15000, stdio: ['pipe', 'pipe', 'ignore'] });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; if (output.length > 400000) child.kill(); });
    child.once('error', () => reject(new Error('文档解析进程未能启动。')));
    child.once('close', code => { try { const data = JSON.parse(output); if (code !== 0 || data.error) reject(new Error(data.error || '文档解析未完成。')); else accept(data); } catch { reject(new Error('文档解析超时或内容过大。')); } });
    child.stdin.on('error', () => {}); child.stdin.end(JSON.stringify({ extension, data: bytes.toString('base64') }));
  });
}

const ATTACHMENT_TEXT = new Set(['.txt', '.md', '.csv', '.tsv', '.json']);
const ATTACHMENT_NAME = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\.(txt|md|csv|tsv|json|pdf|docx)$/i;
/** Read a file the user attached in chat. Only a bare generated name inside the session's attachments folder. */
export async function readAttachment(attachmentsDir, reference) {
  const name = String(reference || '').split(/[\\/]/).at(-1) || '';
  if (!ATTACHMENT_NAME.test(name)) throw new Error('只能读取用户在对话里附带的文件；请使用消息中 attached-file 的 path。');
  const target = join(attachmentsDir, name), extension = extname(name).toLowerCase();
  let fd; try { fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); } catch { throw new Error('附件不存在或已清理。'); }
  let bytes;
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 10000000) throw new Error('附件不是普通文件或超过 10MB。');
    bytes = readFileSync(fd);
  } finally { closeSync(fd); }
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  if (ATTACHMENT_TEXT.has(extension)) {
    const text = bytes.toString('utf8');
    return { name, sha256, text: text.slice(0, 50000), truncated: text.length > 50000 };
  }
  return { name, sha256, ...(await parseDocument(bytes, extension)) };
}

export class LocalFolders {
  constructor(rootDir, archive) { this.rootDir = rootDir; this.archive = archive; this.path = join(rootDir, 'folder-access.json'); this.rows = existsSync(this.path) ? JSON.parse(readFileSync(this.path, 'utf8')) : []; }
  save() { mkdirSync(this.rootDir, { recursive: true }); writeFileSync(this.path, JSON.stringify(this.rows, null, 2) + '\n', { mode: 0o600 }); }
  listGrants() { return this.rows.filter(row => !row.revokedAt).map(row => ({ id: row.id, name: row.name, path: row.root, writable: row.writable })); }
  files(row, actor = {}) { return new WorkspaceFiles({ root: row.root, archive: join(this.archive, row.id), ledger: join(this.rootDir, 'folder-ledger', row.id + '.jsonl'), readFormats: binary, ...actor }); }
  grant(path, writable = false) {
    if (typeof path !== 'string' || !isAbsolute(path) || path.length > 1000 || typeof writable !== 'boolean') throw new Error('请填写本机文件夹的完整路径。');
    const root = resolve(path); if (dirname(root) === root) throw new Error('请选择具体文件夹，不能授权整个磁盘。');
    const row = { id: randomUUID(), root, name: basename(root), writable, createdAt: Date.now() }; this.files(row);
    if (this.rows.some(item => !item.revokedAt && item.root.toLowerCase() === root.toLowerCase())) throw new Error('这个文件夹已经在可用列表中，请先撤销旧授权再修改权限。');
    this.rows.push(row); this.save(); return this.listGrants().find(item => item.id === row.id);
  }
  get(id) { const row = this.rows.find(item => item.id === id && !item.revokedAt); if (!row) throw new Error('文件夹尚未授权或授权已撤销。请在“能力”里选择文件夹。'); this.files(row); return row; }
  revoke(id) { const row = this.rows.find(item => item.id === id && !item.revokedAt); if (!row) throw new Error('授权已撤销或不存在。'); row.revokedAt = Date.now(); this.save(); return { revoked: true }; }
  list(id) {
    const row = this.get(id), files = this.files(row), items = []; let visited = 0;
    const visit = (folder, prefix = '', depth = 0) => {
      if (depth > 6 || visited > 1500 || items.length >= 200) return;
      for (const item of readdirSync(folder, { withFileTypes: true })) {
        if (++visited > 1500 || items.length >= 200) break;
        if (item.name.startsWith('.') || item.isSymbolicLink() || /node_modules|^归档$|^dist$/i.test(item.name)) continue;
        const path = prefix + item.name;
        if (item.isDirectory()) visit(join(folder, item.name), path + '/', depth + 1);
        else if (item.isFile()) { try { const target = files.target(path), stat = lstatSync(target); items.push({ path, bytes: stat.size, format: extname(path).slice(1), modifiedAt: stat.mtime.toISOString() }); } catch {} }
      }
    };
    visit(row.root); return { folderId: id, name: row.name, writable: row.writable, files: items, truncated: items.length >= 200 || visited > 1500, supported: 'UTF-8 text, CSV, PDF text and DOCX; scanned PDF requires OCR' };
  }
  async read(id, path) {
    const row = this.get(id), files = this.files(row), extension = extname(path).toLowerCase();
    if (!binary.includes(extension)) return { folderId: id, ...files.read(path) };
    const target = files.target(path), fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0)); let bytes;
    try { const stat = fstatSync(fd), current = lstatSync(target); if (!stat.isFile() || stat.nlink !== 1 || current.isSymbolicLink() || stat.ino !== current.ino || stat.dev !== current.dev || stat.size > 10000000) throw new Error('文档被链接、发生变化或超过 10 MB。'); bytes = readFileSync(fd); } finally { closeSync(fd); }
    const data = await parseDocument(bytes, extension);
    this.get(id); files.target(path);
    return { folderId: id, path, sha256: createHash('sha256').update(bytes).digest('hex'), ...data };
  }
  write(id, path, content, expected, actor = {}) { const row = this.get(id); if (!row.writable) throw new Error('这个文件夹当前仅可读取。请在能力面板明确开启写入，或将产物保存到任务目录。'); return this.files(row, actor).write(path, content, expected); }
}
