import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, localDate, reducer, selectFinance, selectStats } from './model.js';
import { validateBackup } from './persistence.js';

test('claiming beyond the persisted reward capacity cannot produce an unsaveable state', () => {
  let state = createInitialState();
  for (let days = 0; days < 14; days++) {
    const date = new Date(); date.setDate(date.getDate() - days);
    state = reducer(state, { type: 'SET_QUEST_COMPLETED', id: 'daily-move', date: localDate(date) });
  }
  for (let index = 0; index < 500; index++) state = reducer(state, { type: 'CLAIM_REWARD', id: `reward-${index}`, cost: 1 });
  assert.equal(state.rewards.length, 500);
  assert.equal(selectStats(state).balance, 60);
  assert.deepEqual(validateBackup(JSON.stringify(state)), state);
  const next = reducer(state, { type: 'CLAIM_REWARD', id: 'reward-overflow', cost: 1 });
  assert.equal(next, state);
  assert.deepEqual(validateBackup(JSON.stringify(next)), state);
});

test('increasing a completed goal target preserves actual progress and reopens the goal', () => {
  let state = reducer(createInitialState(), { type: 'ADD_GOAL', goal: { id: 'pages', title: 'Книжка', category: 'growth', target: 10, current: 10, unit: 'сторінок' } });
  assert.equal(state.goals[0].status, 'completed');
  state = reducer(state, { type: 'UPDATE_GOAL', id: 'pages', goal: { target: 20 } });
  assert.equal(state.goals[0].current, 10);
  assert.equal(state.goals[0].target, 20);
  assert.equal(state.goals[0].status, 'active');
  assert.deepEqual(validateBackup(JSON.stringify(state)), state);
});

test('free-form legacy finance categories never inherit a JavaScript object property as a limit', () => {
  let state = createInitialState();
  for (const [index, category] of ['constructor', '__proto__', 'toString'].entries()) state = reducer(state, { type: 'ADD_EXPENSE', expense: { id: `expense-${index}`, title: 'Legacy import', category, amount: 0.1 } });
  const finance = selectFinance(state);
  assert.equal(finance.expense, 0.3);
  assert.equal(finance.income, 0);
  assert.ok(finance.byCategory.every(category => category.limit === 0));
  assert.deepEqual(validateBackup(JSON.stringify(state)), state);
});

test('backup import rejects malformed coach routing, privacy consent and message provenance without rejecting legacy omissions', () => {
  let initial = createInitialState();
  initial = reducer(initial, { type: 'ADD_MESSAGE', message: { id: 'm', role: 'assistant', text: 'Відповідь', source: 'openai' } });
  for (const mutate of [state => { state.profile.coachMode = 'unknown'; }, state => { state.profile.coachContextConsent = 'true'; }, state => { state.messages[0].source = 'unknown'; }]) {
    const state = structuredClone(initial); mutate(state);
    assert.throws(() => validateBackup(JSON.stringify(state)));
  }
  const legacy = structuredClone(initial);
  delete legacy.profile.coachMode; delete legacy.profile.coachContextConsent; delete legacy.messages[0].source;
  const normalized = validateBackup(JSON.stringify(legacy));
  assert.equal(normalized.profile.coachMode, 'openai');
  assert.equal(normalized.profile.coachContextConsent, false);
  assert.equal(normalized.messages[0].source, 'local');
});
