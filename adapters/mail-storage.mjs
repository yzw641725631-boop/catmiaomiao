import { createRequire } from 'node:module';
import { randomBytes, createCipheriv, createDecipheriv, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const appRequire=createRequire(new URL('../app/package.json',import.meta.url));
export const mailRequire=createRequire(appRequire.resolve('mcp-ecc/package.json'));
export function assertMailLibrary(name,expected){if(createHash('sha256').update(readFileSync(mailRequire.resolve(name))).digest('hex')!==expected)throw new Error('邮箱连接库发生变化，请先复核适配后再启动。');}
assertMailLibrary('@mcp-ecc/storage-sqlite','4f67d04c2add4a6e3d6a7fc38d98f2b48ea338e5cb0d759955238e98419f12b5');
const {SQLiteStorage}=mailRequire('@mcp-ecc/storage-sqlite');
export const MAIL_OWNER='companion-local-owner';
export function mailKey(directory){mkdirSync(directory,{recursive:true});const file=join(directory,'encryption.key');if(!existsSync(file))writeFileSync(file,randomBytes(32),{flag:'wx',mode:0o600});const key=readFileSync(file);if(key.length!==32)throw new Error('邮箱连接的本地加密配置无效。');return key;}
export class MailStorage extends SQLiteStorage {
  constructor(directory){const key=mailKey(directory);super(join(directory,'accounts.db'),key.toString('hex'));this.localKey=key;}
  encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',this.localKey,iv);cipher.setAAD(Buffer.from('openmaus-mail-v1'));const bytes=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);return 'gcm1:'+Buffer.concat([iv,cipher.getAuthTag(),bytes]).toString('base64');}
  decrypt(value){if(!value)return '';if(!value.startsWith('gcm1:'))throw new Error('邮箱凭据不是当前已验证的格式。');const bytes=Buffer.from(value.slice(5),'base64'),decipher=createDecipheriv('aes-256-gcm',this.localKey,bytes.subarray(0,12));decipher.setAAD(Buffer.from('openmaus-mail-v1'));decipher.setAuthTag(bytes.subarray(12,28));return Buffer.concat([decipher.update(bytes.subarray(28)),decipher.final()]).toString('utf8');}
  async saveOAuthState(state,data){this.db.prepare('INSERT OR REPLACE INTO oauth_states (state,data) VALUES (?,?)').run(state,this.encrypt(JSON.stringify(data)));}
  async getOAuthState(state){const row=this.db.prepare('SELECT data FROM oauth_states WHERE state=?').get(state);return row?JSON.parse(this.decrypt(row.data)):null;}
  async saveAccount(account){return super.saveAccount({...account,credentials:{...account.credentials,config:{...account.credentials?.config,localHealth:account.health||'unknown',localCheckedAt:account.lastSyncAt||null}}});}
  mapAccount(row){const account=super.mapAccount(row),config=account.credentials?.config||{};return {...account,health:['healthy','unhealthy'].includes(config.localHealth)?config.localHealth:'unknown',...(typeof config.localCheckedAt==='number'?{lastSyncAt:config.localCheckedAt}:{})};}
}
