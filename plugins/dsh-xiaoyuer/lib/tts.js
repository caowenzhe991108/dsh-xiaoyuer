import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

export class TtsError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'TtsError';
    this.code = options.code ?? 'tts_error';
    this.status = options.status;
  }
}

function hashKey(parts) {
  return crypto.createHash('sha256').update(parts.join('\u0000'), 'utf8').digest('hex');
}

function ancestors(start) {
  const values = [];
  let current = path.resolve(start);
  for (let depth = 0; depth < 8; depth += 1) {
    values.push(current);
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return values;
}

function pythonCandidates(pluginRoot) {
  const explicit = process.env.XIAOYUER_PYTHON;
  const candidates = [];
  if (explicit) candidates.push(explicit);
  const venvDirs = [];
  if (process.env.XIAOYUER_VENV) venvDirs.push(process.env.XIAOYUER_VENV);
  for (const root of [pluginRoot, process.cwd(), process.env.XIAOYUER_REPO, process.env.DSH_HOME].filter(Boolean)) {
    for (const directory of ancestors(root)) {
      venvDirs.push(path.join(directory, '.venv'));
      venvDirs.push(path.join(directory, 'venv'));
    }
  }
  for (const venv of [...new Set(venvDirs)]) {
    candidates.push(path.join(venv, 'Scripts', 'python.exe'));
    candidates.push(path.join(venv, 'bin', 'python'));
  }
  candidates.push('python', 'python3');
  return [...new Set(candidates)];
}

function run(command, args, options) {
  // edge-tts creates its aiohttp session with trust_env=True. A desktop-wide
  // HTTP(S)_PROXY inherited from the DSH process can therefore capture the
  // Edge WebSocket and yield NoAudioReceived. Use a direct connection unless
  // the operator explicitly opts in.
  const childEnv = { ...process.env };
  if (!options.useSystemProxy) {
    for (const key of Object.keys(childEnv)) {
      if (/(^|_)proxy$/i.test(key)) delete childEnv[key];
    }
  }
  const spawnOptions = { windowsHide: true, env: childEnv };
  const attempt = (usePipes) =>
    new Promise((resolve, reject) => {
      let child;
      try {
        child = spawn(
          command,
          args,
          usePipes
            ? { ...spawnOptions, stdio: ['ignore', 'pipe', 'pipe'] }
            : { ...spawnOptions, stdio: 'ignore' },
        );
      } catch (error) {
        reject(error);
        return;
      }
      let stdout = '';
      let stderr = '';
      let settled = false;
      const fail = (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(error);
      };
      const timer = setTimeout(() => {
        child.kill();
        fail(new TtsError('Edge TTS 生成超时。', { code: 'tts_timeout', status: 504 }));
      }, options.timeoutMs);
      child.stdout?.on('data', (chunk) => {
        stdout = (stdout + chunk.toString()).slice(-2_000);
      });
      child.stderr?.on('data', (chunk) => {
        stderr = (stderr + chunk.toString()).slice(-2_000);
      });
      child.on('error', (error) => {
        fail(Object.assign(error, { stderr, stdout }));
      });
      child.on('close', (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        if (code === 0) resolve({ stdout, stderr });
        else {
          const failure = new TtsError(
            `Edge TTS 退出码 ${code}：${(stderr || stdout || '').trim().slice(0, 300) || '没有输出'}`,
            { code: 'tts_failed', status: 502 },
          );
          failure.stderr = stderr;
          failure.stdout = stdout;
          reject(failure);
        }
      });
    });

  return attempt(true).catch((error) => {
    // A confined host may deny piped grandchild stdio (EPERM). Retrying with
    // ignored descriptors keeps synthesis usable; diagnostics are lost.
    if (error?.code === 'EPERM') {
      if (process.env.XIAOYUER_DEBUG) process.stderr.write('[xiaoyuer] spawn piped stdio denied; retrying with ignored stdio\n');
      return attempt(false);
    }
    throw error;
  });
}

/**
 * Edge TTS through the `edge-tts` Python package. A per-process Python call
 * keeps the plugin dependency-free on the Node side while using the canonical
 * Microsoft neural voices. Results are cached by voice + rate + pitch + text.
 */
export class EdgeTts {
  constructor(options) {
    this.voice = options.voice;
    this.rate = options.rate;
    this.pitch = options.pitch;
    this.cacheDir = options.cacheDir;
    this.pythonPath = options.pythonPath;
    this.pythonHintFile = options.pythonHintFile;
    this.pluginRoot = options.pluginRoot;
    this.timeoutMs = options.timeoutMs;
    this.maxChars = options.maxChars;
    this.useSystemProxy = options.useSystemProxy === true;
    this.serverUrl = options.serverUrl ? options.serverUrl.replace(/\/+$/, '') : '';
  }

  #candidateCommands() {
    const candidates = [];
    if (this.pythonPath) candidates.push(this.pythonPath);
    if (process.env.XIAOYUER_PYTHON) candidates.push(process.env.XIAOYUER_PYTHON);
    if (this.pythonHintFile) {
      try {
        const hint = fs.readFileSync(this.pythonHintFile, 'utf8').replace(/^\uFEFF/, '').trim();
        if (hint) candidates.push(hint);
      } catch {
        // No hint file yet.
      }
    }
    candidates.push(...pythonCandidates(this.pluginRoot));
    return [...new Set(candidates)];
  }

  async #python() {
    for (const candidate of this.#candidateCommands()) {
      if (path.isAbsolute(candidate) && !fs.existsSync(candidate)) {
        if (process.env.XIAOYUER_DEBUG) process.stderr.write(`[xiaoyuer] python candidate missing: ${candidate}\n`);
        continue;
      }
      if (process.env.XIAOYUER_DEBUG) process.stderr.write(`[xiaoyuer] python candidate trying: ${candidate}\n`);
      try {
        await run(candidate, ['-c', 'import edge_tts'], { timeoutMs: 10_000 });
        return candidate;
      } catch (error) {
        if (process.env.XIAOYUER_DEBUG) {
          process.stderr.write(`[xiaoyuer] python candidate failed: ${candidate}: ${error.message}\n`);
        }
        // Try the next interpreter. A bare "python" may be a Windows Store stub.
      }
    }
    throw new TtsError(
      '未找到安装 edge-tts 的 Python。请运行 scripts/setup-voice.ps1（或 scripts/setup-voice.sh）。',
      { code: 'tts_unavailable', status: 503 },
    );
  }

  async available() {
    if (this.serverUrl) {
      try {
        const response = await fetch(`${this.serverUrl}/health`, { signal: AbortSignal.timeout(5_000) });
        if (!response.ok) return { ok: false, error: `TTS helper HTTP ${response.status}` };
        return { ok: true, server: this.serverUrl };
      } catch (error) {
        return { ok: false, error: `TTS helper unavailable: ${error.message}` };
      }
    }
    try {
      const python = await this.#python();
      return { ok: true, python };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async #synthesizeFromServer(normalized, voice, cachedPath) {
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(new Error('timeout')), this.timeoutMs);
      try {
        const response = await fetch(`${this.serverUrl}/tts`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ text: normalized, voice, rate: this.rate, pitch: this.pitch }),
          signal: controller.signal,
        });
        if (!response.ok) {
          let detail = '';
          try {
            const body = await response.json();
            detail = body?.message ?? '';
          } catch {
            // Non-JSON error.
          }
          throw new TtsError(`TTS helper HTTP ${response.status}${detail ? `: ${detail}` : ''}`, {
            code: 'tts_failed',
            status: 502,
          });
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        if (buffer.length < 100) throw new TtsError('TTS helper 返回了空音频。', { code: 'tts_empty_audio', status: 502 });
        await fs.promises.mkdir(this.cacheDir, { recursive: true });
        await fs.promises.writeFile(cachedPath, buffer);
        await this.#prune();
        return { buffer, mime: 'audio/mpeg', cached: false };
      } catch (error) {
        lastError =
          error instanceof TtsError
            ? error
            : new TtsError(`TTS helper 请求失败：${error.message}`, { code: 'tts_failed', status: 502 });
        if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 450 + attempt * 400));
      } finally {
        clearTimeout(timer);
      }
    }
    throw lastError;
  }

  /**
   * @param {string} text - plain text to speak.
   * @param {{ voice?: string, signal?: AbortSignal }} [options]
   * @returns {Promise<{ buffer: Buffer, mime: string, cached: boolean }>}
   */
  async synthesize(text, options = {}) {
    const normalized = String(text ?? '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, this.maxChars);
    if (normalized === '') throw new TtsError('没有可播报的文字。', { code: 'tts_empty', status: 400 });
    const voice = options.voice && /^[a-z]{2,3}-[A-Z]{2,4}-[A-Za-z0-9-]+Neural$/.test(options.voice) ? options.voice : this.voice;
    const key = hashKey([voice, this.rate, this.pitch, normalized]);
    const cachedPath = path.join(this.cacheDir, `${key}.mp3`);

    try {
      const stat = await fs.promises.stat(cachedPath);
      if (stat.size > 100) return { buffer: await fs.promises.readFile(cachedPath), mime: 'audio/mpeg', cached: true };
    } catch {
      // Cache miss.
    }

    if (this.serverUrl) return this.#synthesizeFromServer(normalized, voice, cachedPath);

    await fs.promises.mkdir(this.cacheDir, { recursive: true });
    const temp = path.join(this.cacheDir, `${key}.${process.pid}.tmp.mp3`);
    const requestFile = path.join(this.cacheDir, `${key}.${process.pid}.request.json`);
    const errorFile = path.join(this.cacheDir, `${key}.${process.pid}.error.txt`);
    const bridge = path.join(this.pluginRoot, 'scripts', 'edge_tts_bridge.py');
    const python = await this.#python();
    const args = fs.existsSync(bridge)
      ? [bridge, '--input', requestFile, '--output', temp, '--error', errorFile]
      : [
          '-m',
          'edge_tts',
          '--voice',
          voice,
          `--rate=${this.rate}`,
          `--pitch=${this.pitch}`,
          '--text',
          normalized,
          '--write-media',
          temp,
        ];
    const cleanup = () =>
      Promise.all([
        fs.promises.rm(temp, { force: true }).catch(() => {}),
        fs.promises.rm(requestFile, { force: true }).catch(() => {}),
        fs.promises.rm(errorFile, { force: true }).catch(() => {}),
      ]);
    let lastError;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        if (fs.existsSync(bridge)) {
          await fs.promises.writeFile(
            requestFile,
            JSON.stringify({ text: normalized, voice, rate: this.rate, pitch: this.pitch }),
            'utf8',
          );
        }
        await fs.promises.rm(errorFile, { force: true });
        await run(python, args, { timeoutMs: this.timeoutMs, useSystemProxy: this.useSystemProxy });
        const buffer = await fs.promises.readFile(temp);
        if (buffer.length < 100) {
          const detail = await fs.promises.readFile(errorFile, 'utf8').catch(() => '');
          throw new TtsError(`Edge TTS 返回了空音频。${detail ? ` ${detail.slice(-300)}` : ''}`, {
            code: 'tts_empty_audio',
            status: 502,
          });
        }
        await fs.promises.rename(temp, cachedPath);
        await this.#prune();
        await cleanup();
        return { buffer, mime: 'audio/mpeg', cached: false };
      } catch (error) {
        const fileDetail = await fs.promises.readFile(errorFile, 'utf8').catch(() => '');
        const detail = fileDetail || error?.stderr || error?.stdout || '';
        if (detail) {
          await fs.promises
            .appendFile(path.join(this.cacheDir, 'last-error.log'), `\n[${new Date().toISOString()}]\n${detail}\n`)
            .catch(() => {});
        }
        const enriched =
          error instanceof TtsError
            ? new TtsError(`${error.message}${detail ? ` ${detail.slice(-1_800)}` : ''}`.trim(), {
                code: error.code,
                status: error.status,
              })
            : new TtsError(`Edge TTS 生成失败：${error.message}${detail ? ` ${detail.slice(-1_800)}` : ''}`, {
                code: 'tts_failed',
                status: 502,
              });
        lastError = enriched;
        const transient = /NoAudioReceived|WebSocket|Connection|timed? ?out|503|502/i.test(enriched.message);
        if (!transient || attempt === 2) break;
        await new Promise((resolve) => setTimeout(resolve, 450 + attempt * 400));
      }
    }
    await cleanup();
    throw lastError ?? new TtsError('Edge TTS 生成失败。', { code: 'tts_failed', status: 502 });
  }

  async #prune() {
    try {
      const entries = await fs.promises.readdir(this.cacheDir, { withFileTypes: true });
      const files = [];
      for (const entry of entries) {
        if (!entry.isFile() || !entry.name.endsWith('.mp3')) continue;
        const file = path.join(this.cacheDir, entry.name);
        const stat = await fs.promises.stat(file);
        files.push({ file, time: stat.mtimeMs });
      }
      if (files.length <= 200) return;
      files.sort((left, right) => left.time - right.time);
      await Promise.all(files.slice(0, files.length - 200).map((entry) => fs.promises.rm(entry.file, { force: true })));
    } catch {
      // Cache maintenance must never fail a synthesis.
    }
  }
}
