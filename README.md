# DSH 前女友语音记忆助手（脱敏版）

一个跑在 DeepSeek Harness（DSH）上的、可切换人设的语音聊天助手：

- iPhone Safari / Chrome 通过 Tailscale HTTPS 打开 DSH；
- 点麦克风说话 → ASR 转写 → 自动发送到当前会话；
- AI 回复通过 Edge TTS 播放；
- 每个会话独立选择“角色 / 普通助手”，并独立开关 Hindsight 记忆；
- 角色会话可召回长期记忆；普通助手会话中记忆工具被硬拦截；
- 聊天记录可用离线脚本蒸馏成事实条目，写入本地 Hindsight。

> 这不是真人。项目只做基于用户整理并授权的事实记忆的统计性模仿，不还原真实人格，也不替代现实关系。
>
> 本仓库是**脱敏版**：角色卡是模板，示例事实为虚构；请替换成你自己整理、已获得授权使用的资料。

## 架构

```text
iPhone Safari
  └─ Tailscale HTTPS / MagicDNS
      └─ DSH Web（电脑）
          ├─ @local/dsh-xiaoyuer
          │   ├─ 会话工具栏：角色 / 普通助手、记忆、播报、麦克风
          │   ├─ /api/xiaoyuer/asr  → ASR 服务
          │   ├─ /api/xiaoyuer/tts  → Edge TTS → MP3
          │   ├─ /api/xiaoyuer/state → 按会话持久化设置
          │   ├─ 系统提示：角色卡（普通助手不注入）
          │   └─ 工具：hindsight_recall / remember / condense
          │        └─ Hindsight HTTP API（localhost:8888）
          └─ 会话历史：语音转写文字作为普通用户消息留存

离线：
聊天记录 txt/csv/json → scripts/distill_chat.py → memories.md / facts.jsonl / persona.md
  → Hindsight /memories（或生成 /hindsight remember 命令）
```

## 功能

| 模块 | 说明 |
|---|---|
| 语音输入 | 浏览器 MediaRecorder → WAV → 主机转发 ASR → 自动发送 |
| 语音播报 | assistant 消息 → Edge TTS → MP3 → 浏览器播放 |
| 角色切换 | 按 Session 保存 persona，普通助手强制关闭记忆 |
| 记忆工具 | `hindsight_recall`、`hindsight_remember`、`hindsight_condense` |
| 硬门禁 | `ctx.tools.guard` 拒绝普通助手会话的 `hindsight_*` 调用 |
| 离线蒸馏 | 过滤噪声、提取事实、输出 Markdown/JSONL、幂等写入 |
| 手机访问 | Tailscale HTTPS + MagicDNS，麦克风要求安全上下文 |

## 快速开始

### 1. Hindsight

```powershell
Copy-Item .env.example .env
# 编辑 .env，填入 Hindsight 使用的大模型 Key
scripts\start-hindsight.ps1
```

验证：

```powershell
Invoke-RestMethod http://localhost:8888/health
```

### 2. Edge TTS

```powershell
scripts\setup-voice.ps1
scripts\start-voice-server.ps1
```

TTS helper 监听 `127.0.0.1:5050`，避免 DSH Host 的 Python 子进程受 Windows 沙箱的网络/写权限限制。

### 3. ASR Key

```powershell
scripts\configure.ps1 -SiliconFlowApiKey "your-key"
```

也可以设置环境变量 `SILICONFLOW_API_KEY`。没有 Key 时客户端会回退到浏览器内置识别。

### 4. 安装 DSH 插件

```powershell
scripts\install-dsh.ps1 -Profile web
```

或使用 DSH 的 Plugins 页面安装本地目录：

```text
<repo>\plugins\dsh-xiaoyuer
```

### 5. 手机访问

见 [iPhone + Tailscale](docs/iphone-tailscale.md)。核心是：

```text
dsh --profile web --host 127.0.0.1 --port 3000 --no-open `
  --public-url https://<your-magicdns> --trusted-host <your-magicdns>

tailscale serve --bg --https=443 http://127.0.0.1:3000
```

## 角色卡与记忆的拆分

| 内容 | 放哪里 |
|---|---|
| 说话方式、语气、口头禅、互动风格 | `personas/ex-girlfriend.md` 系统提示 |
| 称呼、城市、职业、兴趣等稳定资料 | Hindsight 事实库 |
| 具体共同经历、日期、礼物、承诺 | 后续从聊天记录蒸馏进 Hindsight |
| 一次性情绪、寒暄 | 不写入 |

模板文件：

- [`personas/ex-girlfriend.md`](plugins/dsh-xiaoyuer/personas/ex-girlfriend.md)
- [`personas/profile-facts.example.json`](plugins/dsh-xiaoyuer/personas/profile-facts.example.json)
- [`personas/assistant.md`](plugins/dsh-xiaoyuer/personas/assistant.md)

导入示例事实：

```powershell
python scripts\import_persona_facts.py --file plugins\dsh-xiaoyuer\personas\profile-facts.example.json
python scripts\import_persona_facts.py --file ... --write
```

## 离线蒸馏

```powershell
python scripts\distill_chat.py tests\fixtures\sample_chat.txt --out distill-output
python scripts\distill_chat.py tests\fixtures\sample_chat.txt `
  --out distill-output --write --endpoint http://localhost:8888 --bank xiaoyu
```

输出：`memories.md`、`facts.jsonl`、`persona.md`、可选 `commands.txt`、`write-log.json`。

## 配置

插件默认配置在 [`cordis.patch.yml`](plugins/dsh-xiaoyuer/cordis.patch.yml)：

| 字段 | 默认 | 说明 |
|---|---|---|
| `endpoint` | `http://localhost:8888` | Hindsight 地址 |
| `bankId` | `xiaoyu` | 记忆库名 |
| `autoRemember` | `true` | 写入前要求模型询问 |
| `edgeTtsVoice` | `zh-CN-XiaoxiaoNeural` | Edge TTS 音色 |
| `ttsServerUrl` | 空 | 本机 TTS helper |
| `siliconflowApiKey` | 空 | 可被环境变量/secrets 覆盖 |

密钥优先级：配置 → 环境变量 → `%DSH_HOME%\xiaoyuer\secrets.json`。

## 测试

```powershell
scripts\acceptance.ps1
```

覆盖：

- JS 语法与 Markdown 链接；
- 客户端 Slot 注册；
- 三个 Hindsight 工具、硬门禁、会话隔离；
- 确认写入、去重、批量写入；
- ASR/TTS 路由；
- 离线蒸馏 ≥10 条事实写入 mock Hindsight。

## 安全与隐私

- 音频只在 ASR 请求中短暂传输；写入会话的是转写文字。
- 记忆库保存的是你整理的事实，不是真人。
- 不要把 API Key、聊天记录、`secrets.json`、`PHONE_URL.txt` 提交到 Git。
- 使用他人聊天记录/声音前，确认你有合法依据和授权。
- 不用于骚扰、跟踪、冒充、诈骗或操控。
- 角色卡和示例事实是模板；请替换成自己的授权资料。

详见 [隐私与授权](docs/privacy.md)。

## 限制

- Edge TTS 是通用音色，不是真人声音；不做声音克隆。
- 输出是统计性模仿，可能出错、过时或与真人矛盾。
- 记忆门禁是工具调用拦截，不是操作系统级权限隔离。
- 手机麦克风需要 HTTPS；Tailscale Serve 是推荐方式。
- 本项目不包含真实用户数据；脱敏版不保证与作者本地部署完全一致。

## 文档

- [安装与配置](docs/install.md)
- [Hindsight](docs/hindsight.md)
- [iPhone + Tailscale](docs/iphone-tailscale.md)
- [语音](docs/voice.md)
- [人设与记忆](docs/personas.md)
- [离线蒸馏](docs/distill.md)
- [验收](docs/acceptance.md)
- [故障排查](docs/troubleshooting.md)
- [隐私](docs/privacy.md)

## License

MIT
