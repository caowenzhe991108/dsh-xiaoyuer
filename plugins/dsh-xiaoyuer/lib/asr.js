export class AsrError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'AsrError';
    this.code = options.code ?? 'asr_error';
    this.status = options.status;
  }
}

function timeoutSignal(ms, outer) {
  const controller = new AbortController();
  const onAbort = () => controller.abort(outer?.reason ?? new Error('aborted'));
  if (outer?.aborted) controller.abort(outer.reason);
  outer?.addEventListener('abort', onAbort, { once: true });
  const timer = setTimeout(() => controller.abort(new Error('timeout')), ms);
  return {
    signal: controller.signal,
    dispose() {
      clearTimeout(timer);
      outer?.removeEventListener('abort', onAbort);
    },
    timedOut() {
      return controller.signal.reason?.message === 'timeout';
    },
  };
}

function extractText(body) {
  if (typeof body === 'string') return body.trim();
  if (body !== null && typeof body === 'object') {
    for (const key of ['text', 'transcript', 'result']) {
      const value = body[key];
      if (typeof value === 'string' && value.trim() !== '') return value.trim();
      if (value !== null && typeof value === 'object' && typeof value.text === 'string') return value.text.trim();
    }
  }
  return '';
}

/**
 * Call SiliconFlow's OpenAI-compatible audio transcription endpoint with one
 * complete WAV recording. Audio stays transient; only the returned text is
 * submitted to the Session.
 */
export async function transcribeAudio(audio, options, signal) {
  if (!options.apiKey) {
    throw new AsrError('未配置 SiliconFlow API Key，无法转写语音。', { code: 'asr_not_configured', status: 503 });
  }
  if (!(audio instanceof Uint8Array) || audio.byteLength === 0) {
    throw new AsrError('录音为空。', { code: 'asr_empty_audio', status: 400 });
  }
  if (audio.byteLength > options.maxAudioBytes) {
    throw new AsrError('录音过长，请缩短到 60 秒以内。', { code: 'asr_audio_too_large', status: 413 });
  }

  const form = new FormData();
  form.append('model', options.model);
  form.append('file', new Blob([audio], { type: 'audio/wav' }), 'speech.wav');
  if (options.language) form.append('language', options.language);

  const clock = timeoutSignal(options.timeoutMs ?? 60_000, signal);
  try {
    const response = await fetch(options.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${options.apiKey}` },
      body: form,
      signal: clock.signal,
    });
    const text = await response.text();
    let body;
    try {
      body = text.trim() === '' ? {} : JSON.parse(text);
    } catch {
      body = text;
    }
    if (!response.ok) {
      const detail =
        body !== null && typeof body === 'object'
          ? body.message ?? body.error?.message ?? body.detail ?? text
          : text;
      throw new AsrError(`语音转写失败（HTTP ${response.status}）：${String(detail).slice(0, 240)}`, {
        code: 'asr_failed',
        status: response.status,
      });
    }
    const transcript = extractText(body);
    if (transcript === '') throw new AsrError('没有识别到语音内容。', { code: 'asr_empty_transcript', status: 422 });
    return transcript;
  } catch (error) {
    if (error instanceof AsrError) throw error;
    if (clock.timedOut()) throw new AsrError('语音转写超时。', { code: 'asr_timeout', status: 504 });
    if (signal?.aborted) throw new AsrError('语音转写已取消。', { code: 'asr_aborted', status: 499 });
    throw new AsrError(`语音转写请求失败：${error.message}`, { code: 'asr_unreachable', status: 502 });
  } finally {
    clock.dispose();
  }
}
