# 同类助理功能缺口（2026-10-31）

对照对象：xAI Grok Bot 官方文档、Meta Muse 官方发布与维基条目、OpenMausBot 上游（本项目锁定 v0.1.121，最新 v0.1.135）、OpenClaw、Hermes Agent。本项目一侧按代码核对（`~/ws/projects/openmaus-assistant`，main dd6c012 之后），不凭记忆。

判定：已有 / 部分 / 缺。工作量：S 不到半天，M 半天到 2 天，L 超过 2 天。“上游已有”指 v0.1.121 服务端已经实现，我们只需在界面或适配层接出来。

## 缺口表（按对个人用户的价值排序）

| # | 功能 | 本项目 | 证据（我们 / 上游） | 上游已有 | 工作量 | 外部依赖 | 风险与注意 | 来源 |
|---|---|---|---|---|---|---|---|---|
| 1 | 对话里显示上游的特殊卡片：图表/表格/小部件、安全密钥卡、登录卡、通话卡 | 缺（会被直接过滤掉） | 我们 `app/src/projection.ts` displayMessages 只放行 text/options/digest/activity；上游 `shared/wire.ts:417` 还有 screen、connector、secret、signin、call、widget、compaction，`server/chat-widgets.ts`、`server/data/chart-compiler.ts` | 是 | M | 否 | 助理若发出密钥卡或登录卡，用户看不到，会一直等。实际是否触发【未核实】 | [Grok Bot 对话](https://docs.x.ai/grok-bot/chat-and-collaboration)、上游 v0.1.130 发布说明 |
| 2 | 搜索历史对话 | 缺 | 我们 app/src 没有搜索入口，server.mjs 白名单不含 /api/search；上游 `routes/threads.ts:385` GET /api/search，`message-db.ts` searchMessagesAsync | 是 | S–M | 否 | 只搜本机 | [Hermes 功能总览](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/overview.md) |
| 3 | 回复某条消息、表情回应 | 缺 | 我们 ChatMessage 只有“播放这条回复”；上游 `routes/bot-messages.ts` replyTo，`routes/reactions.ts`（👍👎❤️😂🎉👀，回应会作为反馈交给助理） | 是 | S–M | 否 | 无 | [Grok Bot 对话](https://docs.x.ai/grok-bot/chat-and-collaboration) |
| 4 | 对话里直接附带文件（PDF、文档） | 部分 | 我们 `imageAttachments.tsx:93` 只收 png/jpeg/webp/gif，文件靠“授权文件夹”；上游 `server/attachments.ts:90` 已收 application/pdf 等 | 是 | S–M | 否 | 文件经本地存储，不外传 | [Grok Bot 文件](https://docs.x.ai/grok-bot/files-and-results) |
| 5 | 每日简报与“需要你”汇总 | 部分 | 我们可用提醒/例行工作拼出来，没有现成简报；上游 `routes/today.ts` GET /api/today（todayReport），v0.1.123 “Chief keeps an eye on your day” | 是（数据接口） | M | 否（接邮箱更好） | 只汇总，不代发 | 上游 v0.1.123 发布说明、[Muse 发布](https://about.fb.com/news/2026/09/introducing-muse-personal-ai-agent/) |
| 6 | 通知中心与系统通知（窗口不在前台也能提醒） | 部分 | 我们只有提醒事件（ServicesDrawer `/companion/notifications/:id/read`），没用浏览器 Notification；上游 `routes/notifications.ts` /api/notifications、read-all，`server/notify.ts` | 是 | S–M | 否 | 需用户允许浏览器通知 | [Grok Bot 设置与通知](https://docs.x.ai/grok-bot/settings-and-notifications) |
| 7 | 发邮件前可编辑的草稿卡 | 部分 | 我们 `mail-mcp.mjs` 写操作要 allowWrites，再走审批卡，但审批卡不能改收件人和正文；Grok Bot 默认先出可编辑草稿 | 否（需自己做） | M | 需已接入的邮箱 | 正向降低误发 | [Grok Bot 对话](https://docs.x.ai/grok-bot/chat-and-collaboration) |
| 8 | 保存登录与密码库（助理只用不看） | 缺 | 我们无；上游 `routes/logins.ts`（“No answer ever carries a password”）、`login-store.ts`、`onepassword.ts`、`routes/sign-in-cards.ts` | 是 | M–L | 否（1Password 可选） | 涉及凭据，必须只在服务端，不进浏览器、日志、URL | [Grok Bot Vault](https://docs.x.ai/grok-bot/vault) |
| 9 | 主助理说话风格、头像 | 部分 | 我们有改名（assistant_rename_assistant），没有风格设置；头像是书房人物图，不可换 | 部分（soul、avatar 字段） | 风格 S，换人物 L | 换人物需生图 | 人物换图需重做资产 | [Muse 维基](https://en.wikipedia.org/wiki/Muse_(AI_agent))、[Grok Bot Bots](https://docs.x.ai/grok-bot/bots) |
| 10 | 例行工作的事件触发（邮件到达、网页变化、webhook） | 部分 | 我们 RoutinesPane / native-workflows 只有定时；上游 `routes/webhooks.ts`，v0.1.134 “Tell me when… without an AI running” | 部分（webhook 在 v121，监视在 v0.1.134） | M | 否 | webhook 只能本机回环 | [Grok Bot 技能与例行](https://docs.x.ai/grok-bot/skills-routines-and-automations) |
| 11 | 额度用完自动换备用模型 | 缺 | 我们只有同一服务的重试（model-retry、vision-retry）；上游 v0.1.132 “A usage limit no longer stops your bots” | 否（v0.1.132 起） | M（升级后 S） | 需第二个模型服务 | 无 | 上游 v0.1.132 发布说明、[Hermes 备用模型](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/overview.md) |
| 12 | 唤醒词（“你好，小X”免按键） | 缺 | 我们只有麦克风按钮和连续语音 | 否 | M–L | 端侧唤醒模型（有的要 key） | 麦克风常开，需明示和开关 | [Hermes 唤醒词](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/user-guide/features/overview.md) |
| 13 | 页面产物（仪表盘、报告页） | 缺 | 我们只有文档预览；上游 v0.1.122 起有页面卡片与版本 | 否（v0.1.122 起） | L | 公开分享需外部链接 | 只做本地预览，不发公开链接 | [Grok Bot 文件](https://docs.x.ai/grok-bot/files-and-results)、上游 v0.1.122/125 |
| 14 | 外部渠道（微信/Telegram/手机端） | 缺 | 我们只有本机网页；OpenClaw 支持 20 多种渠道，Muse 支持 WhatsApp，Grok Bot 支持 X Chat 和手机 | 【未核实】（v121 有 3 个 whatsapp 相关文件） | L | 需外部账号 | 外来消息是不可信输入 | [OpenClaw README](https://github.com/openclaw/openclaw/blob/main/README.md) |
| 15 | 图片/视频生成 | 缺 | 我们无 | 否 | M | 付费生图服务（ReachAI 是否提供【未核实】） | 费用 | [Grok Bot 文件](https://docs.x.ai/grok-bot/files-and-results) |
| 16 | 演示一次、保存成技能 | 缺 | 我们技能只能文字审阅启用 | 否（v0.1.134 仅 Mac） | L | 否 | 录屏内容隐私 | [Grok Bot 技能](https://docs.x.ai/grok-bot/skills-routines-and-automations) |

## 已有的（不用再做）

后台持续工作、回来汇报（works、goals、routines）；工作中补充与另开任务（10-31 已接通）；连续语音对话与打断（`continuousVoice.ts`、`useVoice.ts`）；回复朗读与语速/音色；观看并接管浏览器与电脑（NativeBrowserView、NativeComputerView）；记忆与撤销（memory journal revert）；偏好确认后保存；改名；技能与 MCP 导入；邮箱与日历读写（需显式允许写）；需要你确认的卡片。

## 不建议做

代购与支付（Muse 用 Stripe Link）、代打电话（Muse 曾被报道由人工代拨）、代发社交帖子（上游 v0.1.133 Postiz）。这些都以用户名义对外行动，费用和风险大，个人助理这一阶段不做。若以后要做，也必须每次先确认。

## 上游 v0.1.122–v0.1.135 与我们相关的新增

页面卡片与版本（122、125）、主助理每日简报（123）、用量页（123）、实时步骤一行与“Now”卡（131）、一键问答快捷键（131）、点选式问题卡（133）、额度用完换备用模型（132）、安全密钥卡扩展（132）、“到时告诉我”无需模型的监视（134）、按用户语言写过程说明（135）、偏好告诉主助理一次全队遵守（135）。大量条目是云端、团队、Mac 专属，与本项目无关。来源：<https://api.github.com/repos/milind-soni/OpenMausBot/releases>。

## 说明

- Grok Bot 文档页较大，只读取了对话、例行与技能、电脑与应用、设置、Bots、文件、Vault 七页的正文；其余页（手机、共享 Bot、团队）未读。
- Muse 只读了官方发布全文与维基“Features/Privacy”两节。
- 上游 v121 到 v135 有 1,555 个提交，未逐个查看，只看了 14 个版本的发布说明。
