# 验收

## FR 对照

| 编号 | 需求 | 实现 | 验证 |
|---|---|---|---|
| FR1 | 语音输入转文字并自动发送 | 浏览器录音 → WAV → `/api/xiaoyuer/asr` → `Session.prompt` | mock ASR 路由测试 + 手机实机 |
| FR2 | 语音回复播报 | assistant 消息 → `/api/xiaoyuer/tts` → Edge TTS → AudioContext | TTS 路由测试 + 手机实机 |
| FR3 | 会话文字留存 | 转写文字作为普通 user message | 刷新后仍可见 |
| FR4 | 记忆写入 | `hindsight_remember` / `hindsight_condense` / `/hindsight remember` | Host 测试写入 mock |
| FR5 | 记忆召回 | `hindsight_recall` + 人设引导 | Host 测试召回 mock |
| FR6 | 按会话开关 | `state.json` + prompt 段 + `tools.guard` | 切普通助手后工具被拒 |
| FR7 | iPhone 访问 | Tailscale HTTPS + DSH Web | iPhone Safari 实机 |
| FR8 | 离线蒸馏 | `scripts/distill_chat.py` | 样例 ≥10 条写入 mock |

## 自动检查

```powershell
scripts\acceptance.ps1
```

覆盖：

1. JS 语法与 Markdown 相对链接；
2. 客户端模块注册到 `conversation.input.dock`；
3. PowerShell BOM 的 `secrets.json` / `python.txt` 兼容；
4. 三个 Hindsight 工具注册、系统提示注入；
5. assistant 人设强制关记忆，guard 拦截；
6. `/persona`、`/memory` 命令；
7. `hindsight_remember` 确认门、重复去重；
8. `hindsight_recall` 召回；
9. `hindsight_condense` 批量与去重；
10. 认证状态路由与会话隔离；
11. ASR 路由（mock）；
12. Edge TTS 真实合成与缓存命中；
13. 离线蒸馏 ≥10 条并写入 mock。

连接真实 Hindsight 后：

```powershell
scripts\acceptance.ps1 -Live
```

## 手工验收

### 1. 语音对话

1. iPhone Safari 打开 Tailscale HTTPS 地址；
2. 允许麦克风；
3. 点 **说话**，说一句话；
4. 点 **停止并发送**；
5. 确认用户文字、AI 回复和 TTS 声音。

### 2. 人设切换

1. 点 **普通助手**；
2. 确认记忆开关变灰、关闭；
3. 问“你还记得我喜欢喝什么吗？”；
4. 确认不调用 `hindsight_recall`，不出现“我记得”式回答；
5. 点 **角色**，记忆自动打开；
6. 问一个已写入记忆的问题，确认召回。

### 3. 记忆写入确认

1. 角色会话说“我最近开始喜欢手冲咖啡了”；
2. 模型应询问是否记进回忆；
3. 回答“好”；
4. 确认工具调用带 `confirm: true`；
5. 新会话中问相关问题，确认能召回。

### 4. 离线蒸馏

```powershell
python scripts\distill_chat.py tests\fixtures\sample_chat.txt --out distill-output --write
```

检查 `memories.md` 至少 10 条，`write-log.json` 无失败。

### 5. 重启恢复

1. 重启电脑；
2. 启动 Docker / Hindsight；
3. 启动 `dsh web`；
4. iPhone 重新打开；
5. 确认人设/记忆开关、历史、TTS 仍可用。

## 边界

- 没有真实 Hindsight 和 ASR Key 时，FR4/5/8 只能算“协议通过”，不能算端到端通过。
- 没有 iPhone 实机时，FR1/2/7 只能算“代码与路由通过”。
- Desktop 的浏览器桥与 Web profile 可能不同；手机部署建议使用 `dsh web` profile。
- 不承诺人格还原；输出是统计性模仿。
