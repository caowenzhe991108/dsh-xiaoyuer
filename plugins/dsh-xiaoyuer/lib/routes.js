import { AsrError, transcribeAudio } from './asr.js';
import { TtsError } from './tts.js';

const MAX_JSON_BYTES = 64 * 1024;
const SESSION_ID = /^[A-Za-z0-9._:-]{1,200}$/;

function json(value, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  });
}

function failure(error, fallbackStatus = 500) {
  const status = Number.isInteger(error?.status) ? error.status : fallbackStatus;
  return json(
    {
      ok: false,
      code: error?.code ?? 'internal_error',
      message: error?.message ?? '请求失败。',
    },
    status,
  );
}

function sessionIdOf(url) {
  const sessionId = url.searchParams.get('sessionId') ?? '';
  return SESSION_ID.test(sessionId) ? sessionId : '';
}

async function readJson(request, limit = MAX_JSON_BYTES) {
  const header = request.headers.get('content-length');
  if (header !== null && Number(header) > limit) throw Object.assign(new Error('请求体过大。'), { status: 413 });
  const text = await request.text();
  if (Buffer.byteLength(text, 'utf8') > limit) throw Object.assign(new Error('请求体过大。'), { status: 413 });
  if (text.trim() === '') return {};
  try {
    const value = JSON.parse(text);
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('not an object');
    return value;
  } catch {
    throw Object.assign(new Error('请求体必须是 JSON 对象。'), { status: 400 });
  }
}

/**
 * Authenticated browser routes. Mounting through `ctx.connection.fetch`
 * inherits the Web carrier's owner-only admission, so microphone audio and
 * per-session state are never exposed by an unauthenticated HTTP route.
 */
export function registerRoutes(ctx, services) {
  const { store, hindsight, tts, config, logger } = services;
  const prefix = config.apiPrefix;
  let ttsStatusCache;

  ctx.inject(['connection'], (connectionCtx) => {
    const register = (path, methods, fetch) => {
      connectionCtx.effect(
        () =>
          connectionCtx.connection.fetch.register({
            path,
            methods,
            requestBody: 'buffered',
            fetch,
          }),
        `xiaoyuer: ${path}`,
      );
    };

    register(`${prefix}/state`, ['GET', 'POST'], async (request) => {
      try {
        if (request.method === 'GET') {
          const sessionId = sessionIdOf(new URL(request.url));
          if (!sessionId) return failure(Object.assign(new Error('缺少或非法的 sessionId。'), { status: 400 }));
          return json({ ok: true, ...store.get(sessionId) });
        }
        const body = await readJson(request);
        const sessionId = typeof body.sessionId === 'string' && SESSION_ID.test(body.sessionId) ? body.sessionId : '';
        if (!sessionId) return failure(Object.assign(new Error('缺少或非法的 sessionId。'), { status: 400 }));
        if (body.persona !== undefined && body.persona !== 'ex' && body.persona !== 'assistant') {
          return failure(Object.assign(new Error('persona 只能是 ex 或 assistant。'), { status: 400 }));
        }
        for (const key of ['memoryEnabled', 'ttsEnabled']) {
          if (body[key] !== undefined && typeof body[key] !== 'boolean') {
            return failure(Object.assign(new Error(`${key} 必须是布尔值。`), { status: 400 }));
          }
        }
        const state = store.update(sessionId, {
          ...(body.persona !== undefined ? { persona: body.persona } : {}),
          ...(body.memoryEnabled !== undefined ? { memoryEnabled: body.memoryEnabled } : {}),
          ...(body.ttsEnabled !== undefined ? { ttsEnabled: body.ttsEnabled } : {}),
        });
        return json({ ok: true, ...state });
      } catch (error) {
        return failure(error);
      }
    });

    register(`${prefix}/health`, ['GET'], async () => {
      try {
        const now = Date.now();
        if (ttsStatusCache === undefined || now - ttsStatusCache.at > 300_000) {
          ttsStatusCache = { at: now, value: await tts.available() };
        }
        const [hindsightStatus, ttsStatus] = await Promise.all([
          hindsight.health(),
          Promise.resolve(ttsStatusCache.value),
        ]);
        return json({
          ok: true,
          hindsight: hindsightStatus,
          tts: { ...ttsStatus, voice: config.edgeTtsVoice },
          asr: { configured: config.siliconflowApiKey !== '', model: config.asrModel },
          store: store.counts(),
        });
      } catch (error) {
        return failure(error);
      }
    });

    register(`${prefix}/asr`, ['POST'], async (request) => {
      try {
        const declared = Number(request.headers.get('content-length') ?? '0');
        if (declared > config.maxAudioBytes) {
          return failure(Object.assign(new Error('录音过长，请缩短到 60 秒以内。'), { status: 413, code: 'asr_audio_too_large' }));
        }
        const bytes = new Uint8Array(await request.arrayBuffer());
        const transcript = await transcribeAudio(
          bytes,
          {
            apiKey: config.siliconflowApiKey,
            endpoint: config.asrEndpoint,
            model: config.asrModel,
            language: config.asrLanguage,
            maxAudioBytes: config.maxAudioBytes,
            timeoutMs: config.requestTimeoutMs,
          },
          request.signal,
        );
        logger?.info?.(`[xiaoyuer] ASR transcribed ${bytes.byteLength} bytes`);
        return json({ ok: true, text: transcript });
      } catch (error) {
        if (error instanceof AsrError) return failure(error);
        return failure(error);
      }
    });

    register(`${prefix}/tts`, ['POST'], async (request) => {
      try {
        const body = await readJson(request);
        const text = typeof body.text === 'string' ? body.text.trim().slice(0, config.edgeTtsMaxChars) : '';
        if (text === '') return failure(Object.assign(new Error('缺少 text。'), { status: 400, code: 'tts_empty' }));
        const voice = typeof body.voice === 'string' ? body.voice : undefined;
        const audio = await tts.synthesize(text, { voice, signal: request.signal });
        return new Response(audio.buffer, {
          status: 200,
          headers: {
            'content-type': audio.mime,
            'content-length': String(audio.buffer.length),
            'cache-control': 'no-store',
            'x-xiaoyuer-tts-cache': audio.cached ? 'hit' : 'miss',
          },
        });
      } catch (error) {
        if (error instanceof TtsError) return failure(error);
        return failure(error);
      }
    });

    logger?.info?.(`[xiaoyuer] browser API mounted at ${prefix}`);
  });
}
