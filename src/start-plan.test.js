import test from 'node:test';
import assert from 'node:assert/strict';
import { START_QUESTIONS, START_VARIANTS, buildLocalStartPlan, buildStartRequest, normalizeStartAnswers, startAnswersComplete, validateStartPlan, validateStartVariant } from './start-plan.js';
import { QUEST_TIERS, questTier, tierXp } from './catalog.js';
import { INITIAL_QUESTS, createInitialState, localDate, needsStart, reducer, selectActiveQuests, weeklyMeetingDue } from './model.js';
import { validateBackup } from './persistence.js';
import { buildCoachActionContext, checkCoachProposal, coachStateFingerprint, validateCoachActions } from './coach-actions.js';
import { COACH_SCENARIOS, buildScenarioMessage, suggestedScenario } from './coach-scenarios.js';

const answers = { name: 'Оля', change: 'Мати більше енергії та кинути курити', focus: ['body', 'sleep'], minutes: 30, slots: ['morning', 'evening'], level: 'low', obstacles: ['Втома'], quit: 'куріння' };
const today = localDate();
const shift = days => { const date = new Date(); date.setDate(date.getDate() + days); return localDate(date); };

test('the question list is self-consistent and every question maps to an answer field', () => {
  const fields = Object.keys(normalizeStartAnswers(null));
  assert.deepEqual(START_QUESTIONS.map(question => question.id).sort(), [...fields].sort());
  for (const question of START_QUESTIONS) {
    assert.ok(['text', 'longtext', 'choice', 'multi'].includes(question.type), question.id);
    assert.ok(question.title && question.hint, question.id);
    if (question.type === 'multi') assert.ok(question.limit >= 1 && question.options.length >= question.limit, question.id);
  }
  assert.ok(START_QUESTIONS.length <= 8, 'keep the start short');
});

test('answers are allowlisted, bounded and incomplete sets are detected', () => {
  const dirty = normalizeStartAnswers({ name: '  Оля   Петренко ', change: 'x'.repeat(900), focus: ['body', 'body', 'hack', 'sleep', 'mind', 'money'], minutes: 31, slots: ['night', 'evening'], level: 'pro', obstacles: ['Втома', 'Щось своє', 'Забуваю', 'Брак часу'], quit: 5 });
  assert.equal(dirty.name, 'Оля Петренко'); assert.equal(dirty.change.length, 300);
  assert.deepEqual(dirty.focus, ['body', 'sleep', 'mind']); assert.equal(dirty.minutes, 0);
  assert.deepEqual(dirty.slots, ['evening']); assert.equal(dirty.level, ''); assert.deepEqual(dirty.obstacles, ['Втома', 'Забуваю']); assert.equal(dirty.quit, '');
  assert.equal(startAnswersComplete(dirty), false);
  assert.equal(startAnswersComplete(answers), true);
  assert.equal(startAnswersComplete({ ...answers, obstacles: [], quit: '' }), true, 'optional questions may stay empty');
});

test('the ready-made plan offers lighter and fuller variants inside the stated time', () => {
  const plan = buildLocalStartPlan(answers);
  assert.deepEqual(plan.variants.map(variant => variant.id), ['light', 'balanced', 'intense'].slice(0, plan.variants.length));
  assert.ok(plan.variants.length >= 2);
  for (const variant of plan.variants) {
    const budget = Math.round(answers.minutes * START_VARIANTS.find(item => item.id === variant.id).share) + 5;
    const spent = variant.items.filter(item => item.tier !== 'legendary').reduce((total, item) => total + item.minutes, 0);
    assert.ok(spent <= budget, `${variant.id}: ${spent} > ${budget}`);
    assert.ok(variant.items.every(item => ['morning', 'evening'].includes(item.timeOfDay)), 'only the chosen parts of day');
  }
  const [light, balanced] = plan.variants;
  assert.ok(light.items.every(item => item.tier === 'common'), 'the light start has no heavy steps');
  assert.ok(balanced.items.some(item => item.tier === 'epic'));
  const challenge = balanced.items.find(item => item.tier === 'legendary');
  assert.equal(challenge.title, 'День без: куріння');
  assert.equal(balanced.items.find(item => item.tier === 'epic').title, 'Легке тренування', 'a beginner does not start with a full workout');
  assert.equal(buildLocalStartPlan({ ...answers, quit: '' }).variants.some(variant => variant.items.some(item => item.tier === 'legendary')), false);
  assert.equal(buildLocalStartPlan({ ...answers, minutes: 0 }), null);
});

test('a generated plan is rejected when it breaks the shape, order, budget or challenge limit', () => {
  const plan = buildLocalStartPlan(answers);
  const copy = () => structuredClone(plan);
  assert.ok(validateStartPlan(copy(), answers));
  const cases = [
    value => { value.variants.reverse(); },
    value => { value.variants = value.variants.slice(0, 1); },
    value => { value.variants[0].items[0].minutes = 500; },
    value => { value.variants[0].items[0].minutes = answers.minutes * 3; },
    value => { value.variants[0].items[0].tier = 'mythic'; },
    value => { value.variants[0].items[0].timeOfDay = 'night'; },
    value => { value.variants[0].items[0].category = 'hack'; },
    value => { value.variants[0].items[0].xp = 9999; },
    value => { value.variants[0].items.push({ ...value.variants[0].items[0] }); },
    value => { value.variants[1].items = [1, 2].map(index => ({ title: `Виклик ${index}`, description: '', category: 'mind', minutes: 5, timeOfDay: 'any', tier: 'legendary' })); },
    value => { value.variants[0].items = value.variants[0].items.slice(0, 1); },
    value => { value.variants[0].id = 'extreme'; },
    value => { value.summary = ''; },
    value => { value.extra = true; },
  ];
  for (const [index, mutate] of cases.entries()) { const value = copy(); mutate(value); assert.equal(validateStartPlan(value, answers), null, `case ${index}`); }
  assert.equal(validateStartVariant(plan.variants[0], { ...answers, minutes: 0 }), null);
});

test('the request to the model carries the answers and existing habit titles only', () => {
  const state = createInitialState();
  const body = buildStartRequest(answers, { date: today, tone: 'direct', habits: [...state.habits, { title: 'Архівна', archived: true }] });
  assert.deepEqual(Object.keys(body).sort(), ['answers', 'consent', 'date', 'existingHabits', 'tone']);
  assert.equal(body.consent, true); assert.deepEqual(body.existingHabits, state.habits.map(habit => habit.title));
  assert.equal(JSON.stringify(body).includes('data:image'), false);
  assert.throws(() => buildStartRequest({ ...answers, name: '' }, { date: today }), /обов’язкові/);
});

test('only an untouched profile is sent to the start; used or demo-like profiles are never blocked', () => {
  const fresh = createInitialState();
  assert.equal(needsStart(fresh), true);
  assert.equal(needsStart(validateBackup(JSON.stringify(fresh))), true);
  assert.equal(needsStart({ ...fresh, profile: { ...fresh.profile, onboarded: true } }), false);
  assert.equal(needsStart(reducer(fresh, { type: 'TOGGLE_QUEST', id: fresh.quests[0].id })), false);
  assert.equal(needsStart(reducer(fresh, { type: 'LOG_HABIT', id: fresh.habits[0].id })), false);
  assert.equal(needsStart(reducer(fresh, { type: 'ADD_GOAL', goal: { title: 'Рух', category: 'body', target: 5, unit: 'разів' } })), false);
  assert.equal(needsStart(reducer(fresh, { type: 'ADD_QUEST', quest: { title: 'Свій квест', category: 'body', minutes: 5, xp: 20 } })), false);
  assert.equal(needsStart(reducer(fresh, { type: 'ADD_MESSAGE', message: { role: 'user', text: 'Привіт', source: 'local' } })), false);
});

test('choosing a variant builds the routine atomically and replaces only unused starter examples', () => {
  const fresh = createInitialState();
  const plan = buildLocalStartPlan(answers), variant = plan.variants[1];
  const next = reducer(fresh, { type: 'APPLY_START_PLAN', answers, variant, source: 'local' });
  assert.notEqual(next, fresh);
  assert.equal(next.quests.some(quest => INITIAL_QUESTS.some(seed => seed.id === quest.id)), false, 'unused starter quests are gone');
  assert.deepEqual(next.quests.map(quest => quest.title), variant.items.map(item => item.title));
  for (const [index, quest] of next.quests.entries()) {
    assert.equal(quest.timeOfDay, variant.items[index].timeOfDay); assert.equal(questTier(quest.xp), variant.items[index].tier);
    assert.equal(quest.xp, tierXp(variant.items[index].tier)); assert.equal(quest.frequency, 'daily');
  }
  assert.equal(next.profile.name, 'Оля'); assert.equal(next.profile.onboarded, true); assert.equal(next.profile.focus, 'body');
  assert.deepEqual(next.profile.start, { date: today, variant: 'balanced', source: 'local', answers: normalizeStartAnswers(answers) });
  assert.deepEqual(next.profile.weeklyMeeting, { lastDate: today });
  assert.deepEqual(next.profile.coachPlan.priorities, ['body', 'sleep']); assert.equal(next.profile.coachPlan.dailyTime, '20-30');
  assert.equal(next.profile.coachContextConsent, false, 'the start grants no sharing consent');
  assert.equal(next.habits.length, fresh.habits.length);
  assert.equal(needsStart(next), false);
  assert.equal(selectActiveQuests(next).length, variant.items.length);
  assert.deepEqual(validateBackup(JSON.stringify(next)), next, 'the routine survives a reload unchanged');
  assert.equal(next.schemaRevision, 6);
});

test('a starter quest that was already used is kept, and invalid input changes nothing', () => {
  let state = createInitialState();
  state = reducer(state, { type: 'TOGGLE_QUEST', id: 'daily-move' });
  const variant = buildLocalStartPlan(answers).variants[0];
  const next = reducer(state, { type: 'APPLY_START_PLAN', answers, variant, source: 'ai' });
  assert.ok(next.quests.some(quest => quest.id === 'daily-move'), 'earned history is never removed');
  assert.equal(next.completions[today].includes('daily-move'), true);
  assert.equal(next.profile.start.source, 'ai');
  assert.equal(reducer(state, { type: 'APPLY_START_PLAN', answers, variant, source: 'model' }), state);
  assert.equal(reducer(state, { type: 'APPLY_START_PLAN', answers: { ...answers, name: '' }, variant, source: 'local' }), state);
  assert.equal(reducer(state, { type: 'APPLY_START_PLAN', answers, variant: { ...variant, items: [{ ...variant.items[0], minutes: 900 }, variant.items[1]] }, source: 'local' }), state);
});

test('quest levels follow the reward bands and older quests migrate with a neutral part of day', () => {
  assert.deepEqual([5, 30, 49, 50, 99, 100, 150].map(questTier), ['common', 'common', 'common', 'epic', 'epic', 'legendary', 'legendary']);
  for (const tier of QUEST_TIERS) assert.equal(questTier(tier.xp), tier.id);
  const legacy = JSON.parse(JSON.stringify(createInitialState()));
  legacy.schemaRevision = 5; delete legacy.profile.start; delete legacy.profile.weeklyMeeting;
  for (const quest of legacy.quests) delete quest.timeOfDay;
  const restored = validateBackup(JSON.stringify(legacy));
  assert.equal(restored.schemaRevision, 6);
  assert.ok(restored.quests.every(quest => quest.timeOfDay === 'any'));
  assert.equal(restored.profile.start, null); assert.deepEqual(restored.profile.weeklyMeeting, { lastDate: '' });
  const broken = JSON.parse(JSON.stringify(createInitialState())); broken.quests[0].timeOfDay = 'midnight';
  assert.throws(() => validateBackup(JSON.stringify(broken)), /пошкоджені|несумісні/);
  const future = JSON.parse(JSON.stringify(createInitialState())); future.schemaRevision = 7;
  assert.throws(() => validateBackup(JSON.stringify(future)), /не підтримується/);
});

test('the weekly meeting is due seven days after the start or the previous meeting', () => {
  const fresh = createInitialState();
  assert.equal(weeklyMeetingDue(fresh), false);
  const started = reducer(fresh, { type: 'APPLY_START_PLAN', answers, variant: buildLocalStartPlan(answers).variants[0], source: 'local' });
  assert.equal(weeklyMeetingDue(started, shift(6)), false);
  assert.equal(weeklyMeetingDue(started, shift(7)), true);
  assert.equal(suggestedScenario({ ...started, profile: { ...started.profile, weeklyMeeting: { lastDate: shift(-8) } } }, new Date()), 'weekly');
  const old = { ...fresh, createdAt: shift(-30), profile: { ...fresh.profile, onboarded: true } };
  assert.equal(weeklyMeetingDue(old), true, 'an existing profile is invited once a week has passed');
  const met = reducer(old, { type: 'COMPLETE_WEEKLY_MEETING' });
  assert.deepEqual(met.profile.weeklyMeeting, { lastDate: today }); assert.equal(weeklyMeetingDue(met), false);
  assert.equal(validateBackup(JSON.stringify(met)).profile.weeklyMeeting.lastDate, today);
  const message = buildScenarioMessage('weekly', ['Робив зарядку', '', 'Заважкий — полегшити', 'прибрати читання']);
  assert.match(message, /Яким був план: Заважкий — полегшити/); assert.match(message, /до п’яти змін розпорядку/);
  assert.equal(COACH_SCENARIOS.weekly.needsRecords, true);
});

test('the coach can ease the routine: archive an item and add a levelled replacement in one confirmed batch', () => {
  let state = reducer(createInitialState(), { type: 'APPLY_START_PLAN', answers, variant: buildLocalStartPlan(answers).variants[1], source: 'local' });
  const heavy = state.quests.find(quest => questTier(quest.xp) === 'epic');
  state = reducer(state, { type: 'TOGGLE_QUEST', id: heavy.id });
  const habit = state.habits[0];
  const actions = [
    { type: 'archive_quest', ref: 'a1', id: heavy.id },
    { type: 'archive_habit', ref: 'a2', id: habit.id },
    { type: 'create_quest', ref: 'c1', title: 'Прогулянка 15 хвилин', description: 'Легша заміна тренуванню.', category: 'body', minutes: 15, frequency: 'daily', weekdays: [], scheduledDate: '', goalId: null, goalRef: null, tier: 'common', timeOfDay: 'evening' },
  ];
  const context = buildCoachActionContext(state, today);
  assert.equal(validateCoachActions({ text: 'Пропоную полегшити.', actions }, { date: today, context }).ok, true);
  assert.equal(validateCoachActions({ text: 'x', actions }, { date: today }).error.code, 'context_required', 'archiving needs the shared records');
  assert.equal(validateCoachActions({ text: 'x', actions: [{ type: 'archive_quest', ref: 'a', id: 'missing' }] }, { date: today, context }).error.code, 'quest_archive_unavailable');
  assert.equal(validateCoachActions({ text: 'x', actions: [actions[0], { type: 'complete_quest', ref: 'b', id: heavy.id, date: today }] }, { date: today, context }).error.code, 'duplicate_action');
  assert.equal(validateCoachActions({ text: 'x', actions: [{ ...actions[2], tier: 'mythic' }] }, { date: today, context }).error.code, 'invalid_quest');
  const proposal = { id: 'coach-weekly-1', date: today, text: 'Пропоную полегшити.', actions, model: 'test', sourceFingerprint: coachStateFingerprint(state, today), status: 'pending', appliedIds: [] };
  assert.equal(checkCoachProposal(state, proposal, { today }).ok, true);
  state = reducer(state, { type: 'SAVE_COACH_PROPOSAL', proposal });
  const xpBefore = state.completions[today].length;
  const applied = reducer(state, { type: 'APPLY_COACH_PROPOSAL', id: proposal.id });
  assert.equal(applied.quests.find(quest => quest.id === heavy.id).archived, true);
  assert.equal(applied.habits.find(item => item.id === habit.id).archived, true);
  assert.equal(applied.completions[today].length, xpBefore, 'earned completions stay');
  const added = applied.quests.find(quest => quest.title === 'Прогулянка 15 хвилин');
  assert.equal(added.timeOfDay, 'evening'); assert.equal(added.xp, tierXp('common'));
  assert.equal(applied.coachProposals[0].status, 'applied');
  assert.deepEqual(validateBackup(JSON.stringify(applied)), applied);
  // A proposal saved before schema 6 (no level fields) is still valid and keeps the old default reward.
  const legacyAction = { type: 'create_quest', ref: 'c9', title: 'Старий формат', description: '', category: 'mind', minutes: 5, frequency: 'daily', weekdays: [], scheduledDate: '', goalId: null, goalRef: null };
  assert.equal(validateCoachActions({ text: 'x', actions: [legacyAction] }, { date: today }).ok, true);
  assert.equal(validateCoachActions({ text: 'x', actions: [{ ...legacyAction, tier: 'epic' }] }, { date: today }).ok, false, 'level and part of day come together');
});
