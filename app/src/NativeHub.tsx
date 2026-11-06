import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowUpRight, BookOpen, Check, Globe2, LoaderCircle, Monitor, Plug, Plus, RefreshCw, X } from 'lucide-react';
import { post, request } from './api.ts';
import { RoutinesPane } from './RoutinesPane.tsx';
import { MailPane } from './MailPane.tsx';
import { GoalsPane, type GoalRow } from './GoalsPane.tsx';

export interface CapabilityBot {
  id: string;
  name: string;
  browser: boolean;
  computer: 'local' | 'browser' | 'off';
  mcpServers: string[];
  permissions?: { browser: 'ask' | 'full'; computer: 'ask' | 'full' };
}
interface McpServer {
  name: string;
  enabled: boolean;
  command?: string;
  args?: string[];
  url?: string;
  type?: string;
  auth?: string;
}
export interface CapabilityData {
  bots: CapabilityBot[];
  servers: McpServer[];
  browserEngine: string;
  computer: { state: string; ready: boolean; version?: string; error?: string };
}
interface Skill {
  name: string;
  description: string;
  enabled: boolean;
  source?: string;
  warnings?: string[];
}
interface SkillData {
  skills: Skill[];
  staged: Array<{ id: string; name: string; gist: string; action: string }>;
}
type Run = (action: () => Promise<unknown>, feedback?: string) => Promise<void>;

export function NativeHub({
  close,
  changed,
  viewBrowser,
  viewComputer,
  initialTab = 'skills',
  initialBotId,
  renderRow,
}: {
  close(): void;
  changed(): Promise<void>;
  viewBrowser(bot: CapabilityBot): void;
  viewComputer(bot: CapabilityBot): void;
  initialTab?: 'goals' | 'skills' | 'access';
  initialBotId?: string;
  renderRow?: (row: GoalRow) => ReactNode;
}) {
  const [data, setData] = useState<CapabilityData>(),
    [selected, setSelected] = useState(''),
    [tab, setTab] = useState<'skills' | 'mcp' | 'access' | 'routines' | 'mail' | 'goals'>(initialTab);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [feedback, setFeedback] = useState('');
  const dialog = useRef<HTMLElement>(null),
    submitting = useRef(false);
  useEffect(() => {
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.focus();
    return () => prior?.focus();
  }, []);
  useEffect(() => {
    if (!dialog.current?.contains(document.activeElement)) dialog.current?.focus();
  }, [busy, tab]);
  const load = async () => {
    const next = await request<CapabilityData>('/companion/capabilities');
    setData(next);
    setSelected((value) => (next.bots.some((bot) => bot.id === value) ? value : next.bots[0]?.id || ''));
  };
  useEffect(() => {
    let active = true;
    void request<CapabilityData>('/companion/capabilities')
      .then((next) => {
        if (active) {
          setData(next);
          setSelected(next.bots.some((bot) => bot.id === initialBotId) ? initialBotId! : next.bots[0]?.id || '');
        }
      })
      .catch((error) => active && setError(error.message));
    return () => {
      active = false;
    };
  }, []);
  const run: Run = async (action, message = '已保存。') => {
    if (submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError('');
    setFeedback('');
    try {
      await action();
      await load();
      await changed();
      setFeedback(message);
    } catch (error) {
      setError(error instanceof Error ? error.message : '操作未完成，请重试。');
    } finally {
      submitting.current = false;
      setBusy(false);
    }
  };
  const bot = data?.bots.find((bot) => bot.id === selected);
  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && !busy && close()}>
      <section
        className={`settings-drawer native-hub ${tab === 'goals' ? 'native-goals-hub' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="native-title"
        tabIndex={-1}
        ref={dialog}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            if (!busy) close();
          }
          if (event.key === 'Tab') {
            const controls = [
              ...(dialog.current?.querySelectorAll<HTMLElement>(
                'button:not(:disabled),input:not(:disabled),textarea:not(:disabled),select:not(:disabled),a[href]',
              ) || []),
            ];
            if (
              event.shiftKey &&
              (document.activeElement === controls[0] || document.activeElement === dialog.current)
            ) {
              event.preventDefault();
              controls.at(-1)?.focus();
            } else if (!event.shiftKey && document.activeElement === controls.at(-1)) {
              event.preventDefault();
              controls[0]?.focus();
            }
          }
        }}
      >
        <header className="drawer-header">
          <div>
            <span className="eyebrow">让助理学会更多</span>
            <h2 id="native-title">{tab === 'goals' ? '持续目标' : '技能与工具'}</h2>
          </div>
          <button className="icon-button" aria-label="关闭技能与工具" disabled={busy} onClick={close}>
            <X size={20} />
          </button>
        </header>
        <nav className="native-tabs" aria-label="技能与工具分类">
          {(
            [
              ['skills', '技能', BookOpen],
              ['mcp', '应用与工具', Plug],
              ['mail', '邮箱与日历', Globe2],
              ['access', '分配本领', Monitor],
              ['routines', '例行工作', RefreshCw],
              ['goals', '持续目标', BookOpen],
            ] as const
          ).map(([id, label, Icon]) => (
            <button
              key={id}
              className={tab === id ? 'active' : ''}
              aria-pressed={tab === id}
              onClick={() => {
                setTab(id);
                setFeedback('');
                setError('');
              }}
              disabled={busy}
            >
              <Icon size={16} />
              {label}
            </button>
          ))}
        </nav>
        <div className="settings-content native-content">
          {error && (
            <p className="feedback error" role="alert">
              {error}
            </p>
          )}
          {feedback && (
            <p className="feedback success" role="status">
              <Check size={15} />
              {feedback}
            </p>
          )}
          {!data ? (
            <div className="native-empty">
              {error ? (
                <button className="text-button" onClick={() => void run(load, '已重新连接。')}>
                  重新连接
                </button>
              ) : (
                <>
                  <LoaderCircle className="spin" size={22} />
                  <p>正在读取助理的本领…</p>
                </>
              )}
            </div>
          ) : (
            <>
              {(tab === 'skills' || tab === 'access') && (
                <label className="native-bot-select">
                  为哪位助理设置
                  <select
                    value={selected}
                    disabled={busy}
                    onChange={(event) => {
                      setSelected(event.target.value);
                      setFeedback('');
                      setError('');
                    }}
                  >
                    {data.bots.map((bot) => (
                      <option key={bot.id} value={bot.id}>
                        {bot.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {bot && tab === 'skills' && <SkillsPane key={bot.id} bot={bot} busy={busy} run={run} />}
              {tab === 'mcp' && <McpPane servers={data.servers} busy={busy} run={run} />}
              {tab === 'routines' && <RoutinesPane busy={busy} run={run} />}
              {tab === 'mail' && <MailPane busy={busy} run={run} />}
              {tab === 'goals' && <GoalsPane busy={busy} run={run} renderRow={renderRow} />}
              {bot && tab === 'access' && (
                <AccessPane
                  key={bot.id + JSON.stringify([bot.browser, bot.computer, bot.mcpServers, bot.permissions])}
                  bot={bot}
                  data={data}
                  busy={busy}
                  run={run}
                  viewBrowser={viewBrowser}
                  viewComputer={viewComputer}
                />
              )}
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function SkillsPane({ bot, busy, run }: { bot: CapabilityBot; busy: boolean; run: Run }) {
  const [listing, setListing] = useState<SkillData>(),
    [error, setError] = useState(''),
    [source, setSource] = useState(''),
    [text, setText] = useState('');
  const [adding, setAdding] = useState<'source' | 'text' | null>(null),
    [preview, setPreview] = useState<{ skill: Skill; text: string }>();
  const load = async () => setListing(await request<SkillData>(`/companion/skills/${bot.id}`));
  useEffect(() => {
    let active = true;
    void request<SkillData>(`/companion/skills/${bot.id}`)
      .then((value) => active && setListing(value))
      .catch((error) => active && setError(error.message));
    return () => {
      active = false;
    };
  }, [bot.id]);
  const mutate = (action: () => Promise<unknown>, message: string) =>
    run(async () => {
      await action();
      await load();
    }, message);
  return (
    <div className="native-section">
      <p className="native-intro">
        把常用的做法教给{bot.name}。技能会随助理保存，也可以直接在对话里说“把这套做法保存成技能”。
      </p>
      <div className="native-actions">
        <button
          className="secondary-button"
          disabled={busy}
          onClick={() => setAdding(adding === 'source' ? null : 'source')}
        >
          <Plus size={15} />从 GitHub 导入
        </button>
        <button className="text-button" disabled={busy} onClick={() => setAdding(adding === 'text' ? null : 'text')}>
          从文本添加
        </button>
        <button
          className="icon-button"
          aria-label="刷新技能"
          disabled={busy}
          onClick={() => void run(load, '技能已同步。')}
        >
          <RefreshCw size={15} />
        </button>
      </div>
      {adding && (
        <form
          className="native-form"
          onSubmit={(event) => {
            event.preventDefault();
            void mutate(async () => {
              await post(
                `/companion/skills/${bot.id}/${adding === 'source' ? 'import' : 'create'}`,
                adding === 'source' ? { source } : { text },
              );
              setSource('');
              setText('');
              setAdding(null);
            }, '已添加，阅读技能内容后即可启用。');
          }}
        >
          <label>
            {adding === 'source' ? 'GitHub 或 skills.sh 地址' : 'SKILL.md 内容'}
            {adding === 'source' ? (
              <input
                required
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder="https://github.com/…"
                disabled={busy}
              />
            ) : (
              <textarea
                required
                rows={10}
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder={'---\nname: weekly-notes\ndescription: 整理每周笔记\n---\n\n先整理结论，再列出待办。'}
                disabled={busy}
              />
            )}
          </label>
          <button className="primary-button" disabled={busy}>
            {busy ? '正在添加…' : '添加并查看'}
          </button>
        </form>
      )}
      {error && (
        <p className="feedback error" role="alert">
          {error}
        </p>
      )}
      {!listing ? (
        <p className="field-note">正在读取技能…</p>
      ) : !listing.skills.length ? (
        <div className="native-empty">
          <BookOpen size={25} />
          <h3>从一件常做的事开始</h3>
          <p>例如整理周报、规划行程，或按你的格式核对文档。</p>
        </div>
      ) : (
        <div className="native-list">
          {listing.skills.map((skill) => (
            <article className="native-item" key={skill.name}>
              <span className="native-item-mark">
                <BookOpen size={18} />
              </span>
              <div>
                <button
                  className="native-item-title"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const data = await request<{ text: string }>(`/companion/skills/${bot.id}/${skill.name}`);
                      setPreview({ skill, text: data.text });
                    }, '已打开技能内容。')
                  }
                >
                  {skill.name}
                </button>
                <p>{skill.description}</p>
                <small>
                  {skill.enabled ? '已启用' : '尚未启用'}
                  {skill.source ? ` · ${skill.source}` : ''}
                </small>
              </div>
              <button
                className="text-button"
                disabled={busy}
                onClick={() =>
                  skill.enabled
                    ? void mutate(
                        () =>
                          request(`/companion/skills/${bot.id}/${skill.name}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ enabled: false }),
                          }),
                        '技能已停用，内容仍保留。',
                      )
                    : void run(async () => {
                        const data = await request<{ text: string }>(`/companion/skills/${bot.id}/${skill.name}`);
                        setPreview({ skill, text: data.text });
                      }, '阅读后可以启用。')
                }
              >
                {skill.enabled ? '停用' : '审阅'}
              </button>
            </article>
          ))}
        </div>
      )}
      {preview && (
        <section className="native-preview">
          <div className="native-section-heading">
            <h3>{preview.skill.name}</h3>
            <button className="text-button" onClick={() => setPreview(undefined)}>
              收起
            </button>
          </div>
          {preview.skill.warnings?.map((warning) => (
            <p className="field-note" key={warning}>
              {warning}
            </p>
          ))}
          <pre>{preview.text}</pre>
          {!preview.skill.enabled && (
            <button
              className="primary-button"
              disabled={busy}
              onClick={() =>
                void mutate(async () => {
                  await request(`/companion/skills/${bot.id}/${preview.skill.name}`, {
                    method: 'PATCH',
                    body: JSON.stringify({ enabled: true }),
                  });
                  setPreview(undefined);
                }, '技能已启用，下次相关工作可以使用。')
              }
            >
              启用这项技能
            </button>
          )}
        </section>
      )}
      {!!listing?.staged.length && (
        <p className="field-note">还有 {listing.staged.length} 项技能提议等待处理，请在对应对话中查看内容与版本。</p>
      )}
    </div>
  );
}

function McpPane({ servers, busy, run }: { servers: McpServer[]; busy: boolean; run: Run }) {
  const [configuration, setConfiguration] = useState(''),
    [adding, setAdding] = useState(false),
    [probe, setProbe] = useState<
      Record<string, { ok: boolean; tools?: Array<{ name: string; description?: string }>; error?: string }>
    >({});
  const [signIn, setSignIn] = useState<{
    name: string;
    flowId: string;
    authorizationUrl: string | null;
    phase: string;
    message?: string;
  }>();
  useEffect(() => {
    if (!signIn || signIn.phase !== 'waiting') return;
    let active = true;
    const timer = setInterval(
      () =>
        void request<{ auth: Omit<NonNullable<typeof signIn>, 'name'> }>(
          `/companion/mcp/servers/${signIn.name}/sign-in/${signIn.flowId}`,
        )
          .then((result) => active && setSignIn({ name: signIn.name, ...result.auth }))
          .catch(() => {}),
      2000,
    );
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [signIn?.flowId, signIn?.phase]);
  return (
    <div className="native-section">
      <p className="native-intro">
        接入现成的 MCP 服务，让助理使用你选择的应用和工具。添加后测试连接，再到“分配本领”交给具体助理。
      </p>
      <button className="secondary-button" disabled={busy} onClick={() => setAdding(!adding)}>
        <Plus size={15} />
        添加工具连接
      </button>
      {adding && (
        <form
          className="native-form"
          onSubmit={(event) => {
            event.preventDefault();
            void run(async () => {
              JSON.parse(configuration);
              await post('/companion/mcp/servers/import', { json: configuration });
              setConfiguration('');
              setAdding(false);
            }, '已添加连接。请测试、启用，再分配给助理。');
          }}
        >
          <label>
            MCP 配置 JSON
            <textarea
              value={configuration}
              rows={9}
              required
              disabled={busy}
              onChange={(event) => setConfiguration(event.target.value)}
              placeholder={'{"mcpServers":{"example":{"url":"https://example.com/mcp"}}}'}
            />
          </label>
          <p className="field-note">支持标准 mcpServers 配置，服务地址或本机程序。密钥只保存在本地服务端。</p>
          <button className="primary-button" disabled={busy}>
            {busy ? '正在添加…' : '添加连接'}
          </button>
        </form>
      )}
      {!servers.length ? (
        <div className="native-empty">
          <Plug size={26} />
          <h3>连接你已经在用的工具</h3>
          <p>粘贴服务提供的 MCP 配置，保留原有助理和对话。</p>
        </div>
      ) : (
        <div className="native-list">
          {servers.map((server) => (
            <article className="native-item native-connection" key={server.name}>
              <span className="native-item-mark">
                <Plug size={18} />
              </span>
              <div>
                <h3>{server.name === 'personal_mail' ? '邮箱与日历' : server.name}</h3>
                <p>
                  {server.name === 'personal_mail'
                    ? '本机账户连接：邮件、日历与日程。账户授权在“邮箱与日历”中管理。'
                    : server.url || '本机工具服务'}
                </p>
                {server.name !== 'personal_mail' && server.command && (
                  <details>
                    <summary className="field-note">查看连接配置</summary>
                    <p>{[server.command, ...(server.args || [])].join(' ')}</p>
                  </details>
                )}
                <small>
                  {server.enabled ? '已启用' : '已停用'}
                  {server.auth === 'signed-in' ? ' · 已登录' : server.auth === 'needs-sign-in' ? ' · 需要登录' : ''}
                </small>
                <div className="native-actions">
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const result = await post<NonNullable<(typeof probe)[string]>>(
                          `/companion/mcp/servers/${server.name}/test`,
                          {},
                        );
                        setProbe((value) => ({ ...value, [server.name]: result }));
                      }, '连接测试已结束。')
                    }
                  >
                    测试连接
                  </button>
                  <button
                    className="text-button"
                    disabled={busy}
                    onClick={() =>
                      void run(
                        () =>
                          request(`/companion/mcp/servers/${server.name}`, {
                            method: 'PATCH',
                            body: JSON.stringify({ enabled: !server.enabled }),
                          }),
                        server.enabled ? '连接已停用。' : '连接已启用，可以分配给助理。',
                      )
                    }
                  >
                    {server.enabled ? '停用' : '启用'}
                  </button>
                  {server.url && (
                    <button
                      className="text-button"
                      disabled={busy}
                      onClick={() =>
                        void run(
                          async () => {
                            if (server.auth === 'signed-in')
                              await post(`/companion/mcp/servers/${server.name}/sign-out`, {});
                            else {
                              const result = await post<{ auth: Omit<NonNullable<typeof signIn>, 'name'> }>(
                                `/companion/mcp/servers/${server.name}/sign-in`,
                                {},
                              );
                              setSignIn({ name: server.name, ...result.auth });
                            }
                          },
                          server.auth === 'signed-in' ? '已退出登录。' : '请在服务页面完成登录。',
                        )
                      }
                    >
                      {server.auth === 'signed-in' ? '退出登录' : '登录'}
                    </button>
                  )}
                </div>
                {probe[server.name] && (
                  <div className="native-probe">
                    <p>
                      {probe[server.name].ok
                        ? `已连接，发现 ${probe[server.name].tools?.length || 0} 个工具。`
                        : probe[server.name].error}
                    </p>
                    {probe[server.name].tools?.map((tool) => (
                      <span key={tool.name} title={tool.description}>
                        {tool.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      {signIn && (
        <div className="native-preview">
          <h3>
            {signIn.name} ·{' '}
            {signIn.phase === 'waiting'
              ? '等待登录'
              : signIn.phase === 'succeeded'
                ? '已登录'
                : signIn.message || '登录未完成'}
          </h3>
          {signIn.phase === 'waiting' && signIn.authorizationUrl && (
            <a className="primary-button" href={signIn.authorizationUrl} target="_blank" rel="noreferrer noopener">
              前往服务登录
              <ArrowUpRight size={16} />
            </a>
          )}
          <p className="field-note">{signIn.message || '登录完成后会自动同步状态。'}</p>
        </div>
      )}
    </div>
  );
}

function AccessPane({
  bot,
  data,
  busy,
  run,
  viewBrowser,
  viewComputer,
}: {
  bot: CapabilityBot;
  data: CapabilityData;
  busy: boolean;
  run: Run;
  viewBrowser(bot: CapabilityBot): void;
  viewComputer(bot: CapabilityBot): void;
}) {
  const [browser, setBrowser] = useState(bot.browser),
    [computer, setComputer] = useState(bot.computer === 'local'),
    [servers, setServers] = useState(bot.mcpServers);
  const [permissions, setPermissions] = useState(
    bot.permissions || { browser: 'ask' as const, computer: 'ask' as const },
  );
  const choice = (kind: 'browser' | 'computer', enabled: boolean) => (
    <fieldset className="access-mode" disabled={busy || !enabled}>
      <legend>{kind === 'computer' ? '电脑' : '浏览器'}操作权限</legend>
      {(
        [
          ['ask', '每次询问', '执行前由你确认'],
          ['full', '完全允许', '此助理后续操作不逐次询问'],
        ] as const
      ).map(([value, label, note]) => (
        <label key={value} className={permissions[kind] === value ? 'selected' : ''}>
          <input
            type="radio"
            name={'permission-' + kind}
            value={value}
            checked={permissions[kind] === value}
            onChange={() => setPermissions((current) => ({ ...current, [kind]: value }))}
          />
          <span>
            <strong>{label}</strong>
            <small>{note}</small>
          </span>
        </label>
      ))}
    </fieldset>
  );
  return (
    <form
      className="native-section"
      onSubmit={(event) => {
        event.preventDefault();
        void run(
          () => post(`/companion/capabilities/bots/${bot.id}`, { browser, computer, mcpServers: servers, permissions }),
          '本领与操作权限已保存。',
        );
      }}
    >
      <p className="native-intro">为{bot.name}分配本领和操作权限。每位助理独立保存，可以随时改回询问。</p>
      <div className="native-permission">
        <Globe2 size={21} />
        <div>
          <h3>专用浏览器</h3>
          <p>打开网页、填写内容和整理结果，使用独立浏览器资料。</p>
          <label>
            <input
              type="checkbox"
              checked={browser}
              disabled={busy}
              onChange={(event) => setBrowser(event.target.checked)}
            />
            允许这位助理使用
          </label>
          {choice('browser', browser)}
          {browser && permissions.browser === 'full' && (
            <p className="permission-scope-note">
              保存后，{bot.name}可在专用浏览器中连续操作。接管浏览器仍会暂停助理输入。
            </p>
          )}
          {bot.browser && (
            <button type="button" className="text-button" onClick={() => viewBrowser(bot)}>
              查看浏览器
              <ArrowUpRight size={14} />
            </button>
          )}
        </div>
      </div>
      <div className="native-permission">
        <Monitor size={21} />
        <div>
          <h3>这台电脑</h3>
          <p>
            {data.computer.ready
              ? '驱动已连接，可以查看屏幕并在需要时接管。'
              : data.computer.error || '需要先准备本机驱动。'}
          </p>
          <button type="button" className="text-button" onClick={() => viewComputer(bot)}>
            {data.computer.ready ? '查看电脑' : '准备电脑连接'}
            <ArrowUpRight size={14} />
          </button>
          <label>
            <input
              type="checkbox"
              checked={computer}
              disabled={busy || !data.computer.ready}
              onChange={(event) => setComputer(event.target.checked)}
            />
            允许这位助理使用
          </label>
          {choice('computer', computer)}
          {computer && permissions.computer === 'full' && (
            <p className="permission-scope-note">
              保存后，{bot.name}可连续查看并操作这台电脑，不再逐步询问。此设置不授予其他助理或外部工具权限。
            </p>
          )}
        </div>
      </div>
      <div className="native-permission">
        <Plug size={21} />
        <div>
          <h3>已接入的应用与工具</h3>
          {!data.servers.length ? (
            <p>先在“应用与工具”添加连接。</p>
          ) : (
            data.servers.map((server) => (
              <label key={server.name}>
                <input
                  type="checkbox"
                  checked={servers.includes(server.name)}
                  disabled={busy || (!server.enabled && !servers.includes(server.name))}
                  onChange={(event) =>
                    setServers((current) =>
                      event.target.checked ? [...current, server.name] : current.filter((name) => name !== server.name),
                    )
                  }
                />
                {server.name === 'personal_mail' ? '邮箱与日历' : server.name}
                {!server.enabled ? ' · 已停用' : ''}
              </label>
            ))
          )}
        </div>
      </div>
      <p className="field-note">
        新权限用于后续操作；已经弹出的请求仍保留。助理忙碌时可以只改授权模式，增减工具需先停止当前工作。
      </p>
      <button className="primary-button" disabled={busy}>
        {busy ? '正在保存…' : '保存本领与权限'}
      </button>
    </form>
  );
}
