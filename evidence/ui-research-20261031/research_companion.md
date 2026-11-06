# 人物居中 / 语音陪伴类开源助理调研

调研日期：2026-10-31（Asia/Shanghai）。方法：web_search + web_fetch 读取 GitHub README / 官网 / GitHub API；未安装、未克隆、未运行。星数与推送时间为读取当时所见的近似值。未能直接确认的标【未核实】。

对照对象：openmaus-assistant 现状为暖色书房、居中成年女性（静态分层图，无口型）、右上对话/工作记录、左下小助理、底部语音/文字输入；底座 OpenMausBot，模型/ASR/TTS 走 ReachAI，本机 GTX 1070 8GB，Windows。

## 候选明细

### 1. Project AIRI（moeru-ai/airi）

- 仓库：https://github.com/moeru-ai/airi ；官网 https://airi.moeru.ai ；Steam https://store.steampowered.com/app/3885340/Project_AIRI/
- 许可：MIT（GitHub API 识别为 MIT）。注意内置 Live2D 示例模型另受 Live2D 许可约束【未逐一核实其模型目录】。
- 活跃度：GitHub API 2026-10-31 读取：约 50.9k 星、5.1k fork，pushed_at 2026-10-30；最新 release v0.14.1 发布于 2026-10-30（含 Windows x64 安装包、Android APK、mac）。Windows 可 `winget install MoeruAI.AIRI`。
- 技术栈：TypeScript monorepo，Vue（stage-ui），桌面版 stage-tamagotchi 为 Electron（2025-10 DevLog 写明迁移到 Electron），另有 stage-web（浏览器/PWA）与 stage-pocket（Capacitor 移动端）。README 架构图显示有 server-runtime（桌面服务通道）和可选托管后端（api-server/auth-server + PostgreSQL/Redis）。
- 形象：Live2D 与 VRM 都支持，自动眨眼、视线跟随、待机眼动；README 致谢 pixiv/ChatVRM。渲染走 WebGPU/Three.js，桌面版本地推理可用 CUDA（candle）。GTX 1070 8GB：Live2D/VRM 渲染本身属轻量 Web 图形，可跑【未实测】；本地 LLM/ASR 才吃显卡，可全部走云端 API。
- 语音：浏览器音频输入、客户端语音识别、客户端说话检测（VAD）；TTS 多家（ElevenLabs、Azure、OpenAI 兼容、阿里云百炼、本地 Kokoro）。子项目 webai-realtime-voice-chat 实现 VAD+STT+LLM+TTS。打断/全双工：README 未写明【未核实】。
- Agent 能力：能玩 Minecraft / Factorio、接入 Telegram / Discord；记忆为浏览器内 DuckDB WASM / pglite，长期记忆 "Memory Alaya" 仍 WIP；有 MCP Launcher 子项目，GitHub topics 含 "openclaw"，社区有 airi-openclaw fork。没有看到成体系的多智能体派工、技能审核、电脑/浏览器操作、邮箱日历——它的“工作”能力远弱于 OpenMausBot。
- Windows：官方安装包、winget、Scoop。
- 界面风格：二次元游戏感（README 写明 UI 参考 Cookard、UNBEATABLE 等游戏），桌宠式透明窗口，角色站在桌面上。
- 截图：README 只有 banner 和下载按钮。Steam 商店 API（appid 3885340，页面状态“即将推出”，Win/Mac/Linux）返回 7 张截图，例如：https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3885340/758ec6be2ec1810ae7d9e9c70ffcafc248b4f5ae/ss_758ec6be2ec1810ae7d9e9c70ffcafc248b4f5ae.1920x1080.jpg 、https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3885340/c7a817d584af07e198065303f9bc06c3f806b3eb/ss_c7a817d584af07e198065303f9bc06c3f806b3eb.1920x1080.jpg 、https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3885340/f71b17681312b0e59701f58d6d33e98746b43b25/ss_f71b17681312b0e59701f58d6d33e98746b43b25.1920x1080.jpg （本人未查看图片内容，只确认 URL 由 Steam API 返回）。
- 判断：**借形象层/参考**。理由：星数和更新频率在这一类里最高、MIT 许可、Live2D/VRM 渲染包（stage-ui-live2d / stage-ui-three）可单独参考；但它是 Vue 生态，本项目前台是 React，直接整包嵌入需要隔离（iframe 或 Web Component），且它的“干活”能力无法替代 OpenMausBot，不适合换底座。

### 2. Open-LLM-VTuber

- 仓库：https://github.com/Open-LLM-VTuber/Open-LLM-VTuber ；文档 https://open-llm-vtuber.github.io/
- 许可：GitHub API 显示 "Other / NOASSERTION"；README 写项目为 MIT，但内置 Live2D 示例模型受 Live2D Free Material License 约束，中大型企业商用需另取授权。**需打开 LICENSE 原文确认是否有附加条款【未核实】**。
- 活跃度：约 14.5k 星、1.7k fork；pushed_at 2026-05-15（距今 5 个多月无推送）。README 顶部声明正在规划 v2.0 全量重写，v1 不再接受新功能请求、只修 bug。
- 技术栈：Python 后端（uv），Web 前端 + Electron 桌面客户端（另仓库 Open-LLM-VTuber-Web）。
- 形象：Live2D，表情映射由后端控制，点击/拖拽触摸反馈；桌宠模式（透明背景、置顶、鼠标穿透）。GTX 1070：Live2D 本身轻；本地 ASR/TTS/LLM 可选 CPU 或云端。
- 语音：ASR 支持 sherpa-onnx、FunASR、Faster-Whisper、whisper.cpp、Azure 等；TTS 支持 sherpa-onnx、MeloTTS、CosyVoice、GPT-SoVITS、Edge TTS、**Fish Audio**、Azure 等。**支持免耳机语音打断（AI 不会听到自己的声音）**——这正是本项目“TTS 播放时暂停采集、尚非全双工”的缺口。另有 AI 主动说话、显示“内心想法”、摄像头/屏幕视觉。
- Agent 能力：提供 Agent 接口可接 Mem0、HumeAI EVI 等；长期记忆暂时移除；无多智能体、MCP、电脑操作的成体系支持（README 未列出）。本质是陪聊。
- Windows：支持。
- 界面风格：Live2D 角色占满画面，底部输入，侧边聊天记录；整体偏工具型，美术感一般。
- 截图（README Demo 表格，实际存在于仓库）：https://raw.githubusercontent.com/Open-LLM-VTuber/Open-LLM-VTuber/main/assets/i1.jpg 、https://raw.githubusercontent.com/Open-LLM-VTuber/Open-LLM-VTuber/main/assets/i2.jpg 、https://raw.githubusercontent.com/Open-LLM-VTuber/Open-LLM-VTuber/main/assets/i3.jpg
- 判断：**参考语音打断方案**。理由：它的免耳机打断与 Fish Audio TTS 接入和本项目语音链路直接相关，值得读源码；但 v1 已冻结、v2 尚在规划、许可字段未明确，不宜作为底座或长期依赖。

### 3. Super Agent Party（heshengtao/super-agent-party）

- 仓库：https://github.com/heshengtao/super-agent-party ；官网 https://www.agentparty.top/
- 许可：**AGPLv3 + 商业授权双许可**；闭源商用必须向作者取得商业授权（README“许可证协议”节原文）。若本项目将来分发或对外提供服务，AGPL 会要求公开修改后的源码。
- 活跃度：README 当前提供 v0.4.3 下载（Windows 安装版/整合包、mac、Linux、Docker）；星数与推送时间见下方补充。
- 技术栈：Python（uv）+ Node/Electron 桌面端，Docker 版 3456 端口；对外提供 OpenAI 兼容 API 与 MCP 接口。
- 形象：VRM 3D 桌宠（自定义模型、动作、3D 场景，双向 VMC 协议）；THA（Talking Head Anime）2D 角色音频驱动口型；VTube Studio 联动控制 Live2D；release 说明新增 SoulX-FlashHead“3D 真人”桌面伴侣（需单独部署后端）。GTX 1070：VRM/THA 渲染可跑【未实测】，SoulX-FlashHead 真人头像对显卡要求【未核实】。
- 语音：VRM/THA 桌宠均写明“可语音交互、对话打断”；多种 ASR/TTS 可接本地或云端（具体引擎列表在飞书文档）。
- Agent 能力：这一类里最强。任务中心可后台执行任务，支持 MCP、Agent Skills、A2A；电脑控制（桌面视觉 + 鼠标/键盘/终端）；AI 浏览器（自动控制）；多角色群聊（酒馆角色卡）、长期记忆；`/plan` `/read` `/edit` `/yolo` 权限模式、`/cowork` 子智能体协作、`/goal` 目标模式；接入 QQ/微信/飞书/钉钉/Telegram 等；扩展系统（AI PPT、表格、drawio 等）。
- Windows：一等支持（安装版、免安装整合包，要求 Win10/11）。
- 界面风格：功能堆叠型，自定义背景/表情包/人设，胶囊模式和手机尺寸小窗停靠；截图看起来信息密度高，美术统一性一般。
- 截图（README 内实际图片路径）：https://raw.githubusercontent.com/heshengtao/super-agent-party/main/doc/image/img-1/cover.jpeg 、https://raw.githubusercontent.com/heshengtao/super-agent-party/main/doc/image/img-1/tha4.jpeg 、https://raw.githubusercontent.com/heshengtao/super-agent-party/main/doc/image/img-1/task.jpeg
- 判断：**唯一接近“换底座”的陪伴类候选，但要慎重**。理由：陪伴形象 + 任务中心 + 电脑/浏览器 + MCP/Skills + 子智能体都有，功能面最接近“陪伴 + 干活”；但 AGPLv3/商业双许可、单一作者主导、功能多而杂，且与 OpenMausBot 已接通的审批/账本/权限体系完全不同，替换意味着重做本项目大部分适配与验收。

补充（GitHub 搜索 API，2026-10-31）：Super Agent Party 约 2.8k 星、pushed_at 2026-10-27、GitHub 识别许可 AGPL-3.0，与 README 一致。Open-LLM-VTuber 的 LICENSE 原文已读：项目本身 MIT，仅 Live2D 示例模型受 LICENSE-Live2D.md 约束（上文“未核实”已消除，GitHub 显示 NOASSERTION 是因为文件末尾多了这句附加说明）。

### 4. TalkingHead（met4citizen/TalkingHead）——用户的 persona 项目已在用

- 仓库：https://github.com/met4citizen/TalkingHead
- 许可：MIT。
- 活跃度：约 1.7k 星，pushed_at 2026-10-30，持续维护。
- 技术栈：纯浏览器 JavaScript 类（three.js），可直接嵌入 React 页面；配套 HeadTTS（Kokoro 神经 TTS，浏览器 WebGPU/WASM 或本地 Node 运行，输出音素时间戳和 Oculus 口型）https://github.com/met4citizen/HeadTTS 。
- 形象：全身 3D GLB，要求 Mixamo 兼容骨骼 + ARKit 52 个表情形变 + Oculus 15 个口型形变；仓库 blender/ 目录有 VRoid、MPFB（MakeHuman 写实人体）、Faceit 三条自建模型流程，**不再只依赖 Ready Player Me**。有动态骨骼（头发物理）、情绪表情、姿势动画。也能用 `speakAudio` 给已有音频配口型（可配合外部 TTS，如本项目的 Fish Audio，需要词级时间戳或用 Whisper 对齐【未核实 Fish Audio 是否返回时间戳】）。GTX 1070：浏览器 WebGL 实时渲染单个角色压力不大【未实测】。
- 语音：本身只管“嘴”，ASR/VAD 由宿主提供。
- Agent 能力：无，是渲染组件。
- 界面风格：写实或半写实 3D 人物，适合近景对话；演示截图为单人特写。
- 截图（README 内引用）：https://raw.githubusercontent.com/met4citizen/TalkingHead/main/images/screenshot4.jpg 、https://raw.githubusercontent.com/met4citizen/TalkingHead/main/images/screenshot3.jpg
- 判断：**借形象层（首选之一）**。理由：MIT、React 可直接引用、用户已有使用经验，且能做写实成年女性（MPFB/Faceit），最贴合“书房里居中的成年女性”；代价是需要按已批准的外观重新做一个 3D 模型，静态照片无法直接转换。

### 5. LiveTalking（lipku/LiveTalking，原 metahuman-stream）

- 仓库：https://github.com/lipku/LiveTalking ；文档 https://doc.livetalking.ai
- 许可：Apache-2.0（开源版）；另有付费商用版。README“声明”要求基于本项目发布到 B站/视频号/抖音的视频带 LiveTalking 水印和标识。
- 活跃度：约 10.2k 星，pushed_at 2026-10-20。
- 技术栈：Python 3.12 + PyTorch 2.9.1 + CUDA 12.8 服务端，WebRTC/RTMP/虚拟摄像头输出到浏览器；提供 `/human` `/humanaudio` HTTP 接口，可当作“嘴”接入任何前台。
- 形象：照片/视频真人口型（wav2lip、MuseTalk、ER-NeRF、Ultralight-Digital-Human），需要一段人物视频生成 avatar（有 /avatar.html 上传生成）。**GPU 门槛**：README 性能表 wav2lip256 在 RTX 3060 为 60 FPS、推荐 3060 及以上；MuseTalk 推荐 3080Ti 及以上。GTX 1070 跑 wav2lip256 可能勉强达到 25 FPS 实时线【未实测，按 3060 数据推测】，MuseTalk 基本不行。
- 语音：支持数字人说话被打断；TTS 支持 EdgeTTS、GPT-SoVITS、CosyVoice、腾讯云等，自带 LLM 对接（Qwen 等）。
- Agent 能力：无（只有对话），定位是直播/客服数字人引擎。
- Windows：README 写 linux/win/mac，提供 Windows 整合包（夸克网盘）；官方测试环境是 Ubuntu 22.04。
- 界面风格：视频窗口 + 文本框，偏演示页，不美观。
- 截图：https://raw.githubusercontent.com/lipku/LiveTalking/main/assets/index.jpg
- 判断：**参考/备选形象层**。理由：它是唯一能让“已批准的照片里的那位女性”真的开口说话的成熟开源方案（正好对应本项目的“照片口型”待测项），但 GTX 1070 性能处于边缘，且需要真人视频素材生成 avatar；适合做独立实验，不适合当前直接接入。

### 6. Duix（duixcom/Duix-Mobile、Duix-Avatar）

- 仓库：https://github.com/duixcom/Duix-Mobile （约 8.3k 星，pushed_at 2026-08-05）；https://github.com/duixcom/Duix-Avatar （约 16.2k 星，pushed_at 2026-04-21）
- 许可：**DUIX.COM COMMUNITY LICENSE，不是 OSI 开源许可**（LICENSE 原文已读）：分发必须显著标注 "Powered by Duix.com"；产品月活超过 1000 必须另向 duix.com 申请授权，对方可自行决定是否授予。个人自用不受月活条款影响。
- 技术栈：Duix-Mobile 是 Android/iOS 端侧 SDK（C++），**没有 Web/Windows 版本**；Duix-Avatar 是 Windows 离线视频合成工具（生成视频，不是实时对话）。
- 形象：写实真人 2D 数字人，官方提供 4 个公开形象，自定义形象需发邮件给官方（15 秒到 2 分钟视频）。
- 语音：流式音频、支持打断（2025-07-17 版本起），可接自有 LLM/ASR/TTS。
- 判断：**排除**。理由：实时版只支持手机端，Windows 桌面前台无法直接使用；自定义形象依赖官方；许可非开源。

### 7. Lobe Vidol（lobehub/lobe-vidol）

- 仓库：https://github.com/lobehub/lobe-vidol ；在线体验 https://vidol.lobehub.com
- 许可：Apache-2.0。
- 活跃度：约 1.0k 星，pushed_at 2026-10-15；README 仍写“开发初期、Beta”。
- 技术栈：Next.js + React + @lobehub/ui 组件库 + three-vrm + mmd-parser；PWA。与本项目 React 前台同生态。
- 形象：VRM 3D 角色 + MMD 舞蹈/舞台，内置 Mixamo 动作库，角色编辑器可设触摸反应，可设置背景图片。
- 语音：TTS（OpenAI、Edge）/STT；有“视频对话模式”面对面聊天。打断【未核实】。
- Agent 能力：基本没有（多模型聊天 + 角色市场）。
- 界面风格：这一组里**UI 最精致**的一个——LobeHub 一贯的现代深色设计，聊天区与角色舞台并排，背景可换。
- 截图（README 内实际图片）：https://github.com/user-attachments/assets/4af0dfb3-97b9-468e-b1c9-a672242d8aad （视频对话模式）、https://github.com/user-attachments/assets/e62b635c-168d-4f4e-8741-39aac0f7cfd3 （背景设置，最接近“书房背景 + 角色”）、https://github.com/user-attachments/assets/d2585e90-b44e-494b-ac55-113f924abefc （文字聊天）
- 判断：**借 UI（视觉参考首选）**。理由：React 同栈、Apache-2.0、“背景场景 + 居中角色 + 侧边对话”的构图和本项目最像，可以直接参考它的舞台布局、玻璃面板和 @lobehub/ui 组件；但功能浅、Beta 状态，不能当底座。注意 @lobehub/ui 本身的许可需单独核对【未核实】。

### 8. Amica（semperai/amica）

- 仓库：https://github.com/semperai/amica ；在线 https://amica.arbius.ai
- 许可：MIT（模型/图片资源按各作者许可）。
- 活跃度：约 1.6k 星，pushed_at 2026-09-22；README 称刚发布 Amica 1.2。
- 技术栈：Next.js/React + three.js + @pixiv/three-vrm，桌面版用 Tauri；fork 自 pixiv ChatVRM（ChatVRM 已于 GitHub 归档）。
- 形象：VRM 3D 角色，“情绪引擎”让回复带表情。
- 语音：Whisper（含浏览器 Transformers.js）ASR、**Silero VAD（与本项目已用的 @ricky0123/vad-web 同一套）**、TTS 支持 ElevenLabs/OpenAI/Coqui/RVC/AllTalk 等；视觉用 BakLLaVA。
- Agent 能力：README 未列出工具/MCP/多智能体【未核实 1.2 新功能】。
- Windows：Tauri 桌面版；README 的 Windows 下载按钮指向第三方仓库 flukexp/llama-piper-go 的 exe，来源需谨慎。
- 界面风格：全屏 3D 角色，底部输入条，简洁但偏“demo 感”。
- 截图：https://amica.arbius.ai/ogp.png （官网 OG 图）
- 判断：**参考**。理由：React + VRM + Silero VAD 的组合与本项目最近，可读它的 VRM 表情/口型与 VAD 衔接代码；但视觉不如 Lobe Vidol，能力不如 AIRI，且 Windows 安装来源不清晰。

### 9. SillyTavern

- 仓库：https://github.com/SillyTavern/SillyTavern
- 许可：AGPL-3.0。
- 活跃度：约 35.1k 星，pushed_at 2026-10-02，非常活跃。
- 技术栈：Node.js + jQuery 风格前端，扩展生态大（Live2D/VRM 扩展、TTS、图像生成等）。
- Agent 能力：以角色扮演聊天为主；扩展可加工具调用，但没有派工/审批/电脑操作体系。
- 界面风格：“高级玩家前端”，选项极多、信息密度大，美观度一般。
- 判断：**排除（仅角色卡格式可参考）**。理由：AGPL、界面复杂、定位是角色扮演前端，与“陪伴 + 干活”的个人助理方向不符；它的角色卡格式被 Super Agent Party 等兼容，可作为人设导入格式参考。

### 10. 语音界面组件（不是陪伴应用，但能让“底部语音输入”更好看）

- **Pipecat Voice UI Kit**：https://github.com/pipecat-ai/voice-ui-kit ，BSD-2-Clause，约 0.4k 星，pushed_at 2026-10-26。React 组件 + Tailwind 4 + CSS 变量主题，含 VoiceVisualizer（声波可视化）、ControlBar、UserAudioControl 等。组件默认绑定 Pipecat 的传输层（Daily / SmallWebRTC），用在本项目需要只取视觉组件或自写适配【未核实组件能否脱离 PipecatAppBase 单独使用】。截图：https://raw.githubusercontent.com/pipecat-ai/voice-ui-kit/main/image.png
- **LiveKit agent-starter-react**：https://github.com/livekit-examples/agent-starter-react ，MIT，约 1.0k 星，pushed_at 2026-10-30。Next.js 完整语音前端（音频可视化、转写、控制条）；与 LiveKit 房间强绑定。**LiveKit agents-playground**：https://github.com/livekit/agents-playground ，Apache-2.0，pushed_at 2026-10-30，偏调试台。
- 判断：**借 UI 细节**。理由：本项目底部输入栏目前是普通按钮，这两套的“正在听/正在说”的声波和状态切换做得成熟，可以照样式重写；不建议引入它们的传输层，因为本项目语音走 ReachAI。

### 11. SoulX-FlashHead（Soul-AILab/SoulX-FlashHead）——2026 年新出的“单张照片实时说话”模型

- 仓库：https://github.com/Soul-AILab/SoulX-FlashHead ；项目页 https://soul-ailab.github.io/soulx-flashhead/ ；论文 arXiv 2602.07449；HF 在线演示 https://huggingface.co/spaces/Soul-AILab/SoulX-FlashHead
- 许可：Apache-2.0（代码）。模型权重在 HuggingFace，权重许可【未核实】。基础模型为 Wan2.1。
- 活跃度：约 1.2k 星，2026-02 发布，pushed_at 2026-05-28。Super Agent Party v0.4.3 已把它接成“3D 真人桌面伴侣”。
- 形象：**输入一张参考人像 + 音频，流式生成无限长的说话视频**——这是唯一能直接让“已批准的那张人物图”开口的方案，不需要重新建模或录视频。
- GPU 门槛：README 原文：Lite 模型单张 RTX 4090 达 96 FPS（或 3 路并发实时）；Pro 模型单张 4090 只有 10.8 FPS，两张 RTX 5090 才实时。安装要求 PyTorch 2.7.1 + CUDA 12.8 + FlashAttention 2.8。**FlashAttention 2 官方只支持 Ampere（RTX 30 系）及更新的显卡，GTX 1070 是 Pascal 架构，按此推断无法按官方流程运行**【推断，未实测】；网上有“8GB 显存可用整合包”的文章，未核实其显卡型号。实际可行做法是放在云端或另一台 30/40 系显卡机器上推流。
- 语音/Agent：无，纯“嘴 + 脸”渲染。
- 判断：**借形象层（照片口型的最佳候选，但本机显卡不够）**。理由：效果路线与已批准视觉完全一致（照片真人、书房中居中），许可宽松；限制是本机 GTX 1070 跑不了，需要租 GPU 或换卡，延迟与费用需单独评估。

### 12. ElevenLabs UI（elevenlabs/ui）

- 仓库：https://github.com/elevenlabs/ui ；文档 https://ui.elevenlabs.io/docs ；Orb 组件 https://ui.elevenlabs.io/docs/components/orb
- 许可：MIT。约 2.4k 星，pushed_at 2026-10-16。
- 内容：基于 shadcn/ui 的 React 组件注册表，含 3D 音频反应 Orb（Three.js，可显示“听/想/说”状态）、波形、语音 Agent 面板、音频播放器、转写等。组件以源码方式拷入项目（shadcn 模式），可改成接本项目自己的音频流【未核实 Orb 是否必须绑定 ElevenLabs SDK，文档描述为传入音量/状态即可】。
- 判断：**借 UI 细节**。理由：本项目底部语音按钮和“正在听/正在说”状态最缺视觉反馈，Orb/波形可直接放在人物脚下或输入栏中，MIT 且是 React，改造成本最低。

### 已排除

- pixiv/ChatVRM：已归档（archived=true，最后推送 2025-05-27），由 Amica 继承。
- kimjammer/Neuro：MIT，约 2.1k 星，但最后推送 2025-01-17，基本停更。
- GMTalker（GML-MMGroup/GMTalker）：3D 数字人（ASR/TTS/口型），约 1.2k 星，但最后推送 2026-01-08，许可显示 NOASSERTION【未读原文】。
- 2026 年新出的小项目（daijinru/wenko 约 20 星、Suge8/Bao 约 23 星、LiiLk/Local-AI-Companion 约 12 星、ksromt/koclaw 1 星无许可）：用户量太小，不作为依赖；Bao 的“持久分类记忆 + 子代理 + MCP”思路可作参考。
- 搜索中出现的 Agent-Player、xiaokeai-aihuman、LLM-Live2D-Desktop-Assitant 在 GitHub 搜索 API 中未返回结果（可能改名或删除），未纳入。



## 对“书房 + 居中女性”界面能带来什么

现在的人物是静态分层图，界面“不好看”很大一部分来自人物不动、语音状态没有视觉反馈、对话面板像普通网页卡片。陪伴类项目里可直接借的做法有：Lobe Vidol 的“整屏场景背景 + 角色居中 + 半透明侧边对话面板”构图（与本项目布局几乎相同，可对照它的面板透明度、圆角和留白）；AIRI 与 Open-LLM-VTuber 的自动眨眼、视线跟随鼠标、待机呼吸/眼动，这些让人物“活着”的效果在 Live2D/VRM/TalkingHead 里都是现成能力，静态图做不到；ElevenLabs UI 的 Orb 或 Pipecat/LiveKit 的声波可视化放在人物下方或输入栏，用来表示“在听/在想/在说”；Open-LLM-VTuber 的“内心想法”气泡和 AI 主动开口，可以用来展示小助理在后台干活的进度，而不是只在右上列表里刷新。

让已批准的那张人物图真正动起来有两条路线。第一条是重新做一个外观接近的写实 3D 模型（MPFB/Faceit 流程）交给 TalkingHead 渲染，本机 GTX 1070 能跑，但外观会和原图有差距，需要用户重新确认。第二条是保留原照片，用 SoulX-FlashHead（单张照片驱动）或 LiveTalking（需要一段视频素材）生成口型视频，外观最忠实，但前者按官方依赖需要 RTX 30 系及以上显卡，后者在 1070 上处于实时边缘，都要先做性能实测。

## 排名

### 换底座 Top 3（陪伴类候选）

结论先说：**陪伴类开源项目里没有一个能替代 OpenMausBot 的“干活”内核**。它们强在形象和语音，弱在派工、审批、文件账本、电脑/浏览器操作、邮箱日历这些本项目已接通的部分。若只看“能否整体换掉”，排序如下：

1. **Super Agent Party**（AGPLv3 + 商业双许可，约 2.8k 星，2026-10-27 仍在推送）：唯一同时有 VRM/THA 陪伴形象、语音打断、任务中心、电脑控制、AI 浏览器、MCP/Skills/A2A、子智能体协作和目标模式的项目，功能面最接近“陪伴 + 干活”。不推荐直接换的原因：AGPL 对将来分发不利；单一作者主导；权限模式（plan/read/edit/yolo）与本项目已验收的逐次审批、文件账本、作用域校验是两套体系，换过去等于重做大部分适配和验收。
2. **Project AIRI**（MIT，约 50.9k 星，v0.14.1 于 2026-10-30 发布，有 Windows 安装包/winget）：社区最大、更新最快、Live2D+VRM 都成熟。不推荐换的原因：Vue 生态；工作能力只有游戏、Discord/Telegram 和 MCP 启动器，长期记忆仍在开发，没有多助理派工与审批。
3. **Open-LLM-VTuber**（MIT，约 14.5k 星）：语音链路（免耳机打断、Fish Audio TTS）与本项目最接近。不推荐换的原因：v1 冻结、v2 重写尚在规划，最后推送 2026-05-15；本质是陪聊。

### 借 UI / 形象层 Top 3

1. **Lobe Vidol**（Apache-2.0，React/Next.js）：界面最精致，“场景背景 + 居中角色 + 侧边对话”的构图与本项目一致，适合作为视觉改版的直接参照，并可评估引入 @lobehub/ui 组件（其许可需另核）。
2. **TalkingHead + HeadTTS**（MIT，纯浏览器 JS，用户 persona 项目已在用）：让人物开口、眨眼、做表情的最低成本方案，GTX 1070 可跑；需要按已批准外观新做写实 3D 模型。
3. **ElevenLabs UI 的 Orb / 波形组件**（MIT，React + shadcn）：给底部语音输入和人物“在听/在说”状态加视觉反馈，改造量最小、见效最快。

备选：SoulX-FlashHead（Apache-2.0）是“照片原样开口”的最佳技术路线，但需要 RTX 30 系及以上显卡或云 GPU；Open-LLM-VTuber 的语音打断实现值得读源码，用来补本项目“TTS 播放时暂停采集”的缺口。
