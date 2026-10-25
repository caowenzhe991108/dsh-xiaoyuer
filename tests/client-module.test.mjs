import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync(new URL('../plugins/dsh-xiaoyuer/client.js', import.meta.url), 'utf8');
let registration;
global.window = {
  __ModuleLoader__: {
    load(value) {
      registration = value;
    },
  },
};
// Evaluate the browser module in this process; it only touches window.require.
await import('data:text/javascript;base64,' + Buffer.from(source, 'utf8').toString('base64'));

assert.equal(registration.id, '@local/dsh-xiaoyuer');
const React = {
  createElement() {
    return null;
  },
  useState() {
    return [undefined, () => {}];
  },
  useEffect() {},
  useRef() {
    return { current: null };
  },
  useCallback(fn) {
    return fn;
  },
};
const client = registration.factory(() => React);
const registrations = [];
let injected = false;
client.apply({
  slots: {
    inject(slot, callback) {
      injected = true;
      assert.equal(slot, 'conversation.input.dock');
      callback();
    },
    register(options, component) {
      registrations.push({ options, component });
      return () => {};
    },
  },
  sessions: {
    binding() {
      return undefined;
    },
  },
});

assert.equal(client.inject.includes('sessions'), true);
assert.equal(injected, true);
assert.equal(registrations.length, 1);
assert.equal(registrations[0].options.name, 'conversation.input.dock');
assert.equal(registrations[0].options.id, 'xiaoyuer-voice-memory');
assert.equal(typeof registrations[0].component, 'function');

console.log('client-module ok:', registrations[0].options);
