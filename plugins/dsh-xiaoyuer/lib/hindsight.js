export class HindsightError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'HindsightError';
    this.code = options.code ?? 'hindsight_error';
    this.status = options.status;
  }
}

function clampText(value, max) {
  const text = typeof value === 'string' ? value.trim() : '';
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function errorDetail(body, fallback) {
  if (typeof body === 'string' && body.trim() !== '') return clampText(body, 300);
  if (body !== null && typeof body === 'object') {
    const detail = body.detail ?? body.message ?? body.error;
    if (typeof detail === 'string') return clampText(detail, 300);
    if (detail !== undefined) {
      try {
        return clampText(JSON.stringify(detail), 300);
      } catch {
        return fallback;
      }
    }
  }
  return fallback;
}

/**
 * Small dependency-free client for the Hindsight HTTP API.
 * Endpoints follow the 1.x API: `/v1/default/banks/{bank}/memories` and
 * `/v1/default/banks/{bank}/memories/recall`.
 */
export class HindsightClient {
  constructor(options) {
    this.endpoint = options.endpoint.replace(/\/+$/, '');
    this.bankId = options.bankId;
    this.apiKey = options.apiKey;
    this.timeoutMs = options.timeoutMs;
  }

  #bankPath(suffix = '') {
    return `${this.endpoint}/v1/default/banks/${encodeURIComponent(this.bankId)}${suffix}`;
  }

  async #request(url, init, signal) {
    const controller = new AbortController();
    const onAbort = () => controller.abort(signal?.reason ?? new Error('aborted'));
    if (signal?.aborted) controller.abort(signal.reason);
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs);
    try {
      const headers = { ...(init.headers ?? {}) };
      if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;
      return await fetch(url, { ...init, headers, signal: controller.signal });
    } catch (error) {
      if (controller.signal.reason?.message === 'timeout') {
        throw new HindsightError(`Hindsight 请求超时（${this.timeoutMs}ms）。`, { code: 'hindsight_timeout' });
      }
      if (signal?.aborted) throw new HindsightError('请求已取消。', { code: 'hindsight_aborted' });
      throw new HindsightError(`无法连接 Hindsight：${error.message}`, { code: 'hindsight_unreachable' });
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    }
  }

  async #json(response) {
    const text = await response.text();
    if (text.trim() === '') return {};
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  /** Cheap readiness check used by the UI health dot. */
  async health(signal) {
    try {
      const response = await this.#request(`${this.endpoint}/health`, { method: 'GET' }, signal);
      return {
        ok: response.ok,
        status: response.status,
        bankId: this.bankId,
        endpoint: this.endpoint,
      };
    } catch (error) {
      return {
        ok: false,
        status: 0,
        bankId: this.bankId,
        endpoint: this.endpoint,
        error: error.message,
      };
    }
  }

  /**
   * Store one or more raw content items. Hindsight extracts facts itself.
   * `documentId` makes the write idempotent: the same id replaces the prior
   * document instead of duplicating it.
   */
  async retain(items, signal) {
    const payload = {
      items: items.map((item) => ({
        content: clampText(item.content, 8_000),
        ...(item.documentId ? { document_id: item.documentId } : {}),
        ...(item.context ? { context: clampText(item.context, 200) } : {}),
        ...(Array.isArray(item.tags) && item.tags.length > 0 ? { tags: item.tags } : {}),
        ...(item.metadata && typeof item.metadata === 'object' ? { metadata: item.metadata } : {}),
        ...(item.timestamp ? { timestamp: item.timestamp } : {}),
      })),
      async: false,
    };
    const response = await this.#request(
      this.#bankPath('/memories'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      },
      signal,
    );
    const body = await this.#json(response);
    if (!response.ok) {
      throw new HindsightError(
        `Hindsight 写入失败（HTTP ${response.status}）：${errorDetail(body, 'unknown error')}`,
        { code: 'hindsight_retain_failed', status: response.status },
      );
    }
    return {
      success: body?.success !== false,
      bankId: body?.bank_id ?? this.bankId,
      itemsCount: body?.items_count ?? items.length,
      async: body?.async === true,
    };
  }

  /**
   * Recall facts. A missing bank is an empty result, not an error: Hindsight
   * creates banks on first write and returns 404 for reads before that.
   */
  async recall({ query, maxTokens = 2_000, budget = 'mid', types }, signal) {
    const response = await this.#request(
      this.#bankPath('/memories/recall'),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query,
          max_tokens: maxTokens,
          budget,
          ...(Array.isArray(types) && types.length > 0 ? { types } : {}),
        }),
      },
      signal,
    );
    if (response.status === 404) return { results: [], bankMissing: true };
    const body = await this.#json(response);
    if (!response.ok) {
      throw new HindsightError(
        `Hindsight 召回失败（HTTP ${response.status}）：${errorDetail(body, 'unknown error')}`,
        { code: 'hindsight_recall_failed', status: response.status },
      );
    }
    const raw = Array.isArray(body) ? body : Array.isArray(body?.results) ? body.results : Array.isArray(body?.memories) ? body.memories : [];
    const unique = new Map();
    for (const item of raw) {
      const text = clampText(item?.text ?? item?.content ?? '', 1_200);
      if (text === '') continue;
      // Hindsight appends "| Involving: ..." to raw facts and may also return a
      // consolidated observation with the same wording. Keep one copy.
      const key = text
        .split(' | Involving:')[0]
        .replace(/[\s。.!！?？；;："“”]/g, '')
        .toLowerCase();
      const score = item?.scores?.final ?? item?.score ?? 0;
      const previous = unique.get(key);
      if (previous === undefined || score > previous.score) {
        unique.set(key, {
          id: item?.id ?? undefined,
          text,
          type: item?.type ?? 'world',
          context: item?.context ?? null,
          score,
          occurredAt: item?.occurred_start ?? item?.occurredAt ?? null,
          mentionedAt: item?.mentioned_at ?? null,
          documentId: item?.document_id ?? null,
        });
      }
    }
    return {
      results: [...unique.values()].sort((left, right) => right.score - left.score).slice(0, 8),
      bankMissing: false,
    };
  }
}
