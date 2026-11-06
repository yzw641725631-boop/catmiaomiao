# 设计 Token

2026-10-31 最新：样式已合并为一套。所有 token 只在 `app/src/tokens.css` 定义（primitive、semantic、圆角 4/8/12/16/20/胶囊、字号 `--text-10`…`--text-28`），`app/src/app.css` 按区域引用，原来的 style/assistant-services/conversation-ui/team/native-hub/interaction-ui 六个文件已归档。全站最小字号 10px；首页字幕 18、输入 16、记录标题 20、小助理名 13、状态 11。下方各段是历史记录，数值以 tokens.css 为准；新增颜色先查 tokens.css，没有合适的再加 token，不在组件里写新色值。

2026-10-24 最新：按用户 Bot 截图落实三层交互，详见[降噪、权限与交互验收](../docs/降噪与权限交互验收_v1.0.md)和[本轮决策](voice-permissions-hierarchy-decision.md)。本段为当前规则，下方 10-23 及更早增量保留为历史；冲突处以本段为准。

局部 primitive：linen-50=#FBFAF7、bubble-neutral-100=#F0EEE9、bubble-sage-100=#E5E9DE、hairline=#E7E3DB；semantic：conversation-surface、conversation-text、conversation-rule；semantic assistant-message-fill/user-message-fill 分别映射 bubble primitive，component message-assistant/message-user 引用语义填充，助理气泡4/16px、用户16/4px，动态行无独立底卡。气泡正文14px/1.85、动态标题14px；日期/辅助10–11px。仅本项目对话、动态、详情和权限设置受影响，场景/人物不变，不是全站换色。

2026-10-23 当前对话表面：interaction-ui.css 的 primitive linen-50=#FBFAF7、ink-900=#302E29、ink-500=#8A857A、hairline=#E7E3DB；semantic conversation-surface/text/rule 分别引用对应 primitive。C02 外窗14px、用户气泡3/12px，C04输入12px，工作行无独立底卡；正文14px/1.95、用户正文13px/1.85，辅助文字10–11px。只影响本项目对话/工作/输入/团队，不替换人物场景。以下旧值是批准视觉基线，冲突处以此当前修订为准。

日期：2026-10-21。状态：review。当前值为批准视觉的实现起点，实际渲染后检查对比度。

2026-10-23 仅扩展对话阅读表面：primitive `paper-50=#FCFBF8`、`leaf-100=#E9EEE5`、`neutral-line=#E9E7E1`；semantic `chat-surface=paper-50`、`user-bubble=leaf-100`、`reading-divider=neutral-line`；component `chat-paper/chat-user/chat-line` 在 conversation-ui.css 使用。影响范围仅本项目对话、工作阅读与文档预览，人物/场景/设置主题沿用。当前正文 14px/1.9，文件正文 15px/2；用户气泡 16px 圆角，外窗 20px，任务行无独立卡片背景。旧 Token 表保留为整体视觉来源。

## Primitive

| Token | 值 |
|---|---|
| ivory-50 / 100 | `#FAF7F1` / `#F1EBE2` |
| stone-200 / 500 / 800 / 950 | `#D9D0C3` / `#857B6F` / `#403A33` / `#29251F` |
| sage-100 / 600 / 800 | `#E3E8DC` / `#66715A` / `#3E4C35` |
| amber-100 / 800 | `#F8E8CB` / `#82551E` |
| red-100 / 800 | `#F5E0DB` / `#913F32` |
| blue-100 / 800 | `#E1EAF0` / `#365B73` |

## Semantic

| Token | 用途 / 值 |
|---|---|
| background | `ivory-100`，场景图片缺失时仍可阅读 |
| surface | `ivory-50`，重要正文/审批使用不透明表面 |
| floating-surface | `rgba(250,247,241,.94)`，只用于非关键浮层 |
| text-primary / secondary | `stone-950` / `#62594F` |
| border | `rgba(64,58,51,.16)` |
| primary | `sage-800`，前景白色 |
| success / warning / danger / info | `sage-800` / `amber-800` / `red-800` / `blue-800` |
| disabled | 表面 `ivory-100` + 文字 `stone-500`，同时有禁用语义 |
| focus | `#365B73`，2px ring，外扩 3px |

状态同时有文字/图标，不只用颜色。普通正文目标对比度≥4.5:1；图标/控件边界≥3:1。字幕使用深色半透明衬底保证不同场景区域都可读，未验证前不只加细阴影。

## Component

| 组件 | Token 规则 |
|---|---|
| Button | 最小 44×44px；主按钮 primary；次按钮 surface+border；危险动作明确 danger 文案 |
| Input | surface、16px 字号、52px 最小高度、聚焦 ring；输入栏最大高度 140px |
| Timeline / Card | surface、20px 圆角、20px 内边距；工作卡 12px 圆角、16px 内边距 |
| Tag | 12px/18px 字体，图标+状态文字；不用纯发光点代替文本 |
| Drawer / Dialog | 不透明 surface；宽度受 viewport 约束；背景有遮罩，焦点收束 |
| Toast | 简短反馈，8px 圆角；错误与审批保留在相关卡片，不依靠短暂 toast |
| Navigation | 当前模式为清晰文字标签，44px 点击目标；不设置常驻侧栏 |
| Evidence table | 14px 字体、行高至少 40px；长文件名单行省略但可展开完整路径 |

字体：中文使用系统 `Microsoft YaHei`/`PingFang SC` 回退，西文 Segoe UI；代码使用 Cascadia Code/Consolas。正文 16/24px，次要正文 14/22px，面板标题 20/28px，字幕 20/30px；代码 13/20px。

间距：4/8/12/16/20/24/32/48px。圆角：8/12/20px，输入栏可以胶囊形。阴影：`0 12px 40px rgba(41,37,31,.10)`，不叠加彩色光晕。层级：场景0、人物10、常驻UI20、展开详情30、审批/设置50、toast60；人物不抢输入点击。

微交互 120ms，面板切换 220ms，人物状态切换 250ms，缓动 `cubic-bezier(.2,.7,.2,1)`。减少动态效果时关闭视差、缩放和循环动作；文本/状态立即到位。

默认画布 1920×1080，必须检查 1366×768 和 125% 缩放。移动端尚不在范围，未来单独制定触控密度与纵向布局，不直接缩小桌面界面。本轮为新项目 token，无其他页面迁移影响。
