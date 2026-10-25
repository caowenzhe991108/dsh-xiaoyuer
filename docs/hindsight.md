# 本地 Hindsight

## 启动

推荐：

```powershell
Copy-Item .env.example .env
# 编辑 .env
scripts\start-hindsight.ps1
```

或直接：

```bash
docker run -it --pull always --name hindsight --restart unless-stopped \
  -p 8888:8888 -p 9999:9999 \
  -e HINDSIGHT_API_LLM_PROVIDER=openai \
  -e HINDSIGHT_API_LLM_API_KEY=$OPENAI_API_KEY \
  -v hindsight-data:/home/hindsight/.pg0 \
  ghcr.io/vectorize-io/hindsight:latest
```

数据在 Docker volume `hindsight-data` 中；删除容器不会丢数据，`docker compose down -v` 才会。

## DeepSeek + 中文 embedding

本机使用的组合：

```dotenv
HINDSIGHT_API_LLM_PROVIDER=deepseek
HINDSIGHT_API_LLM_MODEL=deepseek-v4-pro
HINDSIGHT_API_LLM_API_KEY=sk-...
HF_ENDPOINT=https://hf-mirror.com
HINDSIGHT_API_EMBEDDINGS_LOCAL_MODEL=BAAI/bge-small-zh-v1.5
HINDSIGHT_API_RERANKER_PROVIDER=rrf
```

注意：

- Hindsight 的 DeepSeek provider 不支持 embedding；embedding 必须留在 `local`（默认）或其他支持 embedding 的 provider。
- 默认 embedding 是英文模型 `BAAI/bge-small-en-v1.5`；中文记忆建议 `BAAI/bge-small-zh-v1.5`。
- Hugging Face 在国内通常需要 `HF_ENDPOINT=https://hf-mirror.com`，否则启动会卡在模型下载并最终失败。
- 首次启动要下载 embedding 模型，可能 2–5 分钟；设置 `start_period: 300s` 避免被误判。
- `deepseek-flash` 在本机抽取时返回 0 条事实；改用 `deepseek-v4-pro` 后正常。模型能力会直接影响事实抽取质量。
- **reranker 设为 `rrf`**：Hindsight 1.1.0 的本地 MiniLM reranker 是英文模型，中文候选分数几乎一样，会把“示例行业 商务”这种直接事实排到第 10 位；改用 RRF 融合后，它排到第 1 位。`HINDSIGHT_API_RERANKER_PROVIDER=none` 在 1.1.0 不支持，必须是 `rrf`。

容器日志应出现：

```text
LLM: provider=deepseek, model=deepseek-v4-pro
Embeddings: provider=local
Reranker: provider=rrf
Hindsight is running!
```

## 健康检查

```powershell
Invoke-RestMethod http://localhost:8888/health
```

- `200`：API 可服务；
- `503`：数据库不可达；
- 连接失败：容器没起来 / 端口没映射 / 代理拦截。

## 记忆库

第一次写入时按 `bankId`（默认 `xiaoyu`）自动创建，不需要预创建。

当前 bank 已从旧名称克隆为 `xiaoyu`，旧库已删除。克隆会复制事实、observation、文档和审计历史，不重新调用 LLM 抽取：

```text
POST /v1/default/banks/{旧bank}/clone?target_bank_id=xiaoyu&include_data=true&include_bank_config=false&include_history=true
```

DSH 插件只使用三个 API：

```text
POST /v1/default/banks/{bank}/memories
POST /v1/default/banks/{bank}/memories/recall
GET  /health
```

写入 item 示例：

```json
{
  "items": [
    {
      "content": "她喜欢喝冰美式，不喜欢香菜。",
      "document_id": "dsh-remember:abc123",
      "context": "用户与前女友角色的对话",
      "tags": ["source:dsh", "persona:ex"],
      "metadata": { "source": "dsh-xiaoyuer" }
    }
  ],
  "async": false
}
```

召回请求：

```json
{
  "query": "她喜欢喝什么",
  "max_tokens": 1800,
  "budget": "mid"
}
```

召回返回 `{ "results": [...] }`；bank 还没写入任何内容时返回 404，插件会把它当作“没有记忆”，不报错。

## 事实抽取质量

Hindsight 不是“存原文”，而是用 LLM 从内容中抽取事实。为了质量：

- `context` 写清楚来源（例如“微信聊天 2024-05”“用户亲口说的”）；
- 一条记忆只写一个稳定事实；
- 重要日期、偏好、厌恶、共同经历分开写；
- 不要写入一次性情绪、密码、身份证、银行卡、门牌号；
- 需要固定原文时，可在 bank 配置里使用 `verbatim` 抽取模式（会偏离本项目的“事实条目”设计）。

## 幂等、去重与删除

- 插件用内容 SHA-256 生成 `document_id`；同一内容重复写入会 replace 同一 document，不会累积。
- 本地 `state.json` 另有一份已写入指纹，避免重复请求。
- 离线蒸馏同样使用 `distill:<sha256>`。
- 删除单条记忆：

  ```powershell
  # 先列出来
  curl.exe "http://localhost:8888/v1/default/banks/xiaoyu/memories/list?limit=50"
  # 删除文档（会删掉由它抽取出的记忆）
  curl.exe -X DELETE "http://localhost:8888/v1/default/banks/xiaoyu/documents/<document_id>"
  ```

  具体 API 以你所用 Hindsight 版本的 OpenAPI 为准：<https://hindsight.vectorize.io/openapi.json>。

## 备份

```powershell
docker run --rm -v hindsight-data:/data -v ${PWD}:/backup alpine `
  tar czf /backup/hindsight-data.tgz -C /data .
```

恢复时把压缩包解回同一 volume，再启动容器。

## 鉴权

本地默认无鉴权。若设置 `HINDSIGHT_API_KEY`：

```dotenv
HINDSIGHT_API_KEY=...
```

同时给 DSH 插件配置同名 `hindsightApiKey`，或写入 `secrets.json`。不要把带 Key 的地址写进前端。

## 测试替身

没有 Docker 时，可用仓库里的兼容 mock 验证协议：

```powershell
python scripts\mock_hindsight.py --port 8899 --persist .test\mock-hindsight.json
```

它只实现写入、召回、列表、健康检查，不做 LLM 事实抽取，也不代表 Hindsight 的真实检索质量。
