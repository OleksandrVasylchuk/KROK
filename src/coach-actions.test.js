import test from 'node:test';
import assert from 'node:assert/strict';
import { COACH_ACTION_LIMIT, buildCoachActionContext, coachStateFingerprint, validateCoachActions, normalizeCoachProposal, checkCoachProposal } from './coach-actions.js';
import { createInitialState, localDate, reducer, restoreState, selectStats } from './model.js';
import { validateBackup, createPersistence } from './persistence.js';
import { scopedStorage, scopedPreferences } from './app-persistence.js';

const goal = (overrides = {}) => ({ type: 'create_goal', ref: 'goal-one', title: 'Прочитати нову книжку', description: 'Читати у власному темпі.', category: 'growth', target: 200, unit: 'сторінок', deadline: '', ...overrides });
const quest = (overrides = {}) => ({ type: 'create_quest', ref: 'quest-one', title: 'Прочитати перший розділ', description: 'Знайти спокійне місце.', category: 'growth', minutes: 15, frequency: 'once', weekdays: [], scheduledDate: localDate(), goalId: null, goalRef: null, ...overrides });
const habit = (overrides = {}) => ({ type: 'create_habit', ref: 'habit-one', title: 'Нотатка після читання', category: 'growth', icon: 'book', target: 1, unit: 'нотатка', timeOfDay: 'evening', frequency: 'daily', weekdays: [], ...overrides });
const content = actions => ({ text: 'Ось конкретні кроки для тебе.', actions });
const proposal = (state, actions = [quest()], id = 'proposal-one') => ({ id, date: localDate(), ...content(actions), model: 'test-model', sourceFingerprint: coachStateFingerprint(state), status: 'pending', appliedIds: [] });
const save = (state, record) => reducer(state, { type: 'SAVE_COACH_PROPOSAL', proposal: record });
const apply = (state, id = 'proposal-one') => reducer(state, { type: 'APPLY_COACH_PROPOSAL', id });
const past = days => { const date = new Date(); date.setDate(date.getDate() - days); return localDate(date); };

test('strict action boundary permits text-only answers and caps actions at five', () => {
  assert.equal(COACH_ACTION_LIMIT, 5);
  assert.equal(validateCoachActions(content([])).ok, true);
  assert.equal(validateCoachActions(content([quest(), habit(), goal()])).ok, true);
  assert.equal(validateCoachActions(content(Array.from({ length: 6 }, (_, index) => quest({ ref: `q${index}`, title: `Крок ${index}` })))).ok, false);
  for (const value of [{ ...content([]), tools: [] }, content([quest({ xp: 1000 })]), content([habit({ target: 0 })]), content([goal({ target: 1.001 })]), content([goal({ target: 1.000000000001 })]), content([quest({ minutes: 181 })]), content([quest({ frequency: 'weekdays', weekdays: [] })]), content([quest({ ref: '__proto__' })]), content([quest({ description: null })]), content([quest({ type: ['create_quest'] })]), content([quest({ type: { toString: 'create_quest' } })])]) assert.equal(validateCoachActions(value).ok, false);
});

test('existing record access requires authorized context, new records and local goal references do not', () => {
  const state = createInitialState();
  const done = { type: 'complete_quest', ref: 'done', id: state.quests[0].id, date: localDate() };
  assert.equal(validateCoachActions(content([done])).error.code, 'context_required');
  assert.equal(validateCoachActions(content([done]), { context: buildCoachActionContext(state) }).ok, true);
  assert.equal(validateCoachActions(content([quest({ goalId: 'private-goal' })])).error.code, 'context_required');
  assert.equal(validateCoachActions(content([quest({ goalRef: 'goal-one' }), goal()])).ok, true);
  assert.equal(validateCoachActions(content([quest({ goalRef: 'missing' })])).error.code, 'unknown_goal_ref');
  assert.equal(validateCoachActions(content([done]), { context: { ...buildCoachActionContext(state), quests: [] } }).error.code, 'quest_not_due');
});

test('semantic checks reject duplicate changes, unknown ids, invalid dates and out-of-target progress', () => {
  const state = createInitialState();
  const context = buildCoachActionContext(state);
  const action = { type: 'set_habit_count', ref: 'water', id: 'water', date: localDate(), value: 2 };
  for (const value of [content([action, { ...action, ref: 'again' }]), content([{ ...action, id: 'missing' }]), content([{ ...action, value: 9 }]), content([{ ...action, date: past(1) }]), content([quest(), quest({ ref: 'again', title: '  прочитати   перший розділ ' })]), content([goal({ deadline: '2026-02-30' })])]) assert.equal(validateCoachActions(value, { context }).ok, false);
});

test('atomic create batch resolves a goal reference before its quest and only completion earns XP', () => {
  const initial = createInitialState();
  const record = proposal(initial, [quest({ goalRef: 'goal-one' }), habit(), goal()]);
  const pending = save(initial, record);
  assert.equal(checkCoachProposal(pending, record).ok, true);
  const next = apply(pending);
  assert.equal(next.quests.length, initial.quests.length + 1);
  assert.equal(next.habits.length, initial.habits.length + 1);
  assert.equal(next.goals.length, 1);
  assert.equal(next.quests.at(-1).id, 'coach-proposal-one-0');
  assert.equal(next.goals[0].id, 'coach-proposal-one-2');
  assert.equal(next.quests.at(-1).goalId, next.goals[0].id);
  assert.equal(next.quests.at(-1).xp, 30);
  assert.equal(selectStats(next).totalXp, 0);
  assert.equal(next.coachProposals[0].status, 'applied');
  const loaded = validateBackup(JSON.stringify(next));
  assert.deepEqual(loaded, next);
  assert.equal(apply(loaded), loaded);
  assert.equal(save(loaded, record), loaded);
});

test('progress actions are absolute and cannot double-count XP after retries or reload', () => {
  let state = reducer(createInitialState(), { type: 'ADD_GOAL', goal: { id: 'g', title: 'Сторінки', category: 'growth', target: 100, unit: 'сторінок' } });
  const actions = [{ type: 'complete_quest', ref: 'done', id: 'daily-move', date: localDate() }, { type: 'set_habit_count', ref: 'water', id: 'water', date: localDate(), value: 3 }, { type: 'set_goal_progress', ref: 'pages', id: 'g', value: 25.5 }];
  state = apply(save(state, proposal(state, actions)));
  assert.equal(selectStats(state).totalXp, 40);
  assert.equal(state.habitLogs[localDate()].water, 3);
  assert.equal(state.goals[0].current, 25.5);
  const loaded = restoreState(state);
  assert.equal(apply(loaded), loaded);
  assert.equal(reducer(loaded, { type: 'SET_QUEST_COMPLETED', id: 'daily-move' }), loaded);
  assert.equal(selectStats(loaded).totalXp, 40);
});

test('full batch capacity failure changes neither records nor receipt', () => {
  const state = createInitialState();
  state.habits = Array.from({ length: 50 }, (_, index) => ({ ...state.habits[0], id: `h${index}`, title: `Звичка ${index}` }));
  const pending = save(state, proposal(state, [goal(), habit()]));
  assert.equal(checkCoachProposal(pending, pending.coachProposals[0]).error.code, 'record_capacity');
  assert.equal(apply(pending), pending);
  assert.equal(pending.goals.length, 0);
  assert.equal(pending.coachProposals[0].status, 'pending');
});

test('stale response is blocked by records or progress but not by chat, consent, or another preview', () => {
  const state = createInitialState();
  const record = proposal(state);
  let pending = save(state, record);
  pending = reducer(pending, { type: 'ADD_MESSAGE', message: { role: 'assistant', text: 'Пропозиція готова.', source: 'openai' } });
  pending = reducer(pending, { type: 'UPDATE_PROFILE', profile: { coachActionsConsent: true, coachTone: 'buddy' } });
  pending = reducer(pending, { type: 'UPDATE_PROFILE', profile: { coachActionsConsent: false } });
  assert.equal(coachStateFingerprint(pending), record.sourceFingerprint);
  assert.equal(checkCoachProposal(pending, record).ok, true);
  const changed = reducer(pending, { type: 'LOG_HABIT', id: 'water' });
  assert.equal(checkCoachProposal(changed, record).error.code, 'stale_proposal');
  assert.equal(apply(changed), changed);
  assert.equal(apply(pending).coachProposals[0].status, 'applied');
});

test('day rollover, dismissal, duplicate titles and receipt-capacity have clear rejection results', () => {
  const state = createInitialState();
  const old = { ...proposal(state), date: past(1) };
  old.actions[0].scheduledDate = old.date;
  state.coachProposals = [old];
  assert.equal(checkCoachProposal(state, old).error.code, 'day_changed');
  assert.equal(apply(state), state);
  const fresh = createInitialState();
  const duplicate = proposal(fresh, [quest({ title: fresh.quests[0].title })]);
  assert.equal(checkCoachProposal(fresh, duplicate).error.code, 'already_exists');
  const record = proposal(fresh);
  const dismissed = reducer(save(fresh, record), { type: 'DISMISS_COACH_PROPOSAL', id: record.id });
  assert.equal(checkCoachProposal(dismissed, dismissed.coachProposals[0]).error.code, 'already_handled');
  assert.equal(apply(dismissed), dismissed);
  fresh.coachProposals = Array.from({ length: 100 }, (_, index) => ({ ...record, id: `p${index}`, status: 'dismissed' }));
  assert.equal(checkCoachProposal(fresh, record).error.code, 'proposal_capacity');
  assert.equal(save(fresh, record), fresh);
});

test('backup migration preserves receipts and consent is strict without silently dropping malformed data', () => {
  const legacy = createInitialState();
  legacy.schemaRevision = 3;
  delete legacy.coachProposals; delete legacy.profile.coachActionsConsent;
  const restored = validateBackup(JSON.stringify(legacy));
  assert.equal(restored.schemaRevision, 6);
  assert.deepEqual(restored.coachProposals, []);
  assert.equal(restored.profile.coachActionsConsent, false);
  assert.equal(reducer(restored, { type: 'UPDATE_PROFILE', profile: { coachActionsConsent: 'true' } }).profile.coachActionsConsent, false);
  let state = save(restored, proposal(restored));
  assert.deepEqual(validateBackup(JSON.stringify(state)), state);
  for (const mutate of [value => { value.coachProposals[0].actions[0].xp = 100; }, value => { value.coachProposals[0].status = 'applied'; }, value => { value.coachProposals[0].sourceFingerprint = 'bad'; }, value => { value.profile.coachActionsConsent = 1; }, value => { value.coachProposals.push(value.coachProposals[0]); }]) {
    const bad = structuredClone(state); mutate(bad);
    assert.throws(() => validateBackup(JSON.stringify(bad)));
  }
  state = apply(state);
  assert.equal(normalizeCoachProposal({ ...state.coachProposals[0], appliedIds: ['forged'] }), null);
});

test('review aggregates actual recorded completions and scheduled habit days without private fields', () => {
  const state = createInitialState(past(10));
  state.profile.avatar = 'private image'; state.checkIns[localDate()] = { mood: 2, energy: 3, note: 'private journal' }; state.expenses = [{ note: 'private transaction' }];
  state.completions[localDate()] = ['daily-move', 'daily-move', 'missing'];
  state.completions[past(7)] = ['daily-read'];
  state.habitLogs[localDate()] = { water: 8 };
  const result = buildCoachActionContext(state);
  assert.equal(result.review.questCompletions, 1);
  assert.equal(result.review.plannedMinutes, 20);
  assert.equal(result.review.habitCompletedDays, 1);
  assert.equal(result.review.habitScheduledDays, 21);
  assert.equal(result.review.byDay.length, 7);
  assert.equal(JSON.stringify(result).includes('private'), false);
  assert.deepEqual(result.capacity, { quests: 5, habits: 3, goals: 0 });
  const recreated = structuredClone(state); recreated.completions = Object.fromEntries(Object.entries(state.completions).reverse());
  assert.equal(coachStateFingerprint(recreated), coachStateFingerprint(state));
});

test('applied proposals persist through browser and native demo adapters without touching personal storage', async () => {
  for (const native of [false, true]) {
    const personal = JSON.stringify(createInitialState());
    const values = new Map([['krok-state-v1', personal]]);
    const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
    const preferences = { get: async ({ key }) => ({ value: values.get(key) ?? null }), set: async ({ key, value }) => { values.set(key, value); } };
    const persistence = createPersistence({ native, storage: scopedStorage(storage, 'krok-demo-v3'), preferences: scopedPreferences(preferences, 'krok-demo-v3') });
    const boot = await persistence.initializePersistence();
    const state = apply(save(boot.state, proposal(boot.state)));
    assert.equal(await persistence.persistState(state), true);
    assert.equal(values.get('krok-state-v1'), personal);
    const loaded = validateBackup(values.get('krok-demo-v3'));
    assert.equal(loaded.coachProposals[0].status, 'applied');
    assert.equal(apply(loaded), loaded);
  }
});
