import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { apply, RECALL_OUTPUT_SCHEMA } from '../plugins/dsh-xiaoyuer/index.js';

// Minimal JSON Schema checker covering the subset used by the tool output
// schema. The DSH host validates tool output against it, so the test must too.
function assertMatchesSchema(value, schema, at = 'recall') {
  assert.equal(typeof value, 'object', `${at} must be an object`);
  const { properties = {}, required = [], additionalProperties } = schema;
  for (const key of required) assert.ok(key in value, `${at}.${key} is required`);
  if (additionalProperties === false) {
    for (const key of Object.keys(value)) {
      assert.ok(key in properties, `${at}.${key} is not allowed by the output schema`);
    }
  }
  for (const [key, propertySchema] of Object.entries(properties)) {
    if (!(key in value)) continue;
    const item = value[key];
    const sub = `${at}.${key}`;
    if (propertySchema.type === 'object') {
      assertMatchesSchema(item, propertySchema, sub);
    } else if (propertySchema.type === 'array') {
      assert.ok(Array.isArray(item), `${sub} must be an array`);
      item.forEach((entry, index) => assertMatchesSchema(entry, propertySchema.items, `${sub}[${index}]`));
    } else if (propertySchema.type === 'string') {
      assert.equal(typeof item, 'string', `${sub} must be a string`);
    } else if (propertySchema.type === 'number') {
      assert.equal(typeof item, 'number', `${sub} must be a number`);
    } else if (propertySchema.type === 'integer') {
      assert.ok(Number.isInteger(item), `${sub} must be an integer`);
    } else if (propertySchema.type === 'boolean') {
      assert.equal(typeof item, 'boolean', `${sub} must be a boolean`);
    }
  }
}

const root = path.resolve('.');
const stateFile = path.join(root, '.test', 'host-state.json');
const ttsCacheDir = path.join(root, '.test', 'host-tts-cache');
fs.rmSync(stateFile, { force: true });

const tools = new Map();
let guard;
const commands = new Map();
const routes = new Map();
const sections = [];

const logger = {
  info() {},
  warn(message) {
    if (process.env.DEBUG_TEST) console.warn(message);
  },
};

function childContext(extra) {
  return {
    ...ctx,
    ...extra,
  };
}

const ctx = {
  logger,
  tools: {
    register(definition) {
      tools.set(definition.name, definition);
      return () => tools.delete(definition.name);
    },
    guard(fn) {
      guard = fn;
      return () => {
        guard = undefined;
      };
    },
  },
  inject(names, callback) {
    if (names.includes('systemPrompt')) {
      callback(
        childContext({
          systemPrompt: {
            section(definition) {
              sections.push(definition);
              return () => {};
            },
          },
        }),
      );
    }
    if (names.includes('commands')) {
      callback(
        childContext({
          commands: {
            register(definition) {
              commands.set(definition.name, definition);
              return () => commands.delete(definition.name);
            },
          },
        }),
      );
    }
    if (names.includes('connection')) {
      callback(
        childContext({
          connection: {
            fetch: {
              register(route) {
                routes.set(route.path, route);
                return () => routes.delete(route.path);
              },
            },
          },
        }),
      );
    }
  },
  effect(fn) {
    return fn();
  },
};

apply(ctx, {
  endpoint: 'http://127.0.0.1:8899',
  bankId: 'test-bank',
  autoRemember: true,
  systemPromptSection: true,
  defaultPersona: 'ex',
  defaultMemoryEnabled: true,
  stateFile,
  personaDir: path.join(root, 'plugins', 'dsh-xiaoyuer', 'personas'),
  ttsCacheDir,
  requestTimeoutMs: 5_000,
});

const agent = { session: { id: 'session-test-1' } };
const exec = { agent, signal: new AbortController().signal };

assert.equal(tools.size, 3, 'three Hindsight tools register');
assert.equal(sections.length, 1, 'one persona prompt section registers');
assert.ok(commands.has('persona') && commands.has('memory') && commands.has('hindsight'), 'commands register');
assert.ok(routes.has('/api/xiaoyuer/state'), 'state route registers');
assert.ok(routes.has('/api/xiaoyuer/health'), 'health route registers');
assert.ok(routes.has('/api/xiaoyuer/asr'), 'ASR route registers');
assert.ok(routes.has('/api/xiaoyuer/tts'), 'TTS route registers');

const personaText = sections[0].text({ agent });
assert.match(personaText, /前女友/);
assert.match(personaText, /角色/);
assert.match(personaText, /hindsight_recall/);
assert.match(personaText, /confirm/);

assert.equal(guard({ name: 'hindsight_recall', agent }), undefined, 'memory gate allows ex persona');
assert.equal(guard({ name: 'web_search', agent }), undefined, 'guard ignores other tools');

const remember = tools.get('hindsight_remember');
const recall = tools.get('hindsight_recall');
const condense = tools.get('hindsight_condense');

const confirmation = await remember.execute({ content: '她喜欢吃火锅，尤其是牛油锅底。' }, exec);
assert.equal(confirmation.ok, false);
assert.equal(confirmation.code, 'confirmation_required');

const stored = await remember.execute(
  { content: '她喜欢吃火锅，尤其是牛油锅底。', confirm: true, context: '单元测试' },
  exec,
);
assert.equal(stored.ok, true);
assert.equal(stored.stored, true);
assert.match(stored.documentId, /^dsh-remember:/);

const duplicate = await remember.execute(
  { content: '她喜欢吃火锅，尤其是牛油锅底。', confirm: true },
  exec,
);
assert.equal(duplicate.ok, true);
assert.equal(duplicate.duplicate, true);

const recalled = await recall.execute({ query: '火锅' }, exec);
assert.equal(recalled.ok, true);
assert.ok(recalled.count >= 1, 'recall returns the stored fact');
assert.ok(recalled.memories.some((memory) => memory.text.includes('火锅')));
assertMatchesSchema(recalled, RECALL_OUTPUT_SCHEMA, 'recall');

const stateRoute = routes.get('/api/xiaoyuer/state');
const getState = await stateRoute.fetch(new Request('http://localhost/api/xiaoyuer/state?sessionId=session-test-1'));
assert.equal(getState.status, 200);
const initialState = await getState.json();
assert.equal(initialState.persona, 'ex');
assert.equal(initialState.memoryEnabled, true);

const postState = await stateRoute.fetch(
  new Request('http://localhost/api/xiaoyuer/state', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ sessionId: 'session-test-1', persona: 'assistant' }),
  }),
);
assert.equal(postState.status, 200);
const assistantState = await postState.json();
assert.equal(assistantState.persona, 'assistant');
assert.equal(assistantState.memoryEnabled, false, 'assistant forces memory off');

const otherState = await (
  await stateRoute.fetch(new Request('http://localhost/api/xiaoyuer/state?sessionId=session-test-2'))
).json();
assert.equal(otherState.persona, 'ex', 'another session keeps its own persona');
assert.equal(otherState.memoryEnabled, true, 'another session keeps its own memory switch');

assert.ok(guard({ name: 'hindsight_recall', agent }), 'guard blocks memory tools for assistant');
assert.equal(sections[0].text({ agent }), '', 'assistant gets no persona section');

const blocked = await recall.execute({ query: '火锅' }, exec);
assert.equal(blocked.ok, false);
assert.equal(blocked.code, 'memory_disabled');

const personaCommand = commands.get('persona');
const commandResult = await personaCommand.handler({ agent, rawInput: 'ex' });
assert.equal(commandResult.kind, 'success');
assert.match(commandResult.text, /前女友/);

const memoryCommand = commands.get('memory');
const memoryOff = await memoryCommand.handler({ agent, rawInput: 'off' });
assert.equal(memoryOff.kind, 'success');
const offPersonaText = sections[0].text({ agent });
assert.match(offPersonaText, /记忆开关已关闭/);
assert.match(offPersonaText, /不要调用/);
assert.equal((await recall.execute({ query: '火锅' }, exec)).code, 'memory_disabled');

await memoryCommand.handler({ agent, rawInput: 'on' });
const hindsightCommand = commands.get('hindsight');
const manualRemember = await hindsightCommand.handler({ agent, rawInput: 'remember 她喜欢春天。' });
assert.equal(manualRemember.kind, 'success');
assert.match(manualRemember.text, /春天/);
const manualRecall = await hindsightCommand.handler({ agent, rawInput: 'recall 春天' });
assert.equal(manualRecall.kind, 'success');
assert.match(manualRecall.text, /春天/);

const condensed = await condense.execute(
  {
    facts: ['她讨厌烟味。', '她习惯睡前听周杰伦。'],
    confirm: true,
    context: '单元测试批量',
  },
  exec,
);
assert.equal(condensed.ok, true);
assert.equal(condensed.stored, 2);

const condensedAgain = await condense.execute(
  { facts: ['她讨厌烟味。', '她习惯睡前听周杰伦。'], confirm: true },
  exec,
);
assert.equal(condensedAgain.ok, true);
assert.equal(condensedAgain.stored, 0);
assert.equal(condensedAgain.duplicates, 2);

const healthRoute = routes.get('/api/xiaoyuer/health');
const health = await (await healthRoute.fetch(new Request('http://localhost/api/xiaoyuer/health'))).json();
assert.equal(health.ok, true);
assert.equal(typeof health.hindsight.ok, 'boolean');
assert.equal(health.asr.configured, false);

console.log('host-plugin ok:', {
  tools: [...tools.keys()],
  commands: [...commands.keys()],
  routes: [...routes.keys()],
  recalled: recalled.count,
  condensed: condensed.stored,
});
