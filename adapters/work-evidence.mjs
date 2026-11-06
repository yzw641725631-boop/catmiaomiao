import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync } from 'node:fs';
import { extname, join, relative } from 'node:path';
import { lineDiff } from '../upstream/OpenMausBot/shared/line-diff.ts';
import { redactSecretsInText } from '../upstream/OpenMausBot/server/redact.ts';

const ALLOWED = new Set(['.md', '.txt', '.csv', '.json', '.js', '.mjs', '.ts', '.tsx', '.jsx', '.py', '.css', '.html', '.yaml', '.yml']);
const SKIP = new Set(['node_modules', '.git', '.venv', 'dist', 'build', '__pycache__', '.companion-evidence.json']);
export function captureFiles(root) {
  const files = new Map();
  const unavailable = [];
  let total = 0;
  function visit(folder, depth = 0) {
    if (depth > 8 || files.size >= 100) { unavailable.push('文件数量或目录深度达到上限'); return; }
    for (const name of readdirSync(folder)) {
      if (SKIP.has(name) || name.startsWith('.') || /(?:secret|credential|password|token|private[_-]?key)/i.test(name)) continue;
      const path = join(folder, name);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) { unavailable.push(relative(root, path)); continue; }
      if (stat.isDirectory()) { visit(path, depth + 1); continue; }
      if (!stat.isFile() || !ALLOWED.has(extname(name))) continue;
      if (stat.size > 64000 || total + stat.size > 2000000 || files.size >= 100) { unavailable.push(relative(root, path)); continue; }
      const text = readFileSync(path, 'utf8');
      if (text.includes('\0')) continue;
      const safe = redactSecretsInText(text);
      files.set(relative(root, path).replaceAll('\\', '/'), { text: safe, hash: createHash('sha256').update(text).digest('hex') });
      total += stat.size;
    }
  }
  visit(root);
  return { files, unavailable };
}

async function validateFixtureDocument(folder) {
  const code = `const fs=require('node:fs');const p=require('node:path');const t=fs.readFileSync(p.join(process.argv[1],'report.md'),'utf8');if(!t.startsWith('# ')||!t.includes('隔离演示')){console.error('文档结构验证失败');process.exit(1)}console.log('已读取实际 report.md；标题及演示标记校验通过。')`;
  return new Promise(resolve => {
    const child = spawn(process.execPath, ['-e', code, folder], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '', stderr = '';
    child.stdout.on('data', chunk => stdout += chunk);
    child.stderr.on('data', chunk => stderr += chunk);
    child.on('error', error => resolve({ command: '隔离验收：Node 读取 report.md 并校验结构', exitCode: -1, stdout, stderr: error.message }));
    child.on('close', exitCode => resolve({ command: '隔离验收：Node 读取 report.md 并校验结构', exitCode: exitCode ?? -1, stdout: stdout.slice(0, 8000), stderr: stderr.slice(0, 8000) }));
  });
}

export async function finishEvidence(job) {
  const after = captureFiles(job.folder);
  const files = [];
  for (const path of new Set([...job.before.files.keys(), ...after.files.keys()])) {
    const old = job.before.files.get(path), next = after.files.get(path);
    if (old?.hash === next?.hash) continue;
    const before = old?.text || '', text = next?.text || '';
    const diffLines = lineDiff(before, text);
    files.push({ path, before, after: text, status: !old ? 'added' : !next ? 'deleted' : 'changed', diff: [`--- ${path}`, `+++ ${path}`, ...diffLines.slice(0, 600), ...(diffLines.length > 600 ? ['[差异超过 600 行，后续未展示]'] : [])].join('\n') });
  }
  let tests = job.session.mode === 'fixture' && after.files.has('report.md') ? [await validateFixtureDocument(job.folder)] : [];
  if (job.session.mode === 'live') {
    const ledger = join(job.session.dataDir, '..', 'workspace-ledger', job.folder.split(/[\\/]/).at(-1) + '.jsonl');
    try {
      tests = readFileSync(ledger, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line))
        .filter(item => item.operation === 'check_file')
        .map(item => ({ command: item.command, exitCode: item.exitCode, stdout: item.stdout, stderr: item.stderr, path: item.path, sha256: item.sha256, current: after.files.get(item.path)?.hash === item.sha256 }));
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
  const skipped = [...job.before.unavailable, ...after.unavailable];
  return { threadId: job.threadId, files, tests, coverage: `${job.session.mode === 'fixture' ? '隔离演示：脚本模型写入实际文档，校验命令在本机执行。' : '仅包含本次指定目录内捕获的文本文件变化；未运行的测试不标记通过。'}${skipped.length ? ' 部分文件因大小、链接或范围限制未捕获。' : ''}` };
}
