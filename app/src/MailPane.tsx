import { useEffect, useState } from 'react';
import { ArrowUpRight, CalendarDays, Mail, Plus } from 'lucide-react';
import { post, request } from './api.ts';
interface Account {
  id: string;
  provider: string;
  name: string;
  email: string;
  status: string;
  health: string;
  allowWrites: boolean;
  lastSyncAt?: number;
  imapHost?: string;
  smtpHost?: string;
}
interface Flow {
  id: string;
  provider: string;
  state: string;
  url: string;
  error?: string;
  redirectUri?: string;
}
interface Data {
  accounts: Account[];
  flows: Flow[];
}
export function MailPane({
  busy,
  run,
}: {
  busy: boolean;
  run(action: () => Promise<unknown>, message?: string): Promise<void>;
}) {
  const [data, setData] = useState<Data>(),
    [adding, setAdding] = useState(false),
    [editing, setEditing] = useState(''),
    [provider, setProvider] = useState('imap'),
    [preset, setPreset] = useState('qq'),
    [name, setName] = useState(''),
    [email, setEmail] = useState(''),
    [password, setPassword] = useState(''),
    [imapHost, setImapHost] = useState('imap.qq.com'),
    [smtpHost, setSmtpHost] = useState('smtp.qq.com'),
    [clientId, setClientId] = useState(''),
    [clientSecret, setClientSecret] = useState(''),
    [tenantId, setTenantId] = useState('common'),
    [allowWrites, setAllowWrites] = useState(false),
    [error, setError] = useState(''),
    [tests, setTests] = useState<Record<string, number>>({});
  const load = () => request<Data>('/companion/mail').then(setData);
  useEffect(() => {
    let live = true;
    const read = () =>
      void request<Data>('/companion/mail')
        .then((value) => live && setData(value))
        .catch((e) => live && setError(e.message));
    read();
    const timer = setInterval(read, 2500);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <div className="native-pane">
      <p className="native-intro">
        把常用邮箱和日历交给助理。支持多个账户，凭据保存在本机；默认只读取，发送邮件或修改日程须另行允许，并经过任务确认。
      </p>
      <div className="native-mail-providers">
        <span>
          <Mail size={15} />
          QQ / 163 / 企业邮箱
        </span>
        <span>
          <CalendarDays size={15} />
          Outlook / Microsoft 365
        </span>
        <span>
          <CalendarDays size={15} />
          Gmail / Google Calendar
        </span>
      </div>
      {error && <p className="feedback error">{error}</p>}
      <div className="native-actions">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => {
            setEditing('');
            setAdding(!adding);
          }}
        >
          <Plus size={15} />
          {adding ? '收起' : '添加邮箱或日历'}
        </button>
      </div>
      {adding && (
        <form
          className="native-form"
          autoComplete="off"
          onSubmit={(event) => {
            event.preventDefault();
            void run(
              async () => {
                await post(editing ? '/companion/mail/' + editing + '/repair' : '/companion/mail', {
                  provider,
                  name,
                  email,
                  allowWrites,
                  ...(provider === 'imap' ? { password, imapHost, smtpHost } : { clientId, clientSecret, tenantId }),
                });
                setPassword('');
                setClientSecret('');
                setEditing('');
                setAdding(false);
                await load();
              },
              provider === 'imap' ? '账户已保存，请测试连接后分配本领。' : '登录入口已准备好，请在服务页面选择账户。',
            );
          }}
        >
          <label>
            服务
            <select
              value={provider}
              disabled={busy || !!editing}
              onChange={(event) => {
                setProvider(event.target.value);
                setPassword('');
                setClientSecret('');
              }}
            >
              <option value="imap">QQ / 163 / 标准 IMAP 邮箱</option>
              <option value="microsoft">Outlook / Microsoft 365</option>
              <option value="google">Gmail / Google Calendar</option>
            </select>
          </label>
          <label>
            账户名称
            <input
              required
              maxLength={100}
              readOnly={!!editing}
              value={name}
              disabled={busy}
              onChange={(event) => setName(event.target.value)}
              placeholder="私人邮箱 / 工作日历"
            />
          </label>
          <label>
            邮箱地址
            <input
              required
              type="email"
              readOnly={!!editing}
              value={email}
              disabled={busy}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          {provider === 'imap' ? (
            <>
              <label>
                邮箱类型
                <select
                  value={preset}
                  disabled={busy}
                  onChange={(event) => {
                    setPreset(event.target.value);
                    if (event.target.value === 'qq') {
                      setImapHost('imap.qq.com');
                      setSmtpHost('smtp.qq.com');
                    }
                    if (event.target.value === '163') {
                      setImapHost('imap.163.com');
                      setSmtpHost('smtp.163.com');
                    }
                  }}
                >
                  <option value="qq">QQ 邮箱</option>
                  <option value="163">163 邮箱</option>
                  <option value="custom">企业邮箱或其他</option>
                </select>
              </label>
              <label>
                IMAP 服务地址
                <input
                  required
                  value={imapHost}
                  disabled={busy}
                  onChange={(event) => setImapHost(event.target.value)}
                />
              </label>
              <label>
                SMTP 服务地址
                <input
                  required
                  value={smtpHost}
                  disabled={busy}
                  onChange={(event) => setSmtpHost(event.target.value)}
                />
              </label>
              <label>
                邮箱授权码
                <input
                  required
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  disabled={busy}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <p className="field-note">
                请先在邮箱设置开启 IMAP，填写服务生成的授权码。使用加密连接：IMAP 993 / SMTP 465。
              </p>
            </>
          ) : (
            <>
              <label>
                OAuth Client ID
                <input
                  required
                  value={clientId}
                  disabled={busy}
                  onChange={(event) => setClientId(event.target.value)}
                />
              </label>
              <label>
                {provider === 'google' ? 'OAuth Client Secret' : 'Client Secret（桌面公共客户端可留空）'}
                <input
                  type="password"
                  autoComplete="new-password"
                  required={provider === 'google'}
                  value={clientSecret}
                  disabled={busy}
                  onChange={(event) => setClientSecret(event.target.value)}
                />
              </label>
              {provider === 'microsoft' && (
                <label>
                  租户
                  <input
                    value={tenantId}
                    disabled={busy}
                    onChange={(event) => setTenantId(event.target.value)}
                    placeholder="common"
                  />
                </label>
              )}
              <p className="field-note">
                使用你自己的桌面 OAuth 客户端。
                {provider === 'google'
                  ? '在 Google Cloud 开启 Gmail 与 Calendar API，并将自己加入测试用户。'
                  : '在 Microsoft Entra 登记公共客户端或允许本地回调。'}
                保存后会显示本次回调地址和服务登录入口。
              </p>
            </>
          )}
          <label className="native-check">
            <input
              type="checkbox"
              checked={allowWrites}
              disabled={busy}
              onChange={(event) => setAllowWrites(event.target.checked)}
            />
            允许发送邮件和创建、修改日程
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? '正在准备…' : provider === 'imap' ? '保存到本机' : '准备服务登录'}
          </button>
        </form>
      )}
      {data?.flows.map((flow) => (
        <section className="native-preview" key={flow.id}>
          <h3>
            {flow.provider === 'google' ? 'Google' : 'Microsoft'} ·{' '}
            {flow.state === 'waiting'
              ? '等待你登录'
              : flow.state === 'exchanging'
                ? '正在保存授权'
                : flow.state === 'succeeded'
                  ? '授权已保存'
                  : '登录未完成'}
          </h3>
          {flow.state === 'waiting' && (
            <>
              <a className="primary-button" target="_blank" rel="noreferrer noopener" href={flow.url}>
                前往服务登录
                <ArrowUpRight size={15} />
              </a>
              <p className="field-note">本次回调地址：{flow.redirectUri}</p>
            </>
          )}
          {flow.error && <p className="field-note">{flow.error}</p>}
        </section>
      ))}
      {!data ? (
        <p className="field-note">正在读取账户…</p>
      ) : !data.accounts.length ? (
        <div className="native-empty">
          <Mail size={25} />
          <h3>还没有连接账户</h3>
          <p>添加后先测试连接，再把“邮箱与日历”分配给需要它的助理。</p>
        </div>
      ) : (
        <div className="native-list">
          {data.accounts.map((account) => (
            <article className="native-item" key={account.id}>
              <span className="native-item-mark">
                <Mail size={18} />
              </span>
              <div>
                <h3>{account.name}</h3>
                <p>{account.email}</p>
                <small>
                  {account.provider === 'imap'
                    ? '标准邮箱'
                    : account.provider === 'google'
                      ? 'Google 邮箱与日历'
                      : 'Microsoft 邮箱与日历'}{' '}
                  ·{' '}
                  {account.status === 'disabled'
                    ? '已停用'
                    : account.health === 'healthy'
                      ? '连接已验证'
                      : account.health === 'unhealthy'
                        ? '连接需检查'
                        : '已保存，待测试'}{' '}
                  · {account.allowWrites ? '允许发送与日程修改' : '只读取'}
                </small>
                <div className="native-actions">
                  <button
                    className="text-button"
                    disabled={busy || account.status !== 'active'}
                    onClick={() =>
                      void run(async () => {
                        const result = await post<{ folders: number }>(`/companion/mail/${account.id}/test`, {});
                        setTests((current) => ({ ...current, [account.id]: result.folders }));
                        await load();
                      }, '账户连接测试通过。')
                    }
                  >
                    测试连接
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        async () => {
                          await post(
                            `/companion/mail/${account.id}/${account.status === 'disabled' ? 'enable' : 'disable'}`,
                            {},
                          );
                          await load();
                        },
                        account.status === 'disabled' ? '账户已启用。' : '账户已停用，数据和授权仍保留。',
                      )
                    }
                  >
                    {account.status === 'disabled' ? '启用' : '停用'}
                  </button>
                  {account.provider === 'imap' && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() => {
                        setEditing(account.id);
                        setProvider('imap');
                        setPreset('custom');
                        setName(account.name);
                        setEmail(account.email);
                        setPassword('');
                        setImapHost(account.imapHost || '');
                        setSmtpHost(account.smtpHost || '');
                        setAllowWrites(account.allowWrites);
                        setAdding(true);
                      }}
                    >
                      更新授权码
                    </button>
                  )}
                  {account.provider !== 'imap' && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await post(`/companion/mail/${account.id}/reauth`, {});
                          await load();
                        }, '登录入口已准备好，请重新完成服务授权。')
                      }
                    >
                      重新登录
                    </button>
                  )}
                </div>
                {tests[account.id] !== undefined && (
                  <p className="field-note">已读取实际文件夹目录：{tests[account.id]} 个，未读取邮件正文。</p>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <p className="field-note">登录或授权码过期后，可以在账户旁重新授权；停用账户会保留本机配置。</p>
    </div>
  );
}
