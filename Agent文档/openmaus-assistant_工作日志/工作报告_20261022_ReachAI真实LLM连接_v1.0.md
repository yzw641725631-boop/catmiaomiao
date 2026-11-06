# 工作报告：ReachAI 真实 LLM 连接 v1.0

版本：v1.0。日期：2026-10-22。项目：openmaus-assistant；依赖：用户明确指定的 ReachAI/Saturn Cloud。

## 目标与授权

用户要求：“LLM你帮我链接啊，那里里面都有配置的。在reachai里面”。据此使用 ReachAI 的既有模型配置完成真实连接；不再要求用户自行找 Key。该指令明确扩展了此前仅核对接口的范围。

## 实际变更

- 经现有 ReachAI 运维入口核对 ACTIVE 实例，选择通用 `deepseek-hongkong` / `5e30cb57-167d-4c2f-b953-6e6b5bd500b1`，配置型号 `deepseek-v4.1-flash`。主助理和两位小助理共用它。
- 通过既有 `issue_api_key.sh` 签发 `openmaus-assistant-local` 专用平台凭证，仅 model:read/model:invoke、365 天有效；只在本项目 `runtime/companion-settings.json` 保存原文。模型厂商密钥未导出；现有模型实例、业务 Key、服务配置及 ReachAI 源码未改。没有把凭证放入报告、截图、浏览器存储或 URL。
- 助理当前为 live / reachai。经过一次正常重启，chief ID、陪伴 thread ID 与 9 条既有聊天记录保持一致。
- 模型在复杂工具调用中曾发出不符 schema 的参数；适配增加明确 JSON 类型说明，同时保持原始 schema、工具内容和内核验证，不做字符串到数组等强转。
- 页面在服务重启后因能力 Cookie 轮换曾持续等待；`useCompanion.ts` 增加失败时重新取 info/状态的恢复，保留消息与输入草稿。

## 真实验证与证据

1. 原生 `/model/chat` 回复“连接正常”，并回读验证 Unicode 字符正确。连接记录：`projects/openmaus-assistant/evidence/reachai-live-20261022/connection-145925.json`。
2. 实际前台发送一句自我介绍测试，收到真实模型成功终态；用户随后在同一页面的两次聊天亦正常返回。仅记录数量和验证事实，不复制用户对话内容进本文。
3. 原生两名小助理文字协作最终通过：主助理实际调用 coordinate_bots，检索/文档助理在各自独立 thread 返回成功标记，主助理收齐后汇总且最终 turnSucceeded=true。证据：`native-work-2026-10-22T07-24-49-894Z.json`（同 evidence 目录）。本轮没有写文件。
4. 过程中出现供应商 HTTP 502，文档助理第一次无模型回复，重派一次后正常回传；也有工具参数拒绝。不能宣称无故障、复杂派工或稳定性全部验收通过。协议对照探针中 DeepSeek/agens 的单工具数组均合规，grok-chat 当时返回 upstream_network_error；未因此修改任何实例。
5. 验收脚本最初错误地把历史任意失败 turn 当作整个任务最终失败；已改为检查最新 terminal，并只读复核同一任务，保留首次误判记录与后续成功审计，没有重复派工以伪造通过。
6. 新版 TypeScript、24 项隔离测试、Vite 构建通过，证据：`projects/openmaus-assistant/evidence/app-checks-2026-10-22T07-26-13-658Z/report.json`。这些测试与真实服务结果分别记录。
7. 浏览器加载新版后，在未发送的测试草稿存在时正常停止并重启本项目空闲服务，未手动刷新页面，自动恢复至“记录保存在本地”，草稿仍在；随后清除本次测试草稿并返回聊天。证据截图 `restart-draft-retained.jpg`。再次打开设置确认 LLM 显示 deepseek-hongkong、平台 Key 仅显示已保存，交付截图 `llm-connected.jpg`；两图均位于上述真实连接 evidence 目录。

## 明确未通过的范围

两次真实文件任务均未通过，失败记录保留。当前兼容驱动提供的 vm_exec 面向 Local VM，不是 Windows 本机文件工具；模型尝试选择电脑被拒，之后请求用 data SQL 组织文稿，不能等同于写文件。该测试 SQL 请求已拒绝，并停止了指定测试工作，未扩大权限。未生成可验收的 report.md。

此前“文件操作已接好”的表述过宽：fixture 确实用脚本模型写过真实文件并展示差异，但真实 LLM 的 Windows 文件/命令工具尚未接通。需补齐受限 Windows 工具和小助理审批体验后另行验收；不能声称现在已经可以真实改代码或写文件。

真实 ASR/TTS 实例仍未选择，麦克风/人声、口型/动作、自动学习习惯和定时主动行动未验收或未实现。用户本次只要求 LLM 实连，没有顺带启用麦克风、安装人物模型或发布。

## 文档与门控

更新 README、当前实现报告、项目概览与索引；原文备份在 `归档/openmaus-assistant/reachai-live-connection-20261022/`。全局 main.md 未改。G2/G4 有既有确认，开发者自检和验证如上；G5 没有独立签字，G7 未申请，没有部署新服务或分发安装包。后续优先解决 Windows 真实文件执行及复杂工具稳定性。
