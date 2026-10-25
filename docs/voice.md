# 语音：ASR 与 Edge TTS

## 录音与转写流程

```text
点“说话”
  → getUserMedia（iPhone 必须 HTTPS）
  → MediaRecorder 录音（webm/opus 或 mp4）
  → 停止后解码 / 重采样为 16 kHz 单声道 PCM16 WAV
  → POST /api/xiaoyuer/asr（DSH 登录 cookie）
  → 主机转发 SiliconFlow /v1/audio/transcriptions
  → 返回文字
  → 用 Session.prompt(..., 'queue') 自动发送
  → 文字作为普通用户消息进入会话历史
```

为什么在浏览器里转 WAV：

- iPhone Safari 的 MediaRecorder 常输出 `audio/mp4`，不同版本差异大；
- WAV 16 kHz 单声道是 ASR 最稳的输入；
- 转换使用 Web Audio API，不需要上传原始格式或安装 ffmpeg。

## SiliconFlow 配置

默认：

```yaml
asrEndpoint: https://api.siliconflow.cn/v1/audio/transcriptions
asrModel: FunAudioLLM/SenseVoiceSmall
```

密钥来源优先级：

1. 配置 `siliconflowApiKey`
2. 环境变量 `SILICONFLOW_API_KEY` 或 `XIAOYUER_ASR_API_KEY`
3. `%DSH_HOME%\xiaoyuer\secrets.json` 的 `siliconflowApiKey`

> DeepSeek API Key 不能用于 SiliconFlow ASR。判断方法：`GET https://api.siliconflow.cn/v1/models` 带该 Key 返回 200 才是 SiliconFlow Key；返回 401 则不是。

## 没有 SiliconFlow Key 时的临时回退

如果 `health.asr.configured` 为 `false`，工具栏会自动退回浏览器内置 `SpeechRecognition`（Safari 的 `webkitSpeechRecognition` / Chrome 的 `SpeechRecognition`）：

- 使用浏览器/系统自带的在线识别，不经过 DSH 主机；
- 只在没有配置 SiliconFlow 时触发；
- 识别文字仍通过 `Session.prompt` 自动发送；
- 兼容性和隐私取决于浏览器厂商，不能替代 SiliconFlow；
- 如果浏览器不支持，会提示“未配置 SiliconFlow Key，且当前浏览器不支持内置语音识别”。

正式使用时仍建议配置 SiliconFlow Key。

## TTS 流程

```text
assistant/message 提交
  → 只取 text block，去掉 Markdown / 代码 / 链接
  → POST /api/xiaoyuer/tts
  → DSH 主机 POST http://127.0.0.1:5050/tts（本地 helper）
  → helper 调用 .venv 里的 edge-tts CLI
  → 生成 MP3（按文本 hash 缓存）
  → 浏览器 fetch → AudioContext.decodeAudioData → 播放
```

为什么走 helper：当前机器上 DSH Host 派生的 Python 子进程不能写 `%USERPROFILE%\.dsh`，直连 Edge TTS 也会返回 `NoAudioReceived`。helper 在 DSH 之外运行，只通过 loopback HTTP 提供服务。

- 默认音色：`zh-CN-XiaoxiaoNeural`
- 默认语速/音高：`+0%` / `+0Hz`
- 单次最多 1500 字
- Edge TTS 偶发 `NoAudioReceived`，helper 和插件都会重试
- 相同文本命中工作区缓存，不再请求微软服务
- 缓存目录用 `ttsCacheDir: <repo>\.cache\tts`，因为 Python 子进程只对工作区有写权限

### 安装/修复

```powershell
scripts\setup-voice.ps1
scripts\start-voice-server.ps1
```

检查：

```powershell
Invoke-RestMethod http://127.0.0.1:5050/health
Invoke-RestMethod http://127.0.0.1:3000/api/xiaoyuer/health
```

`tts.ok` 必须为 `true`，server 模式会返回 `server: http://127.0.0.1:5050`。

### 音色

```yaml
edgeTtsVoice: zh-CN-XiaoyiNeural
```

列出音色：

```powershell
.\.venv\Scripts\python.exe -m edge_tts --list-voices
```

Edge TTS 是微软的通用神经网络音色，不是“前女友”的声音。本项目不做声音克隆。

## 自动播放限制

iOS Safari 只有在用户手势之后才允许播放音频。工具栏的 **说话** 按钮会先创建/恢复 `AudioContext`，所以之后到达的 TTS 一般可以播放。如果仍然没有声音：

1. 点一次 **说话**，再取消/停止；
2. 确认静音拨片和媒体音量；
3. 确认 `tts.ok`；
4. 刷新页面后重试。

## 转录文字与历史

- 音频不写入会话，也不落盘；只在 ASR 请求中短暂存在。
- 转写文字通过普通 `Session.prompt` 发送，因此会出现在会话历史、可编辑、可复制。
- 如果识别错，直接在输入框改字重发即可。
- 语音和文字共用同一个会话人设/记忆开关。

## 性能

| 环节 | 典型耗时 | 说明 |
|---|---|---|
| 录音转 WAV | < 300 ms | 取决于录音长度和手机性能 |
| SiliconFlow 转写 | 0.5–3 s | 网络 + 音频长度 |
| 模型回复 | 取决于模型 | 与普通 DSH 对话一致 |
| Edge TTS | 0.8–3 s | 首次合成；缓存命中 < 50 ms |

想更快：

- 缩短单次说话时长（10–20 秒最稳）；
- 使用更快的对话模型；
- 保持 Hindsight 与 DSH 在同一台电脑；
- 不要同时开太多 Safari 标签。

## 安全

- `/api/xiaoyuer/asr`、`/tts`、`/state` 都注册在 DSH 的认证 Fetch 通道上，只接受 owner 登录 cookie；不是裸 HTTP 接口。
- 不要把 SiliconFlow Key 放进前端代码或 bundle 配置。
- 转写内容会进入会话历史，等同于你手动打字；敏感信息请勿口述。
