# ReachAI 模型与语音接入核对 v1.0

> 历史阶段记录。2026-10-22 更新：用户已批准并完成本地适配，当前状态、24 项验证和真实联调步骤见 [ReachAI 接入实现与验收](ReachAI接入实现与验收_v1.0.md)。下文保留当时的研究结论，不表示专用适配仍未实现。

版本：v1.0。核对日期：2026-10-21。所属项目：openmaus-assistant。

用户要求先检查 reachai 的 LLM 和语音。本次只读检查 `projects/reachai/`、对应知识库及公开服务；没有修改 ReachAI、读取其他业务的私密会话、借用凭证或变更线上配置。

## 结论

可以复用 ReachAI（产品名 Saturn Cloud）的模型网关、语音识别与语音合成。保留 OpenMausBot 的持久主助理、原生委派、工具执行、审批、记忆和任务记录；ReachAI 负责提供模型与语音。直接调用模型层，不把 ReachAI 的 Agent 执行入口再包成第二套主助理。

这是接入建议和契约核对，尚未实现 ReachAI 专用适配，也尚未连接其真实模型。现有通用兼容 API / multipart ASR / 上游 TTS 设置不能直接当作 ReachAI 已接入。

## 已存在的接口

| 能力 | ReachAI 接口 | 契约及助理侧需要的转换 |
|---|---|---|
| 模型实例 | `GET /model/instances` | 授权后选 ACTIVE 的 LLM / ASR / TTS 实例；服务端保留 `modelInstanceId`，不把模板名冒充实例 ID |
| LLM 同步 | `POST /model/chat` | `{modelInstanceId,messages,tools?,toolChoice?,options?}`；响应 `ApiResult.data` 含 content / reasoningContent / toolCalls / finishReason / usage |
| LLM 流式 | `POST /model/chat/stream/events` | 结构化 SSE：content.delta / reasoning.delta / tool_call.delta / usage / completed / error。需要映射为 OpenMausBot 的兼容模型驱动消费的 OpenAI 流；原样保留工具 ID、参数片段、完成原因、推理字段和 token 统计 |
| 整段 ASR | `POST /model/audio/transcriptions` | JSON `{modelInstanceId,audioBase64,fileName,contentType,language,...}`，不是直接向此处发送 multipart；助理可把已录制 webm/opus 转 base64 后发出 |
| 实时 ASR | `wss://saturn.starhubs.online/model/audio/transcriptions/stream` | start + 16kHz 单声道 PCM int16 音频帧 + end/cancel；返回 ready / partial / final / speech_started / speech_stopped / error；支持服务端 VAD、热词与连续句子 |
| TTS | `POST /model/audio/speech` | `{modelInstanceId,input,voice?,speed?,format?,options?}`；默认 JSON base64 音频，`stream:true` 则分块二进制。需要处理 HTTP 200 内的业务错误，不能把 JSON 错误当音频 |

LLM 请求支持 assistant.tool_calls、tool.tool_call_id 与 reasoning_content 的别名，足以承载文本工具调用的多轮往返。当前 `ChatMessage.content` 是 String；带截图/图片的多模态消息不能据此宣称已经兼容，需要另行核实和适配。

## 建议的本地接线

1. 设置页增加 Saturn Cloud 入口：平台地址、平台 API Key、LLM / ASR / TTS 三个实例，以及音色和语速。实例列表要求 `model:read`，调用要求 `model:invoke`；不需要平台管理或 Agent 发布权限。
2. 平台 Key 只进入本项目本地服务，前台只显示就绪状态。模型厂商 Key 继续由 ReachAI 管理。不得从其他项目配置中复制凭证。
3. 本地服务增加受保护的协议适配，转换 LLM 请求/响应与流事件。OpenMausBot 仍然执行工具和 coordinate_bots，不在前台或 ReachAI Agent 层另起推理循环。
4. 先跑通录音→整段 ASR→聊天→分句 TTS→打断，再接实时 ASR。浏览器原生 WebSocket 不能设置 Authorization 请求头，应通过本地服务转发并在服务端加鉴权；不把 Key 放进 URL。
5. 实时录音需要 AudioWorklet 等产生/重采样 PCM；不能把现有 MediaRecorder 的 webm/opus 字节直接发给 PCM 实时接口。服务端 partial 只更新草稿；final 按录音 session 和句子 ID 去重。
6. TTS 的分块返回与浏览器边下边播分别验收。当前前台仍使用完整音频 Blob 播放；它还不能被称为低延迟流式播放。打断播报不应停止后台任务。

主助理可先与工作小助理使用同一可用 LLM，之后按实际质量和延迟分别选择实例。不能只用一句闲聊成功就判断模型适合派工；必须验证工具调用、多轮工具回传、流中断、限流与重试。

## 已有语音记录及限制

ReachAI 知识库记录 2026-09-13 已有 sherpa-onnx Zipformer 实时 ASR（实例 `b73bbcca-2d69-4b53-bdb5-eff23711fbd7`）、whisper-small 整段 ASR，以及 Edge TTS（实例 `c1233f59-6a6f-4354-9aef-05e30f9e7c86`）；流式交付记录还包含 Fish Audio 分块输出。

这些是历史部署/验收记录，不能当作 2026-10-21 的授权在线验收。记录中的首 partial 约 0.55 秒、end→final 约 70ms 属于当时的样本和环境，不能直接用于承诺这个助理的延迟。人声、噪声、回声和自然插话仍要在本机验证。

本次公开检查：主页 HTTP 200，`GET /model/instances` 无凭证返回 401。说明站点可达且模型列表受保护；没有因此绕过权限或推断哪些实例现在可用。下一步真实联调需要用户在本地设置页输入授权凭证并选择实例，不在聊天中收集密钥。

## 代码与资料依据

- ReachAI 本地 HEAD `2e038b8`（2026-09-13）；仓库有现存用户改动，本次未改动。
- `projects/reachai/AGENTS.md`。
- `reachai-model-service/src/main/java/com/enterprise/ai/model/controller/ModelController.java`。
- 同服务 `service/ChatRequest.java`、`ChatResponse.java`、`ModelStreamEvent.java`。
- `sdk-python/meraviglia_ai/saturn/resources/models.py`、`realtime.py`。
- `ops-154/nginx.conf`、`docker-compose.yml`（只核对路由/服务定义，不读取环境密钥）。
- `Agent文档/reachai_知识库/开放接口速查.md` v2.6、`中台待办清单.md` v2.2。
- `Agent文档/reachai_工作日志/2026-09-08_实时语音三项流式能力.json`。

## 接入验收清单

- 授权获取实例；无 Key / 错误 Key / 缺 scope 各有明确反馈。
- LLM 文本逐字、reasoning 字段、工具调用片段和两轮工具回传均不丢失。
- 工具循环期间主助理继续聊天；断线不会重复派遣。
- ASR 中文、取消后迟到结果、实时 PCM 格式与 VAD 停句。
- TTS 音色试听、第一段可播放时间、JSON 业务错误、打断后旧片段不能复活。
- 真实 Key 不出现在前台、模型日志、截图、URL 或报告。
