import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createBackgroundExecutable } from '../upstream/OpenMausBot/scripts/cua-windows-background.mjs';

const PROJECT = resolve(import.meta.dirname, '..');
const COMPONENTS = join(PROJECT, 'runtime', 'components', 'cua-driver-0.28.2');
const MANIFEST = join(COMPONENTS, 'component.json');
const PIN = { version: '0.28.2', archive: 'cua-driver-rs-0.28.2-windows-x86_64-binary.zip',
  zipSha256: '1f4bfceeab64cb7f56be7aad774c3dc2d2910d1427e4be1d79939c706e8029ba', binarySha256: 'dbbd52d75759900155fbf3d5f0a13c759a12d06ef17338b88b3f2b8b9c1ef8dc' };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const run = promisify(execFile), require = createRequire(join(PROJECT, 'upstream', 'OpenMausBot', 'package.json'));
const { createCuaConnectionStore } = require('./electron/cua-connection.cjs');

async function systemProxyArgs() {
  if(process.env.HTTPS_PROXY || process.env.https_proxy || process.env.ALL_PROXY || process.env.all_proxy)return [];
  try {
    const key='HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings';
    const enabled=await run('reg.exe',['query',key,'/v','ProxyEnable'],{windowsHide:true,timeout:5000});
    if(!/REG_DWORD\s+0x1\b/i.test(enabled.stdout))return [];
    const result=await run('reg.exe',['query',key,'/v','ProxyServer'],{windowsHide:true,timeout:5000});
    const raw=result.stdout.match(/REG_SZ\s+([^\r\n]+)/)?.[1]?.trim() || '';
    const address=raw.includes('=')?raw.split(';').find(value=>value.startsWith('https='))?.slice(6)||raw.split(';').find(value=>value.startsWith('http='))?.slice(5):raw;
    if(address && /^(?:[a-z0-9.-]+|\[[a-f0-9:]+\]):\d{1,5}$/i.test(address))return ['--proxy','http://'+address];
  }catch{}
  return [];
}

export async function ensureDesktopComponents(progress = () => {}, signal) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('当前本机接入只支持 Windows x64。');
  if (PIN.binarySha256 && existsSync(MANIFEST)) {
    const saved = JSON.parse(readFileSync(MANIFEST, 'utf8'));
    if (saved.version === PIN.version && [saved.binary, saved.background].every(path => typeof path === 'string' && resolve(path).startsWith(resolve(COMPONENTS) + '\\') && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink())) {
      const original = readFileSync(saved.binary);
      if (hash(original) === PIN.binarySha256 && hash(readFileSync(saved.background)) === hash(createBackgroundExecutable(original))) return saved;
    }
  }
  mkdirSync(COMPONENTS, { recursive: true });
  const stage = join(COMPONENTS, 'install-' + randomUUID()); mkdirSync(stage);
  const archivePath = join(stage, PIN.archive);
  progress('downloading');
  const url = `https://github.com/trycua/cua/releases/download/cua-driver-rs-v${PIN.version}/${PIN.archive}`;
  let bytes;
  const proxyArgs=await systemProxyArgs();
  const curl=()=>run('curl.exe', ['--location','--fail','--silent','--show-error','--retry','2','--retry-delay','2','--connect-timeout','15','--max-time','120',...proxyArgs,'--output',archivePath,url], { windowsHide:true,timeout:150000,maxBuffer:128*1024,signal });
  try {
    if(proxyArgs.length){await curl();bytes=readFileSync(archivePath);}
    else {
    const response = await fetch(url, { signal: AbortSignal.any([AbortSignal.timeout(120000),...(signal?[signal]:[])]), headers: { 'user-agent': 'OpenMausBot-companion-components' } });
    if (!response.ok) throw new Error(`官方驱动下载失败（HTTP ${response.status}）。`);
    bytes = Buffer.from(await response.arrayBuffer());
    }
  } catch {
    signal?.throwIfAborted();
    await curl();
    bytes=readFileSync(archivePath);
  }
  if (bytes.length > 150 * 1024 * 1024 || hash(bytes) !== PIN.zipSha256) throw new Error('驱动包完整性检查未通过。');
  if(!existsSync(archivePath)) writeFileSync(archivePath, bytes, { flag: 'wx' }); progress('installing');
  const unpack = join(stage, 'unpacked');
  await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Expand-Archive -LiteralPath $env:COMPANION_CUA_ARCHIVE -DestinationPath $env:COMPANION_CUA_UNPACK'], { windowsHide: true, timeout: 60000, signal, env: { ...process.env, COMPANION_CUA_ARCHIVE: archivePath, COMPANION_CUA_UNPACK: unpack } });
  const binary = join(unpack, 'cua-driver.exe'), original = readFileSync(binary), background = join(stage, 'cua-driver-background.exe');
  if (PIN.binarySha256 && hash(original) !== PIN.binarySha256) throw new Error('驱动程序完整性检查未通过。');
  writeFileSync(background, createBackgroundExecutable(original), { flag: 'wx' });
  const version = await run(binary, ['--version'], { windowsHide: true, timeout: 5000 });
  if (!version.stdout.includes(`cua-driver ${PIN.version}`)) throw new Error('驱动程序版本与 SDK 不匹配。');
  const manifest = { version: PIN.version, binary, background, originalSha256: hash(original), archiveSha256: PIN.zipSha256 };
  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', { mode: 0o600 });
  return manifest;
}

export class DesktopHost {
  constructor(rootDir) {
    this.directory = join(rootDir, 'live-harness', 'desktop-host');
    this.store = createCuaConnectionStore({ getUserData: () => this.directory });
    this.state = existsSync(MANIFEST) ? 'installed' : 'not-installed'; this.error = ''; this.host = null; this.client = null; this.starting = null; this.operation=null; this.generation=0; this.abort=null;
  }
  status() { return { state: this.state, ready: this.state === 'ready', version: PIN.version, ...(this.error ? { error: this.error } : {}) }; }
  async install() {
    if(this.operation) return this.operation;
    if(this.state==='ready') return this.status();
    this.abort=new AbortController(); const generation=++this.generation;this.error='';
    this.operation=(async()=>{try{await ensureDesktopComponents(state=>{if(generation===this.generation)this.state=state;},this.abort.signal);if(generation!==this.generation)throw new Error('准备已取消。');this.state='installed';return this.status();}catch(error){if(generation===this.generation){this.state='failed';this.error=error.message;}throw error;}finally{this.operation=null;}})();
    return this.operation;
  }
  async start() {
    if (this.starting) return this.starting;
    if(this.operation) await this.operation;
    if (this.host && this.state === 'ready') return this.status();
    this.starting = this.open();
    try { return await this.starting; } finally { this.starting = null; }
  }
  async open() {
    this.error = '';const generation=++this.generation;this.abort=new AbortController();const signal=this.abort.signal;
    try {
      const component = await ensureDesktopComponents(state => {if(generation===this.generation)this.state=state;},signal);signal.throwIfAborted();this.state='starting';
      const sdkRoot=realpathSync(join(PROJECT,'upstream','OpenMausBot','node_modules','@trycua','cua-driver'));
      if(JSON.parse(readFileSync(join(sdkRoot,'package.json'),'utf8')).version!==PIN.version)throw new Error('本机 CUA SDK 与固定驱动版本不一致。');
      const embedded = await import(pathToFileURL(join(sdkRoot,'dist','embedded.js')).href);
      const sdk = await import(pathToFileURL(join(sdkRoot,'dist','index.js')).href);
      signal.throwIfAborted();
      process.env.CUA_DRIVER_RS_TELEMETRY_ENABLED = '0'; process.env.CUA_DRIVER_RS_UPDATE_CHECK = 'false';
      const host = new embedded.EmbeddedCuaDriverHost(component.background, 'com.openmausbot.app'); this.host = host;
      const connection = await host.start({ signal: AbortSignal.any([signal,AbortSignal.timeout(25000)]) });signal.throwIfAborted();
      this.client = sdk.CuaDriver.connect(connection.socketPath);
      const catalog = JSON.parse(await this.client.listToolsJson({ signal: AbortSignal.any([signal,AbortSignal.timeout(8000)]) }));
      const tools = Array.isArray(catalog) ? catalog : catalog.tools;
      if (!Array.isArray(tools) || !tools.some(tool => tool.name === 'get_desktop_state')) throw new Error('驱动未返回兼容的工具目录。');
      signal.throwIfAborted();
      this.store.persist({ mode: 'embedded', status: 'ready', socketPath: connection.socketPath, mcpCommand: component.binary,
        mcpArgs: ['mcp','--embedded','--socket',connection.socketPath], mcpEnv: { CUA_DRIVER_EMBEDDED:'1',CUA_DRIVER_HOST_BUNDLE_ID:'com.openmausbot.app',CUA_DRIVER_RS_TELEMETRY_ENABLED:'0',CUA_DRIVER_RS_UPDATE_CHECK:'false' } });
      signal.throwIfAborted();this.state='ready'; return this.status();
    } catch (error) { if(generation===this.generation){await this.stop().catch(()=>{});this.state='failed';this.error=error.message;}throw error; }
  }
  async frame(signal) {
    if (!this.client || this.state !== 'ready') throw new Error('本机驱动尚未连接。');
    const result = await this.client.callTool('get_desktop_state', '{}', { signal: AbortSignal.any([AbortSignal.timeout(12000),...(signal?[signal]:[])]) });
    if (result.isError) throw new Error(result.text || '屏幕画面暂时不可用。');
    const image = result.images?.find(image=>['image/png','image/jpeg'].includes(image.mimeType));
    if (!image || image.dataBase64.length > 28 * 1024 * 1024) throw new Error('没有收到可显示的屏幕画面。');
    return { data:image.dataBase64,mime:image.mimeType,at:Date.now() };
  }
  async stop() {
    this.generation++;this.abort?.abort();this.abort=null;
    const client=this.client,host=this.host; this.client=null; this.host=null;
    client?.uniffiDestroy?.();
    if(host) { try { await host.stop(); } finally { host.uniffiDestroy?.(); } }
    this.store.persist({mode:'unavailable',reason:'desktop-host-stopped'}); this.state=existsSync(MANIFEST)?'installed':'not-installed';
    return this.status();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url) && process.argv.includes('--install')) console.log(JSON.stringify(await ensureDesktopComponents(state=>console.log(JSON.stringify({state})))));
