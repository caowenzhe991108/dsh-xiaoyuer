import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const TRUE = new Set(['1', 'true', 'yes', 'on']);
const FALSE = new Set(['0', 'false', 'no', 'off']);

function bool(value, fallback) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (TRUE.has(normalized)) return true;
    if (FALSE.has(normalized)) return false;
  }
  return fallback;
}

function text(value, fallback = '') {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback;
}

function positiveInt(value, fallback) {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

/**
 * Normalize the bundle's YAML config. Secrets are read from the environment so
 * a checked-in profile patch never contains an API key.
 * @param {Record<string, unknown>} raw - config supplied by the Cordis patch.
 * @param {{ pluginRoot: string, env?: NodeJS.ProcessEnv }} options
 * @returns {Record<string, unknown>}
 */
export function normalizeConfig(raw = {}, options) {
  const env = options.env ?? process.env;
  const dshHome = text(env.DSH_HOME, path.join(os.homedir(), '.dsh'));
  const personaDir = text(raw.personaDir, path.join(options.pluginRoot, 'personas'));
  const stateFile = text(raw.stateFile, path.join(dshHome, 'xiaoyuer', 'state.json'));
  const secretsFile = text(raw.secretsFile, path.join(dshHome, 'xiaoyuer', 'secrets.json'));
  let secrets = {};
  try {
    const rawSecrets = fs.readFileSync(secretsFile, 'utf8').replace(/^\uFEFF/, '');
    const parsed = JSON.parse(rawSecrets);
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) secrets = parsed;
  } catch {
    // Missing or unreadable secrets file is the normal first-run state.
  }
  const edgeTtsVoice = text(raw.edgeTtsVoice, 'zh-CN-XiaoxiaoNeural');
  const defaultPersona = raw.defaultPersona === 'assistant' ? 'assistant' : 'ex';

  return {
    endpoint: text(raw.endpoint, text(env.HINDSIGHT_URL, 'http://localhost:8888')).replace(/\/+$/, ''),
    bankId: text(raw.bankId, 'xiaoyu'),
    hindsightApiKey: text(raw.hindsightApiKey, text(env.HINDSIGHT_API_KEY, text(secrets.hindsightApiKey, ''))),
    requestTimeoutMs: positiveInt(raw.requestTimeoutMs, 30_000),
    healthTimeoutMs: positiveInt(raw.healthTimeoutMs, 3_000),

    autoRemember: bool(raw.autoRemember, true),
    systemPromptSection: bool(raw.systemPromptSection, true),
    defaultPersona,
    defaultMemoryEnabled: bool(raw.defaultMemoryEnabled, true),
    stateFile,
    secretsFile,
    personaDir,

    siliconflowApiKey: text(
      raw.siliconflowApiKey,
      text(env.SILICONFLOW_API_KEY, text(env.XIAOYUER_ASR_API_KEY, text(secrets.siliconflowApiKey, ''))),
    ),
    asrEndpoint: text(raw.asrEndpoint, 'https://api.siliconflow.cn/v1/audio/transcriptions'),
    asrModel: text(raw.asrModel, 'FunAudioLLM/SenseVoiceSmall'),
    asrLanguage: text(raw.asrLanguage, ''),
    maxAudioBytes: positiveInt(raw.maxAudioBytes, 12 * 1024 * 1024),

    edgeTtsVoice,
    edgeTtsRate: text(raw.edgeTtsRate, '+0%'),
    edgeTtsPitch: text(raw.edgeTtsPitch, '+0Hz'),
    edgeTtsMaxChars: positiveInt(raw.edgeTtsMaxChars, 1_500),
    ttsCacheDir: text(raw.ttsCacheDir, path.join(dshHome, 'xiaoyuer', 'tts-cache')),
    pythonPath: text(raw.pythonPath, text(env.XIAOYUER_PYTHON, '')),
    ttsTimeoutMs: positiveInt(raw.ttsTimeoutMs, 45_000),
    ttsUseSystemProxy: bool(raw.ttsUseSystemProxy, false),
    ttsServerUrl: text(raw.ttsServerUrl, text(env.XIAOYUER_TTS_URL, '')),

    apiPrefix: '/api/xiaoyuer',
  };
}
