import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, localDate, reducer, restoreState, selectStats, STORAGE_KEY } from './model.js';
import { createPersistence, validateBackup } from './persistence.js';
import { emptyLifeProfile } from './life-profile.js';

const shiftDate = days => { const date = new Date(); date.setDate(date.getDate() + days); return localDate(date); };
const content = () => ({ summary: 'Почни з доступної маленької дії.', insights: [{ category: 'body', observation: 'Ти хочеш більше рухатися.', advice: 'Знайди короткий комфортний маршрут.' }], quests: [{ title: 'Прогуляйся десять хвилин', description: 'Пройдися знайомим маршрутом у своєму темпі.', category: 'body', minutes: 10 }] });
const record = (id = 'daily-plan-a', date = localDate()) => ({ id, date, ...content(), model: 'test-model' });
const save = (state, plan = record()) => reducer(state, { type: 'SAVE_DAILY_PLAN', plan });
const apply = (state, id = 'daily-plan-a', extra = {}) => reducer(state, { type: 'APPLY_DAILY_PLAN', id, ...extra });

test('old coach-plan data prefills intake without granting new AI consent or changing old progress', () => {
  const raw = createInitialState();
  raw.profile.coachPlan = { priorities: ['sleep', 'body'], desiredChange: 'Відновити ритм', obstacle: 'Пізно закінчую роботу', dailyTime: '20-30', extra: 'Працюю позмінно', step: 4 };
  raw.profile.coachContextConsent = true;
  delete raw.profile.lifeProfile; delete raw.dailyPlans;
  raw.completions[localDate()] = ['daily-move'];
  const next = validateBackup(JSON.stringify(raw));
  assert.deepEqual(next.completions, raw.completions); assert.deepEqual(next.profile.coachPlan, raw.profile.coachPlan);
  assert.equal(next.profile.lifeProfile.status, 'in_progress'); assert.equal(next.profile.lifeProfile.dailyMinutes, 30);
  assert.deepEqual(next.profile.lifeProfile.focus, ['sleep', 'body']); assert.equal(next.profile.lifeProfile.domains.sleep.desired, 'Відновити ритм');
  assert.equal(next.profile.lifeProfile.aiConsent, false); assert.equal(next.profile.lifeProfile.about, 'Працюю позмінно');
  assert.deepEqual(next.dailyPlans, []); assert.equal(next.schemaRevision, 6);
});

test('draft intake updates persist all domains and preserve explicit opt-in only', () => {
  const lifeProfile = emptyLifeProfile(); lifeProfile.status = 'in_progress'; lifeProfile.step = 7; lifeProfile.dailyMinutes = 25; lifeProfile.focus = ['sleep', 'career']; lifeProfile.about = 'Змінний графік'; lifeProfile.aiConsent = true;
  lifeProfile.domains.career = { rating: 3, current: 'Нова робота', desired: 'Структурувати день', obstacle: 'Часті переривання' };
  const state = reducer(createInitialState(), { type: 'UPDATE_PROFILE', profile: { lifeProfile } });
  assert.deepEqual(state.profile.lifeProfile, lifeProfile); assert.deepEqual(validateBackup(JSON.stringify(state)), state);
  assert.equal(reducer(state, { type: 'UPDATE_PROFILE', profile: { lifeProfile: { ...lifeProfile, aiConsent: 'true' } } }).profile.lifeProfile.aiConsent, false);
});

test('applying a daily plan is atomic, earns no XP until completion and survives reload idempotently', () => {
  const initial = createInitialState(); const state = save(initial); const next = apply(state);
  assert.deepEqual(next.quests.slice(0, initial.quests.length), initial.quests); assert.equal(next.quests.length, initial.quests.length + 1);
  const quest = next.quests.at(-1); assert.equal(quest.frequency, 'once'); assert.equal(quest.scheduledDate, localDate()); assert.equal(quest.xp, 30); assert.equal(quest.attribute, 'strength');
  assert.equal(selectStats(next).totalXp, 0); assert.deepEqual(next.dailyPlans[0].appliedQuestIds, [quest.id]);
  assert.equal(apply(next), next);
  const restored = validateBackup(JSON.stringify(next)); assert.deepEqual(restored, next); assert.equal(apply(restored), restored);
  const done = reducer(restored, { type: 'TOGGLE_QUEST', id: quest.id }); assert.equal(selectStats(done).totalXp, 30);
  assert.equal(save(done, record()), done);
});

test('one accepted plan per day remains enforced after archive and preview retention pressure', () => {
  let state = apply(save(createInitialState()));
  const appliedId = state.dailyPlans[0].appliedQuestIds[0];
  state = reducer(state, { type: 'ARCHIVE_QUEST', id: appliedId });
  for (let i = 0; i < 35; i++) state = save(state, record(`preview-${i}`));
  assert.equal(state.dailyPlans.length, 30); assert.ok(state.dailyPlans.some(item => item.id === 'daily-plan-a'));
  const restored = validateBackup(JSON.stringify(state)); assert.equal(apply(restored, 'preview-34'), restored);
  assert.equal(restored.quests.find(quest => quest.id === appliedId).archived, true);
});

test('old/future plans, stale fingerprints and malformed edits cannot create quests', () => {
  const initial = createInitialState(); assert.equal(save(initial, record('future', shiftDate(1))), initial);
  const old = save(initial, record('old', shiftDate(-1))); assert.equal(apply(old, 'old'), old);
  const fingerprint = 'a'.repeat(64); const state = save(initial, { ...record(), sourceFingerprint: fingerprint });
  assert.equal(apply(state), state); assert.equal(apply(state, 'daily-plan-a', { sourceFingerprint: 'b'.repeat(64) }), state);
  for (const quests of [null, [], [{ ...content().quests[0], xp: 500 }], [{ ...content().quests[0], minutes: 16 }]]) assert.equal(apply(state, 'daily-plan-a', { sourceFingerprint: fingerprint, quests }), state);
  assert.equal(apply(state, 'daily-plan-a', { sourceFingerprint: fingerprint }).quests.length, initial.quests.length + 1);
});

test('editable subsets respect the current time budget and preserve capacity atomically', () => {
  const extra = { title: 'Напиши близькій людині', description: 'Запитай, як минає день.', category: 'social', minutes: 5 };
  const source = { ...record(), quests: [...content().quests, extra] };
  let state = save(createInitialState(), source);
  state = reducer(state, { type: 'UPDATE_PROFILE', profile: { lifeProfile: { ...state.profile.lifeProfile, dailyMinutes: 5 } } });
  assert.equal(apply(state), state);
  const edited = { ...extra, title: 'Напиши другові' }; const selected = apply(state, source.id, { quests: [edited] });
  assert.equal(selected.quests.at(-1).title, edited.title); assert.equal(selected.quests.at(-1).attribute, 'charisma');
  assert.deepEqual(selected.dailyPlans[0].quests, [edited]);
  assert.deepEqual(validateBackup(JSON.stringify(selected)).dailyPlans[0].quests, [edited]);
  const nearlyFull = save(createInitialState(), source);
  nearlyFull.quests = Array.from({ length: 199 }, (_, i) => ({ ...nearlyFull.quests[0], id: `existing-${i}` }));
  assert.equal(apply(nearlyFull), nearlyFull); assert.equal(nearlyFull.dailyPlans[0].appliedQuestIds.length, 0);
  assert.equal(apply(nearlyFull, source.id, { quests: [extra] }).quests.length, 200);
});

test('a plan generated before midnight cannot be accepted on the next day', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 15, 23, 59, 50) });
  const state = save(createInitialState());
  t.mock.timers.tick(20_000);
  assert.equal(apply(state), state);
  const nextDay = save(state, record('new-day')); assert.equal(apply(nextDay, 'new-day').quests.length, state.quests.length + 1);
});

test('an accepted previous-day plan does not block a new day or rewrite its earned history', t => {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(2026, 8, 15, 12) });
  let state = apply(save(createInitialState()));
  const firstQuest = state.quests.at(-1);
  state = reducer(state, { type: 'TOGGLE_QUEST', id: firstQuest.id });
  t.mock.timers.tick(86_400_000);
  const next = apply(save(state, record('next-day')), 'next-day');
  assert.equal(next.quests.length, state.quests.length + 1);
  assert.deepEqual(next.completions, state.completions); assert.equal(selectStats(next).totalXp, 30);
  assert.equal(next.dailyPlans.filter(plan => plan.appliedQuestIds.length).length, 2);
  assert.deepEqual(validateBackup(JSON.stringify(next)), next);
});

test('new records round-trip through real persistence adapters without leaking intake into legacy fields', async () => {
  const values = new Map(); const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const adapter = createPersistence({ storage }); await adapter.initializePersistence();
  const state = apply(save(createInitialState(), { ...record(), sourceFingerprint: 'a'.repeat(64) }), 'daily-plan-a', { sourceFingerprint: 'a'.repeat(64) });
  assert.equal(await adapter.persistState(state), true);
  assert.deepEqual((await createPersistence({ storage }).initializePersistence()).state, state);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)).profile.coachPlan, createInitialState().profile.coachPlan);
});

test('malformed backup intake, plans, accepted references and extra AI fields are rejected', () => {
  const corruptions = [
    state => { state.profile.lifeProfile.aiConsent = 'true'; }, state => { state.profile.lifeProfile.domains.body.rating = 6; },
    state => { delete state.profile.lifeProfile.domains.sleep; }, state => { state.profile.lifeProfile.focus.push('unknown'); },
    state => { state.profile.lifeProfile.about = 'x'.repeat(1001); }, state => { state.profile.lifeProfile.step = 12; },
    state => { state.profile.lifeProfile.extra = 'dropped'; }, state => { state.dailyPlans = {}; },
    state => { state.dailyPlans[0].quests[0].xp = 50; }, state => { state.dailyPlans[0].date = shiftDate(1); },
    state => { state.dailyPlans[0].sourceFingerprint = 'invalid'; }, state => { state.dailyPlans[0].extra = 'dropped'; },
    state => { state.dailyPlans[0].appliedQuestIds = ['missing']; }, state => { state.dailyPlans.push({ ...state.dailyPlans[0], id: 'accepted-again' }); },
    state => { state.dailyPlans[0].quests.push({ ...content().quests[0], title: 'Інший крок' }); },
    state => { state.dailyPlans.push({ ...state.dailyPlans[0], id: 'reused-reference', date: shiftDate(-1) }); },
    state => { state.dailyPlans = Array.from({ length: 31 }, (_, i) => ({ ...state.dailyPlans[0], id: `plan-${i}`, appliedQuestIds: [] })); },
  ];
  for (const corrupt of corruptions) { const state = apply(save(createInitialState())); corrupt(state); assert.throws(() => validateBackup(JSON.stringify(state))); }
});

test('loading missing new fields keeps established profiles usable with safe defaults', () => {
  const state = createInitialState(); delete state.profile.lifeProfile; delete state.dailyPlans;
  const restored = restoreState(state); assert.deepEqual(restored.profile.lifeProfile, emptyLifeProfile()); assert.deepEqual(restored.dailyPlans, []);
});
