window.__ModuleLoader__.load({
  id: '@local/dsh-xiaoyuer',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const { useCallback, useEffect, useRef, useState } = React;

    const API = '/api/xiaoyuer';
    const MAX_RECORDING_MS = 60_000;
    let clientCtx = null;

    const CSS = `
.xy-root{display:flex;align-items:center;gap:8px;flex-wrap:wrap;box-sizing:border-box;width:calc(100% - 24px);max-width:760px;margin:0 auto 6px;padding:5px 8px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.28));border-radius:14px;background:var(--dsw-specific-menu,var(--dsw-alias-bg-base,transparent));color:var(--dsw-alias-label-primary,currentColor);font-size:12px;line-height:20px;box-shadow:var(--dsw-elevation-panel,none)}
.xy-left,.xy-right{display:flex;align-items:center;gap:6px;min-width:0}
.xy-right{margin-left:auto}
.xy-dot{width:7px;height:7px;border-radius:50%;flex:none;background:var(--dsw-alias-label-tertiary,#888);box-shadow:0 0 0 2px color-mix(in srgb,currentColor 8%,transparent)}
.xy-dot.ok{background:#30a46c}.xy-dot.warn{background:#f5a623}.xy-dot.bad{background:#e5484d}
.xy-seg{display:inline-flex;align-items:center;padding:2px;border-radius:10px;background:color-mix(in srgb,currentColor 7%,transparent)}
.xy-seg button,.xy-toggle,.xy-mic,.xy-cancel{border:0;background:transparent;color:inherit;font:inherit;cursor:pointer;border-radius:8px;padding:3px 8px;white-space:nowrap;line-height:18px}
.xy-seg button[aria-pressed="true"]{background:var(--dsw-alias-bg-base,#fff);box-shadow:0 1px 2px rgba(0,0,0,.12);font-weight:600}
.xy-seg button:disabled,.xy-toggle:disabled,.xy-mic:disabled,.xy-cancel:disabled{opacity:.45;cursor:default}
.xy-toggle{display:inline-flex;align-items:center;gap:4px;background:color-mix(in srgb,currentColor 6%,transparent)}
.xy-toggle[aria-checked="true"]{color:var(--dsw-alias-brand-primary,#3b82f6);background:color-mix(in srgb,var(--dsw-alias-brand-primary,#3b82f6) 13%,transparent)}
.xy-toggle .xy-knob{width:16px;height:9px;border-radius:999px;background:currentColor;opacity:.35;position:relative;flex:none}
.xy-toggle .xy-knob::after{content:"";position:absolute;top:-2px;left:0;width:13px;height:13px;border-radius:50%;background:var(--dsw-alias-bg-base,#fff);border:1px solid currentColor;box-sizing:border-box;transition:left .15s}
.xy-toggle[aria-checked="true"] .xy-knob{opacity:.9}
.xy-toggle[aria-checked="true"] .xy-knob::after{left:4px}
.xy-mic{display:inline-flex;align-items:center;gap:5px;background:var(--dsw-alias-brand-primary,#3b82f6);color:#fff;font-weight:600;padding:4px 10px;border-radius:999px}
.xy-mic.rec{background:#e5484d}
.xy-mic svg{width:14px;height:14px;display:block}
.xy-cancel{color:var(--dsw-alias-label-secondary,inherit);text-decoration:underline;text-underline-offset:2px}
.xy-status{min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary,inherit);flex:1 1 160px}
.xy-status.error{color:#e5484d}.xy-status.ok{color:#30a46c}
.xy-rec{display:inline-flex;align-items:center;gap:4px;color:#e5484d;font-weight:600}
.xy-rec i{width:7px;height:7px;border-radius:50%;background:#e5484d;display:inline-block;animation:xy-pulse 1s infinite}
@keyframes xy-pulse{0%,100%{opacity:.35}50%{opacity:1}}
@media (max-width:520px){.xy-root{width:calc(100% - 12px);gap:5px;padding:5px 6px}.xy-status{display:none}.xy-seg button,.xy-toggle{padding:3px 6px}.xy-toggle span:not(.xy-knob){display:none}}
`;

    function safeJson(value) {
      try {
        return JSON.stringify(value);
      } catch {
        return '';
      }
    }

    async function readError(response) {
      const type = response.headers.get('content-type') || '';
      if (type.includes('application/json')) {
        try {
          const body = await response.json();
          return body.message || body.code || `HTTP ${response.status}`;
        } catch {
          return `HTTP ${response.status}`;
        }
      }
      const text = await response.text().catch(() => '');
      return text.trim().slice(0, 240) || `HTTP ${response.status}`;
    }

    async function api(path, options) {
      const response = await fetch(`${API}${path}`, {
        credentials: 'same-origin',
        cache: 'no-store',
        ...options,
      });
      if (!response.ok) throw new Error(await readError(response));
      return response;
    }

    function splitText(message) {
      if (!message || !Array.isArray(message.content)) return '';
      return message.content
        .filter((block) => block && block.type === 'text' && typeof block.text === 'string')
        .map((block) => block.text)
        .join('\n')
        .trim();
    }

    function stripForSpeech(text) {
      return String(text)
        .replace(/```[\s\S]*?```/g, ' ')
        .replace(/`([^`]*)`/g, '$1')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/^#{1,6}\s+/gm, '')
        .replace(/[*_~>#|]/g, '')
        .replace(/^\s*[-+]\s+/gm, '')
        .replace(/^\s*\d+[.)]\s+/gm, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 1_200);
    }

    function assistantEvents(session, sinceSeq) {
      const events = session?.events;
      if (!events || typeof events.getSnapshot !== 'function') return { entries: [], latest: sinceSeq };
      const snapshot = events.getSnapshot();
      const entries = Array.isArray(snapshot?.entries) ? snapshot.entries : [];
      const fresh = [];
      let latest = sinceSeq;
      for (const entry of entries) {
        const event = entry?.event ?? entry;
        const seq = Number(event?.seq);
        if (!Number.isFinite(seq)) continue;
        if (seq > latest) latest = seq;
        if (seq <= sinceSeq) continue;
        if (event.type !== 'assistant/message') continue;
        if (!event.data || event.data.interrupted === true) continue;
        const message = event.data.message;
        const text = stripForSpeech(splitText(message));
        if (text !== '') fresh.push({ seq, text });
      }
      return { entries: fresh, latest };
    }

    function decodeAudio(context, bytes) {
      return new Promise((resolve, reject) => {
        let settled = false;
        const done = (value) => {
          if (settled) return;
          settled = true;
          resolve(value);
        };
        const fail = (error) => {
          if (settled) return;
          settled = true;
          reject(error);
        };
        try {
          const returned = context.decodeAudioData(bytes, done, fail);
          if (returned && typeof returned.then === 'function') returned.then(done, fail);
        } catch (error) {
          fail(error);
        }
      });
    }

    function writeWav(samples, sampleRate) {
      const buffer = new ArrayBuffer(44 + samples.length * 2);
      const view = new DataView(buffer);
      const writeString = (offset, value) => {
        for (let index = 0; index < value.length; index += 1) view.setUint8(offset + index, value.charCodeAt(index));
      };
      writeString(0, 'RIFF');
      view.setUint32(4, 36 + samples.length * 2, true);
      writeString(8, 'WAVE');
      writeString(12, 'fmt ');
      view.setUint32(16, 16, true);
      view.setUint16(20, 1, true);
      view.setUint16(22, 1, true);
      view.setUint32(24, sampleRate, true);
      view.setUint32(28, sampleRate * 2, true);
      view.setUint16(32, 2, true);
      view.setUint16(34, 16, true);
      writeString(36, 'data');
      view.setUint32(40, samples.length * 2, true);
      let offset = 44;
      for (let index = 0; index < samples.length; index += 1) {
        const sample = Math.max(-1, Math.min(1, samples[index]));
        view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
        offset += 2;
      }
      return new Blob([buffer], { type: 'audio/wav' });
    }

    async function toWav(blob) {
      const AudioCtor = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtor) throw new Error('当前浏览器不支持音频处理。');
      const decodeContext = new AudioCtor();
      let decoded;
      try {
        decoded = await decodeAudio(decodeContext, await blob.arrayBuffer());
      } finally {
        decodeContext.close?.().catch?.(() => {});
      }
      let finalBuffer = decoded;
      const targetRate = 16_000;
      if (decoded.sampleRate !== targetRate) {
        try {
          const length = Math.max(1, Math.ceil(decoded.duration * targetRate));
          const OfflineCtor = window.OfflineAudioContext || window.webkitOfflineAudioContext;
          if (OfflineCtor) {
            const offline = new OfflineCtor(1, length, targetRate);
            const source = offline.createBufferSource();
            source.buffer = decoded;
            source.connect(offline.destination);
            source.start();
            finalBuffer = await offline.startRendering();
          }
        } catch {
          finalBuffer = decoded;
        }
      }
      return writeWav(finalBuffer.getChannelData(0), finalBuffer.sampleRate);
    }

    function IconMic() {
      return h(
        'svg',
        { viewBox: '0 0 24 24', fill: 'none', 'aria-hidden': true },
        h('rect', { x: 9, y: 3, width: 6, height: 11, rx: 3, stroke: 'currentColor', strokeWidth: 2 }),
        h('path', { d: 'M5 11a7 7 0 0 0 14 0M12 18v3M9 21h6', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' }),
      );
    }

    function XiaoyuerBar({ sessionId, useSession }) {
      const session = useSession ? useSession((snapshot) => snapshot) : undefined;
      const [state, setState] = useState(null);
      const [health, setHealth] = useState(null);
      const [notice, setNotice] = useState(null);
      const [recording, setRecording] = useState(false);
      const [seconds, setSeconds] = useState(0);
      const [busy, setBusy] = useState(false);
      const [speaking, setSpeaking] = useState(false);

      const stateRef = useRef(null);
      const sessionIdRef = useRef(sessionId);
      const mountedRef = useRef(true);
      const recorderRef = useRef(null);
      const recognitionRef = useRef(null);
      const chunksRef = useRef([]);
      const streamRef = useRef(null);
      const timerRef = useRef(null);
      const startedAtRef = useRef(0);
      const audioContextRef = useRef(null);
      const sourceRef = useRef(null);
      const ttsAbortRef = useRef(null);
      const queueRef = useRef([]);
      const speakingRef = useRef(false);
      const baselineRef = useRef(null);
      const noticeTimerRef = useRef(null);

      const pushNotice = useCallback((kind, message) => {
        setNotice({ kind, message });
        if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
        if (kind !== 'error') {
          noticeTimerRef.current = setTimeout(() => {
            if (mountedRef.current) setNotice(null);
          }, 3_500);
        }
      }, []);

      const applyState = useCallback((next) => {
        stateRef.current = next;
        if (mountedRef.current) setState(next);
      }, []);

      const ensureAudio = useCallback(async () => {
        const AudioCtor = window.AudioContext || window.webkitAudioContext;
        if (!AudioCtor) throw new Error('当前浏览器不支持语音播放。');
        if (!audioContextRef.current || audioContextRef.current.state === 'closed') {
          audioContextRef.current = new AudioCtor();
        }
        const context = audioContextRef.current;
        if (context.state === 'suspended') await context.resume();
        return context;
      }, []);

      const stopAudio = useCallback(() => {
        queueRef.current = [];
        ttsAbortRef.current?.abort();
        ttsAbortRef.current = null;
        if (sourceRef.current) {
          try {
            sourceRef.current.stop();
          } catch {
            // Already ended.
          }
          sourceRef.current = null;
        }
        speakingRef.current = false;
        if (mountedRef.current) setSpeaking(false);
      }, []);

      const drainSpeech = useCallback(async () => {
        if (speakingRef.current) return;
        if (stateRef.current?.ttsEnabled === false) {
          queueRef.current = [];
          return;
        }
        const next = queueRef.current.shift();
        if (!next) return;
        speakingRef.current = true;
        if (mountedRef.current) setSpeaking(true);
        const controller = new AbortController();
        ttsAbortRef.current = controller;
        try {
          const response = await api('/tts', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: safeJson({ text: next, voice: stateRef.current?.voice }),
            signal: controller.signal,
          });
          const bytes = await response.arrayBuffer();
          if (controller.signal.aborted) return;
          const context = await ensureAudio();
          const buffer = await decodeAudio(context, bytes);
          if (!mountedRef.current || controller.signal.aborted) return;
          const source = context.createBufferSource();
          source.buffer = buffer;
          source.connect(context.destination);
          sourceRef.current = source;
          await new Promise((resolve) => {
            source.onended = resolve;
            source.start();
          });
        } catch (error) {
          if (!controller.signal.aborted) pushNotice('error', `播报失败：${error.message}`);
        } finally {
          if (ttsAbortRef.current === controller) ttsAbortRef.current = null;
          sourceRef.current = null;
          speakingRef.current = false;
          if (mountedRef.current) setSpeaking(false);
          drainSpeech();
        }
      }, [ensureAudio, pushNotice]);

      const enqueueSpeech = useCallback(
        (text) => {
          if (!text || stateRef.current?.ttsEnabled === false) return;
          queueRef.current.push(text);
          if (queueRef.current.length > 4) queueRef.current.splice(0, queueRef.current.length - 4);
          drainSpeech();
        },
        [drainSpeech],
      );

      const loadState = useCallback(async () => {
        const response = await api(`/state?sessionId=${encodeURIComponent(sessionId)}`);
        const body = await response.json();
        if (sessionIdRef.current !== sessionId) return;
        applyState({ ...body, voice: body.voice ?? undefined });
      }, [applyState, sessionId]);

      const loadHealth = useCallback(async () => {
        try {
          const response = await api('/health');
          const body = await response.json();
          if (mountedRef.current) setHealth(body);
        } catch (error) {
          if (mountedRef.current) setHealth({ ok: false, error: error.message });
        }
      }, []);

      useEffect(() => {
        mountedRef.current = true;
        sessionIdRef.current = sessionId;
        if (!sessionId) return undefined;
        let cancelled = false;
        loadState().catch((error) => {
          if (!cancelled) pushNotice('error', `读取设置失败：${error.message}`);
        });
        loadHealth();
        const interval = setInterval(loadHealth, 30_000);
        return () => {
          cancelled = true;
          mountedRef.current = false;
          clearInterval(interval);
          if (timerRef.current) clearInterval(timerRef.current);
          if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
          stopAudio();
          recognitionRef.current?.abort?.();
          recognitionRef.current = null;
          recorderRef.current?.stop?.();
          streamRef.current?.getTracks?.().forEach((track) => track.stop());
          const context = audioContextRef.current;
          audioContextRef.current = null;
          context?.close?.().catch?.(() => {});
        };
      }, [sessionId, loadState, loadHealth, pushNotice, stopAudio]);

      useEffect(() => {
        if (!sessionId) return undefined;
        const binding = clientCtx?.sessions?.binding(sessionId);
        const events = binding?.events;
        if (!events || typeof events.subscribe !== 'function') return undefined;
        baselineRef.current = null;
        const handle = () => {
          const sessionObject = clientCtx?.sessions?.binding(sessionId);
          if (!sessionObject) return;
          if (baselineRef.current === null) {
            const all = assistantEvents(sessionObject, -1);
            baselineRef.current = all.latest;
            return;
          }
          const result = assistantEvents(sessionObject, baselineRef.current);
          baselineRef.current = result.latest;
          if (stateRef.current?.ttsEnabled === false) return;
          for (const entry of result.entries) enqueueSpeech(entry.text);
        };
        const unsubscribe = events.subscribe(handle);
        handle();
        return () => unsubscribe();
      }, [sessionId, enqueueSpeech]);

      const update = useCallback(
        async (patch) => {
          const optimistic = {
            ...(stateRef.current ?? {}),
            ...patch,
            ...(patch.persona === 'assistant' ? { memoryEnabled: false } : {}),
          };
          applyState(optimistic);
          try {
            const response = await api('/state', {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: safeJson({ sessionId, ...patch }),
            });
            const body = await response.json();
            if (sessionIdRef.current !== sessionId) return;
            applyState({ ...body, voice: body.voice ?? stateRef.current?.voice });
          } catch (error) {
            pushNotice('error', `保存失败：${error.message}`);
            loadState().catch(() => {});
          }
        },
        [applyState, loadState, pushNotice, sessionId],
      );

      const choosePersona = useCallback(
        (persona) => {
          if (stateRef.current?.persona === persona) return;
          update({ persona, memoryEnabled: persona === 'ex' });
        },
        [update],
      );

      const sendTranscript = useCallback(
        async (text) => {
          const value = typeof text === 'string' ? text.trim() : '';
          if (value === '') throw new Error('没有识别到内容。');
          const binding = clientCtx?.sessions?.binding(sessionId);
          if (!binding || typeof binding.prompt !== 'function') throw new Error('当前会话不可用，请刷新页面。');
          const result = await binding.prompt([{ type: 'text', text: value }], 'queue');
          if (!result?.ok) throw new Error(result?.error?.message ?? '发送失败。');
          if (mountedRef.current) pushNotice('ok', `已发送：${value.length > 32 ? `${value.slice(0, 32)}…` : value}`);
        },
        [pushNotice, sessionId],
      );

      const stopRecorder = useCallback(() => {
        if (recognitionRef.current) {
          try {
            recognitionRef.current.stop();
          } catch {
            recognitionRef.current = null;
            if (mountedRef.current) setRecording(false);
          }
          return;
        }
        const recorder = recorderRef.current;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
      }, []);

      const finishRecording = useCallback(async () => {
        const blob = new Blob(chunksRef.current, { type: recorderRef.current?.mimeType || 'audio/webm' });
        chunksRef.current = [];
        streamRef.current?.getTracks?.().forEach((track) => track.stop());
        streamRef.current = null;
        if (timerRef.current) clearInterval(timerRef.current);
        timerRef.current = null;
        if (mountedRef.current) {
          setRecording(false);
          setSeconds(0);
        }
        if (blob.size < 800) {
          pushNotice('error', '录音太短，请再说一次。');
          return;
        }
        if (mountedRef.current) setBusy(true);
        try {
          const wav = await toWav(blob);
          if (mountedRef.current) pushNotice('info', '正在转写…');
          const response = await api('/asr', {
            method: 'POST',
            headers: { 'content-type': 'audio/wav' },
            body: wav,
          });
          const body = await response.json();
          await sendTranscript(body.text);
        } catch (error) {
          if (mountedRef.current) pushNotice('error', error.message);
        } finally {
          if (mountedRef.current) setBusy(false);
        }
      }, [pushNotice, sendTranscript]);

      const startBrowserRecognition = useCallback(async () => {
        const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition;
        if (typeof Ctor !== 'function') {
          pushNotice('error', '未配置 SiliconFlow Key，且当前浏览器不支持内置语音识别。');
          return;
        }
        try {
          stopAudio();
          await ensureAudio();
          const recognition = new Ctor();
          recognition.lang = 'zh-CN';
          recognition.interimResults = false;
          recognition.continuous = false;
          recognition.maxAlternatives = 1;
          recognitionRef.current = recognition;
          recognition.onresult = (event) => {
            const result = event.results?.[event.resultIndex ?? 0]?.[0];
            const text = result?.transcript ?? '';
            if (text.trim() === '') return;
            if (mountedRef.current) setBusy(true);
            sendTranscript(text)
              .catch((error) => {
                if (mountedRef.current) pushNotice('error', error.message);
              })
              .finally(() => {
                if (mountedRef.current) setBusy(false);
              });
          };
          recognition.onerror = (event) => {
            if (event.error !== 'aborted' && event.error !== 'no-speech') {
              pushNotice('error', `浏览器语音识别失败：${event.error}`);
            }
            recognitionRef.current = null;
            if (mountedRef.current) setRecording(false);
          };
          recognition.onend = () => {
            recognitionRef.current = null;
            if (mountedRef.current) {
              setRecording(false);
              setSeconds(0);
            }
          };
          recognition.start();
          startedAtRef.current = Date.now();
          if (!mountedRef.current) return;
          setRecording(true);
          setSeconds(0);
          setNotice({ kind: 'info', message: '使用浏览器内置语音识别（临时回退）' });
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            if (mountedRef.current) setSeconds(Math.floor((Date.now() - startedAtRef.current) / 1_000));
          }, 250);
        } catch (error) {
          recognitionRef.current = null;
          pushNotice('error', `无法启动浏览器语音识别：${error.message}`);
        }
      }, [ensureAudio, pushNotice, sendTranscript, stopAudio]);

      const startRecording = useCallback(async () => {
        if (!window.isSecureContext) {
          pushNotice('error', 'iPhone 需要通过 HTTPS 访问才能使用麦克风。');
          return;
        }
        if (!navigator.mediaDevices?.getUserMedia && !(window.SpeechRecognition || window.webkitSpeechRecognition)) {
          pushNotice('error', '当前浏览器不支持麦克风录音。请使用 Safari 或 Chrome。');
          return;
        }
        if (health && health.asr?.configured === false) {
          await startBrowserRecognition();
          return;
        }
        if (typeof window.MediaRecorder !== 'function') {
          pushNotice('error', '当前浏览器不支持 MediaRecorder 录音。');
          return;
        }
        if (stateRef.current?.persona !== 'ex' && stateRef.current?.persona !== 'assistant') {
          pushNotice('error', '设置尚未载入，请稍后再试。');
          return;
        }
        try {
          stopAudio();
          await ensureAudio();
          const stream = await navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          });
          const candidates = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'];
          const mimeType = candidates.find((candidate) => window.MediaRecorder?.isTypeSupported?.(candidate));
          const recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
          chunksRef.current = [];
          recorderRef.current = recorder;
          streamRef.current = stream;
          recorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) chunksRef.current.push(event.data);
          };
          recorder.onstop = () => {
            finishRecording();
          };
          recorder.onerror = (event) => {
            pushNotice('error', `录音失败：${event.error?.message ?? '未知错误'}`);
            stream.getTracks().forEach((track) => track.stop());
            if (mountedRef.current) setRecording(false);
          };
          recorder.start(200);
          startedAtRef.current = Date.now();
          if (mountedRef.current) {
            setRecording(true);
            setSeconds(0);
            setNotice(null);
          }
          if (timerRef.current) clearInterval(timerRef.current);
          timerRef.current = setInterval(() => {
            const elapsed = Date.now() - startedAtRef.current;
            if (mountedRef.current) setSeconds(Math.floor(elapsed / 1_000));
            if (elapsed >= MAX_RECORDING_MS) stopRecorder();
          }, 250);
        } catch (error) {
          pushNotice('error', `无法打开麦克风：${error.message}`);
        }
      }, [ensureAudio, finishRecording, health?.asr?.configured, pushNotice, startBrowserRecognition, stopAudio, stopRecorder]);

      if (!sessionId) return null;

      const persona = state?.persona ?? 'ex';
      const memoryEnabled = state?.memoryEnabled === true;
      const ttsEnabled = state?.ttsEnabled !== false;
      const dotClass = health === null ? '' : health.hindsight?.ok ? 'ok' : 'bad';
      const dotTitle = health === null ? '正在检查服务' : health.hindsight?.ok ? 'Hindsight 在线' : `Hindsight 离线：${health.hindsight?.error ?? health.error ?? '未知错误'}`;
      const memoryDisabled = persona === 'assistant' || !state;
      const statusText = notice?.message ?? (recording ? '' : speaking ? '正在播报…' : '');

      return h(
        'div',
        { className: 'xy-root', 'data-xiaoyuer-bar': true },
        h('style', null, CSS),
        h(
          'div',
          { className: 'xy-left' },
          h('span', { className: `xy-dot ${dotClass}`, title: dotTitle, 'aria-label': dotTitle }),
          h(
            'div',
            { className: 'xy-seg', role: 'group', 'aria-label': '人设' },
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': persona === 'ex',
                onClick: () => choosePersona('ex'),
                disabled: !state,
                title: '角色：使用共同记忆',
              },
              '角色',
            ),
            h(
              'button',
              {
                type: 'button',
                'aria-pressed': persona === 'assistant',
                onClick: () => choosePersona('assistant'),
                disabled: !state,
                title: '普通助手：不启用角色记忆',
              },
              '普通助手',
            ),
          ),
          statusText ? h('span', { className: `xy-status ${notice?.kind ?? ''}` }, statusText) : null,
          recording
            ? h(
                'span',
                { className: 'xy-rec' },
                h('i', null),
                `${seconds}s`,
              )
            : null,
        ),
        h(
          'div',
          { className: 'xy-right' },
          h(
            'button',
            {
              type: 'button',
              className: 'xy-toggle',
              role: 'switch',
              'aria-checked': memoryEnabled,
              disabled: memoryDisabled,
              title: persona === 'assistant' ? '普通助手不使用记忆' : '本会话启用/关闭 Hindsight 记忆',
              onClick: () => update({ memoryEnabled: !memoryEnabled }),
            },
            h('span', { className: 'xy-knob', 'aria-hidden': true }),
            h('span', null, '记忆'),
          ),
          h(
            'button',
            {
              type: 'button',
              className: 'xy-toggle',
              role: 'switch',
              'aria-checked': ttsEnabled,
              disabled: !state,
              title: '是否用 Edge TTS 播报 AI 回复',
              onClick: () => update({ ttsEnabled: !ttsEnabled }),
            },
            h('span', { className: 'xy-knob', 'aria-hidden': true }),
            h('span', null, '播报'),
          ),
          recording
            ? h(
                'button',
                { type: 'button', className: 'xy-cancel', onClick: () => stopRecorder() },
                '停止并发送',
              )
            : null,
          h(
            'button',
            {
              type: 'button',
              className: `xy-mic${recording ? ' rec' : ''}`,
              disabled: busy || !state,
              title: recording ? '停止录音并发送' : '点一下说话，再点一下发送',
              onClick: recording ? stopRecorder : startRecording,
            },
            recording ? null : h(IconMic),
            recording ? '停止' : busy ? '处理中' : '说话',
          ),
        ),
      );
    }

    return {
      inject: ['slots', 'sessions'],
      apply(ctx) {
        clientCtx = ctx;
        ctx.slots.inject('conversation.input.dock', () =>
          ctx.slots.register(
            {
              name: 'conversation.input.dock',
              id: 'xiaoyuer-voice-memory',
              order: 20,
            },
            XiaoyuerBar,
          ),
        );
      },
    };
  },
});
