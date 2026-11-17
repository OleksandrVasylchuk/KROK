import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceInput } from './voice-input.js';
const tick = () => new Promise(resolve => setImmediate(resolve));
function browserHarness() {
  const recognizers = [], results = [], phases = [], errors = [];
  class Recognition {
    constructor() { recognizers.push(this); }
    start() { this.started = true; this.onstart?.(); }
    stop() { this.stopped = true; }
    abort() { this.aborted = true; }
    result(text, final = true) { const item = [{ transcript: text }]; item.isFinal = final; this.onresult?.({ results: [item] }); }
  }
  const service = createVoiceInput({ onResult: value => results.push(value), onState: value => phases.push(value), onError: value => errors.push(value) }, { native: false, platform: 'web', secure: true, Recognition });
  return { service, recognizers, results, phases, errors };
}
test('availability does not request microphone; final Ukrainian dictation is delivered once', async () => {
  const h = browserHarness();
  assert.deepEqual(await h.service.status(), { supported: true, platform: 'web' });
  assert.equal(h.recognizers.length, 0);
  const pending = h.service.start(); await tick();
  const mic = h.recognizers[0];
  assert.equal(mic.lang, 'uk-UA');
  assert.equal(mic.continuous, false);
  mic.result('Створи звичку читати', false);
  assert.equal(h.results.length, 0);
  mic.result('  Створи звичку читати  ');
  mic.result('  Створи звичку читати  ');
  await pending;
  assert.deepEqual(h.results, ['Створи звичку читати']);
  assert.equal(mic.aborted, true);
  assert.equal(mic.onresult, null);
  assert.deepEqual(h.phases, ['starting', 'listening', 'idle']);
  assert.deepEqual(h.errors, []);
});
test('stop waits for final text; cancel discards a late result and permits retry', async () => {
  const h = browserHarness();
  const first = h.service.start(); await tick();
  const mic = h.recognizers[0];
  await h.service.stop();
  assert.equal(mic.stopped, true);
  mic.result('Перша фраза'); await first;
  const next = h.service.start(); await tick();
  const staleCallback = h.recognizers[1].onresult;
  await h.service.cancel();
  const result = [{ transcript: 'Не зберігати' }]; result.isFinal = true;
  staleCallback({ results: [result] }); await next;
  assert.deepEqual(h.results, ['Перша фраза']);
  const retry = h.service.start(); await tick();
  h.recognizers[2].result('Повторна фраза'); await retry;
  assert.deepEqual(h.results, ['Перша фраза', 'Повторна фраза']);
});
test('permission denial and no speech are recoverable without sending text', async () => {
  const h = browserHarness();
  const first = h.service.start(); await tick();
  h.recognizers[0].onerror({ error: 'not-allowed' }); await first;
  const second = h.service.start(); await tick();
  h.recognizers[1].onend(); await second;
  assert.deepEqual(h.results, []);
  assert.deepEqual(h.errors.map(error => error.code), ['permission_denied', 'no_speech']);
});
test('unsupported and insecure contexts never instantiate a recognizer', async () => {
  let created = 0; const errors = [];
  const service = createVoiceInput({ onError: error => errors.push(error) }, { native: false, secure: false, Recognition: class { constructor() { created++; } } });
  assert.equal((await service.status()).supported, false);
  await service.start();
  assert.equal(created, 0);
  assert.equal(errors[0].code, 'unsupported');
});
test('unmount cancels microphone and suppresses all late callbacks', async () => {
  const h = browserHarness();
  const pending = h.service.start(); await tick();
  const callback = h.recognizers[0].onerror;
  const phases = [...h.phases];
  await h.service.dispose();
  callback({ error: 'network' }); await pending;
  await h.service.start();
  assert.deepEqual(h.phases, phases);
  assert.deepEqual(h.errors, []);
  assert.equal(h.recognizers.length, 1);
  assert.equal(h.recognizers[0].aborted, true);
});
test('cancel during pending runtime resolution never starts recognition', async () => {
  let resolveRuntime; let created = 0;
  const service = createVoiceInput({}, () => new Promise(resolve => { resolveRuntime = resolve; }));
  const pending = service.start(); await tick();
  await service.cancel();
  resolveRuntime({ native: false, secure: true, Recognition: class { constructor() { created++; } } });
  await pending;
  assert.equal(created, 0);
});
test('native adapter receives final text and removes listener; double start is ignored', async () => {
  const results = [], phases = []; let startCount = 0, removeCount = 0, resolveCapture, listener;
  const plugin = {
    isAvailable: async () => ({ available: true }),
    addListener: async (_event, callback) => { listener = callback; return { remove: async () => { removeCount++; } }; },
    start: () => { startCount++; listener({ phase: 'listening' }); return new Promise(resolve => { resolveCapture = resolve; }); },
    stop: async () => {}, cancel: async () => {},
  };
  const service = createVoiceInput({ onResult: text => results.push(text), onState: value => phases.push(value) }, { native: true, platform: 'android', plugin });
  assert.equal((await service.status()).supported, true);
  const pending = service.start(); await tick(); await service.start();
  resolveCapture({ text: 'Підсумуй мій день' }); await pending;
  assert.equal(startCount, 1);
  assert.equal(removeCount, 1);
  assert.deepEqual(results, ['Підсумуй мій день']);
  assert.deepEqual(phases, ['starting', 'listening', 'idle']);
});
test('native cancellation finishes before retry can start a new capture', async () => {
  let finishCancellation, resolveCapture, count = 0; const results = [];
  const plugin = {
    isAvailable: async () => ({ available: true }),
    addListener: async () => ({ remove: async () => {} }),
    start: () => { count++; return new Promise(resolve => { resolveCapture = resolve; }); },
    cancel: () => new Promise(resolve => { finishCancellation = resolve; }),
  };
  const service = createVoiceInput({ onResult: value => results.push(value) }, { native: true, platform: 'android', plugin });
  const pending = service.start(); await tick();
  const cancel = service.cancel(); await tick();
  await service.start(); assert.equal(count, 1);
  resolveCapture({ text: 'Запізнілий результат' });
  finishCancellation(); await cancel; await pending;
  assert.deepEqual(results, []);
  const retry = service.start(); await tick();
  resolveCapture({ text: 'Нова фраза' }); await retry;
  assert.equal(count, 2); assert.deepEqual(results, ['Нова фраза']);
});
test('capture has a timeout and does not leave the microphone active', async () => {
  let mic, error;
  const service = createVoiceInput({ onError: value => { error = value; } }, { native: false, secure: true, Recognition: class { constructor() { mic = this; } start() {} abort() { this.aborted = true; } stop() {} } }, { timeoutMs: 10 });
  await service.start();
  assert.equal(error.code, 'timeout');
  assert.equal(mic.aborted, true);
});
