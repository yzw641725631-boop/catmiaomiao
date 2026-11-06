import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(project, 'app');
const output = path.join(project, 'evidence', 'app-checks-' + new Date().toISOString().replace(/[:.]/g, '-'));
await fs.mkdir(output, { recursive: true });
const tests = (await fs.readdir(path.join(app, 'tests'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => 'tests/' + name);
const stages = [
  ['typecheck', ['node_modules/typescript/bin/tsc', '--noEmit']],
  ['test', ['--experimental-strip-types', '--test', '--test-reporter=spec', ...tests]],
  ['build', ['node_modules/vite/bin/vite.js', 'build']],
];
const report = { date: new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()), timeZone: 'Asia/Shanghai', node: process.version, scope: 'isolated local contract checks; no real credentials or microphones', stages: [] };
let failed = false;
for (const [name, args] of stages) {
  if(name==='build'){const dist=path.join(app,'dist');try{await fs.access(dist);await fs.cp(dist,path.resolve(project,'../../归档/openmaus-assistant/app-builds',path.basename(output)),{recursive:true,errorOnExist:true,force:false});}catch(error){if(error.code!=='ENOENT')throw error;}}
  const start = performance.now();
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd: app, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = '';
    child.stdout.on('data', bytes => { log += bytes.toString('utf8'); });
    child.stderr.on('data', bytes => { log += bytes.toString('utf8'); });
    child.once('error', reject); child.once('exit', (exitCode, signal) => resolve({ exitCode, signal, log }));
  });
  await fs.writeFile(path.join(output, name + '.log'), result.log, 'utf8');
  report.stages.push({ name, args, exitCode: result.exitCode, signal: result.signal, elapsedMs: Math.round(performance.now() - start), log: name + '.log' });
  console.log(JSON.stringify({ stage: name, exitCode: result.exitCode, output }));
  if (result.exitCode !== 0) { failed = true; console.log(result.log); break; }
}
report.passed = !failed;
await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n', 'utf8');
process.exitCode = failed ? 1 : 0;
