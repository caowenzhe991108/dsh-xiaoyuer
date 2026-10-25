# 离线蒸馏

目标：把微信/QQ 等导出的聊天记录整理成“她喜欢 X / 她讨厌 Y / 她习惯 Z / 我们曾经……”的事实条目，写入 Hindsight。它不是运行时插件，不参与在线对话。

## 输入

支持：

- `.txt`：`2024-03-02 21:15:10 她: 我喜欢吃辣`、`她: ...`、或纯文本行；
- `.csv`：自动识别 `time/timestamp/时间`、`sender/from/昵称`、`text/content/内容` 列；
- `.json`：消息数组，或 `{ "messages": [...] }`。

编码自动尝试 UTF-8、GB18030、UTF-16。

## 运行

```powershell
# 只生成文件（默认）
python scripts\distill_chat.py tests\fixtures\sample_chat.txt --out distill-output

# 生成并写入本地 Hindsight
python scripts\distill_chat.py tests\fixtures\sample_chat.txt `
  --out distill-output --write `
  --endpoint http://localhost:8888 --bank xiaoyu `
  --min-facts 10

# 同时生成可在 DSH 里逐条执行的命令
python scripts\distill_chat.py tests\fixtures\sample_chat.txt `
  --out distill-output --emit-commands
```

## 输出

```text
distill-output/
  memories.md       人可读的事实清单（表格）
  facts.jsonl       每条事实一行 JSON
  persona.md        表达习惯 + 原话片段 + 事实摘要
  meta.json         输入、时间、数量
  commands.txt      可选：/hindsight remember ... 列表
  write-log.json    可选：写入批次与结果
```

样例（`tests/fixtures/sample_chat.txt`，20 条消息）会生成 14 条事实，包含：

- 她喜欢吃辣，但是不吃香菜
- 她讨厌下雨天
- 她每天早上都要喝一杯冰美式
- 她的生日是 11 月 3 日
- 我们第一次见面是在学校图书馆
- 她害怕打雷
- 她习惯睡前听周杰伦
- 她对芒果过敏
- 她想去看极光
- 她不喜欢别人迟到
- 她周末一般宅在家里看剧
- 她受不了烟味
- 她老家在成都
- 她最近在学做菜

## 规则

- 过滤：媒体占位符、系统提示、撤回、纯表情、纯语气词、过短消息、URL、时间戳。
- 抽取：喜好、厌恶、害怕、习惯、生日、过敏、不能吃、共同经历、目标、籍贯/生活状态。
- 归一化：第一人称改第三人称、去口语填充、限制长度、去重。
- 每条事实带 `category`、`confidence`、来源文件、时间。
- 默认少于 `--min-facts` 会返回退出码 3；用 `--allow-few` 忽略。

## 写入

- URL：`POST /v1/default/banks/{bank}/memories`
- 每批默认 5 条（Hindsight 单请求建议 2–10 条）。
- 每条使用 `document_id = distill:<sha256>`，重复运行会替换同一文档，不会重复累积。
- 标签：`source:distill`、`persona:ex`、`kind:distilled`。
- `write-log.json` 记录每批成功/失败；有失败返回退出码 4。
- `HINDSIGHT_API_KEY` 从环境变量读取。

## 质量提升

纯规则抽取稳定但保守。想要更自然的事实，可以：

1. 先人工清洗导出文件，去掉群聊和无关联系人；
2. 用 `--her-name` 指定她的昵称（可重复）；
3. 把 `memories.md` 人工过一遍，删掉一次性状态和误抽取；
4. 用 `commands.txt` 在 DSH 里逐条 `/hindsight remember`，写入前再确认；
5. 或者把清洗后的事实作为 `facts` 调 `hindsight_condense`。

不要在事实里写入：

- 密码、验证码、身份证、银行卡、精确住址；
- 第三方隐私；
- 未经授权的私密照片描述；
- 一次性的情绪和争吵细节。

## 恢复与重跑

- 重跑同一输入是幂等的：内容 hash 不变，document_id 不变。
- 改了某条事实的文字，会生成新 document，旧 document 仍在；需要手动删除旧 document。
- 删除整个库：`docker compose down -v`（不可恢复）。
