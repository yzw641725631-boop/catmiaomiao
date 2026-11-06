# 工作区类个人助理调研（Muse / Grok Bot 式）

调研日期：2026-10-31（Asia/Shanghai）。方法：web_search + web_fetch 公开页面，未安装、未克隆、未登录。无法确认的内容标【未核实】。星数、推送时间为抓取当时所见的近似值。

## 第一部分：商业产品基线

### Meta Muse（2026-09 发布）

来源：[Muse 的设计思路](https://introducing.muse.ai/)（2026-09-08，Mona Sarantakos / Christine Awad，已抓取全文）。about.fb.com 发布稿本轮未再抓取，下文只依据设计文章。

决定性的界面/交互模式：

1. **一条长期主对话 + 旁聊**。主聊天是持续对话，可以打断、连发多个任务不必等回复；复杂主题另开“旁聊”保持独立上下文。
2. **聊天气泡分段**。因为助理会主动发消息、消息可能乱序到达，所以用气泡标出“一个想法结束、下一个开始”，不用无边界的长转录。
3. **自定义虚拟形象是核心**。用户为 Muse 创建形象、命名、定风格（示例形象 Veda）。**形象下方显示它正在处理的工作片段**；点形象打开完整动态记录和已批准的权限。
4. **“目标”选项卡**。长期任务按目标归组，显示分解后的计划与进度；可在选项卡里直接操作，也可在聊天中询问。
5. **确定性控制**。关键操作（发邮件、购物结账）用带明确“接受/拒绝”的结构化批准卡；凭证单独安全存储。默认放行普通浏览，只在难以撤销的操作前停下，避免“横幅盲区”。
6. **构件（Artifacts）**。行程、支出面板、学习指南等以富交互输出出现在聊天内，或作为聊天外的实时页面。
7. **“点子”选项卡与主动性**。根据目标和对话主动给建议；主动消息频率可调高/调低/关闭。
8. **透明度**：设置、权限界面、记忆文件均可直接阅读和编辑。

已在抓取页面中看到的官方图片（可直接引用）：

- 状态与动态视图：`https://introducing.muse.ai/_next/static/immutable/media/status.38zbywac8-xmc.png`
- 目标与进度：`https://introducing.muse.ai/_next/static/immutable/media/goals.0afs6w3eczjsr.png`
- 结账批准卡：`https://introducing.muse.ai/_next/static/immutable/media/checkout.0nx6hmfxq6ara.png`
- 构件示例（宽图）：`https://introducing.muse.ai/_next/static/immutable/media/artifacts.2gtkrb_-csikn.png`
- 点子/建议：`https://introducing.muse.ai/_next/static/immutable/media/ideas.03w1vqmflzqox.png`
- 虚拟形象 Veda：`https://introducing.muse.ai/_next/static/immutable/media/veda.3-ibej52-w941.png`
- 头图：`https://introducing.muse.ai/_next/static/immutable/media/hero_blog.2ucsn55_1djkw.png`

### xAI Grok Bot（2026-09 指南）

来源：[Grok Bot 101](https://x.ai/bot/guides/grok-bot-101)（2026-09-11，Matt Palmer，已抓取全文）。

决定性的界面/交互模式：

1. **“带电脑的同事”**。每个 bot 有一台云端持久电脑（桌面、文件系统、终端、应用）；点 bot 的窗口即可像远程桌面一样自己操作。
2. **交还桌面**。需要验证码/2FA 时 bot 把桌面交给用户；需要密码或 API Key 时发安全表单，而不是在聊天里要。
3. **bot = 三个字段**。名称、职位（Title）、描述（工作流程说明），可在聊天里或右上角设置里改；也能录屏教它一个流程。
4. **三种对话方式**：聊天；例行任务与触发器（自己排程或监听 Slack 线程、GitHub PR 等事件）；bot 之间互相发消息、互相触发。
5. **专家 bot + 群聊 + 链式协作**。多个 bot 拉进一个群聊；一个 bot 遇到判断题可以问“Chief of Staff”bot。
6. **自然语言权限 + 审查代理**。规则在 Settings > General > Agent 用文字写；独立审查代理对拟执行动作给出放行/拦截/升级给用户；配合允许/拦截列表。
7. **连接器**：支持与 Cursor 相同的 MCP、插件、技能；每种服务可接多个账号（个人/工作 Gmail、多个 Slack）。
8. 手机和桌面看到的是同一台云电脑。

已在抓取页面中看到的官方图片（media.x.ai CDN，可改 width 参数）：

- 云电脑：`https://media.x.ai/cdn-cgi/image/fit=scale-down,onerror=redirect,width=1280,height=800,f=auto/v1/website/grok-bot-guides-grok-bot-101-cloud-computer-b57bf80b.jpg`
- bot 结构：`https://media.x.ai/cdn-cgi/image/fit=scale-down,onerror=redirect,width=1280,height=800,f=auto/v1/website/grok-bot-guides-grok-bot-101-anatomy-2135357a.jpg`
- 设置：`https://media.x.ai/cdn-cgi/image/fit=scale-down,onerror=redirect,width=1280,height=800,f=auto/v1/website/grok-bot-guides-grok-bot-101-settings-211dc21a.jpg`
- 例行与触发：`https://media.x.ai/cdn-cgi/image/fit=scale-down,onerror=redirect,width=1280,height=800,f=auto/v1/website/grok-bot-guides-grok-bot-101-routines-3ee4464a.jpg`
- 权限规则：`https://media.x.ai/cdn-cgi/image/fit=scale-down,onerror=redirect,width=1280,height=800,f=auto/v1/website/grok-bot-guides-grok-bot-101-permissions-e0c14511.jpg`
- 多 bot 链：`https://media.x.ai/cdn-cgi/image/fit=scale-down,onerror=redirect,width=1280,height=800,f=auto/v1/website/grok-bot-guides-grok-bot-101-chain-8599ce17.jpg`

### 两者对本产品的共同启示

两者都不是“一个聊天框 + 侧边抽屉”：Muse 以**形象 + 主对话 + 目标/动态/点子选项卡 + 批准卡 + 构件**组织；Grok Bot 以**多个专家 bot + 每个 bot 一台可接管的电脑 + 例行/触发 + 群聊**组织。我们的产品已有主助理形象、小助理、目标、例行、浏览器/电脑，缺的主要是这些对象的**专门视图**（目标页、动态记录、批准卡、电脑画面、构件阅读器），而不是更多能力。

## 第二部分：开源候选（可能替换底座或整套参考）

（表头说明：许可、星数、最近推送均取自 2026-10-31 GitHub API 返回值。）

### 0. 现底座对照：milind-soni/OpenMausBot

- 仓库：https://github.com/milind-soni/OpenMausBot ；描述原文 “Open-source Grok Bot alternative with a virtual machine that bots can use”。
- 许可 Apache-2.0；约 8.5k 星；最近推送 2026-10-30；创建于 2026-08-11（不到 3 个月）；开放 issue 609；TypeScript，话题含 electron、expo、computer-use、docker。
- 意义：它本身就是“开源 Grok Bot”，与 Grok Bot 的 bot/电脑/例行/群聊模型一一对应。本地固定在 v0.1.121，上游此后仍在快速提交（bitdoze 2026-10-23 文章记为 0.1.124）。
- **上游自带一套完整、较精致的 React 19 + Vite + Tailwind CSS 界面**（README “Powered By”与架构表原文：App `src/` 为 chat shell，端口 5199；harness 在 127.0.0.1:8799，HTTP 命令 + 单条 SSE 流）。界面形态是 Telegram 式：左侧 bot 名册（可置顶/未读/右键菜单），中间对话，右侧 Computer 面板（实时屏幕预览、“Open desktop”接管、Cloud box / This Mac / Off 切换）；对话内有 Allow/Deny 审批卡与选择题卡、工具运行“活动芯片”、模型选择器（带厂商栏、不可用原因置灰）、Composio 应用市场、Triggers 页（日历 + 运行历史）、Channels（工作/个人/项目分频道）、语音朗读与通话（通话目前仅 macOS）、SupaMaus 光标吉祥物。
- Windows：官方提供 x64 安装包（未代码签名，SmartScreen 会提示）；本机电脑控制在 README 能力表中只列 macOS 与 Ubuntu Xorg【Windows 宿主控制的官方支持状态未在 README 表中列出，未核实；本项目文档记录固定版本已有 Windows Cua 0.28.2 接线】。
- 官方截图（README 内相对路径，换算为 raw 地址）：
  - 主界面：`https://raw.githubusercontent.com/milind-soni/OpenMausBot/main/docs/screenshots/hero.png`
  - 电脑面板：`https://raw.githubusercontent.com/milind-soni/OpenMausBot/main/docs/screenshots/computer-panel.png`
  - 审批卡：`https://raw.githubusercontent.com/milind-soni/OpenMausBot/main/docs/screenshots/approval-card.png`
  - 模型选择器：`https://raw.githubusercontent.com/milind-soni/OpenMausBot/main/docs/screenshots/model-picker.png`
  - 应用市场：`https://raw.githubusercontent.com/milind-soni/OpenMausBot/main/docs/screenshots/marketplace.png`
  - 第三方评测截图（bitdoze）：`https://www.bitdoze.com/_astro/grok-bot-alt-openmausbot.DX2KgNm4_4dEGo.webp`
- 结论：**保留为底座，并优先借它自己的 UI 组件**。理由：同一仓库、同一事件流、Apache-2.0，审批卡/电脑面板/模型选择器/Triggers 页都是现成的，且已经对接了本项目在用的原生 bot/goal/routine 事件；我们自建的前台与之并行，等于重造了一遍上游已有的视图。

### 1. OpenClaw（openclaw/openclaw）

- 仓库：https://github.com/openclaw/openclaw ，官网 https://openclaw.ai
- 许可 **MIT**；约 **39.3 万星**，fork 8.3 万；最近推送 2026-10-30；开放 issue 7934（量极大）。由独立 501(c)(3) OpenClaw Foundation 管理。
- 技术栈：TypeScript / Node（要求 Node 24.22.1+），pnpm workspace。Gateway 是本地控制面；**Control UI 为 Vite + Solid 单页**，由 Gateway 在 `:18789` 提供，走同端口 WebSocket。
- UI 风格：侧边栏“助理名册（roster）+ 会话列表”，主区聊天，右侧可停靠面板；Cmd/Ctrl+K 命令面板可拖文件新开后台会话。
- 已在文档读到的界面元素（docs.openclaw.ai/web/control-ui）：Side Chat（旁聊）、Activity 历史、审批队列、board/portal 文档、**MCP Apps 与 Canvas 内嵌渲染**、远程电脑查看器（可弹出画中画只读窗口观看远程电脑）、Skill Workshop、Memory / Dreaming、按助理切换的设置、自动会话命名、断线保留草稿。
- 能力覆盖：持久主助理 + 记忆（SOUL.md、MEMORY.md、Honcho、active memory）✔；多助理 / 并行专家通道 / 委派 ✔；Skills + ClawHub ✔；MCP + MCP Apps ✔；浏览器 ✔；电脑操作：文档有 Codex Computer Use 与远程桌面查看【Windows 本机电脑操作未核实】；例行（Cron/standing intents）✔；邮箱日历：官网称“整理收件箱、发邮件、管理日历” ✔（具体走插件/技能）；语音：companion app 与 node 提供 voice/Talk，另有电话、会议插件 ✔；形象：仅头像/肖像图，无人物驱动。
- Windows：有 Windows 10/11 x64/ARM64 桌面应用（v2026.9.8-1，官网标 Beta）和 PowerShell 一键安装。
- 图片：README 横幅 `https://raw.githubusercontent.com/openclaw/openclaw/main/docs/assets/openclaw-banner-dark.png`；Control UI 文档社交图 `https://docs.openclaw.ai/og/web/control-ui.png`；官网 og `https://openclaw.ai/og-image.png`。README 与官网首页**未见 Control UI 实际截图**【界面实拍未核实】。
- 结论：**可考虑替换底座（排名第一的候选）**。理由：MIT、生态和维护规模最大、Windows 有原生应用，且 Control UI 已有旁聊、审批队列、MCP Apps、远程电脑查看等我们正缺的视图；代价是整套 Gateway/会话/记忆模型完全不同，现有 adapters 与 OpenMausBot 原生 bot/goal/routine 投影需要重写，issue 量也说明稳定性要自己把关。

### 2. Hermes Agent（NousResearch/hermes-agent）

- 仓库：https://github.com/NousResearch/hermes-agent ，官网 https://hermes-agent.nousresearch.com
- 许可 **MIT**；约 **25.9 万星**；最近推送 2026-10-30；开放 issue 约 5.2 万（极高，含大量自动/社区提交，需警惕）。
- 技术栈：Python 主体（安装器拉 Python 3.14 + Node）；入口为 TUI、消息网关、以及 **Hermes Desktop（macOS 12+ / Windows 10/11 桌面应用）**。
- UI 风格：以终端 TUI 和聊天软件（Telegram、Discord、Slack、WhatsApp、Signal、Email）为主，桌面版为补充【Desktop 界面细节未核实，仅见宣传视频与预览图】。
- 能力覆盖：持久记忆 + 用户建模（Honcho）+ 跨会话检索 ✔；子代理并行 ✔；**自动生成并自我改进 Skills（agentskills.io 标准）** ✔；MCP ✔；浏览器自动化（含 Browser Use 云浏览器）✔；电脑操作：README 只链接社区 Linux computer-use MCP，**Windows 桌面操作未见** ✘；内置 cron 定时 ✔；邮件作为消息通道 ✔，日历【未核实】；语音：语音备忘转写、TTS ✔；形象 ✘。
- Windows：原生 PowerShell 安装 + Windows 桌面应用；README 提示 uv.exe 可能被杀软误报。
- 可迁移：`hermes import-agent openclaw/claude-code/codex/cursor` 可导入人格、记忆、技能。
- 图片：README 横幅 `https://raw.githubusercontent.com/NousResearch/hermes-agent/main/assets/banner.png`；官网桌面预览 `https://web-assets.nousresearch.com/marketing/73edac8eae57c8914e23605b9f0a7015d9d3fd26/assets/hermes-agent/desktop-preview.webp`；桌面演示视频 `https://hermes-assets.nousresearch.com/hermes-desktop.mp4`；功能图 `.../assets/hermes-agent/feature-delegate.webp`、`feature-memory.webp`。
- 结论：**仅作参考，不建议替换**。理由：记忆/技能自学习是强项，但界面主轴是终端和聊天软件、Python 栈与现有 React/Node 适配层不同、缺 Windows 电脑操作，换过来反而离“人物居中 + 工作区”的产品形态更远。

### 3. Eigent（eigent-ai/eigent）

- 仓库：https://github.com/eigent-ai/eigent ，官网 https://www.eigent.ai
- 许可 **Apache-2.0**（README 写明）；约 1.57 万星；最近推送 2026-10-30；开放 issue 252。
- 技术栈：前端 **React + Electron + TypeScript，Tailwind CSS、Radix UI、Lucide React、Framer Motion**，Zustand 状态，React Flow 画流程；后端 FastAPI + uv，多智能体框架 CAMEL。本地部署可完全离线（vLLM/Ollama/LM Studio）；快速开始模式会连其云端并要求注册。
- UI 风格：干净的三栏“Cowork”工作台。官网首页内嵌的界面样例（HTML 文本可读）显示：左栏 Home / Workspace / Files / Local Automations / Dispatch / Configuration 与置顶、会话列表；中栏是对话，回复里带“3 actions”折叠的工具步骤（Search web / Read page / Extract）、“Eigent is working…”状态和生成的文件卡片（.md、.csv）；输入框下有 Single Agent / “Ask me first”（审批模式）/ 模型档位选择；右栏分区为 Agents、Progress（勾选式步骤）、Execution Context、Skills、MCP & Tools、Files。
- 能力覆盖：单代理 + 多代理 Workforce 并行 ✔；Skills ✔；MCP ✔；内置浏览器与终端工具 ✔；定时自动化 ✔；持久主助理记忆【未核实，README 未强调】；电脑操作（桌面 GUI 控制）【未核实】；邮箱日历：靠 MCP【未核实】；语音 ✘；形象 ✘。
- Windows：桌面应用提供下载【具体 Windows 包未逐一核实】。
- 图片：README 头图 `https://eigent-ai.github.io/.github/assets/head.png`、`https://eigent-ai.github.io/.github/assets/banner.png`；官网产品图 `https://cdn.eigent.ai/product/agent-workspace-graphics/control.png`、`https://cdn.eigent.ai/product/agent-workspace-graphics/model.png`；社交缩略图 `https://www.eigent.ai/thumbnail.png`。
- 结论：**借鉴 UI（首选之一）**。理由：技术栈与我们最接近（React + Tailwind + Radix + Lucide + Framer Motion），右栏“Agents / Progress / Skills / MCP / Files”正是我们工作记录区缺的结构；后端是 Python/CAMEL，与 OpenMausBot 内核不兼容，不宜整体替换。

### 4. AionUi（iOfficeAI/AionUi）

- 仓库：https://github.com/iOfficeAI/AionUi ，官网 https://www.aionui.com
- 许可 **Apache-2.0**；约 3.39 万星；最近推送 2026-10-23；macOS / **Windows 10+** / Linux 安装包。
- 技术栈：Electron 前端（TypeScript）+ 独立后端仓库 AionCore（Rust，内置 aionrs 代理引擎）；本地 SQLite。
- UI 风格：桌面 Cowork 客户端，左侧会话/助理列表，中间对话，右侧**多标签预览面板**（PDF、Word、Excel、PPT、代码、Markdown、HTML、Diff 可直接预览，Markdown/代码/HTML 可编辑）；支持自定义 CSS 换肤；可并排多会话。
- 能力覆盖：内置代理 + 接入 20+ 外部 CLI 代理（Claude Code、Codex、Hermes、OpenClaw、Goose 等，经 ACP）✔；**Team 模式**：Leader 拆任务派给 Teammate，异步邮箱 + 共享任务板，每个代理独立审批弹窗、侧栏角标显示待审批 ✔；三层 Skills（内置/自定义/扩展）✔；MCP 统一管理 ✔；网页搜索 ✔，浏览器操作【未核实】；电脑操作 ✘（未见）；Cron 定时（cron/间隔/一次性，绑定会话，防休眠）✔；邮箱日历 ✘；手机端：WebUI + Telegram / 飞书 / 钉钉 / 微信 ✔；语音 ✘；形象 ✘；21 个内置助理（PPT/Word/Excel 等）。
- 图片（README 相对路径换算为 raw 地址，图片在 README 中可见）：
  - 主页：`https://raw.githubusercontent.com/iOfficeAI/AionUi/main/resources/homepage.png`
  - Team 模式动图：`https://raw.githubusercontent.com/iOfficeAI/AionUi/main/resources/AionUi_team.gif`
  - 预览面板动图：`https://raw.githubusercontent.com/iOfficeAI/AionUi/main/resources/preview.gif`
  - 定时任务：`https://raw.githubusercontent.com/iOfficeAI/AionUi/main/resources/alart-task.png`
- 结论：**借鉴 UI**。理由：Team 模式的“待审批角标 + 共享任务板”和多格式预览面板可以直接对应我们的小助理与成果；但它是“多 CLI 代理的外壳”，没有持久人格、语音、电脑操作，不适合作为个人助理底座。

### 5. LobeHub（lobehub/lobehub，原 LobeChat）

- 仓库：https://github.com/lobehub/lobehub ，默认分支 canary
- 许可：**LobeHub Community License（非 OSI 标准，Apache-2.0 加附加条款）**。原文：可不改源码商用；**基于 LobeChat 开发并分发衍生作品须向 LobeHub 取得商业许可**；贡献者同意其可收紧或放宽协议。README 徽章写 “apache 2.0”，与 LICENSE 文件不一致，应以 LICENSE 为准。
- 约 8.4 万星；最近推送 2026-10-30；开放 issue 1190。
- 技术栈：TypeScript，Next.js + Vite SPA，pnpm；配套 `@lobehub/ui` 组件库、`@lobehub/tts`（TTS/STT React Hooks）、`@lobehub/icons`。
- UI 风格：当前定位 “Chief Agent Operator”，精致的现代 Web 界面；README 列出 Agent Builder、Agent Groups（群组协作）、Pages（多代理共写文档）、Schedule、Project、Workspace、Personal Memory（白盒可编辑记忆）、IM Gateway。
- 能力覆盖：主助理 + 白盒记忆 ✔；Agent Groups ✔；Skills/插件（称 10,000+，含 MCP）✔；定时 ✔；浏览器/电脑操作 ✘（README 未提）；邮箱日历 ✘【未核实】；语音：lobe-tts 提供 TTS/STT ✔；形象 ✘（形象类在另一项目 Lobe Vidol，由另一路调研）。
- Windows：主要是 Web/Docker 自托管，桌面版【未核实】。
- 图片（README 中可见的 GitHub 附件）：横幅 `https://github.com/user-attachments/assets/5f78ae58-ed4f-4d38-8037-96109fbba58c`；功能图 `https://github.com/user-attachments/assets/89d1c402-a62b-4794-82ea-17e5ee1a6165`、`https://github.com/user-attachments/assets/e51526c6-e09c-4a5a-9cec-dcd3fd68a3a8`；协作配图 `https://hub-apac-1.lobeobjects.space/blog/assets/771ff3d30b9ef93e65e55021cc43d356.webp`。
- 结论：**仅作视觉参考；不要复制源码或换底座**。理由：界面审美是同类里最好的之一，但社区许可禁止未经授权分发衍生作品，且缺电脑/浏览器操作。如只想借组件，可单独评估 `@lobehub/ui` 的许可【未核实，需另查】。

### 6. Kortix CompanyOS（kortix-ai/suna，原 Suna）

- 仓库：https://github.com/kortix-ai/suna ，官网 https://kortix.com
- 许可：**Elastic License 2.0（ELv2，非 OSI 开源）**：禁止作为托管服务提供给第三方、禁止绕过 license key。另有白标许可要求独家使用 Platinum 计算。
- 约 2.0 万星；最近推送 2026-10-30。
- 技术栈：TypeScript，pnpm monorepo（apps/web、api、cli、desktop-electron、mobile、sandbox），Docker Compose 自托管。
- 定位已从 “Manus 式通用代理” 转为 **面向公司的 CompanyOS**：Agents / Skills / Drive / Connectors（3000+）/ Automations / Outcomes / 每会话一台云电脑 / 变更需人工审批。
- 与我们的匹配：多人、公司级、云沙箱为中心，不是个人陪伴助理；语音、形象、Windows 本机电脑操作均未见。
- 图片：README 演示动图 `https://raw.githubusercontent.com/kortix-ai/suna/main/apps/web/public/media/showcase/kortix-readme.gif`。
- 结论：**仅作参考**。理由：ELv2 许可 + 公司级多人定位，与个人本地助理方向不符；其 “Outcome → Plan → Work → Verify → Learn” 目标循环与独立校验代理的思路可借鉴到我们的目标页。

### 7. OpenWork（different-ai/openwork）

- 仓库：https://github.com/different-ai/openwork ，默认分支 dev，官网 https://openworklabs.com
- 许可：**目录分拆**。`ee/` 以外为 **MIT**（桌面应用与核心）；`ee/`（OpenWork Den 组织控制面）为 source-available 的 EE 许可，生产使用需订阅（≤5 人组织免费），每个 ee 版本两年后转 MIT；更早版本为 FSL-1.1-MIT。
- 约 2.43 万星；最近推送 2026-10-30；创建于 2026-01。
- 技术栈：Node 24 + pnpm 11；`apps/app` React UI、`apps/desktop` Electron 壳、`apps/server` openwork-server；底层代理是 OpenCode。macOS / Windows / Linux 桌面应用。
- UI 风格：Claude Cowork 式简洁桌面工作区，输入框内置模型选择器（固定/最近/按厂商分组）。
- 能力覆盖：本地文件上的代理工作 ✔；Skills 与 MCP（可团队共享）✔；Google Workspace / Microsoft 365 能力经 OpenWork MCP 提供 ✔（邮箱日历间接覆盖）；多代理、持久人格记忆、定时、电脑操作、语音、形象【均未在 README 看到】。
- 图片：`https://raw.githubusercontent.com/different-ai/openwork/dev/docs/images/model-picker.png`；桌面应用 `https://github.com/user-attachments/assets/66a8dd9b-5260-488c-957d-e54331e78c1c`；Den 控制面 `https://github.com/user-attachments/assets/033dbbfe-5661-4f7c-869c-46278406d6cc`。
- 说明：任务里给的 `accomplish-ai/openwork` 经 GitHub API 搜索未返回（可能已改名或迁移）【未核实】；搜索结果另有大量同名 fork（Xerus-ai/openwork 仅 35 星且 2026-01 后无推送，已排除）。
- 结论：**借鉴 UI（输入框/模型选择器/工作区布局）**。理由：React + Electron + MIT 核心，可直接参考组件；但它是“文件上的编码代理”，缺个人助理必需的持续人格、语音、例行与电脑操作。

### 8. Cherry Studio（CherryHQ/cherry-studio）

- 仓库：https://github.com/CherryHQ/cherry-studio
- 许可：**AGPL-3.0**（社区版）；需豁免须买商业许可。
- 约 5.31 万星；最近推送 2026-10-30；Windows / macOS / Linux 桌面 + iOS/Android 移动端。
- 技术栈：TypeScript（Electron 桌面）【前端框架细节未核实】。
- UI 风格：成熟的“AI 工作站”，浅色主题精致；多标签与独立窗口、快速助手、划词工具、主题库 + 自定义 CSS。README 截图覆盖 Agent 工作区、对话、模型设置、知识库、绘图。
- 能力覆盖：代理（独立指令/工作区/模型/工具权限）✔；文件、命令、**浏览器与电脑自动化工具** ✔（README 原文）；Skills + MCP ✔；定时任务 + 消息渠道 ✔；语音听写与 TTS（含本地模型）✔；知识库 ✔；多助理团队/子代理派遣【未核实】；邮箱日历 ✘；形象 ✘。
- 图片（README 内，相对路径换算）：`https://raw.githubusercontent.com/CherryHQ/cherry-studio/main/.github/images/readme/agent-light-en.webp`、`.../chat-light-en.webp`、`.../knowledge-light-en.webp`。
- 结论：**仅作视觉参考**。理由：界面完成度高、中文用户熟悉，但 AGPL-3.0 传染性强，抄组件源码会让我们的前端也受 AGPL 约束；底座也与 OpenMausBot 无关。

### 9. goose（aaif-goose/goose，原 block/goose）

- 仓库：https://github.com/aaif-goose/goose （2026-04 从 block/goose 迁出，现属 Linux 基金会 Agentic AI Foundation）
- 许可 **Apache-2.0**；约 5.6 万星；最近推送 2026-10-30。
- 技术栈：Rust 内核；桌面应用（macOS / Linux / **Windows**）+ CLI + API；15+ 模型厂商，经 ACP 复用 Claude/ChatGPT/Gemini 订阅；70+ MCP 扩展。
- UI 风格：简洁的单会话代理桌面应用【桌面界面细节未在 README 中看到截图】。
- 能力覆盖：MCP ✔；通用代理 ✔；持久人格/多助理/语音/形象/电脑操作【README 未提，未核实】；“recipes”可复用流程【来自搜索摘要，未核实】。
- 图片：README 无界面截图【未核实】。
- 结论：**仅作参考**。理由：MCP 生态与治理可靠，但定位是开发者通用代理，和我们“陪伴 + 派工 + 工作区”的个人助理距离远，且 Rust 内核与现有 Node 适配层不兼容。

### 10. UI-TARS Desktop / Agent TARS（bytedance/UI-TARS-desktop）

- 仓库：https://github.com/bytedance/UI-TARS-desktop
- 许可 **Apache-2.0**；约 3.95 万星；最近推送 2026-10-09；README 最新新闻停在 2025-11-05（Agent TARS CLI v0.3.0）。
- 技术栈：TypeScript；Agent TARS 为 CLI + Web UI（Node ≥ 22），UI-TARS Desktop 为 Electron 桌面应用。
- UI 风格：任务执行画面为主，左侧对话/步骤，右侧实时截图或浏览器画面；v0.3.0 加入 Event Stream Viewer。
- 能力覆盖：**电脑操作（本地/远程，Windows/macOS）** ✔，依赖 UI-TARS / Seed-VL 视觉模型；浏览器（GUI 视觉 / DOM / 混合）✔；MCP ✔；持久助理、多助理、例行、邮箱日历、语音、形象 ✘。
- 图片：README 横幅 `https://raw.githubusercontent.com/bytedance/UI-TARS-desktop/main/images/tars.png`；CLI 图 `https://agent-tars.com/agent-tars-cli.png`；演示视频 `https://github.com/user-attachments/assets/e0914ce9-ad33-494b-bdec-0c25c1b01a27`（本地操作）。
- 结论：**借鉴“电脑操作现场”视图**。理由：执行轨迹 + 实时画面的布局可直接参考做“电脑接管”面板；但它需要专门视觉模型，且是另一套执行循环，不能叠加到 OpenMausBot 上当底座。

### 11. Rakazo（elie222/rakazo）——本轮新发现，与 OpenMausBot 同类

- 仓库：https://github.com/elie222/rakazo ，官网 https://rakazo.com
- 许可 **Apache-2.0**；约 6.4k 星；创建于 2026-08-13；最近推送 2026-10-30；bitdoze 记 v0.3.3（2026-10-22），README 自称 beta。
- 技术栈：TypeScript，**React 19 + Vite + Tailwind CSS**，Electron 桌面 + Expo 移动端，Hono + oRPC，PostgreSQL + Prisma，Better Auth，Graphile Worker，模型经 Pi；电脑提供方 Docker / E2B / Daytona / CreateOS / Boat / 本机可信模式。
- UI 风格（bitdoze 截图说明）：左侧 bot 名册（Chief of Staff、Sales Outbound、Inbox Manager…），中间对话，右侧该 bot 的电脑画面、“Take control”按钮与它的 routines。
- 能力覆盖：持久 bot（各自会话、记忆、routines、历史）✔；委派同伴 bot / 临时子代理 ✔；**语音模式：朗读、听写、给 bot 打电话（ElevenLabs / OpenAI / Cartesia / Fish Audio）** ✔；浏览器、终端、文件、图形桌面 ✔；共享 Team Computer 与独立 Private Computer ✔；Composio / Pipedream / 远程 MCP / OpenAPI ✔（邮箱日历走连接器）；Skills（仓库有 agents/skills 目录）【产品内技能管理未核实】；形象 ✘；Windows 本机：需 Docker Desktop，“This computer”模式在本机跑 Compose【Windows 宿主 GUI 控制未核实】。
- 图片：README 头图 `https://raw.githubusercontent.com/elie222/rakazo/main/docs/readme-hero.png`；bitdoze 截图 `https://www.bitdoze.com/_astro/grok-bot-alt-rakazo.D4tnA8ic_ZE8cbd.webp`；演示视频 `https://github.com/user-attachments/assets/dccdeddb-2134-4a56-8eed-b2e591736b1c`。
- 结论：**可考虑替换底座（第二候选）**。理由：功能面与 Grok Bot 最接近且自带语音通话、私有电脑隔离、手机端，同为 React 19 + Tailwind；但依赖 Postgres + Worker + Docker 的服务器式架构，比 OpenMausBot 的单进程本地 harness 重得多，Windows 本机电脑控制也未见说明。

### 12. OpenBot（CopilotKit/OpenBot）

- 仓库：https://github.com/CopilotKit/OpenBot
- 许可 **MIT**；约 8.7k 星；创建于 2026-08-17；最近推送 2026-10-30。README 自称 “a template, not a product”（据 bitdoze 转述）。
- 技术栈：TypeScript，Bun 1.3+，Docker；代理通过 **AG-UI 协议** 接入（LangGraph、Mastra、CrewAI 等）；依赖 CopilotKit Intelligence（有免费/自托管）。
- UI 风格：Slack 式，左侧同事与线程，中间对话（可返回表格等**生成式 UI 组件**），右侧代理的实时浏览器画面。
- 能力覆盖：每个同事独立容器 + Chromium ✔；**策略网关**（CEL 规则、失败即拒、每次动作写审计）✔；MCP ✔；语音、形象、Windows 本机电脑操作 ✘；个人陪伴定位 ✘（偏企业）。
- 图片：bitdoze 截图 `https://www.bitdoze.com/_astro/grok-bot-alt-openbot.DlLS1nQ4_Z29wkrH.webp`【仓库 README 原图未单独抓取】。
- 结论：**借鉴 UI 与审批思路**。理由：聊天里直接渲染表格/组件 + 右侧实时画面 + 动作审计，是 Muse“构件 + 确定性控制”的开源实现；但它是企业模板，不是个人助理。

### 13. OpenHuman（tinyhumansai/openhuman）

- 仓库：https://github.com/tinyhumansai/openhuman
- 许可 **GPL-3.0**（强传染）；约 4.24 万星；最近推送 2026-10-30；话题含 tauri、rust、personal-ai、second-brain。
- 技术栈：Rust harness + **Tauri** 桌面应用；提供 .msi / .exe（Windows）。
- 能力（bitdoze 转述）：单一主助理 + 跨文件/仓库/应用的记忆（带引用）；控制真实 Chrome 与桌面应用，不可撤销操作前提示；Composio 119 个应用 + 触发器；14 个消息渠道；cron/事件工作流带审批；**可打断的实时语音代理**；本地模型。
- UI 风格：桌面应用带吉祥物形象、按住说话开关、任务面板列出研究/代码/工具步骤（bitdoze 截图说明）。
- 图片：`https://www.bitdoze.com/_astro/grok-bot-alt-openhuman.CtHKcwqi_Z1HJMTf.webp`【其中一张，未逐张核对对应关系】。
- 结论：**仅作参考**。理由：“一个主助理 + 语音 + 吉祥物 + 任务面板”最接近我们的人物陪伴方向，但 GPL-3.0 不能抄代码，Rust/Tauri 也与现栈不同；交互可作对照。

### 14. Paperclip（paperclipai/paperclip）

- 仓库：https://github.com/paperclipai/paperclip ；许可 **MIT**；约 10.9 万星；最近推送 2026-10-30。Node.js 24.11+ 服务端 + React UI。
- 定位：给已有代理（Claude Code、Codex、OpenClaw 等）建组织架构、预算、工单、审批与成本追踪；本身不是聊天助理。
- 图片：`https://www.bitdoze.com/_astro/grok-bot-alt-paperclip.60Tu_IXu_19XzFM.webp`【未逐张核对】。
- 结论：**仅作参考**。理由：预算上限与“谁花了多少”的看板可借鉴到小助理管理，但与个人助理主体验无关。

### 15. 其他快速排查

- **Khoj**（khoj-ai/khoj）：**AGPL-3.0**，约 3.79 万星，最近推送 2026-08-02（较慢）。个人“第二大脑”、文档问答、自定义代理、定时研究推送、语音。团队新项目 **Pipali**（khoj-ai/pipali，Apache-2.0，326 星，“电脑上的 AI 同事”）。结论：仅参考。
- **Letta**（letta-ai/letta）：Apache-2.0；README 写明 V1 服务器已退役，活跃代码迁到 **letta-ai/letta-code**（Apache-2.0，约 3.7k 星，TS，含 TUI、App Server、渠道）。强项是有状态长期记忆。结论：记忆机制参考，不作底座。
- **nanoMuse**（nano-muse/nanoMuse）：**GPL-3.0**，约 2.9k 星，**Swift**（苹果平台），自称 Meta Muse 的开源对应物（有名字和形象的单一代理，手机/电脑/网页共享一条对话）。Windows 不适用。结论：交互参考。
- **Comma**（AFK-surf/Comma）：**AGPL-3.0**，356 星，Elixir；“sessionless”常驻主动代理，含浏览器/电脑操作。结论：太新太小，仅参考。
- 其余“OpenGrokBot / HandBot / usefulbot”等克隆：星数 0–10，排除。
## 第三部分：UI 组件库（让 React 对话/智能体界面变好看）

共同前提：下列组件库大多建立在 **shadcn/ui + Tailwind CSS** 上，以“把源码复制进项目”的方式安装，Vite 项目也能用（复制的是 React 源码），但需要先引入 Tailwind 与 shadcn 初始化。现有前台是 React 19 + Vite + 手写 CSS（据项目 package.json，无 Tailwind），引入它们意味着样式体系要先统一。OpenMausBot 上游、Eigent、Rakazo 都已在用 Tailwind，这一步与生态方向一致。

| 组件库 | 许可 / 星数 / 最近推送 | 提供什么 | 与本项目的关系 |
|---|---|---|---|
| [assistant-ui](https://github.com/assistant-ui/assistant-ui) | MIT；约 1.28 万；2026-10-30 | Thread / Message / Composer / ThreadList / ActionBar 等原语；流式、自动滚动、重试、附件、Markdown、代码高亮、**语音听写**、快捷键、无障碍；**生成式 UI：工具调用渲染成 React 卡片、行内人工审批**；可接自定义 data-stream 后端 | **首选对话层**。可用 custom runtime 接现有 REST/SSE，不必用其云服务。README 截图：`https://raw.githubusercontent.com/assistant-ui/assistant-ui/main/.github/assets/demo-light.webp`（含审批卡）、`.../generative-ui-light.png`、`.../anatomy-light.webp` |
| [Tool UI](https://github.com/assistant-ui/tool-ui) | MIT；**已归档（只读）**；最后推送 2026-08-31 | 审批、计划、表格、选项等工具结果组件 | 只挑源码，不作依赖 |
| [AI Elements](https://github.com/vercel/ai-elements) | **Apache-2.0**（LICENSE 文件；API 显示 NOASSERTION）；约 2.5k；2026-10-14 | Conversation、Message、代码块、推理展示等 | **README 警告：2026 年 11 月底弃用，迁往 shadcn/ui 官方 AI Elements**；且要求 Next.js + AI SDK。不建议新接入，等 shadcn 版 |
| [prompt-kit](https://github.com/ibelick/prompt-kit) | MIT；约 3.1k；2026-09-28 | shadcn 风格的 PromptInput、消息、推理、工具等 AI 组件 | 输入框、消息气泡的轻量替代品，可单个复制 |
| [ElevenLabs UI](https://github.com/elevenlabs/ui) | MIT；约 2.4k；2026-10-16 | **Orb（语音球）、波形、语音代理、音频播放器**等音频/代理组件，shadcn 注册表安装 | **适合补“正在听 / 正在说”的视觉反馈**，与现有 Fish Audio TTS 无冲突（组件只负责显示）。README 头图：`https://github.com/user-attachments/assets/a5b73bfc-b0a3-4b4e-8915-f90a086c5723` |
| [LiveKit agent-starter-react](https://github.com/livekit-examples/agent-starter-react) | MIT；约 960；2026-10-30 | Next.js 语音代理前端：实时语音、转写、摄像头、屏幕共享、**5 种音频可视化（bar/grid/radial/wave/aura）**、**虚拟形象集成**、明暗主题 | 可借可视化与“欢迎页 → 会话页”切换；完整使用需 LiveKit 服务，不必整体接入。头图：`https://raw.githubusercontent.com/livekit-examples/agent-starter-react/main/.github/assets/readme-hero-light.webp` |
| [CopilotKit](https://github.com/CopilotKit/CopilotKit) | MIT；约 3.84 万；2026-10-30 | 代理前端栈与生成式 UI，AG-UI 协议制定方 | 偏框架，需配合其运行时；OpenBot 即基于它。参考为主【组件细节本轮未展开核实】 |
| [MCP-UI](https://github.com/MCP-UI-Org/mcp-ui) | Apache-2.0；约 5.2k；2026-09-16 | 在宿主里渲染 MCP 返回的 UI 资源 | 对应 Muse “构件”；与上一轮研究结论一致 |
| [@lobehub/ui](https://github.com/lobehub/lobe-ui) | **MIT**（组件库本身，与 LobeHub 主仓库许可不同）；约 2.2k；2026-10-30 | LobeHub 同款 AIGC 组件，基于 antd | 视觉精致，但依赖 antd，与 shadcn/Tailwind 路线不同，二选一 |

## 结论排名

### “换底座”前三（前提：真要换的话）

1. **OpenClaw** — MIT、39 万星、基金会治理、Windows 原生应用；Control UI 已有旁聊、审批队列、MCP Apps/Canvas、远程电脑画中画、Skill Workshop。代价：Gateway/会话/记忆模型完全不同，现有 adapters 基本重写；Solid 前端与我们的 React 不通用；issue 7900+。
2. **Rakazo** — Apache-2.0，功能形态最像 Grok Bot，且自带语音通话、私有电脑、手机端，React 19 + Tailwind。代价：beta；Postgres + Worker + Docker 的服务器架构，比本地单进程重；Windows 本机电脑控制未见说明。
3. **Hermes Agent** — MIT、26 万星、自学习技能与长期记忆最强，有 Windows 桌面版。代价：Python、以终端和聊天软件为主界面，没有 Windows 电脑操作，离“人物 + 工作区”最远。

结论：**不建议换**。现底座 OpenMausBot 本身就是“开源 Grok Bot”，Apache-2.0、TypeScript、React 19 + Tailwind、有 Windows 安装包和 Cua 电脑操作，能力面不比上面三者少；本项目已围绕其原生 bot/goal/routine/approval 投影写了大量适配。换底座的收益主要是生态规模，不是 UI。

### “借 UI”前三

1. **OpenMausBot 上游自带界面** — 同仓库、同事件流、Apache-2.0：审批卡、电脑面板（实时预览 + 接管）、模型选择器、Triggers 日历、活动芯片都现成，最省接线。
2. **Eigent** — React + Tailwind + Radix + Lucide + Framer Motion，与我们栈最近；三栏布局里右栏 “Agents / Progress / Skills / MCP / Files” 正好补我们右上工作记录的结构；Apache-2.0。
3. **assistant-ui（+ ElevenLabs UI 的 Orb/波形）** — MIT 组件库：对话、附件、行内审批、工具卡片渲染一次到位；Orb/波形补语音状态。可接自定义 SSE，不改内核。

视觉对照（只看不抄）：LobeHub（社区许可限制衍生分发）、Cherry Studio（AGPL）、AionUi（Team 模式待审批角标 + 多格式预览面板）、UI-TARS（电脑操作现场）、OpenBot（聊天内生成式表格 + 右侧实时画面）。Muse 自身的“形象下方显示正在做什么 / 点形象看完整动态 / 目标页 / 结账批准卡 / 构件”是最贴合我们“人物居中”方向的交互蓝本。

## 主要来源

[Muse 的设计思路](https://introducing.muse.ai/) · [Grok Bot 101](https://x.ai/bot/guides/grok-bot-101) · [OpenMausBot README](https://github.com/milind-soni/OpenMausBot) · [OpenClaw](https://github.com/openclaw/openclaw) 与 [Control UI 文档](https://docs.openclaw.ai/web/control-ui) · [Hermes Agent](https://github.com/NousResearch/hermes-agent) · [Eigent](https://github.com/eigent-ai/eigent) / [eigent.ai](https://www.eigent.ai/) · [AionUi](https://github.com/iOfficeAI/AionUi) · [LobeHub](https://github.com/lobehub/lobehub) 与其 [LICENSE](https://github.com/lobehub/lobehub/blob/canary/LICENSE) · [Kortix](https://github.com/kortix-ai/suna) 与其 [LICENSE（ELv2）](https://github.com/kortix-ai/suna/blob/main/LICENSE) · [OpenWork](https://github.com/different-ai/openwork) · [Cherry Studio](https://github.com/CherryHQ/cherry-studio) · [goose](https://github.com/aaif-goose/goose) · [UI-TARS-desktop](https://github.com/bytedance/UI-TARS-desktop) · [Rakazo](https://github.com/elie222/rakazo) · [bitdoze：8 个开源 Grok Bot 替代（2026-10-23）](https://www.bitdoze.com/best-open-source-grok-bot-alternatives/) · [Open WebUI LICENSE](https://github.com/open-webui/open-webui/blob/main/LICENSE)（品牌保留条款：超过 50 名用户不得去除品牌，故未列为候选） · [assistant-ui](https://github.com/assistant-ui/assistant-ui) · [AI Elements](https://github.com/vercel/ai-elements) · [prompt-kit](https://github.com/ibelick/prompt-kit) · [ElevenLabs UI](https://github.com/elevenlabs/ui) · [LiveKit agent-starter-react](https://github.com/livekit-examples/agent-starter-react) · GitHub REST API（星数/许可/推送时间，2026-10-31 抓取）。
