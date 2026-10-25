# 安装与配置

## 前置条件

- Windows 10/11（本仓库脚本以 PowerShell 为主）
- DeepSeek Harness 0.2.1+（当前测试版本 `0.2.1-rc.3`）
- Python 3.10+（Edge TTS 用）
- Docker Desktop（运行 Hindsight）
- SiliconFlow API Key（语音转写）
- 一个 Hindsight 可用的大模型 API Key（事实抽取）

> 如果 PowerShell 阻止运行脚本，在命令前加：
>
> ```powershell
> powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup-voice.ps1
> ```
>
> 仓库内 `.ps1` 已保存为 UTF-8 with BOM，兼容 Windows PowerShell 5.1。

## 1. 启动 Hindsight

```powershell
Copy-Item .env.example .env
notepad .env
scripts\start-hindsight.ps1
```

`.env` 至少需要：

```dotenv
HINDSIGHT_API_LLM_PROVIDER=openai
HINDSIGHT_API_LLM_MODEL=gpt-4o-mini
HINDSIGHT_API_LLM_API_KEY=sk-...
```

健康检查：

```powershell
Invoke-RestMethod http://localhost:8888/health
```

也可以直接使用用户给出的命令：

```bash
docker run -it --pull always --name hindsight --restart unless-stopped \
  -p 8888:8888 -p 9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=openai \
  -e HINDSIGHT_API_LLM_API_KEY=$OPENAI_API_KEY \
  -v hindsight-data:/home/hindsight/.pg0 \
  ghcr.io/vectorize-io/hindsight:latest
```

## 2. 安装 Edge TTS

```powershell
scripts\setup-voice.ps1
```

它会：

1. 创建仓库根目录的 `.venv`；
2. 安装/更新 `edge-tts`；
3. 用 `zh-CN-XiaoxiaoNeural` 合成一句测试音频；
4. 把 Python 绝对路径写入 `%USERPROFILE%\.dsh\xiaoyuer\python.txt`。

插件按以下顺序找 Python：

1. 配置 `pythonPath`
2. 环境变量 `XIAOYUER_PYTHON`
3. `python.txt`
4. 从插件目录、当前目录、`DSH_HOME` 向上找 `.venv` / `venv`
5. PATH 里的 `python` / `python3`

### 为什么本机还需要 TTS helper

当前这台机器上，DSH Host 启动的 Python 子进程：

- 不能写 `%USERPROFILE%\.dsh`（但能写工作区）；
- 直连 Microsoft Edge TTS 时返回 `NoAudioReceived`。

因此 TTS 改成一个**独立的本机 HTTP helper**：

```powershell
scripts\start-voice-server.ps1
```

它监听 `127.0.0.1:5050`，接收 `{text, voice, rate, pitch}`，调用 `.venv` 里的 `edge-tts` CLI，返回 MP3。DSH 插件只访问本机 HTTP，不再直接派生有网络/写权限问题的 Python 子进程。

profile 配置：

```yaml
- id: xiaoyuer
  config:
    ttsServerUrl: http://127.0.0.1:5050
    ttsCacheDir: <repo>\.cache\tts
```

`ttsCacheDir` 放在工作区，因为 Python 子进程对 `%USERPROFILE%` 没有写权限。

启动项：

- `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Xiaoyuer EdgeTTS.vbs`
- `%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Xiaoyuer DSH Web.vbs`

## 3. 配置 SiliconFlow

```powershell
scripts\configure.ps1 -SiliconFlowApiKey "sk-..."
```

写入 `%USERPROFILE%\.dsh\xiaoyuer\secrets.json`：

```json
{
  "siliconflowApiKey": "sk-...",
  "hindsightApiKey": ""
}
```

也可以使用环境变量 `SILICONFLOW_API_KEY`。环境变量优先级高于 secrets 文件。

> 注意：SiliconFlow 和 DeepSeek 的 Key 不通用。`your-key` 已确认是 DeepSeek Key，用于 Hindsight；填到 `siliconflowApiKey` 会在 ASR 时返回 401。SiliconFlow Key 需要在 <https://cloud.siliconflow.cn> 单独创建。

> 修改 `secrets.json` 或 `python.txt` 后，需要重载/重启插件才会生效。Web profile 刷新页面通常不会重新读取 Host 配置；改完建议重启 `dsh web`。

> `secrets.json` 是明文，但位于当前用户目录；不要提交 Git，不要放在共享目录。Hindsight 本地服务默认不需要 `hindsightApiKey`。

## 4. 安装 DSH 插件

### 方式 A：Plugins 页面（推荐，尤其 Desktop）

1. 打开 DSH Web 侧栏 → **Plugins**。
2. 选择安装本地 bundle / 本地目录。
3. 目录填：

   ```text
   <repo>\plugins\dsh-xiaoyuer
   ```

4. 安装完成后刷新页面。Desktop 应用建议完全退出再打开。

### 方式 B：CLI（普通 profile，例如 `web`）

```powershell
scripts\install-dsh.ps1 -Profile web
```

等价于：

```powershell
dsh plugin --profile web add "link:<repo>\plugins\dsh-xiaoyuer"
```

`dsh plugin add` 会把包加入 profile 依赖，并把 bundle 追加到 `dsh.profile.bundles`。

### Desktop profile 说明

`desktop` profile 由 Electron 应用管理。命令行 `dsh plugin --profile desktop` 可能被应用锁或权限挡住；请优先用 Plugins 页面安装。安装后需要完全退出 DSH 再启动，Host 代码才会重新加载。

## 5. 配置项

编辑 profile 的 `cordis.patch.yml`（不要改 `cordis.yml`），例如：

```yaml
- id: xiaoyuer
  config:
    endpoint: http://localhost:8888
    bankId: xiaoyu
    autoRemember: true
    systemPromptSection: true
    defaultPersona: ex
    defaultMemoryEnabled: true
    edgeTtsVoice: zh-CN-XiaoxiaoNeural
    edgeTtsRate: +0%
    edgeTtsPitch: +0Hz
    asrModel: FunAudioLLM/SenseVoiceSmall
    pythonPath: <repo>\.venv\Scripts\python.exe
```

注意：Loader 的 `config` 是整块替换，不是深合并；要保留的字段必须重新写全。

### 常用字段

| 字段 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `endpoint` | string | `http://localhost:8888` | Hindsight 根地址 |
| `bankId` | string | `xiaoyu` | 记忆库名；首次写入自动创建 |
| `hindsightApiKey` | string | 空 | 给 Hindsight 加 Bearer 时使用 |
| `autoRemember` | bool | `true` | 写入前要求模型先询问用户 |
| `systemPromptSection` | bool | `true` | 是否注入前女友人设 |
| `defaultPersona` | `ex` / `assistant` | `ex` | 新会话默认人设 |
| `defaultMemoryEnabled` | bool | `true` | 新会话默认记忆开关 |
| `siliconflowApiKey` | string | 空 | 可被 secrets/env 覆盖 |
| `asrEndpoint` | string | SiliconFlow 官方 | 可替换为兼容服务 |
| `asrModel` | string | `FunAudioLLM/SenseVoiceSmall` | 转写模型 |
| `asrLanguage` | string | 空 | 可选语言提示 |
| `maxAudioBytes` | int | 12 MiB | 录音大小上限 |
| `edgeTtsVoice` | string | `zh-CN-XiaoxiaoNeural` | Edge TTS 音色 |
| `edgeTtsRate` | string | `+0%` | 语速 |
| `edgeTtsPitch` | string | `+0Hz` | 音高 |
| `edgeTtsMaxChars` | int | 1500 | 单次播报最大字数 |
| `pythonPath` | string | 自动 | Edge TTS Python |
| `stateFile` | string | `%DSH_HOME%\xiaoyuer\state.json` | 会话设置 |
| `secretsFile` | string | `%DSH_HOME%\xiaoyuer\secrets.json` | 密钥文件 |
| `ttsCacheDir` | string | `%DSH_HOME%\xiaoyuer\tts-cache` | MP3 缓存 |

### 换音色

```yaml
edgeTtsVoice: zh-CN-YunxiNeural
```

查看可用音色：

```powershell
.\.venv\Scripts\python.exe -m edge_tts --list-voices
```

中文常用：`zh-CN-XiaoxiaoNeural`、`zh-CN-XiaoyiNeural`、`zh-CN-YunxiNeural`、`zh-CN-YunjianNeural`。

## 6. 验证安装

1. 打开任意会话，输入框上方应出现一条工具栏：
   - 左侧：状态点、**角色 / 普通助手** 分段按钮
   - 右侧：**记忆**、**播报**、**说话**
2. 点 **说话**，浏览器会请求麦克风；录音时显示秒数。
3. 点 **停止并发送**，应看到“正在转写…”然后是“已发送：…”。
4. AI 回复后应听到中文语音。
5. 切到 **普通助手**，记忆开关变灰且关闭。

如果没有工具栏：

- 确认 `@local/dsh-xiaoyuer` 已出现在 Plugins 列表；
- 刷新页面；
- 打开浏览器控制台看是否有 `slot entry crashed`；
- 确认 DSH 版本 ≥ 0.2.1。

## 7. 卸载

- Plugins 页面移除 `@local/dsh-xiaoyuer`；
- 或 CLI：

  ```powershell
  dsh plugin --profile web remove @local/dsh-xiaoyuer
  ```

- 可选清理：

  ```powershell
  Remove-Item "$env:USERPROFILE\.dsh\xiaoyuer" -Recurse -Force
  ```

  Docker 数据卷删除会丢失全部记忆：

  ```powershell
  docker compose down -v
  ```
