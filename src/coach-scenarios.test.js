import test from 'node:test';
import assert from 'node:assert/strict';
import { COACH_SCENARIOS, SCENARIO_ANSWER_LIMIT, buildScenarioMessage, scenarioAnswer, scenarioProfilePatch, suggestedScenario } from './coach-scenarios.js';
import { COACH_MESSAGE_LIMIT, buildCoachActionPayload } from './coach-client.js';
import { createInitialState, localDate } from './model.js';

test('each scenario asks a few questions and its longest message fits one coach request', () => {
  for (const scenario of Object.values(COACH_SCENARIOS)) {
    assert.ok(scenario.questions.length >= 3 && scenario.questions.length <= 4, scenario.id);
    assert.ok(scenario.questions[0].required, 'the first answer carries the request');
    const message = buildScenarioMessage(scenario.id, scenario.questions.map(() => 'я'.repeat(SCENARIO_ANSWER_LIMIT)));
    assert.ok(message.length < COACH_MESSAGE_LIMIT, `${scenario.id}: ${message.length}`);
  }
});

test('answers are flattened and bounded before they reach the message', () => {
  assert.equal(scenarioAnswer('  більше \n\n енергії\tвранці  '), 'більше енергії вранці');
  assert.equal(scenarioAnswer('а'.repeat(900)).length, SCENARIO_ANSWER_LIMIT);
  assert.equal(scenarioAnswer(undefined), '');
  assert.equal(scenarioAnswer({ text: 'x' }), '');
});

test('the introduction message carries all three answers and asks for one goal with up to three steps', () => {
  const message = buildScenarioMessage('intro', ['Більше рухатися', '10–15 хвилин', 'Втома після роботи']);
  assert.match(message, /^Знайомство за дві хвилини\./);
  assert.match(message, /Що хочу змінити: Більше рухатися/);
  assert.match(message, /Скільки маю часу на день: 10–15 хвилин/);
  assert.match(message, /Що заважає: Втома після роботи/);
  assert.match(message, /одну ціль і до трьох посильних перших кроків/);
});

test('optional answers may be skipped but required ones may not', () => {
  assert.match(buildScenarioMessage('intro', ['Краще спати', '5 хвилин']), /Що заважає: не вказано/);
  assert.match(buildScenarioMessage('evening', ['Зробив зарядку', '', 'настрій 4, енергія 3', '']), /Витрати за сьогодні: не вказано/);
  assert.throws(() => buildScenarioMessage('intro', ['', '5 хвилин', '']), /обов’язкові/);
  assert.throws(() => buildScenarioMessage('evening', ['Зробив зарядку', '', '', '']), /обов’язкові/);
  assert.throws(() => buildScenarioMessage('unknown', ['x']), /Невідомий сценарій/);
});

test('the evening message keeps the spoken expense for a single confirmation', () => {
  const message = buildScenarioMessage('evening', ['Втомився, зробив лише розтяжку', 'мав десять хвилин', 'настрій 3, енергія 2', '180 гривень на обід карткою']);
  assert.match(message, /180 гривень на обід карткою/);
  assert.match(message, /одну зміну на завтра/);
  assert.match(message, /Не карай за пропущене/);
});

test('a scenario message is an ordinary user turn accepted by the action payload builder', () => {
  const state = createInitialState();
  const text = buildScenarioMessage('morning', ['енергія 3', '20 хвилин', '']);
  const payload = buildCoachActionPayload(state, [{ role: 'user', text, source: 'openai' }]);
  assert.equal(payload.messages.at(-1).text, text);
  assert.equal(payload.actionsConsent, false);
  assert.equal(payload.actionContext, undefined, 'records stay private without the separate consent');
  assert.equal(payload.context, undefined);
});

test('introduction answers update only the local coach plan', () => {
  const profile = createInitialState().profile;
  const patch = scenarioProfilePatch('intro', ['Більше рухатися', '10–15 хвилин', 'Втома'], profile);
  assert.deepEqual(patch, { coachPlan: { priorities: [], extra: '', step: 0, desiredChange: 'Більше рухатися', obstacle: 'Втома', dailyTime: '10-15' } });
  const custom = scenarioProfilePatch('intro', ['Читати', 'пів години в обід', ''], { coachPlan: { priorities: ['mind'], extra: 'коротко', step: 5, obstacle: 'лінь', dailyTime: '5' } });
  assert.deepEqual(custom.coachPlan, { priorities: ['mind'], extra: 'коротко', step: 5, desiredChange: 'Читати', obstacle: 'лінь', dailyTime: '5' });
  assert.equal(scenarioProfilePatch('morning', ['x', 'y', 'z'], profile), null);
  assert.equal(scenarioProfilePatch('intro', ['', '5 хвилин', ''], profile), null);
});

test('the home hint follows the time of day and never repeats a finished evening', () => {
  const fresh = createInitialState();
  assert.equal(suggestedScenario(fresh, new Date(2026, 10, 18, 9)), 'intro');
  const started = { ...fresh, goals: [{ id: 'g1', title: 'Рух', status: 'active' }] };
  assert.equal(suggestedScenario(started, new Date(2026, 10, 18, 8)), 'morning');
  assert.equal(suggestedScenario(started, new Date(2026, 10, 18, 14)), null);
  const evening = new Date(2026, 10, 18, 20);
  assert.equal(suggestedScenario(started, evening), 'evening');
  assert.equal(suggestedScenario({ ...started, checkIns: { [localDate(evening)]: { mood: 4, energy: 3, note: '' } } }, evening), null);
  assert.equal(suggestedScenario({ ...fresh, coachProposals: [{ id: 'p', status: 'applied' }] }, new Date(2026, 10, 18, 3)), null);
});
