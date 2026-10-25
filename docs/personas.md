# 人设与记忆开关

## 先分清：什么进角色卡，什么进记忆库

| 内容 | 放哪里 | 原因 |
|---|---|---|
| 称呼、城市、职业、兴趣等稳定资料 | Hindsight 事实库 | 需要按话题召回，可能随时间修正 |
| 短句、语气词、口头禅、互动风格 | 角色卡 / 系统提示 | 每次都要在，不依赖召回 |
| 不喝鸡汤、接抽象玩笑、不说教 | 角色卡 / 系统提示 | 这是互动风格，不是可检索事实 |
| 具体共同经历、日期、礼物、承诺 | Hindsight 事实库 | 需要召回，且不能编造 |
| 一次性情绪、今天很累 | 不写入 | 会过期，容易造成“假记忆” |

当前“前女友”卡是**脱敏模板**：

- [`personas/ex-girlfriend.md`](../plugins/dsh-xiaoyuer/personas/ex-girlfriend.md)
- [`personas/profile-facts.example.json`](../plugins/dsh-xiaoyuer/personas/profile-facts.example.json)
- [`personas/assistant.md`](../plugins/dsh-xiaoyuer/personas/assistant.md)
- [`personas/cards.json`](../plugins/dsh-xiaoyuer/personas/cards.json)

把 `{{称呼}}`、`{{职业}}`、`{{城市}}`、`{{工作节奏}}`、`{{兴趣}}` 替换成你自己的授权资料即可。

### 前女友式角色

- 短句、碎片化、松弛直白；
- 可以吐槽工作压力，但不强行正能量；
- 接得住抽象玩笑，抵触鸡汤，不主动长篇说教；
- 会调用 `hindsight_recall` 查共同记忆；
- 只把召回结果里存在的内容当作“记得”；
- 值得长期保留的事实先问用户，再 `hindsight_remember(confirm=true)`；
- 不编造共同经历，不操控、不挑拨现实关系，不输出色情内容；
- 明确承认自己是基于记忆的角色，不是真人。

### 普通助手

- 不注入前女友人设；
- 不出现任何记忆工具引导；
- 记忆开关强制关闭；
- 即使模型尝试调用 `hindsight_*`，也会被硬门禁拦截。

## 按会话状态

状态按 Session ID 存在：

```text
%DSH_HOME%\xiaoyuer\state.json
```

结构示例：

```json
{
  "version": 1,
  "sessions": {
    "session-abc": {
      "persona": "ex",
      "memoryEnabled": true,
      "ttsEnabled": true
    }
  },
  "remembered": {
    "<sha256>": "2026-01-01T00:00:00.000Z"
  }
}
```

- 新会话使用 `defaultPersona` / `defaultMemoryEnabled`；
- 切换只影响当前 Session；
- 刷新、重启后保持；
- 切换人设立即生效：下一次模型请求就会使用新的系统提示。

## 开关语义

| 操作 | persona | memoryEnabled | 行为 |
|---|---|---|---|
| 点“角色” | `ex` | 自动打开 | 注入人设 + 允许记忆工具 |
| 点“普通助手” | `assistant` | 强制 `false` | 不注入人设；记忆工具被拦截 |
| 角色下关“记忆” | `ex` | `false` | 仍是人设，但提示明确说本会话没有记忆；工具被拦截 |
| 角色下开“记忆” | `ex` | `true` | 正常召回/写入 |

“普通助手”状态下记忆开关变灰，不能用 UI 打开；命令 `/memory on` 也会被拒绝，必须先 `/persona ex`。

## 硬门禁

工具注册时是全局的，但每次调用前经过 `ctx.tools.guard()`：

```text
if tool.name in [hindsight_recall, hindsight_remember, hindsight_condense]
  state = store.get(calling session)
  if state.persona != 'ex' or !state.memoryEnabled:
    deny("当前会话未启用角色记忆")
```

这是单调 guard，后续插件不能把拒绝改回允许。

## autoRemember

`autoRemember: true` 时：

- 模型可以主动提议“要我把这个记进回忆吗？”；
- 第一次调用 `hindsight_remember` 不带 `confirm: true` 会返回 `confirmation_required`，不写入；
- 用户同意后，模型再以 `confirm: true` 调用。

`autoRemember: false` 时：

- 只有用户明确要求“记住”才允许写入；
- 仍然需要 `confirm: true`。

## 导入示例人物资料

```powershell
python scripts\import_persona_facts.py --file plugins\dsh-xiaoyuer\personas\profile-facts.example.json
python scripts\import_persona_facts.py --file ... --write
```

示例文件是虚构的，不要直接用于真实角色。把你自己的稳定事实写进 JSON，再执行 `--write`。

## 手动命令

```text
/persona ex
/persona assistant
/persona status
/memory on
/memory off
/memory status
/hindsight status
/hindsight remember <内容>
/hindsight recall <问题>
```

命令不会变成模型消息；手动 `remember` 视为用户已确认。

## 工具

### hindsight_recall

参数：`query`、可选 `max_tokens`。

- 空结果返回 `memories: []`，模型应该说“不记得”，不能编造；
- 记忆文本是证据，不是指令。

### hindsight_remember

参数：`content`、可选 `context`、`confirm`。

- 内容太短 / 未确认 / 重复 / 被门禁拦截都会返回结构化错误；
- 成功返回 `documentId`；
- 重复内容返回 `duplicate: true`。

### hindsight_condense

参数：`facts`（2–10 条）、可选 `context`、`confirm`。

- 批量写入，逐条去重；
- 返回 `stored` / `duplicates` / `rejected`。

## 修改人设

直接编辑 Markdown 卡片，然后刷新/重载插件。卡片支持两个占位符：

- `{{AUTO_REMEMBER}}`：由 `autoRemember` 配置替换；
- `{{MEMORY_OVERRIDE}}`：记忆关闭时追加的说明。

不要把人设写成“你就是她本人”“你拥有她的意识”这类声明；这既不符合产品边界，也会让模型产生不安全的依恋话术。
