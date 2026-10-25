# 架构与需求映射

## 为什么是一个 bundle

需求里列的四个插件名（`dsh-voice-chat`、`dsh-hindsight`、`dsh-character-cards`、`dsh-on-phone`）在当前安装的 DSH 0.2.1-rc.3 里并不存在；官方 bundle 列表里没有这些包。为了让功能可安装、可测试，本项目把它们实现为一个自包含 bundle：

```text
@local/dsh-xiaoyuer
  ├─ Host: index.js + lib/*
  └─ Client: client.js
```

一个 bundle 也避免了多个插件之间的加载顺序、共享状态和版本漂移问题。

## 映射

| 需求中的角色 | 本项目实现 |
|---|---|
| `dsh-voice-chat` | `client.js` 录音/自动发送 + `/api/xiaoyuer/asr`、`/tts` 路由 |
| `dsh-hindsight` | `lib/hindsight.js` + `hindsight_recall/remember/condense` 工具 |
| `dsh-character-cards` | `personas/*.md` + `systemPrompt.section` |
| `dsh-on-phone` | Tailscale HTTPS / MagicDNS 部署文档与脚本；DSH 的 Web 服务本身负责手机访问 |
| `dsh-session-memory-gate` | `lib/store.js` 按会话状态 + `ctx.tools.guard` 硬拦截 + 工具栏开关 |

## Host 扩展点

| 扩展点 | 用途 |
|---|---|
| `ctx.tools.register` | 注册三个 Hindsight 工具 |
| `ctx.tools.guard` | 普通助手/记忆关闭时拒绝 `hindsight_*` |
| `ctx.systemPrompt.section` | 按 session 注入前女友人设；普通助手返回空 |
| `ctx.commands.register` | `/persona`、`/memory`、`/hindsight` |
| `ctx.connection.fetch.register` | 认证的 state/asr/tts 路由 |
| `ctx.inject([...])` | 可选服务，缺少时不阻塞插件 |

## Client 扩展点

| 扩展点 | 用途 |
|---|---|
| `conversation.input.dock` | 输入框上方的工具栏（人设/记忆/播报/麦克风） |
| `ctx.sessions.binding(sessionId)` | 读取事件流、调用 `Session.prompt()` 自动发送 |
| `slots.inject/register` | 注册工具栏并随插件卸载清理 |

## 数据与状态

```text
Session log（DSH）           会话文本、工具调用、assistant 回复
state.json（插件）           每个 session 的 persona / memory / tts
secrets.json（插件）         SiliconFlow / Hindsight Key
Hindsight Docker volume     事实记忆
tts-cache/                   Edge TTS MP3 缓存（工作区）
Edge TTS helper (5050)       DSH 之外的 Python HTTP 服务
```

本机额外把 Edge TTS 放到独立 helper（5050）：DSH Host 的 Python 子进程在 Windows 沙箱下不能写 `%USERPROFILE%`，直连 Edge TTS 也可能被代理/网络策略影响。helper 由 Startup 脚本启动，DSH 只访问 loopback HTTP。

原则：

- 模型能看到的内容必须能从 Session log 重建；
- 插件状态只是派生配置，不写自定义 Session 事件；
- 记忆库是外部系统，插件只负责桥接；
- 音频不落盘，转写文字才进入 Session。

## 关键设计选择

1. **不写自定义 Session event**：DSH 对未知事件类型有兼容限制；插件状态放 JSON 文件，避免破坏会话可恢复性。
2. **硬门禁用 guard，而不是只靠 prompt**：prompt 是软引导；guard 是单调拒绝，改不回来。
3. **UI 用 fetch 路由而不是远程 RPC**：不需要 Typert codegen；`ctx.connection.fetch` 自带 owner 认证。
4. **WAV 在浏览器转换**：避免 iPhone 的 mp4/webm 格式差异和主机 ffmpeg 依赖。
5. **Edge TTS 用 Python 子进程**：Node 侧零依赖；失败可用文件 bridge 诊断，不依赖管道。
6. **离线蒸馏不接运行时**：按需求保持一次性脚本，避免把长任务塞进对话循环。
