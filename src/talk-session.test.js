import test from 'node:test';
import assert from 'node:assert/strict';
import { createTalkSession } from './talk-session.js';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
function setup(overrides = {}, options) {
  const events = [], phases = [], errors = [];
  const services = { listen: () => { events.push('listen'); return new Promise(() => {}); }, cancelListening: async () => { events.push('cancel-mic'); }, speak: async text => { events.push('speak:' + text); return { completed: true }; }, cancelSpeaking: async () => { events.push('cancel-speaker'); }, submit: async text => { events.push('submit:' + text); return { text: 'Відповідь', actions: [] }; }, cancelRequest: () => events.push('cancel-request'), onTranscript: text => events.push('transcript:' + text), onPhase: phase => phases.push(phase), onError: error => errors.push(error), ...overrides };
  return { session: createTalkSession(services, options), services, events, phases, errors };
}
test('conversation is inert until start; one utterance cancels capture before submit and playback', async () => {
  const f = setup(); assert.equal(await f.session.receive('Ні'), false); assert.deepEqual(f.events, []);
  await f.session.start(); await tick(); assert.deepEqual(f.events, ['listen']);
  await f.session.receive('Привіт'); await tick();
  assert.deepEqual(f.events, ['listen','transcript:Привіт','cancel-mic','submit:Привіт','speak:Відповідь','listen']);
  await f.session.stop();
});
test('proposal pauses for visual review; only explicit resume starts the next capture', async () => {
  const f = setup({ submit: async () => ({ text: 'Переглянь', actions: [{ type: 'create_quest' }] }) });
  await f.session.start(); await tick(); await f.session.receive('Створи');
  assert.equal(f.session.getPhase(), 'review'); assert.equal(f.events.filter(item => item === 'listen').length, 1);
  f.session.resume(); await tick(); assert.equal(f.events.filter(item => item === 'listen').length, 2);
  await f.session.stop();
});
test('stop during API wait ignores late response and never starts speech or capture', async () => {
  let answer; const f = setup({ submit: () => new Promise(resolve => { answer = resolve; }) });
  await f.session.start(); await tick(); const task = f.session.receive('Привіт'); await tick();
  await f.session.stop(); answer({ text: 'Запізно', actions: [] }); await task;
  assert.equal(f.events.filter(item => item.startsWith('speak:')).length, 0); assert.equal(f.session.isActive(), false);
});
test('duplicate result cannot double submit; voice failure pauses without retries', async () => {
  let answer; let calls = 0; const f = setup({ submit: () => { calls++; return new Promise(resolve => { answer = resolve; }); } });
  await f.session.start(); await tick(); const task = f.session.receive('Привіт'); await tick();
  assert.equal(await f.session.receive('Дублікат'), false); assert.equal(calls, 1);
  answer({ text: 'Так', actions: [] }); await task; f.session.fail(new Error('Denied')); await tick();
  assert.equal(f.session.getPhase(), 'paused'); assert.equal(f.errors.at(-1).message, 'Denied');
  await f.session.stop();
});
test('TTS error pauses with no automatic loop and utterance limit ends session', async () => {
  const f = setup({ speak: async () => { throw new Error('Blocked'); } });
  await f.session.start(); await tick(); await f.session.receive('Привіт');
  assert.equal(f.session.getPhase(), 'paused'); assert.equal(f.events.filter(item => item === 'listen').length, 1); await f.session.stop();
  const g = setup({}, { maxTurns: 1 }); await g.session.start(); await tick(); await g.session.receive('Привіт');
  assert.equal(g.session.isActive(), false); assert.equal(g.events.filter(item => item === 'listen').length, 1);
});
