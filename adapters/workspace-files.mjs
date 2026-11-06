import { constants, closeSync, existsSync, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync, appendFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, extname, isAbsolute, join, relative, resolve } from 'node:path';
import { spawn } from 'node:child_process';

const extensions = new Set(['.md', '.txt', '.csv', '.json', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.css', '.html', '.yaml', '.yml']);
const blocked = /(?:secret|credential|password|token|private[_-]?key|node_modules|^dist$|^build$|^归档$)/i;
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
const string = (description, extra = {}) => ({ type: 'string', description, ...extra });
const schema = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const filePath = string('Relative path inside the assigned work folder, e.g. report.md. Never an absolute path.', { minLength: 1, maxLength: 240 });
export const workspaceTools = [
  { name:'create_document',description:'Generate an actual Word DOCX with the docx library in this assigned work folder. Give title and sections with heading and text. Reopens and verifies content; returns real path and SHA. New filename only, no overwrite.',inputSchema:schema({path:filePath,title:string('Document title',{maxLength:200}),sections:{type:'array',minItems:1,maxItems:40,items:schema({heading:string('Optional section heading',{maxLength:200}),text:string('Plain text paragraphs',{maxLength:8000})},['text'])}})},
  { name:'create_spreadsheet',description:'Generate an actual Excel XLSX using ExcelJS in this assigned folder. Literal cells only; no formulas/macros. Reopens all cells for verification and returns real path and SHA. New filename only.',inputSchema:schema({path:filePath,title:string('Workbook title',{maxLength:100}),columns:{type:'array',minItems:1,maxItems:20,items:string('Column title',{maxLength:100})},rows:{type:'array',maxItems:1000,items:{type:'array',items:{type:['string','number','boolean','null']}}}})},
  { name: 'list_files', description: 'List text files in this task’s assigned Windows work folder. No shell, network or access to other folders.', inputSchema: schema({}) },
  { name: 'read_file', description: 'Read a UTF-8 text file in the assigned work folder and obtain its SHA-256 for safe editing.', inputSchema: schema({ path: filePath }) },
  { name: 'write_file', description: 'Create or replace a UTF-8 text file in this task’s assigned folder. Use expected_sha256=null for a new file; read the existing file first and pass its SHA-256 to replace it. Previous bytes are archived before replacement. Return a real file link. No deletion.', inputSchema: schema({ path: filePath, content: string('Complete UTF-8 file content, max 64 KB.', { maxLength: 64000 }), expected_sha256: { type: ['string', 'null'], description: 'null for a new file; otherwise the exact SHA-256 returned by read_file.', pattern: '^[a-f0-9]{64}$' } }) },
  { name: 'check_file', description: 'Actually validate a saved file and record its exit code. utf8 checks encoding/content; json parses JSON; javascript_syntax runs Node --check only (does not execute code). No arbitrary command execution.', inputSchema: schema({ path: filePath, check: { type: 'string', enum: ['utf8', 'json', 'javascript_syntax'] } }) },
];

export class WorkspaceFiles {
  constructor({ root, archive, ledger, botId, threadId, readFormats = [] }) {
    if (![root, archive, ledger].every(value => typeof value === 'string' && isAbsolute(value))) throw new Error('Missing trusted workspace configuration.');
    this.root = resolve(root); this.archive = resolve(archive); this.ledger = resolve(ledger); this.botId = botId; this.threadId = threadId;
    this.readFormats = new Set([...extensions, ...readFormats]);
    this.assertRoot();
    for (const target of [this.archive, this.ledger]) if (this.inside(target)) throw new Error('Audit and archive storage must be outside the tool scope.');
  }
  inside(target) { const rel = relative(this.root, target); return rel === '' || !isAbsolute(rel) && rel !== '..' && !rel.startsWith('..' + (process.platform === 'win32' ? '\\' : '/')); }
  assertRoot() {
    // Reject junctions/symlinks anywhere in the root, including a replaced ancestor.
    let cursor = this.root;
    while (true) {
      const stat = lstatSync(cursor);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Workspace root is not a plain directory.');
      const parent = dirname(cursor); if (parent === cursor) break; cursor = parent;
    }
    if (!same(realpathSync(this.root), this.root)) throw new Error('Workspace root resolves elsewhere.');
  }
  target(name, createParents = false) {
    this.assertRoot();
    if (typeof name !== 'string' || !name || name.length > 240 || /[:\0\r\n]/.test(name) || /^[\\/]/.test(name)) throw new Error('Use a relative file path.');
    const parts = name.split(/[\\/]/);
    if (parts.length > 9 || parts.some(part => !part || part === '..' || part.startsWith('.') || /[. ]$/.test(part) || /[<>"|?*]/.test(part) || blocked.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('This path is outside the allowed text-file scope.');
    if (!this.readFormats.has(extname(parts.at(-1)).toLowerCase())) throw new Error('Only supported files can be accessed.');
    let cursor = this.root;
    for (let index = 0; index < parts.length; index++) {
      cursor = join(cursor, parts[index]);
      if (!this.inside(cursor)) throw new Error('Path escaped the assigned folder.');
      if (!existsSync(cursor)) {
        // existsSync also returns false for dangling symlinks.
        try { lstatSync(cursor); throw new Error('Linked paths are not allowed.'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
        if (index < parts.length - 1) { if (!createParents) throw new Error('Parent directory does not exist.'); mkdirSync(cursor); }
      } else {
        const stat = lstatSync(cursor);
        if (stat.isSymbolicLink() || stat.nlink > 1 && stat.isFile()) throw new Error('Links are not allowed.');
        if (index < parts.length - 1 && !stat.isDirectory() || index === parts.length - 1 && !stat.isFile()) throw new Error('Path type does not match a text file.');
        if (!same(realpathSync(cursor), resolve(cursor))) throw new Error('Path resolves elsewhere.');
      }
    }
    return cursor;
  }
  bytes(target) {
    const fd = openSync(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = fstatSync(fd), current = lstatSync(target);
      if (!stat.isFile() || stat.nlink !== 1 || current.isSymbolicLink() || stat.ino !== current.ino || stat.dev !== current.dev || stat.size > 64000) throw new Error('File is linked, changed, or too large.');
      const bytes = readFileSync(fd);
      if (bytes.includes(0) || bytes.length > 64000) throw new Error('Binary or oversized file.');
      new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      return bytes;
    } finally { closeSync(fd); }
  }
  record(value) {
    mkdirSync(dirname(this.ledger), { recursive: true });
    appendFileSync(this.ledger, JSON.stringify({ at: new Date().toISOString(), botId: this.botId, threadId: this.threadId, ...value }) + '\n', { mode: 0o600 });
  }
  lock() {
    // All helper MCP processes for a job share this private lock, outside model-visible files.
    mkdirSync(dirname(this.ledger), { recursive: true });
    const target = this.ledger + '.lock'; let fd;
    try { fd = openSync(target, 'wx', 0o600); }
    catch (error) { if (error.code === 'EEXIST') throw new Error('Another helper is saving or validating this work folder. Retry after it finishes; an interrupted lock must be archived by the local operator.'); throw error; }
    writeFileSync(fd, JSON.stringify({ pid: process.pid, at: new Date().toISOString() }) + '\n');
    return () => { closeSync(fd); const folder = join(this.archive, '_locks'); mkdirSync(folder, { recursive: true }); renameSync(target, join(folder, randomUUID() + '.json')); };
  }
  list() {
    this.assertRoot();
    const files = [];
    const visit = (folder, depth = 0) => {
      if (depth > 8) return;
      for (const entry of readdirSync(folder, { withFileTypes: true })) {
        if (files.length >= 100) return;
        if (entry.name.startsWith('.') || blocked.test(entry.name) || entry.isSymbolicLink()) continue;
        const target = join(folder, entry.name);
        if (entry.isDirectory()) visit(target, depth + 1);
        else if (entry.isFile() && extensions.has(extname(entry.name).toLowerCase())) {
          const path = relative(this.root, target).replaceAll('\\', '/');
          try { this.target(path); const bytes = this.bytes(target); files.push({ path, bytes: bytes.length, sha256: hash(bytes) }); } catch {}
        }
      }
    };
    visit(this.root); return { files, limit: 100 };
  }
  read(path) { const target = this.target(path); const bytes = this.bytes(target); return { path, content: bytes.toString('utf8'), sha256: hash(bytes) }; }
  write(path, content, expected) {
    const release = this.lock();
    try { return this.writeUnlocked(path, content, expected); } finally { release(); }
  }
  writeUnlocked(path, content, expected) {
    if (typeof path !== 'string' || !extensions.has(extname(path).toLowerCase())) throw new Error('Only supported text files can be written.');
    if (typeof content !== 'string' || content.includes('\0') || Buffer.byteLength(content) > 64000 || expected !== null && (typeof expected !== 'string' || !/^[a-f0-9]{64}$/.test(expected))) throw new Error('Invalid content or expected_sha256.');
    // Check conflicts before creating any parent folders.
    let target;
    try { target = this.target(path); } catch (error) { if (error.message !== 'Parent directory does not exist.') throw error; if (expected !== null) throw new Error('Existing file not found.'); target = this.target(path, true); }
    const previous = existsSync(target) ? this.bytes(target) : null;
    if (previous ? hash(previous) !== expected : expected !== null) throw new Error('File changed or already exists; read it before replacing.');
    let archived = false;
    if (previous) {
      const folder = join(this.archive, randomUUID()); mkdirSync(folder, { recursive: true });
      writeFileSync(join(folder, 'previous.txt'), previous, { flag: 'wx', mode: 0o600 });
      writeFileSync(join(folder, 'receipt.json'), JSON.stringify({ path, sha256: hash(previous) }) + '\n', { flag: 'wx', mode: 0o600 });
      archived = true;
    }
    this.assertRoot(); this.target(path);
    if (previous ? hash(this.bytes(target)) !== expected : existsSync(target)) throw new Error('File changed before replacement.');
    const temp = join(dirname(target), '.companion-write-' + randomUUID());
    writeFileSync(temp, content, { flag: 'wx', mode: 0o600 });
    renameSync(temp, target);
    const sha256 = hash(this.bytes(target));
    this.record({ operation: 'write_file', path, sha256, before: previous ? hash(previous) : null, archived });
    return { path, sha256, bytes: Buffer.byteLength(content), archived, file: target.replaceAll('\\', '/'), link: `[${path}](${target.replaceAll('\\', '/')})` };
  }
  async check(path, check) {
    const release = this.lock();
    try { return await this.checkUnlocked(path, check); } finally { release(); }
  }
  async checkUnlocked(path, check) {
    const target = this.target(path), bytes = this.bytes(target), sha256 = hash(bytes);
    let result = { command: `${check}: ${path}`, exitCode: 0, stdout: '', stderr: '' };
    if (check === 'utf8') result.stdout = `Valid UTF-8, ${bytes.length} bytes; SHA-256 ${sha256}`;
    else if (check === 'json') { try { JSON.parse(bytes.toString('utf8')); result.stdout = 'JSON parsed successfully.'; } catch (error) { result.exitCode = 1; result.stderr = error.message; } }
    else if (check === 'javascript_syntax') {
      if (!['.js', '.mjs'].includes(extname(path))) throw new Error('JavaScript syntax validation requires .js or .mjs.');
      result = await new Promise(resolve => {
        const env = { PATH: dirname(process.execPath) }; for (const key of ['SYSTEMROOT', 'WINDIR']) if (process.env[key]) env[key] = process.env[key];
        const child = spawn(process.execPath, ['--check', target], { cwd: this.root, env, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], timeout: 5000 });
        let stdout = '', stderr = '';
        child.stdout.on('data', chunk => { stdout = (stdout + chunk).slice(0, 8000); }); child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(0, 8000); });
        child.once('error', error => resolve({ command: `node --check ${path}`, exitCode: -1, stdout, stderr: error.message }));
        child.once('close', code => resolve({ command: `node --check ${path}`, exitCode: code ?? -1, stdout: stdout || (code === 0 ? 'Syntax check passed; code was not executed.' : ''), stderr }));
      });
    } else throw new Error('Unsupported check.');
    this.target(path); if (hash(this.bytes(target)) !== sha256) throw new Error('File changed during validation.');
    this.record({ operation: 'check_file', path, sha256, ...result }); return { path, sha256, ...result };
  }
  async call(name, args) {
    const tool = workspaceTools.find(tool => tool.name === name);
    if (!tool || !args || typeof args !== 'object' || Array.isArray(args) || Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key)) || tool.inputSchema.required.some(key => !Object.hasOwn(args, key))) throw new Error('Unknown tool or invalid arguments.');
    if (name === 'list_files') return this.list();
    if (name === 'read_file') return this.read(args.path);
    if (name === 'write_file') return this.write(args.path, args.content, args.expected_sha256);
    return this.check(args.path, args.check);
  }
}
