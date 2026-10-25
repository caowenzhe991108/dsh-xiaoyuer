# 故障排查

## 工具栏不出现

**现象**：会话输入框上方没有“角色 / 普通助手”工具栏。

检查：

1. Plugins 页面是否有 `@local/dsh-xiaoyuer`，且已启用；
2. 页面刷新；
3. 浏览器控制台是否有：
   - `slot entry crashed in 'conversation.input.dock'`
   - `@local/dsh-xiaoyuer/client.js` 404
4. DSH 版本是否 ≥ 0.2.1；
5. 如果刚替换了 `client.js`，Desktop 需要重启，Web 刷新页面。

## 状态 API 404

插件路由在 `/api/xiaoyuer/...`，不是 `/xiaoyuer/api/...`。

```text
正确：/api/xiaoyuer/state
错误：/xiaoyuer/api/state
```

如果 `/api/xiaoyuer/state` 也 404，说明 Host 插件没激活或连接服务没加载。

## 401 / 403

- 401：没有登录 cookie。用 DSH 打印的带 token URL 重新登录。
- 403：Host/Origin 不匹配。检查 `--trusted-host` 是否和浏览器地址完全一致。
- 通过 Tailscale Serve / 反向代理时，确认保留原始 Host，不要改写成 `127.0.0.1`。

## 麦克风按钮提示“需要通过 HTTPS”

iOS 只在安全上下文开放 `getUserMedia`。必须用 `https://` 域名访问，不能直接用 `http://100.x.y.z:3000`。

解决：按 [iPhone + Tailscale](iphone-tailscale.md) 配置 HTTPS。

## 麦克风权限被拒绝

- iOS 设置 → Safari → 麦克风 → 允许；
- 站点设置里重置权限；
- 关闭其他占用麦克风的 App；
- 重新加载页面再点 **说话**。

## “未配置 SiliconFlow API Key”

```powershell
scripts\configure.ps1 -SiliconFlowApiKey "sk-..."
```

或设置 `SILICONFLOW_API_KEY` 后重启 DSH。

确认：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/xiaoyuer/health
```

`asr.configured` 应为 `true`。

## ASR 失败

| 错误 | 排查 |
|---|---|
| `asr_not_configured` | 没有 Key |
| `asr_audio_too_large` | 录音超过 60 秒 / 12 MiB |
| `asr_empty_transcript` | 没说话、麦克风静音、环境太吵 |
| `asr_failed 401/403` | SiliconFlow Key 无效/余额不足 |
| `asr_timeout` | 网络慢，缩短录音或换网络 |
| `asr_unreachable` | 电脑无法访问 SiliconFlow |

## 没有声音

1. `/api/xiaoyuer/health` 的 `tts.ok`；
2. 运行 `scripts\setup-voice.ps1`；
3. 检查 `.venv\Scripts\python.exe` 是否存在；
4. 手动测试：

   ```powershell
   .\.venv\Scripts\python.exe -m edge_tts --voice zh-CN-XiaoxiaoNeural --text "测试" --write-media test.mp3
   ```

5. iPhone 静音拨片、媒体音量；
6. 先点一次 **说话** 解锁音频上下文；
7. Edge TTS 偶发失败，插件会重试 3 次；持续失败多半是网络。

## TTS 502 / NoAudioReceived

Edge TTS 依赖微软在线服务，偶发 `NoAudioReceived`。插件已自动重试；如果一直失败：

- 换网络（公司代理/防火墙可能拦截 WebSocket）；
- 更新 `edge-tts`：`scripts\setup-voice.ps1`；
- 换音色测试；
- 检查系统时间是否正确（影响 Edge token）。

## 记忆写不进去

- `/api/xiaoyuer/health` 的 `hindsight.ok`；
- `docker ps` 看 `hindsight` 容器；
- `Invoke-RestMethod http://localhost:8888/health`；
- `.env` 里抽取模型 Key 是否有效；
- DSH 日志里是否有 `hindsight_retain_failed`；
- 当前会话是否是“前女友 + 记忆开”。

## 记忆召不回

- 先确认写入成功（Hindsight 日志/列表）；
- Hindsight 是 LLM 抽取，不是原文搜索；问法要接近事实；
- 空 bank 返回 404，插件当空结果；
- 召回有 token 预算，事实太多时只返回最相关几条；
- 换 `budget: mid/high` 或提高 `max_tokens`（工具参数）。

## 普通助手仍“记得”

- 普通助手 prompt 不包含人设/记忆；
- 但同一会话历史里可能有之前前女友对话的文本，模型仍能看到历史。这是会话上下文，不是 Hindsight 召回。
- 想彻底分开：新建一个会话，选择普通助手。
- 记忆工具调用会被 guard 拒绝；如果模型仍然声称“记得”，那是它在根据当前会话历史说话，不是记忆库。

## 插件安装失败

- Desktop：用 Plugins 页面，不要手改 `package.json`；
- CLI：确认 `dsh` 在 PATH，或设 `$env:DSH_CLI`；
- 权限：写 `%USERPROFILE%\.dsh` 需要当前用户权限；
- 安装后完全退出 DSH 再启动；
- 查看 `%DSH_HOME%\profiles\<profile>\.plugin-manager\logs`。

## 重启后配置丢失

- DSH profile 里的 `cordis.patch.yml` 是否还在；
- `%DSH_HOME%\xiaoyuer\state.json` 是否可写；
- Docker volume 是否保留；
- Tailscale Serve 配置是否持久化（`tailscale serve status`）。
