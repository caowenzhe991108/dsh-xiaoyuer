# iPhone 通过 Tailscale 访问 DSH

目标：iPhone 和电脑在同一个 Tailscale 账号下，通过 MagicDNS + HTTPS 打开电脑上的 DSH Web；Safari 允许麦克风，完成语音对话。

> 不要使用 Tailscale Funnel 把 DSH 暴露到公网。本方案只需要 tailnet 内访问。

## 示例值

把下面这些值换成你自己的：

```text
Tailscale IP: 100.x.y.z
MagicDNS:    mypc.tailnet-xxxx.ts.net
DSH Web:     127.0.0.1:3000
Serve:       https://mypc.tailnet-xxxx.ts.net -> http://127.0.0.1:3000
```

手机地址每次 DSH 重启会换 token，启动脚本会写入：

```text
%USERPROFILE%\.dsh\xiaoyuer\phone-url.txt
```

如果 Safari 出现“找不到服务器”，先看电脑端：

```powershell
tailscale status
```

确认 iPhone 不是 `offline`，再打开上面的完整 URL（含 `?token=...`）。

快速区分 DNS 和登录问题：

```text
Safari 打开 https://mypc.tailnet-xxxx.ts.net
  出现 401 Unauthorized  -> MagicDNS/HTTPS 正常，只是缺 token，用完整 URL
  出现“找不到服务器”     -> iPhone 没有走 Tailscale DNS/VPN
```

## 1. Tailscale 基础

1. 电脑安装 Tailscale，登录账号 A。
2. iPhone 安装 Tailscale，登录同一个账号 A。
3. 在 Tailscale 管理后台 **DNS** 页面：
   - 开启 **MagicDNS**；
   - 开启 **HTTPS Certificates**。
4. 记下电脑的 MagicDNS 名称，例如：

   ```text
   mypc.tailnet-xxxx.ts.net
   ```

5. 在电脑上确认：

   ```powershell
   tailscale status
   tailscale ip -4
   ```

   `100.x.y.z` 是电脑的 Tailscale IP。

## 2. 启动 DSH Web

建议单独跑一个 `web` profile，不要和 Desktop 应用抢同一个 profile。

```powershell
# 安装插件到 web profile
scripts\install-dsh.ps1 -Profile web

# 启动；token URL 会打印出来
dsh --profile web --host 127.0.0.1 --port 3000 --no-open `
  --public-url https://mypc.tailnet-xxxx.ts.net `
  --trusted-host mypc.tailnet-xxxx.ts.net
```

`--host 127.0.0.1` 表示只监听本机；外部访问交给 Tailscale Serve。DSH 不支持 `0.0.0.0` 通配绑定。

### 2a. 方案 A：Tailscale Serve（推荐）

另开一个 PowerShell：

```powershell
tailscale serve --bg --https=443 http://127.0.0.1:3000
tailscale serve status
```

它会让下面这个地址可用：

```text
https://mypc.tailnet-xxxx.ts.net
```

首次使用会自动申请/续期 HTTPS 证书。HTTPS 由 Tailscale 终止，DSH 看到的是本机 HTTP；`--trusted-host` 和 `--public-url` 负责让 DSH 接受这个外部 Host。

如果打开后出现 401/403 或登录循环，改用方案 B。

### 2b. 方案 B：DSH 直接 TLS

```powershell
tailscale cert mypc.tailnet-xxxx.ts.net
# 会生成 mypc.tailnet-xxxx.ts.net.crt 和 .key

dsh --profile web --host 100.x.y.z --port 8443 --no-open `
  --tls-cert .\mypc.tailnet-xxxx.ts.net.crt `
  --tls-key .\mypc.tailnet-xxxx.ts.net.key `
  --public-url https://mypc.tailnet-xxxx.ts.net:8443 `
  --trusted-host mypc.tailnet-xxxx.ts.net:8443
```

打开：

```text
https://mypc.tailnet-xxxx.ts.net:8443
```

Windows 防火墙只需允许 DSH 在 Tailscale 网卡上监听 8443；不要把端口映射到公网。

## 3. 首次登录

`dsh web` 启动时会打印带一次性 token 的 URL，例如：

```text
https://mypc.tailnet-xxxx.ts.net/?token=...
```

在 iPhone Safari 打开这个完整 URL。DSH 会用 token 换一个 HttpOnly 登录 cookie，然后跳转到干净的地址。

- token 只能用一次、绑定当前 authority；
- 如果过期，重启 `dsh web`，用新打印的 URL；
- 不要把带 token 的 URL 发到聊天群或截图公开。

## 4. iPhone 麦克风

1. Safari 打开上面的 HTTPS 地址。
2. 点页面里的 **说话**。
3. iOS 弹出麦克风权限，选择 **允许**。
4. 说完点 **停止并发送**。
5. 第一次播放 AI 语音时，如果没声音：
   - 检查 iPhone 静音拨片；
   - 调大媒体音量；
   - 再点一次 **说话**（用户手势会解锁浏览器的音频播放）；
   - Safari 设置里确认该站点没有被禁止麦克风。

麦克风只在安全上下文可用：`https://` 或 `localhost`。Tailscale 的 HTTPS 证书就是为此准备的；普通 `http://100.x.y.z:3000` 在 iPhone 上无法录音。

## 5. 加到主屏幕（可选）

Safari → 分享 → **添加到主屏幕**。之后从主屏幕打开仍是同一个 HTTPS 源，cookie 和麦克风权限通常保留。

## 6. 常见问题

### 页面打不开

- `tailscale status` 看两台设备是否都在线；
- iPhone 是否能解析 MagicDNS：Safari 打开 `https://mypc.tailnet-xxxx.ts.net`；
- `tailscale serve status` 是否显示 443 → 3000；
- DSH 是否还在运行，`http://127.0.0.1:3000/` 在本机是否正常。

### 401 / 403

- 401：没有登录 cookie。用带 token 的完整 URL 重新打开；或重启 DSH 换新 token。
- 403：Host/Origin 不被信任。确认启动参数里 `--trusted-host` 与浏览器地址完全一致（含端口）；方案 A 的 Host 不带端口，方案 B 带 `:8443`。
- 通过反向代理时，代理必须保留原始 `Host`，不要把 Host 改写成 `127.0.0.1`。

### 麦克风按钮提示“需要通过 HTTPS”

说明当前不是安全上下文。检查地址栏是否是 `https://`，证书是否被 iOS 信任；Tailscale 证书由公共 CA 签发，通常不需要手动装根证书。

### 能录音但转写失败

- `%USERPROFILE%\.dsh\xiaoyuer\secrets.json` 里的 `siliconflowApiKey` 是否正确；
- DSH 的 `/api/xiaoyuer/health` 中 `asr.configured` 是否为 `true`；
- SiliconFlow 账户余额、模型权限、网络；
- 录音是否短于 1 秒或超过 60 秒。

### 有文字但没声音

- `/api/xiaoyuer/health` 的 `tts.ok` 是否为 `true`；
- 运行 `scripts\setup-voice.ps1`；
- Edge TTS 需要外网；失败时插件会重试 3 次；
- iPhone 是否处于静音/低电量模式；
- 先点一次 **说话** 解锁音频，再让助手回复。

### 重启后恢复

- Hindsight 容器 `restart: unless-stopped`；
- `dsh web` 需要你自己设为开机启动（任务计划程序或启动文件夹）；
- Tailscale Serve 配置会持久化；
- 插件设置和记忆都在 `%USERPROFILE%\.dsh\xiaoyuer` 与 Docker volume 中。

## 7. 安全建议

- 只在 tailnet 内使用，不开 Funnel；
- 给电脑设置锁屏密码；
- 不在共享电脑上保留登录 cookie；
- 定期检查 Tailscale 设备列表，移除不认识的设备；
- 记忆库包含隐私，备份和删除都要谨慎。
