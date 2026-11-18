import test from 'node:test';
import assert from 'node:assert/strict';
import { STORAGE_KEY, CATEGORIES, createInitialState, localDate, loadState, saveState, reducer, selectStats, coachReply, isQuestDue, selectActiveQuests, isHabitDue, selectActiveHabits, habitStreak, selectFinance } from './model.js';
import { FINANCE_CATEGORIES, QUEST_TEMPLATES, HABIT_TEMPLATES } from './catalog.js';
import { createDemoState } from './demo.js';

const today = localDate();
const before = (offset) => { const date = new Date(); date.setDate(date.getDate() - offset); return localDate(date); };
const complete = (state, id = 'daily-move', date = today) => reducer(state, { type: 'TOGGLE_QUEST', id, date });

test('new users start with real zero progress, not fabricated history', () => {
  const state = createInitialState();
  const stats = selectStats(state);
  assert.equal(stats.totalXp, 0);
  assert.equal(stats.level, 1);
  assert.equal(stats.streak, 0);
  assert.equal(stats.todayTotal, 5);
  assert.equal(state.profile.onboarded, false);
});

test('quest toggle earns once, can undo, and resets availability on a new date', () => {
  const initial = createInitialState();
  const done = complete(initial);
  assert.equal(selectStats(done).totalXp, 40);
  assert.equal(selectStats(done).todayCompleted, 1);
  assert.equal(selectStats(complete(done)).totalXp, 0);
  const prior = complete(done, 'daily-move', before(1));
  assert.equal(selectStats(prior).totalXp, 80);
  assert.equal(selectStats(prior).todayCompleted, 1);
  assert.deepEqual(initial.completions, {});
});

test('duplicate and unknown saved completion IDs do not mint XP', () => {
  const state = createInitialState();
  state.completions[today] = ['daily-move', 'daily-move', 'missing'];
  assert.equal(selectStats(state).totalXp, 40);
  assert.equal(selectStats(state).todayCompleted, 1);
});

test('streak includes yesterday until today is completed, breaks across missed days', () => {
  let state = complete(createInitialState(), 'daily-move', before(1));
  state = complete(state, 'daily-move', before(2));
  assert.equal(selectStats(state).streak, 2);
  state = complete(state);
  assert.equal(selectStats(state).streak, 3);
  state = complete(state, 'daily-move', before(1));
  assert.equal(selectStats(state).streak, 1);
  state = complete(state);
  assert.equal(selectStats(state).streak, 0);
});

test('reward spending cannot be duplicated or take balance below zero', () => {
  const done = complete(createInitialState());
  assert.equal(reducer(done, { type: 'CLAIM_REWARD', id: 'break', cost: 50 }), done);
  const claimed = reducer(done, { type: 'CLAIM_REWARD', id: 'break', cost: 30 });
  assert.equal(selectStats(claimed).balance, 10);
  assert.equal(selectStats(claimed).totalXp, 40);
  assert.equal(reducer(claimed, { type: 'CLAIM_REWARD', id: 'break', cost: 1 }), claimed);
  assert.equal(reducer(claimed, { type: 'CLAIM_REWARD', id: 'bad', cost: -100 }), claimed);
  assert.equal(complete(claimed), claimed, 'cannot undo already spent XP');
});

test('habit counters cap, reset independently, and do not spill into other dates', () => {
  let state = createInitialState();
  for (let i = 0; i < 12; i += 1) state = reducer(state, { type: 'LOG_HABIT', id: 'water' });
  assert.equal(state.habitLogs[today].water, 8);
  state = reducer(state, { type: 'LOG_HABIT', id: 'book', date: before(1) });
  assert.equal(state.habitLogs[before(1)].book, 1);
  assert.equal(state.habitLogs[today].book, undefined);
  state = reducer(state, { type: 'RESET_HABIT', id: 'water' });
  assert.equal(state.habitLogs[today].water, 0);
});

test('invalid expenses and duplicate IDs are rejected; valid entries round cents and delete', () => {
  const state = createInitialState();
  for (const amount of [-1, 0, 0.001, NaN, Infinity, 1000001]) assert.equal(reducer(state, { type: 'ADD_EXPENSE', expense: { title: 'Кава', amount } }), state);
  const saved = reducer(state, { type: 'ADD_EXPENSE', expense: { id: 'coffee', title: ' Кава ', amount: 48.556 } });
  assert.equal(saved.expenses[0].amount, 48.56);
  assert.equal(saved.expenses[0].title, 'Кава');
  assert.equal(reducer(saved, { type: 'ADD_EXPENSE', expense: { id: 'coffee', title: 'Кава', amount: 30 } }), saved);
  assert.equal(reducer(saved, { type: 'DELETE_EXPENSE', id: 'coffee' }).expenses.length, 0);
});

test('storage failures fall back safely and failed writes are reported', () => {
  const denied = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('full'); } };
  assert.equal(loadState(denied).version, 1);
  assert.equal(saveState(createInitialState(), denied), false);
  assert.equal(loadState({ getItem: () => '{broken' }).quests.length, 5);
  assert.equal(loadState({ getItem: () => JSON.stringify({ version: 999 }) }).version, 1);
});

test('storage round-trip preserves user work and sanitizes corrupted fields', () => {
  let stored;
  const storage = { setItem(key, value) { assert.equal(key, STORAGE_KEY); stored = value; }, getItem: () => stored };
  const state = complete(createInitialState());
  assert.equal(saveState(state, storage), true);
  assert.deepEqual(loadState(storage), state);
  const corrupt = { ...state, profile: { name: 123, focus: 'unknown', onboarded: 'yes' }, rewards: [{ id: 'free', cost: 500, date: today }] };
  corrupt.completions[today].push('daily-move', 'absent');
  stored = JSON.stringify(corrupt);
  const recovered = loadState(storage);
  assert.equal(recovered.profile.name, 'Друже');
  assert.equal(recovered.profile.onboarded, false);
  assert.equal(selectStats(recovered).totalXp, 40);
  assert.equal(recovered.rewards.length, 0);
});

test('future/invalid logs are ignored and date conversion respects local calendar', () => {
  const state = createInitialState();
  assert.equal(reducer(state, { type: 'TOGGLE_QUEST', id: 'daily-move', date: '2026-02-30' }), state);
  assert.equal(reducer(state, { type: 'TOGGLE_QUEST', id: 'daily-move', date: '2199-01-01' }), state);
  assert.equal(localDate(new Date(2026, 0, 3, 23, 55)), '2026-01-03');
});

test('progress levels derive from earned XP and category totals reconcile', () => {
  let state = createInitialState();
  for (const date of [today, before(1)]) for (const quest of state.quests) state = complete(state, quest.id, date);
  const stats = selectStats(state);
  assert.equal(stats.totalXp, 350);
  assert.equal(stats.level, 2);
  assert.equal(stats.currentLevelXp, 50);
  assert.equal(Object.values(stats.categoryStats).reduce((sum, category) => sum + category.totalXp, 0), stats.totalXp);
  assert.equal(stats.attributes.strength, 80);
  assert.equal(stats.attributes.endurance, 50);
  assert.equal(stats.attributes.intelligence, 90);
  assert.equal(Object.values(stats.attributes).reduce((sum, xp) => sum + xp, 0), stats.totalXp);
});

test('avatar accepts bounded image data URLs and rejects external URLs and SVG', () => {
  const state = createInitialState();
  const image = 'data:image/png;base64,aGVsbG8=';
  const updated = reducer(state, { type: 'UPDATE_PROFILE', profile: { avatar: image } });
  assert.equal(updated.profile.avatar, image);
  assert.equal(reducer(updated, { type: 'UPDATE_PROFILE', profile: { avatar: 'https://example.com/image.png' } }).profile.avatar, image);
  assert.equal(reducer(updated, { type: 'UPDATE_PROFILE', profile: { avatar: 'data:image/svg+xml;base64,aGVsbG8=' } }).profile.avatar, image);
  assert.equal(reducer(updated, { type: 'UPDATE_PROFILE', profile: { avatar: '' } }).profile.avatar, '');
});

test('portrait migration keeps existing custom images and preserves earned progress', () => {
  const legacy = complete(createInitialState());
  delete legacy.profile.portrait;
  const image = 'data:image/jpeg;base64,YWJj';
  legacy.profile.avatar = image;
  const restored = loadState({ getItem: () => JSON.stringify(legacy) });
  assert.equal(restored.profile.portrait, '');
  assert.equal(restored.profile.avatar, image);
  assert.equal(selectStats(restored).totalXp, 40);
  legacy.profile.avatar = '';
  assert.equal(loadState({ getItem: () => JSON.stringify(legacy) }).profile.portrait, '');
});

test('portrait choices retain custom images and explicit no-preset survives reload', () => {
  const initial = createInitialState();
  assert.equal(initial.profile.portrait, '');
  const image = 'data:image/png;base64,YWJj';
  let state = reducer(initial, { type: 'UPDATE_PROFILE', profile: { avatar: image, portrait: '' } });
  for (const portrait of ['photo-v1', 'traveler-v1', '']) {
    state = reducer(state, { type: 'UPDATE_PROFILE', profile: { portrait } });
    state = loadState({ getItem: () => JSON.stringify(state) });
    assert.equal(state.profile.portrait, portrait);
    assert.equal(state.profile.avatar, image);
  }
  const cleared = reducer(state, { type: 'UPDATE_PROFILE', profile: { avatar: '', portrait: '' } });
  assert.equal(loadState({ getItem: () => JSON.stringify(cleared) }).profile.portrait, '');
  assert.equal(reducer(state, { type: 'UPDATE_PROFILE', profile: { portrait: 'unsupported' } }).profile.portrait, '');
});

test('old quests receive category attributes on restore and custom quests can target endurance', () => {
  const state = createInitialState();
  delete state.quests[0].attribute;
  const restored = loadState({ getItem: () => JSON.stringify(state) });
  assert.equal(restored.quests[0].attribute, 'strength');
  const added = reducer(restored, { type: 'ADD_QUEST', quest: { id: 'run', title: 'Кардіо', category: 'body', attribute: 'endurance', xp: 30, minutes: 10 } });
  assert.equal(selectStats(complete(added, 'run')).attributes.endurance, 30);
});

test('local coach is transparent and uses actual progress and expenses', () => {
  let state = complete(createInitialState());
  state = reducer(state, { type: 'ADD_EXPENSE', expense: { title: 'Кава', amount: 50 } });
  assert.match(coachReply('Ти справжній ШІ?', state), /без підключення до ШІ/);
  assert.match(coachReply('Мій прогрес', state), /40 XP/);
  assert.match(coachReply('Мої витрати', state), /50 ₴/);
});

test('coach tone persists, rejects unknown values, and migrates old profiles', () => {
  const state = createInitialState();
  assert.equal(state.profile.coachTone, 'supportive');
  for (const coachTone of ['supportive', 'buddy', 'direct']) {
    const updated = reducer(state, { type: 'UPDATE_PROFILE', profile: { coachTone } });
    assert.equal(updated.profile.coachTone, coachTone);
    const restored = loadState({ getItem: () => JSON.stringify(updated) });
    assert.equal(restored.profile.coachTone, coachTone);
    assert.equal(reducer(updated, { type: 'UPDATE_PROFILE', profile: { coachTone: 'insulting' } }).profile.coachTone, coachTone);
  }
  const legacy = createInitialState();
  delete legacy.profile.coachTone;
  assert.equal(loadState({ getItem: () => JSON.stringify(legacy) }).profile.coachTone, 'supportive');
  assert.equal(coachReply('Що зробити сьогодні?', legacy), coachReply('Що зробити сьогодні?', state));
});

test('guided coach plan keeps only valid priorities and bounded, supported answers', () => {
  let state = createInitialState();
  state = reducer(state, { type: 'UPDATE_PROFILE', profile: { coachPlan: {
    priorities: ['body', 'money', 'body', 'unknown', 'sleep'],
    desiredChange: '  Стати послідовнішим  ',
    obstacle: 'x'.repeat(400),
    dailyTime: 'not-a-choice',
    extra: 'Поради коротко',
    step: 2,
    privateField: 'не зберігати',
  } } });
  assert.deepEqual(state.profile.coachPlan, {
    priorities: ['body', 'money', 'sleep'],
    desiredChange: 'Стати послідовнішим',
    obstacle: 'x'.repeat(300),
    dailyTime: '',
    extra: 'Поради коротко',
    step: 2,
  });
  const restored = loadState({ getItem: () => JSON.stringify(state) });
  assert.deepEqual(restored.profile.coachPlan, state.profile.coachPlan);
});

test('all three coach tones differ meaningfully while keeping the same user facts', () => {
  let state = complete(createInitialState());
  state = reducer(state, { type: 'ADD_EXPENSE', expense: { title: 'Кава', amount: 50 } });
  const messages = ['Що зробити сьогодні?', 'Я втомився', 'Мої витрати', 'Стосунки', 'Тренування', 'Мої звички', 'Мій прогрес', 'ШІ?'];
  for (const message of messages) {
    const replies = ['supportive', 'buddy', 'direct'].map((coachTone) => coachReply(message, { ...state, profile: { ...state.profile, coachTone } }));
    assert.equal(new Set(replies).size, 3, `distinct wording for ${message}`);
    if (message === 'Мій прогрес') for (const reply of replies) assert.match(reply, /40 XP/);
    if (message === 'Мої витрати') for (const reply of replies) assert.match(reply, /50 ₴/);
    if (message === 'ШІ?') for (const reply of replies) assert.match(reply, /без підключення до ШІ/);
  }
  const buddy = { ...state, profile: { ...state.profile, coachTone: 'buddy' } };
  const direct = { ...state, profile: { ...state.profile, coachTone: 'direct' } };
  assert.match(coachReply('Що зробити сьогодні?', buddy), /^Друже, давай/);
  assert.match(coachReply('Що зробити сьогодні?', direct), /Наступна дія:/);
  assert.match(coachReply('Я втомився', direct), /Виснаження не ігноруй: відпочинок теж потрібен/);
});

test('every coach tone acknowledges completed day without inventing extra quests', () => {
  let state = createInitialState();
  for (const quest of state.quests) state = complete(state, quest.id);
  for (const coachTone of ['supportive', 'buddy', 'direct']) {
    const reply = coachReply('Що зробити сьогодні?', { ...state, profile: { ...state.profile, coachTone } });
    assert.match(reply, /сьогодні/);
    assert.match(reply, /відпоч|видихнути/);
    assert.doesNotMatch(reply, /отримаєш|забереш|Наступна дія:/);
  }
});

test('v0.2 storage migration preserves records and XP while adding optional defaults', () => {
  const legacy = complete(createInitialState(before(10)));
  delete legacy.schemaRevision; delete legacy.budgets; delete legacy.goals; delete legacy.checkIns;
  delete legacy.profile.bio; delete legacy.profile.occupation;
  for (const quest of legacy.quests) for (const key of ['archived', 'frequency', 'weekdays', 'scheduledDate', 'goalId']) delete quest[key];
  for (const habit of legacy.habits) for (const key of ['category', 'timeOfDay', 'archived', 'frequency', 'weekdays', 'createdAt']) delete habit[key];
  legacy.expenses = [{ id: 'old-expense', title: 'Кава', amount: 50, category: 'Кафе', date: before(1) }];
  const restored = loadState({ getItem: () => JSON.stringify(legacy) });
  assert.equal(restored.version, 1); assert.equal(restored.schemaRevision, 6);
  assert.deepEqual(restored.completions, legacy.completions);
  assert.equal(selectStats(restored).totalXp, 40);
  assert.equal(restored.expenses[0].category, 'Кафе'); assert.equal(restored.expenses[0].type, 'expense');
  assert.equal(restored.habits[0].createdAt, legacy.createdAt);
  assert.deepEqual(restored.budgets, { monthLimit: 0, categories: {} });
});

test('archiving and renaming a quest preserve XP, while earned reward fields are immutable', () => {
  const done = complete(createInitialState());
  for (const quest of [{ xp: 150 }, { category: 'career' }, { attribute: 'intelligence' }]) assert.equal(reducer(done, { type: 'UPDATE_QUEST', id: 'daily-move', quest }), done);
  const renamed = reducer(done, { type: 'UPDATE_QUEST', id: 'daily-move', quest: { title: 'Мій рух' } });
  const archived = reducer(renamed, { type: 'ARCHIVE_QUEST', id: 'daily-move' });
  assert.equal(selectStats(archived).totalXp, 40); assert.equal(selectStats(archived).todayTotal, 4);
  assert.equal(selectStats(archived).todayCompleted, 0);
  assert.equal(complete(archived), archived);
  assert.equal(loadState({ getItem: () => JSON.stringify(archived) }).quests[0].archived, true);
  const restored = reducer(archived, { type: 'RESTORE_QUEST', id: 'daily-move' });
  assert.equal(selectStats(restored).todayCompleted, 1); assert.equal(selectStats(restored).totalXp, 40);
});

test('weekday and one-time schedules determine availability without rewriting history', () => {
  const weekdaysQuest = { ...QUEST_TEMPLATES[0], weekdays: [1, 3, 5] };
  assert.equal(isQuestDue(weekdaysQuest, '2026-11-09'), true);
  assert.equal(isQuestDue(weekdaysQuest, '2026-11-10'), false);
  assert.equal(isQuestDue({ ...weekdaysQuest, archived: true }, '2026-11-09'), false);
  assert.equal(isQuestDue({ ...weekdaysQuest, frequency: 'once', scheduledDate: today }, today), true);
  let state = reducer(createInitialState(), { type: 'ADD_QUEST', quest: { title: 'Разова справа', category: 'home', frequency: 'once', scheduledDate: before(1), id: 'one-time' } });
  assert.equal(selectActiveQuests(state).some(item => item.id === 'one-time'), false);
  assert.equal(complete(state, 'one-time'), state);
  state = complete(state, 'one-time', before(1));
  assert.equal(selectStats(state).totalXp, 30);
  assert.equal(reducer(state, { type: 'UPDATE_QUEST', id: 'one-time', quest: { scheduledDate: '' } }), state);
});

test('habit bulk counts, archive and scheduled streaks preserve historical targets', () => {
  let state = reducer(createInitialState('2026-11-01'), { type: 'ADD_HABIT', habit: { id: 'steps', title: 'Кроки', target: 5000, unit: 'кроків', icon: 'walk', category: 'body' } });
  state = reducer(state, { type: 'LOG_HABIT', id: 'steps', amount: 500 });
  assert.equal(state.habitLogs[today].steps, 500);
  assert.equal(reducer(state, { type: 'UPDATE_HABIT', id: 'steps', habit: { target: 6000 } }), state);
  assert.equal(reducer(state, { type: 'SET_HABIT_COUNT', id: 'steps', value: -1 }), state);
  state = reducer(state, { type: 'SET_HABIT_COUNT', id: 'steps', value: 5000 });
  state = reducer(state, { type: 'ARCHIVE_HABIT', id: 'steps' });
  assert.equal(selectActiveHabits(state).some(item => item.id === 'steps'), false);
  assert.equal(reducer(state, { type: 'LOG_HABIT', id: 'steps' }), state);
  assert.equal(loadState({ getItem: () => JSON.stringify(state) }).habitLogs[today].steps, 5000);
  const scheduled = { ...state.habits[1], frequency: 'weekdays', weekdays: [1, 2, 3, 4, 5], createdAt: '2026-11-01' };
  state.habits[1] = scheduled;
  state.habitLogs['2026-11-12'] = { book: 1 }; state.habitLogs['2026-11-13'] = { book: 1 };
  assert.equal(isHabitDue(scheduled, '2026-11-14'), false);
  assert.equal(habitStreak(state, 'book', '2026-11-16'), 2);
});

test('finance handles income, cents, month bounds and transaction-only filters', () => {
  let state = createInitialState();
  const add = expense => { state = reducer(state, { type: 'ADD_EXPENSE', expense }); };
  add({ id: 'salary', title: 'Зарплата', category: 'Зарплата', amount: 1000, type: 'income' });
  add({ id: 'coffee', title: 'Кава', category: 'Кафе', amount: 23.333, note: 'З колегою' });
  add({ id: 'small1', title: 'Дрібне', category: 'Інше', amount: 0.1 });
  add({ id: 'small2', title: 'Дрібне', category: 'Інше', amount: 0.2 });
  const [year, month] = today.split('-').map(Number);
  add({ id: 'previous', title: 'Минулий місяць', category: 'Інше', amount: 500, date: localDate(new Date(year, month - 2, 1, 12)) });
  state = reducer(state, { type: 'UPDATE_BUDGET', budget: { monthLimit: 100, categories: { 'Кафе': 20 } } });
  const finance = selectFinance(state, { month: today.slice(0, 7), category: 'Кафе', type: 'expense', query: 'КОЛЕГОЮ' });
  assert.equal(finance.income, 1000); assert.equal(finance.expense, 23.63); assert.equal(finance.balance, 976.37);
  assert.equal(finance.remaining, 76.37); assert.equal(finance.savingRate, 97.64);
  assert.equal(finance.transactions.length, 1); assert.equal(finance.transactions[0].id, 'coffee');
  assert.equal(finance.byCategory.find(item => item.category === 'Інше').amount, 0.3);
  assert.equal(finance.daily.find(item => item.date === today).expense, 23.63);
  assert.equal(selectFinance(createInitialState()).savingRate, null);
  assert.equal(selectFinance(createInitialState()).remaining, null);
  state = reducer(state, { type: 'UPDATE_EXPENSE', id: 'coffee', expense: { amount: 40, account: 'cash' } });
  assert.equal(selectFinance(state).expense, 40.3);
  assert.equal(reducer(state, { type: 'UPDATE_EXPENSE', id: 'coffee', expense: { date: '2199-01-01' } }), state);
  assert.equal(reducer(state, { type: 'UPDATE_BUDGET', budget: { monthLimit: -1 } }), state);
});

test('goal progress is bounded, completion is coherent, deletion only unlinks quests', () => {
  let state = createInitialState();
  assert.equal(reducer(state, { type: 'ADD_GOAL', goal: { title: 'Нуль', category: 'career', target: 0 } }), state);
  state = reducer(state, { type: 'ADD_GOAL', goal: { id: 'course', title: 'Курс', category: 'career', target: 10, unit: 'уроків' } });
  state = reducer(state, { type: 'UPDATE_QUEST', id: 'daily-read', quest: { goalId: 'course' } });
  state = complete(state, 'daily-read');
  state = reducer(state, { type: 'LOG_GOAL', id: 'course', amount: 12 });
  assert.equal(state.goals[0].current, 10); assert.equal(state.goals[0].status, 'completed');
  assert.equal(reducer(state, { type: 'SET_GOAL_PROGRESS', id: 'course', value: 11 }), state);
  state = reducer(state, { type: 'SET_GOAL_PROGRESS', id: 'course', value: 3 });
  assert.equal(state.goals[0].status, 'active');
  state = reducer(state, { type: 'DELETE_GOAL', id: 'course' });
  assert.equal(state.goals.length, 0); assert.equal(state.quests.find(item => item.id === 'daily-read').goalId, null);
  assert.equal(selectStats(state).totalXp, 45);
});

test('check-ins validate mood and energy, allow editing and explicit deletion', () => {
  let state = createInitialState();
  assert.equal(reducer(state, { type: 'SET_CHECKIN', checkIn: { mood: 0, energy: 3 } }), state);
  state = reducer(state, { type: 'SET_CHECKIN', checkIn: { mood: 4, energy: 2, note: 'Втомлений, але задоволений' } });
  assert.equal(state.checkIns[today].mood, 4);
  assert.equal(reducer(state, { type: 'DELETE_CHECKIN', date: '2199-01-01' }), state);
  assert.equal(Object.keys(reducer(state, { type: 'DELETE_CHECKIN' }).checkIns).length, 0);
});

test('demo is deterministic synthetic data, coherent with schedules and reload-safe', () => {
  const demo = createDemoState(today);
  assert.deepEqual(demo, createDemoState(today));
  assert.equal(demo.profile.name, 'Олексій'); assert.equal(demo.demo.synthetic, true);
  assert.equal(demo.quests.length, 12); assert.equal(demo.habits.length, 10); assert.equal(demo.goals.length, 4);
  assert.equal(Object.keys(demo.completions).length, 30); assert.equal(Object.keys(demo.checkIns).length, 14);
  assert.ok(demo.expenses.length >= 60);
  for (const [date, ids] of Object.entries(demo.completions)) { assert.ok(date <= today); for (const id of ids) assert.equal(isQuestDue(demo.quests.find(quest => quest.id === id), date), true); }
  for (const expense of demo.expenses) assert.ok(expense.date <= today);
  assert.deepEqual(loadState({ getItem: () => JSON.stringify(demo) }), demo);
  assert.equal(CATEGORIES.length, 10); assert.equal(FINANCE_CATEGORIES.length, 15);
  assert.ok(QUEST_TEMPLATES.length >= 24); assert.ok(HABIT_TEMPLATES.length >= 20);
  assert.equal(new Set(QUEST_TEMPLATES.map(item => item.category)).size, 10);
});

test('rescheduling a completed one-time quest cannot grant its XP again', () => {
  let state = reducer(createInitialState(), { type: 'ADD_QUEST', quest: { id: 'one-off', title: 'Разова справа', category: 'home', frequency: 'once', scheduledDate: before(1), xp: 30 } });
  state = complete(state, 'one-off', before(1));
  state = reducer(state, { type: 'UPDATE_QUEST', id: 'one-off', quest: { scheduledDate: today } });
  assert.equal(selectActiveQuests(state).some(quest => quest.id === 'one-off'), false);
  assert.equal(complete(state, 'one-off'), state); assert.equal(selectStats(state).totalXp, 30);
});

test('decimal half-cent inputs round correctly without binary floating-point loss', () => {
  for (const [amount, expected] of [[1.005, 1.01], [10.075, 10.08], [0.005, 0.01], [99.995, 100]]) {
    const state = reducer(createInitialState(), { type: 'ADD_EXPENSE', expense: { title: 'Округлення', amount } });
    assert.equal(state.expenses[0].amount, expected);
    assert.equal(reducer(state, { type: 'UPDATE_BUDGET', budget: { monthLimit: amount } }).budgets.monthLimit, expected);
  }
});
