import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apply } from '../plugins/dsh-xiaoyuer/index.js';

const root = path.resolve('.');
const stateFile = path.join(root, '.test', 'voice-state.json');
fs.rmSync(stateFile, { force: true });
const cacheDir = path.join(root, '.test', 'voice-tts-cache');
fs.rmSync(cacheDir, { recursive: true, force: true });

const routes = new Map();
const logger = { info() {}, warn() {} };
const ctx = {
  logger,
  tools: {
    register() {
      return () => {};
    },
    guard() {
      return () => {};
    },
  },
  inject(names, callback) {
    if (names.includes('connection')) {
      callback({
        ...ctx,
        connection: {
          fetch: {
            register(route) {
              routes.set(route.path, route);
              return () => routes.delete(route.path);
            },
          },
        },
      });
    }
  },
  effect(fn) {
    return fn();
  },
};

apply(ctx, {
  endpoint: 'http://127.0.0.1:8899',
  bankId: 'voice-bank',
  autoRemember: true,
  systemPromptSection: false,
  defaultPersona: 'ex',
  defaultMemoryEnabled: true,
  stateFile,
  personaDir: path.join(root, 'plugins', 'dsh-xiaoyuer', 'personas'),
  ttsCacheDir: cacheDir,
  siliconflowApiKey: 'test-key',
  asrEndpoint: 'http://127.0.0.1:8899/asr',
  requestTimeoutMs: 10_000,
  edgeTtsMaxChars: 1_500,
});

const asr = routes.get('/api/xiaoyuer/asr');
const wavLike = new Uint8Array(1_600);
wavLike.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
const asrResponse = await asr.fetch(
  new Request('http://localhost/api/xiaoyuer/asr', {
    method: 'POST',
    headers: { 'content-type': 'audio/wav' },
    body: wavLike,
  }),
);
assert.equal(asrResponse.status, 200);
const asrBody = await asrResponse.json();
assert.equal(asrBody.ok, true);
assert.match(asrBody.text, /冰岛/);

const tts = routes.get('/api/xiaoyuer/tts');
const ttsResponse = await tts.fetch(
  new Request('http://localhost/api/xiaoyuer/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你好，我是小雨。' }),
  }),
);
assert.equal(ttsResponse.status, 200);
assert.equal(ttsResponse.headers.get('content-type'), 'audio/mpeg');
const audio = new Uint8Array(await ttsResponse.arrayBuffer());
assert.ok(audio.byteLength > 1_000, `expected audio bytes, got ${audio.byteLength}`);
assert.equal(ttsResponse.headers.get('x-xiaoyuer-tts-cache'), 'miss');

const cachedResponse = await tts.fetch(
  new Request('http://localhost/api/xiaoyuer/tts', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ text: '你好，我是小雨。' }),
  }),
);
assert.equal(cachedResponse.status, 200);
assert.equal(cachedResponse.headers.get('x-xiaoyuer-tts-cache'), 'hit');

const health = await (await routes.get('/api/xiaoyuer/health').fetch(new Request('http://localhost/api/xiaoyuer/health'))).json();
assert.equal(health.ok, true);
assert.equal(health.hindsight.ok, true);
assert.equal(health.tts.ok, true);
assert.equal(health.asr.configured, true);

console.log('voice-routes ok:', { audioBytes: audio.byteLength, ttsPython: health.tts.python, asrText: asrBody.text });
