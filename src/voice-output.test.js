import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceOutput, spokenText } from './voice-output.js';

const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function web({ voices = [{ lang: 'uk-UA', name: 'Ukrainian' }] } = {}) {
  const spoken = [], phases = [];
  const env = { native: false, Utterance: class { constructor(text) { this.text = text; } }, synthesis: { getVoices: () => voices, cancel: () => { env.cancelled++; }, speak: utterance => { spoken.push(utterance); utterance.onstart?.(); } }, cancelled: 0 };
  return { env, spoken, phases, output: createVoiceOutput({ onState: phase => phases.push(phase) }, env) };
}
test('TTS status never speaks; Ukrainian voice reads plain response text once', async () => {
  const f = web();
  assert.deepEqual(await f.output.status(), { supported: true, languageAvailable: true });
  assert.equal(f.spoken.length, 0);
  const task = f.output.speak('**Привіт!** [Крок](https://example.com)'); await tick();
  assert.equal(f.spoken[0].text, 'Привіт! Крок'); assert.equal(f.spoken[0].voice.lang, 'uk-UA');
  f.spoken[0].onend(); assert.deepEqual(await task, { completed: true });
  assert.deepEqual(f.phases, ['starting','speaking','idle']);
});
test('TTS cancel suppresses late callbacks and resolves the pending utterance', async () => {
  const f = web(); const task = f.output.speak('Тест'); await tick();
  const late = f.spoken[0].onend; await f.output.cancel(); late();
  assert.deepEqual(await task, { completed: false, cancelled: true }); assert.equal(f.env.cancelled, 1);
  await f.output.dispose(); assert.deepEqual(await f.output.speak('Ні'), { completed: false, cancelled: true });
});
test('TTS unavailable Ukrainian voice and browser permission fail clearly', async () => {
  const f = web({ voices: [{ lang: 'en-US' }] });
  await assert.rejects(f.output.speak('Тест'), error => error.code === 'language'); assert.equal(f.spoken.length, 0);
  const g = web(); const task = g.output.speak('Тест'); await tick();
  g.spoken[0].onerror({ error: 'not-allowed' }); await assert.rejects(task, error => error.code === 'blocked');
});
test('TTS cancel during runtime resolution never launches output; bounded output times out', async () => {
  let resolve; const f = web(); const output = createVoiceOutput({}, () => new Promise(r => { resolve = r; }));
  const task = output.speak('Тест'); await tick(); await output.cancel(); resolve(f.env);
  assert.equal((await task).cancelled, true); assert.equal(f.spoken.length, 0);
  const timed = createVoiceOutput({}, f.env, { timeoutMs: 8 });
  await assert.rejects(timed.speak('Тест'), error => error.code === 'timeout'); assert.equal(f.env.cancelled, 1);
});
test('native TTS returns completion, forwards cancellation and preserves capability errors', async () => {
  let finish, stopped = 0;
  const native = { native: true, platform: 'android', plugin: { isAvailable: async () => ({ available: true, languageAvailable: true }), speak: args => { assert.equal(args.language, 'uk-UA'); return new Promise(resolve => { finish = resolve; }); }, stop: async () => { stopped++; finish?.({ completed: false }); } } };
  const output = createVoiceOutput({}, native); assert.equal((await output.status()).supported, true);
  const task = output.speak('Привіт'); await tick(); await output.cancel(); assert.equal((await task).cancelled, true); assert.equal(stopped, 1);
  native.plugin.speak = async () => { throw { code: 'language' }; };
  await assert.rejects(output.speak('Тест'), error => error.code === 'language');
});
test('spoken text drops code blocks and bounds oversized responses', () => {
  assert.equal(spokenText('Порада ```json\n{"actions":[]}\n``` далі'), 'Порада далі');
  assert.equal(spokenText('а'.repeat(9000)).length, 6000);
});
