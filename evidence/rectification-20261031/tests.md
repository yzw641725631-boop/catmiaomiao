# 测试结果 2026-10-31（VM，Node 24.22.2，fixture 模型）

| 文件 | 结果 |
|---|---|
| artifact-workflows | pass 3 fail 0 skipped 0  |
| asr-relay | pass 1 fail 0 skipped 0  |
| assistant-names | pass 2 fail 0 skipped 0  |
| bridge | pass 6 fail 0 skipped 0  |
| continuous-voice | pass 9 fail 0 skipped 0  |
| conversation-recovery | pass 7 fail 0 skipped 0  |
| conversation-settings | pass 3 fail 0 skipped 0  |
| interaction-vision | pass 3 fail 0 skipped 0  |
| live-adapter | pass 1 fail 0 skipped 0  |
| mail-accounts | pass 5 fail 0 skipped 0  |
| markdown | pass 2 fail 0 skipped 0  |
| microphone | pass 2 fail 0 skipped 0  |
| model-retry | pass 8 fail 0 skipped 0  |
| native-capabilities | pass 5 fail 1 skipped 1  |
| native-goals | pass 1 fail 0 skipped 0  |
| pcm | pass 2 fail 0 skipped 0  |
| projection | pass 8 fail 0 skipped 0  |
| reachai-live | pass 1 fail 0 skipped 0  |
| reachai | pass 5 fail 0 skipped 0  |
| realtime-speech | pass 5 fail 0 skipped 0  |
| services-live | pass 1 fail 0 skipped 0  |
| services | pass 6 fail 0 skipped 0  |
| specialists | pass 4 fail 0 skipped 0  |
| speech | pass 3 fail 0 skipped 0  |
| surface-grants | pass 2 fail 0 skipped 0  |
| tool-recovery-native | pass 2 fail 0 skipped 0  |
| tool-recovery | pass 8 fail 0 skipped 0  |
| vision-retry | pass 9 fail 0 skipped 0  |
| voice | pass 10 fail 0 skipped 0  |
| work-view | pass 2 fail 0 skipped 0  |
| workspace | pass 9 fail 0 skipped 0  |

合计：pass 135, fail 1, skipped 1。唯一失败为 native-capabilities 的原生 Chrome 用例（VM 无 Chrome，基线同样失败）；跳过的是仅限 Windows 的 CUA 用例。
