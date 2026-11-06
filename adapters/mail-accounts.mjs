import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { MailStorage, MAIL_OWNER, mailRequire } from './mail-storage.mjs';
import { fail } from './endpoints.mjs';
const { OAuthManager } = mailRequire('@mcp-ecc/core');
const { ImapSmtpProvider } = mailRequire('@mcp-ecc/provider-imap-smtp');
const { GoogleProvider } = mailRequire('@mcp-ecc/provider-google');
const { MicrosoftProvider } = mailRequire('@mcp-ecc/provider-microsoft');
export const scopes = (provider, write) =>
  provider === 'google'
    ? [
        'openid',
        'email',
        `https://www.googleapis.com/auth/gmail.${write ? 'modify' : 'readonly'}`,
        `https://www.googleapis.com/auth/calendar.${write ? 'events' : 'readonly'}`,
      ]
    : [
        'openid',
        'email',
        'profile',
        'offline_access',
        'https://graph.microsoft.com/User.Read',
        `https://graph.microsoft.com/Mail.${write ? 'ReadWrite' : 'Read'}`,
        `https://graph.microsoft.com/Calendars.${write ? 'ReadWrite' : 'Read'}`,
        ...(write ? ['https://graph.microsoft.com/Mail.Send'] : []),
      ];
const safe = (row) => ({
  id: row.id,
  name: row.name,
  email: row.email,
  provider: row.provider,
  status: row.status,
  health: row.health,
  lastSyncAt: row.lastSyncAt,
  allowWrites: row.credentials?.config?.allowWrites === true,
  ...(row.provider === 'imap'
    ? { imapHost: row.credentials.config?.imapHost, smtpHost: row.credentials.config?.smtpHost }
    : {}),
});
export async function mailProvider(storage, account) {
  let credentials = { ...account.credentials };
  if (
    ['google', 'microsoft'].includes(account.provider) &&
    (!credentials.expiryDate || credentials.expiryDate < Date.now() + 90000)
  ) {
    if (!credentials.refreshToken) throw fail('登录已过期，请重新连接账户。', 409);
    const tokens = await new OAuthManager(storage).refreshToken(
      account.provider,
      account.id,
      credentials.clientId,
      credentials.clientSecret,
    );
    credentials = {
      ...credentials,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken || credentials.refreshToken,
      expiryDate: tokens.expiresAt,
    };
    await storage.saveCredentials(account.id, credentials);
  }
  if (account.provider === 'imap') {
    const provider = new ImapSmtpProvider(account.email, credentials);
    provider.smtpConfig.tls = { rejectUnauthorized: true };
    return provider;
  }
  if (account.provider === 'google') return new GoogleProvider(account.id, credentials);
  if (account.provider === 'microsoft') return new MicrosoftProvider(account.id, credentials);
  throw fail('尚未接入这种账户。');
}
export class MailAccounts {
  constructor(runtime) {
    this.runtime = runtime;
    this.directory = join(runtime.rootDir, 'mail-accounts');
    this.storage = null;
    this.flows = new Map();
    this.busy = false;
  }
  open() {
    return (this.storage ||= new MailStorage(this.directory));
  }
  async snapshot() {
    return {
      engine: 'mcp-ecc',
      version: '0.6.0',
      accounts: (await this.open().listAccounts(MAIL_OWNER)).map(safe),
      flows: [...this.flows.values()].map(({ id, provider, state, url, error, redirectUri }) => ({
        id,
        provider,
        state,
        url,
        error,
        redirectUri,
      })),
    };
  }
  validate(input) {
    if (
      !input ||
      !['imap', 'google', 'microsoft'].includes(input.provider) ||
      typeof input.email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.email) ||
      input.email.length > 254 ||
      typeof input.name !== 'string' ||
      !input.name.trim() ||
      input.name.length > 100 ||
      typeof input.allowWrites !== 'boolean'
    )
      throw fail('请填写账户名称、邮箱和服务类型。');
  }
  async repair(id, input) {
    const account = await this.open().getAccount(id);
    if (!account || account.ownerId !== MAIL_OWNER) throw fail('账户不存在。', 404);
    if (account.provider !== 'imap') throw fail('请使用重新登录。');
    return this.add(
      { ...input, provider: account.provider, name: account.name, email: account.email },
      { ...account, health: 'unknown', lastSyncAt: undefined },
    );
  }
  async ensureMcp() {
    const session = this.runtime.current;
    if (session?.mode !== 'live') throw fail('先连接真实模型，再使用邮箱与日历。', 409);
    const snapshot = await this.runtime.api(session, 'GET', '/api/mcp/servers');
    const spec = {
      command: process.execPath,
      args: [join(import.meta.dirname, 'mail-mcp.mjs')],
      env: { COMPANION_MAIL_DIRECTORY: this.directory },
    };
    const registered = snapshot.servers.find((row) => row.name === 'personal_mail');
    if (!registered)
      await this.runtime.capabilities.mcp('POST', '/servers/import', {
        json: JSON.stringify({ mcpServers: { personal_mail: spec } }),
      });
    await this.runtime.capabilities.mcp('PATCH', '/servers/personal_mail', { enabled: true });
  }
  async add(input, prior = null) {
    this.validate(input);
    if (this.busy) throw fail('正在添加账户，请稍后。', 409);
    this.busy = true;
    try {
      const storage = this.open();
      if (
        !prior &&
        (await storage.listAccounts(MAIL_OWNER)).some(
          (row) => row.email.toLowerCase() === input.email.toLowerCase() && row.provider === input.provider,
        )
      )
        throw fail('这个账户已经保存，请先使用已有连接。', 409);
      const account = prior
        ? { ...prior, updatedAt: Date.now() }
        : {
            id: randomUUID(),
            ownerId: MAIL_OWNER,
            name: input.name.trim(),
            slug: 'mail-' + randomUUID(),
            email: input.email.trim(),
            provider: input.provider,
            status: 'active',
            health: 'unknown',
            createdAt: Date.now(),
            updatedAt: Date.now(),
            credentials: { config: { allowWrites: input.allowWrites } },
          };
      if (input.provider === 'imap') {
        if (
          typeof input.password !== 'string' ||
          !input.password ||
          input.password.length > 4096 ||
          typeof input.imapHost !== 'string' ||
          !/^([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+$/.test(input.imapHost) ||
          typeof input.smtpHost !== 'string' ||
          !/^([a-zA-Z0-9-]+\.)+[a-zA-Z0-9-]+$/.test(input.smtpHost)
        )
          throw fail('请填写邮箱授权码和有效的 IMAP/SMTP 服务地址。');
        account.credentials = {
          appPassword: input.password,
          config: {
            allowWrites: input.allowWrites,
            imapHost: input.imapHost,
            imapPort: 993,
            imapTls: true,
            smtpHost: input.smtpHost,
            smtpPort: 465,
            smtpSecure: true,
          },
        };
        await storage.saveAccount(account);
        await this.ensureMcp();
        return { account: safe(account) };
      }
      if (
        typeof input.clientId !== 'string' ||
        !input.clientId.trim() ||
        input.clientId.length > 500 ||
        (input.provider === 'google' && (typeof input.clientSecret !== 'string' || !input.clientSecret)) ||
        input.clientSecret?.length > 1000 ||
        (input.tenantId && !/^(common|consumers|organizations|[a-f0-9-]{36})$/i.test(input.tenantId))
      )
        throw fail('请填写该服务的 OAuth 客户端配置。');
      const pending = [...this.flows.values()].find(
        (flow) =>
          flow.provider === input.provider &&
          flow.account.email === account.email &&
          ['waiting', 'exchanging'].includes(flow.state),
      );
      if (pending)
        return {
          flow: {
            id: pending.id,
            provider: pending.provider,
            state: pending.state,
            url: pending.url,
            redirectUri: pending.redirectUri,
          },
        };
      const flow = {
        id: randomUUID(),
        provider: input.provider,
        state: 'waiting',
        url: '',
        error: '',
        server: null,
        timer: null,
        account,
      };
      this.flows.set(flow.id, flow);
      const manager = new OAuthManager(storage);
      const listener = createServer(async (req, res) => {
        const address = new URL(req.url, flow.redirectUri);
        if (
          req.method !== 'GET' ||
          req.headers.host !== new URL(flow.redirectUri).host ||
          address.pathname !== '/oauth/callback' ||
          address.searchParams.get('state') !== flow.oauthState ||
          flow.state !== 'waiting'
        ) {
          res.writeHead(400);
          res.end('Invalid callback');
          return;
        }
        flow.state = 'exchanging';
        clearTimeout(flow.timer);
        try {
          if (address.searchParams.has('error')) throw new Error('登录未完成。');
          const code = address.searchParams.get('code');
          if (!code) throw new Error('没有收到授权结果。');
          const tokens = await manager.completeFlow(flow.oauthState, code);
          if (flow.state !== 'exchanging') throw new Error('登录已取消。');
          const identityResponse = await fetch(
            input.provider === 'google'
              ? 'https://openidconnect.googleapis.com/v1/userinfo'
              : 'https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName',
            { headers: { authorization: 'Bearer ' + tokens.accessToken }, signal: AbortSignal.timeout(15000) },
          );
          if (!identityResponse.ok) throw new Error('未能确认登录账户。');
          const identity = await identityResponse.json(),
            email = input.provider === 'google' ? identity.email : identity.mail || identity.userPrincipalName;
          if (
            typeof email !== 'string' ||
            email.toLowerCase() !== account.email.toLowerCase() ||
            (input.provider === 'google' && identity.email_verified !== true)
          )
            throw new Error('服务登录账户与填写地址不一致。');
          account.credentials = {
            clientId: input.clientId,
            clientSecret: input.clientSecret || '',
            accessToken: tokens.accessToken,
            refreshToken: tokens.refreshToken,
            expiryDate: tokens.expiresAt,
            tenantId: input.tenantId || 'common',
            isPublicClient: input.provider === 'microsoft' && !input.clientSecret,
            config: { allowWrites: input.allowWrites },
          };
          await storage.saveAccount(account);
          await this.ensureMcp();
          flow.state = 'succeeded';
          res.writeHead(200, {
            'content-type': 'text/html; charset=utf-8',
            'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'",
            'cache-control': 'no-store',
          });
          res.end(
            '<!doctype html><meta charset="utf-8"><title>登录已完成</title><h2>邮箱与日历已保存</h2><p>可以关闭此页，回到助理设置。请测试连接后分配给助理。</p>',
          );
        } catch {
          flow.state = 'failed';
          flow.error = '登录未完成，请核对 OAuth 客户端、回调地址和账户授权后重试。';
          res.writeHead(400, { 'content-type': 'text/plain;charset=utf-8' });
          res.end(flow.error);
        } finally {
          clearTimeout(flow.timer);
          listener.close();
        }
      });
      flow.server = listener;
      await new Promise((resolve, reject) => {
        listener.once('error', reject);
        listener.listen(0, '127.0.0.1', resolve);
      });
      flow.redirectUri = `http://127.0.0.1:${listener.address().port}/oauth/callback`;
      try {
        const started = await manager.startFlow(
          input.provider,
          'authorization_code',
          {
            provider: input.provider,
            clientId: input.clientId.trim(),
            clientSecret: input.clientSecret || '',
            redirectUri: flow.redirectUri,
            scopes: scopes(input.provider, input.allowWrites),
            tenantId: input.tenantId || 'common',
          },
          account.id,
        );
        flow.oauthState = started.state;
        flow.url = started.verificationUri;
      } catch {
        flow.state = 'failed';
        flow.error = '登录入口未能准备好，请核对客户端配置后重试。';
        listener.close();
        throw fail(flow.error, 502);
      }
      flow.timer = setTimeout(() => {
        flow.state = 'expired';
        flow.error = '登录已超时，请重新开始。';
        listener.close();
        void storage.deleteOAuthState(flow.oauthState);
      }, 10 * 60000);
      flow.timer.unref();
      return {
        flow: { id: flow.id, provider: flow.provider, state: flow.state, url: flow.url, redirectUri: flow.redirectUri },
      };
    } finally {
      this.busy = false;
    }
  }
  async action(id, action) {
    const storage = this.open(),
      account = await storage.getAccount(id);
    if (!account || account.ownerId !== MAIL_OWNER) throw fail('这项账户不存在。', 404);
    if (action === 'disable' || action === 'enable') {
      await storage.updateAccount(id, { status: action === 'enable' ? 'active' : 'disabled' });
      return { account: safe(await storage.getAccount(id)) };
    }
    if (action === 'reauth' && ['google', 'microsoft'].includes(account.provider)) {
      const credentials = account.credentials;
      return this.add(
        {
          provider: account.provider,
          name: account.name,
          email: account.email,
          allowWrites: credentials.config?.allowWrites === true,
          clientId: credentials.clientId,
          clientSecret: credentials.clientSecret,
          tenantId: credentials.tenantId || 'common',
        },
        account,
      );
    }
    if (action !== 'test') throw fail('账户操作无效。');
    if (account.status !== 'active') throw fail('请先启用账户。', 409);
    try {
      const provider = await mailProvider(storage, account),
        items = await provider.listFolders();
      await storage.updateAccount(id, { health: 'healthy', lastSyncAt: Date.now() });
      return { ok: true, folders: items.length };
    } catch {
      await storage.updateAccount(id, { health: 'unhealthy' });
      throw fail('账户连接未通过。请检查授权码、服务地址或重新登录，原始凭据不会显示在错误中。', 502);
    }
  }
  async close() {
    for (const flow of this.flows.values()) {
      clearTimeout(flow.timer);
      if (['waiting', 'exchanging'].includes(flow.state)) flow.state = 'cancelled';
      flow.server?.closeAllConnections();
      flow.server?.close();
    }
    if (this.storage) {
      await this.storage.close();
      this.storage = null;
    }
  }
}
