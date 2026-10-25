import fs from 'node:fs';
import { normalizeConfig } from '../plugins/dsh-xiaoyuer/lib/config.js';
import { EdgeTts } from '../plugins/dsh-xiaoyuer/lib/tts.js';

fs.mkdirSync('.test', { recursive: true });
fs.writeFileSync('.test/secrets.json', '\uFEFF{"siliconflowApiKey":"sk-test"}', 'utf8');
const config = normalizeConfig(
  { secretsFile: '.test/secrets.json', stateFile: '.test/state.json' },
  { pluginRoot: './plugins/dsh-xiaoyuer', env: { DSH_HOME: '.test' } },
);
console.log('secret', config.siliconflowApiKey);
fs.writeFileSync('.test/python.txt', '\uFEFF<repo>/.venv/Scripts/python.exe', 'utf8');
const tts = new EdgeTts({
  voice: 'zh-CN-XiaoxiaoNeural',
  rate: '+0%',
  pitch: '+0Hz',
  cacheDir: '.test/cache',
  pythonHintFile: '.test/python.txt',
  pluginRoot: './plugins/dsh-xiaoyuer',
  timeoutMs: 30_000,
  maxChars: 100,
});
console.log('python', await tts.available());
