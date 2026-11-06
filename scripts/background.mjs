import { spawn } from 'node:child_process';
import { mkdirSync, openSync, closeSync, existsSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';

// Own only this development server. Stop through its stdin so the native
// harness, SQLite handles and model bridge close through their normal path.
const project = resolve(import.meta.dirname, '..'), runtime = join(project, 'runtime');
const archive = resolve(project, '../..', '归档/openmaus-assistant/background-service');
mkdirSync(runtime, { recursive: true }); mkdirSync(archive, { recursive: true });
const control = join(runtime, 'background-service.json'), stop = join(runtime, 'background-stop.json');
const id = randomUUID();
if (existsSync(control)) {
  const prior = JSON.parse(readFileSync(control, 'utf8'));
  let alive = false; try { process.kill(prior.supervisorPid, 0); alive = true; } catch {}
  if (alive) throw new Error('本项目后台服务已经运行，请先正常停止。');
  renameSync(control, join(archive, 'previous-' + id + '.json'));
}
let stopping = false, child, restartCount = 0, restartWindow = Date.now(), restartTimer;
const writeControl = () => writeFileSync(control, JSON.stringify({ id, supervisorPid: process.pid, serverPid: child?.pid || null, project, startedAt: new Date().toISOString(), restartCount }, null, 2) + '\n');
const spawnServer = () => {
  const stdout = openSync(join(runtime, 'background-stdout.log'), 'a'), stderr = openSync(join(runtime, 'background-stderr.log'), 'a');
  child = spawn(process.execPath, ['--experimental-strip-types', 'adapters/server.mjs'], { cwd: project, windowsHide: true, stdio: ['pipe', stdout, stderr] });
  closeSync(stdout); closeSync(stderr); writeControl();
  child.stdin.on('error', () => {});
  child.once('exit', code => {
    if (stopping) { if (existsSync(control)) renameSync(control, join(archive, 'ended-' + id + '.json')); process.exit(code || 0); }
    if (Date.now() - restartWindow > 10 * 60 * 1000) { restartWindow = Date.now(); restartCount = 0; }
    restartCount += 1;
    if (restartCount > 3 || existsSync(stop)) {
      if (existsSync(control)) renameSync(control, join(archive, 'crashed-' + id + '.json'));
      process.exit(code || 1);
    }
    const wait = Math.min(15000, 1000 * 2 ** (restartCount - 1));
    restartTimer = setTimeout(() => { restartTimer = undefined; if (!stopping) spawnServer(); }, wait);
  });
};
spawnServer();
const stopOwned = () => {
  if (stopping) return;
  stopping = true;
  if (restartTimer) clearTimeout(restartTimer);
  if (!child || child.exitCode !== null) {
    if (existsSync(control)) renameSync(control, join(archive, 'ended-' + id + '.json'));
    process.exit(0);
  }
  child.stdin.write('quit\n');
};
const timer = setInterval(() => {
  if (!existsSync(stop)) return;
  try { const input = JSON.parse(readFileSync(stop, 'utf8')); if (input.id !== id) return; renameSync(stop, join(archive, 'stop-' + id + '.json')); stopOwned(); } catch {}
}, 500);
process.on('SIGTERM', stopOwned); process.on('SIGINT', stopOwned);
