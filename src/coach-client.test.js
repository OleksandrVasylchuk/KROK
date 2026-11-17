import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, reducer, restoreState } from './model.js';
import { buildCoachPayload, buildDailyPlanPayload, buildCoachActionPayload, coachHistory, coachApiBase, createCoachClient, COACH_HISTORY_CHAR_LIMIT, EMULATOR_COACH_ORIGIN } from './coach-client.js';
import { normalizeLifeProfile } from './life-profile.js';

const user = text => ({ role: 'user', text, source: 'openai' });
const assistant = text => ({ role: 'assistant', text, source: 'openai' });

test('profile context requires explicit boolean consent and has an allowlisted shape', () => {
  const state = createInitialState();
  state.profile = { ...state.profile, name: 'Олена', bio: 'Вчуся малювати', avatar: 'private-photo', secret: 'never-send' };
  state.messages = [user('Допоможи з метою')];
  state.expenses = [{ title: 'Private bank record', amount: 999 }];
  state.checkIns = { today: { note: 'Private journal' } };
  state.goals = [{ title: 'Малюнки', current: 2, target: 10, unit: 'робіт', status: 'active', description: 'private goal detail' }, { title: 'Finished', status: 'completed' }];
  state.habits.push({ title: 'Archived', archived: true });
  assert.equal(Object.hasOwn(buildCoachPayload(state), 'context'), false);
  state.profile.coachContextConsent = 'true';
  assert.equal(Object.hasOwn(buildCoachPayload(state), 'context'), false);
  state.profile.coachContextConsent = true;
  const payload = buildCoachPayload(state);
  assert.deepEqual(Object.keys(payload.context), ['profile', 'goals', 'habits', 'progress']);
  assert.deepEqual(Object.keys(payload.context.profile), ['name', 'goal', 'focus', 'bio', 'occupation']);
  assert.equal(payload.context.profile.name, 'Олена');
  assert.deepEqual(payload.context.goals, [{ title: 'Малюнки', current: 2, target: 10, unit: 'робіт' }]);
  assert.ok(payload.context.habits.every(habit => habit.title !== 'Archived'));
  assert.ok(!JSON.stringify(payload).includes('private'));
  assert.ok(!JSON.stringify(payload).includes('Private'));
});

test('guided coach answers join OpenAI context only after explicit consent', () => {
  const state = createInitialState();
  state.messages = [user('Допоможи з першим кроком')];
  state.profile.coachPlan = { priorities: ['money', 'sleep'], desiredChange: 'Мати більше спокою', obstacle: 'Немає часу', dailyTime: '10-15', extra: 'Коротко й без тиску' };
  assert.equal(Object.hasOwn(buildCoachPayload(state), 'context'), false);
  state.profile.coachContextConsent = true;
  const payload = buildCoachPayload(state);
  assert.deepEqual(payload.context.profile.coachPlan, {
    priorities: ['Гроші', 'Сон'],
    desiredChange: 'Мати більше спокою',
    obstacle: 'Немає часу',
    dailyTime: '10-15',
    extra: 'Коротко й без тиску',
  });
  assert.ok(JSON.stringify(payload).includes('Коротко й без тиску'));
});

test('only recent OpenAI messages are sent, without IDs or local demo text', () => {
  const history = coachHistory([{ role: 'user', text: 'legacy' }, { role: 'assistant', text: 'local', source: 'local' }, { ...user('hello'), id: 'private-id', at: 'time' }, assistant('hi'), user('next')]);
  assert.deepEqual(history, [{ role: 'user', text: 'hello' }, { role: 'assistant', text: 'hi' }, { role: 'user', text: 'next' }]);
});

test('history limits preserve the latest user turn and stay within server bounds', () => {
  const messages = Array.from({ length: 80 }, (_, i) => i % 2 ? user(`${i} ${'x'.repeat(8000)}`) : assistant('answer'));
  const history = coachHistory(messages);
  assert.ok(history.length <= 24);
  assert.ok(history.every(item => item.text.length <= 6000));
  assert.ok(history.reduce((sum, item) => sum + item.text.length, 0) <= COACH_HISTORY_CHAR_LIMIT);
  assert.equal(history[0].role, 'user');
  assert.equal(history.at(-1).role, 'user');
  assert.ok(history.at(-1).text.startsWith('79 '));
});

test('payload rejects missing final user and uses saved tone', () => {
  const state = createInitialState();
  assert.throws(() => buildCoachPayload(state), { code: 'empty_message' });
  assert.throws(() => buildCoachPayload(state, [user('hi'), assistant('hello')]), { code: 'empty_message' });
  state.profile.coachTone = 'buddy';
  assert.equal(buildCoachPayload(state, [user('hi')]).tone, 'buddy');
});

test('legacy saves choose OpenAI without consent and clearly retain local message sources', () => {
  const raw = createInitialState();
  delete raw.profile.coachMode;
  delete raw.profile.coachContextConsent;
  raw.messages = [{ id: 'old-message', role: 'assistant', text: 'Old scripted answer', at: new Date().toISOString() }];
  const restored = restoreState(raw);
  assert.equal(restored.profile.coachMode, 'openai');
  assert.equal(restored.profile.coachContextConsent, false);
  assert.equal(restored.messages[0].source, 'local');
  assert.equal(coachHistory(restored.messages).length, 0);
});

test('coach mode, consent, tones and long source-labelled messages survive saving', () => {
  let state = createInitialState();
  state = reducer(state, { type: 'UPDATE_PROFILE', profile: { coachMode: 'local', coachContextConsent: true, coachTone: 'direct' } });
  state = reducer(state, { type: 'ADD_MESSAGE', message: { ...user('x'.repeat(7000)), id: 'new-message' } });
  state = restoreState(JSON.parse(JSON.stringify(state)));
  assert.equal(state.profile.coachMode, 'local');
  assert.equal(state.profile.coachContextConsent, true);
  assert.equal(state.profile.coachTone, 'direct');
  assert.equal(state.messages[0].source, 'openai');
  assert.equal(state.messages[0].text.length, 6000);
  state = reducer(state, { type: 'UPDATE_PROFILE', profile: { coachMode: 'invalid', coachContextConsent: 'true' } });
  assert.equal(state.profile.coachMode, 'openai');
  assert.equal(state.profile.coachContextConsent, false);
});

test('endpoint is same-origin on web, emulator bridge on native, HTTPS-only for overrides', () => {
  assert.equal(coachApiBase(false), '');
  assert.equal(coachApiBase(true), EMULATOR_COACH_ORIGIN);
  assert.equal(coachApiBase(true, 'https://coach.example/'), 'https://coach.example');
  for (const url of ['http://coach.example', 'https://secret@coach.example', 'https://coach.example?token=secret', 'https://coach.example/api']) assert.throws(() => coachApiBase(false, url), { code: 'invalid_endpoint' });
});

test('browser transport sends JSON without credentials and status does not send conversation', async () => {
  const calls = [];
  const client = createCoachClient({ isNative: false, fetch: async (url, options) => { calls.push({ url, options }); return { status: 200, json: async () => url.endsWith('/status') ? { provider: 'openai', configured: true, model: 'test-model' } : { text: 'Спробуй один крок', model: 'test-model' } }; } });
  assert.equal((await client.status()).configured, true);
  const payload = { messages: [{ role: 'user', text: 'hi' }], tone: 'supportive' };
  assert.equal((await client.send(payload)).text, 'Спробуй один крок');
  assert.equal(calls[0].url, '/api/coach/status');
  assert.equal(calls[0].options.body, undefined);
  assert.equal(calls[1].url, '/api/coach');
  assert.equal(calls[1].options.credentials, 'omit');
  assert.deepEqual(JSON.parse(calls[1].options.body), payload);
});

test('native transport uses the real CapacitorHttp request contract', async () => {
  let options;
  const client = createCoachClient({ isNative: true, http: { request: async value => { options = value; return { status: 200, data: { text: 'reply', model: 'test' } }; } }, fetch: () => assert.fail('native must not fetch') });
  const payload = { messages: [{ role: 'user', text: 'hi' }], tone: 'direct' };
  await client.send(payload);
  assert.equal(options.url, `${EMULATOR_COACH_ORIGIN}/api/coach`);
  assert.equal(options.method, 'POST');
  assert.equal(options.headers['Content-Type'], 'application/json');
  assert.deepEqual(options.data, payload);
  assert.equal(options.disableRedirects, true);
  assert.equal(options.responseType, 'json');
});

test('server errors stay errors and no local answer replaces an OpenAI failure', async () => {
  const client = createCoachClient({ isNative: true, http: { request: async () => ({ status: 503, data: { error: { code: 'not_configured', message: 'Налаштуй ключ' } } }) } });
  await assert.rejects(client.send({}), { code: 'not_configured', message: 'Налаштуй ключ' });
});

test('aborted native response is ignored even though the native request cannot be cancelled', async () => {
  let resolve;
  const client = createCoachClient({ isNative: true, http: { request: () => new Promise(done => { resolve = done; }) } });
  const controller = new AbortController();
  const response = client.send({}, { signal: controller.signal });
  await new Promise(done => setImmediate(done));
  controller.abort();
  await assert.rejects(response, { name: 'AbortError' });
  resolve({ status: 200, data: { text: 'late reply' } });
});

test('native deadline and malformed server replies are visible failures', async () => {
  const client = createCoachClient({ isNative: true, http: { request: () => new Promise(() => {}) } }, { timeoutMs: 5 });
  await assert.rejects(client.status(), { code: 'timeout' });
  const invalid = createCoachClient({ isNative: false, fetch: async () => ({ status: 200, json: async () => ({}) }) });
  await assert.rejects(invalid.status(), { code: 'invalid_response' });
  await assert.rejects(invalid.send({}), { code: 'empty_response' });
});

const lifeAssessment = () => normalizeLifeProfile({ aiConsent: true, dailyMinutes: 15, focus: ['sleep'], about: 'Працюю ввечері', domains: { sleep: { rating: 2, current: 'Пізно лягаю', desired: 'Висипатися', obstacle: 'Телефон' } } });
const planState = () => { const state = createInitialState(); state.profile.lifeProfile = lifeAssessment(); return state; };
const planResult = () => ({ summary: 'Почнімо зі спокійного вечора.', insights: [{ category: 'sleep', observation: 'Ти пишеш, що лягаєш пізно.', advice: 'Підготуй простий вечірній ритуал.' }], quests: [{ title: 'Підготуй вечір', description: 'Обери час вимкнення екранів.', category: 'sleep', minutes: 10 }] });

test('plan builder requires new explicit consent; old chat consent does not imply it', () => {
  const state = planState();
  state.profile.coachContextConsent = true;
  for (const consent of [false, undefined, 'true', 1]) {
    state.profile.lifeProfile.aiConsent = consent;
    assert.throws(() => buildDailyPlanPayload(state, '2026-11-16'), { code: 'consent_required' });
  }
  state.profile.lifeProfile.aiConsent = true;
  state.profile.coachContextConsent = false;
  assert.equal(buildDailyPlanPayload(state, '2026-11-16').consent, true);
  state.profile.lifeProfile = normalizeLifeProfile({ aiConsent: true });
  assert.throws(() => buildDailyPlanPayload(state, '2026-11-16'), { code: 'assessment_required' });
});

test('plan builder bounds shared fields and aggregates only the recent seven days without private records', () => {
  const state = planState();
  state.profile.secret = 'PRIVATE_PROFILE';
  state.profile.avatar = 'PRIVATE_PHOTO';
  state.profile.lifeProfile.domains.sleep.secret = 'PRIVATE_DOMAIN';
  state.profile.lifeProfile.private = 'PRIVATE_ASSESSMENT';
  state.profile.lifeProfile.about = 'a'.repeat(1500);
  state.profile.lifeProfile.domains.sleep.current = 'c'.repeat(700);
  state.profile.coachTone = 'direct';
  state.expenses = [{ title: 'PRIVATE_TRANSACTION', amount: 999 }];
  state.checkIns = [{ note: 'PRIVATE_JOURNAL' }];
  state.messages = [user('PRIVATE_CHAT')];
  state.quests = [{ id: 'q1', title: 'PRIVATE_QUEST_TITLE', category: 'sleep', minutes: 5 }, { id: 'q2', title: 'Second', category: 'growth', minutes: 10 }];
  state.completions = { '2026-11-16': ['q1', 'q1'], '2026-11-10': ['q2'], '2026-11-09': ['q1'], '2026-11-17': ['q1'], 'invalid': ['q1'] };
  state.goals = [{ title: 'Мій сон', category: 'sleep', current: 1, target: 7, unit: 'днів', description: 'PRIVATE_GOAL_DESCRIPTION', status: 'active' }, { title: 'PRIVATE_FINISHED_GOAL', status: 'completed' }];
  state.habits = [{ title: 'Спокійний вечір', category: 'sleep', target: 1, unit: 'раз', note: 'PRIVATE_HABIT_NOTE' }, { title: 'PRIVATE_ARCHIVED_HABIT', archived: true }];
  const payload = buildDailyPlanPayload(state, '2026-11-16');
  assert.deepEqual(Object.keys(payload.profile), ['name', 'goal']);
  assert.equal(payload.assessment.about.length, 1000);
  assert.equal(payload.assessment.domains.sleep.current.length, 500);
  assert.equal(payload.progress.recentQuests.completed, 2);
  assert.equal(payload.progress.recentQuests.totalMinutes, 15);
  assert.equal(payload.progress.recentQuests.byCategory.find(item => item.category === 'sleep').completed, 1);
  assert.equal(payload.progress.recentQuests.byCategory.find(item => item.category === 'growth').completed, 1);
  assert.equal(payload.tone, 'direct');
  assert.equal(payload.date, '2026-11-16');
  assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
  state.profile.lifeProfile.domains.sleep.current = 'Прокидаюся о п’ятій';
  assert.notDeepEqual(buildDailyPlanPayload(state, '2026-11-16').assessment, payload.assessment);
  for (const date of ['2026-02-30', '2026-2-3', '2026-11-16T12:00:00Z', null]) assert.throws(() => buildDailyPlanPayload(state, date), { code: 'invalid_date' });
});

test('chat shares life assessment only when both independent consents are true', () => {
  const state = planState();
  state.messages = [user('Порадь крок')];
  assert.equal(buildCoachPayload(state).context, undefined);
  state.profile.coachContextConsent = true;
  state.profile.lifeProfile.aiConsent = false;
  assert.equal(buildCoachPayload(state).context.profile.lifeProfile, undefined);
  state.profile.lifeProfile.aiConsent = true;
  const shared = buildCoachPayload(state).context.profile.lifeProfile;
  assert.equal(shared.domains.sleep.current, 'Пізно лягаю');
  assert.equal(shared.aiConsent, true);
});

test('browser plan transport sends to the plan route and independently validates the result', async () => {
  const calls = [];
  const client = createCoachClient({ isNative: false, fetch: async (url, options) => {
    calls.push({ url, options });
    return { status: 200, json: async () => ({ plan: planResult(), model: 'gpt-6-luna' }) };
  } });
  const payload = buildDailyPlanPayload(planState(), '2026-11-16');
  assert.deepEqual(await client.plan(payload), { plan: planResult(), model: 'gpt-6-luna' });
  assert.equal(calls[0].url, '/api/coach/plan');
  assert.deepEqual(JSON.parse(calls[0].options.body), payload);
  assert.equal(calls[0].options.credentials, 'omit');
  await assert.rejects(client.plan({ ...payload, consent: false }), { code: 'consent_required' });
  await assert.rejects(client.plan({ ...payload, assessment: { ...payload.assessment, aiConsent: false } }), { code: 'consent_required' });
  assert.equal(calls.length, 1);
});

test('native plan transport returns only validated plans; errors and aborts never create a fallback plan', async () => {
  let result = planResult();
  let received;
  const client = createCoachClient({ isNative: true, http: { request: async options => {
    received = options;
    return { status: 200, data: { plan: result, model: 'gpt-6-luna' } };
  } } });
  const payload = buildDailyPlanPayload(planState(), '2026-11-16');
  assert.equal((await client.plan(payload)).plan.quests.length, 1);
  assert.equal(received.url, `${EMULATOR_COACH_ORIGIN}/api/coach/plan`);
  assert.deepEqual(received.data, payload);
  result = { ...planResult(), quests: [{ ...planResult().quests[0], minutes: 16 }] };
  await assert.rejects(client.plan(payload), { code: 'invalid_plan' });
  result = { ...planResult(), insights: [{ ...planResult().insights[0], category: 'money' }] };
  await assert.rejects(client.plan(payload), { code: 'invalid_plan' });
  result = { ...planResult(), quests: [{ ...planResult().quests[0], xp: 999 }] };
  await assert.rejects(client.plan(payload), { code: 'invalid_plan' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.plan(payload, { signal: controller.signal }), { name: 'AbortError' });
  const unavailable = createCoachClient({ isNative: false, fetch: async () => ({ status: 429, json: async () => ({ error: { code: 'quota_exceeded', message: 'Ліміт вичерпано' } }) }) });
  await assert.rejects(unavailable.plan(payload), { code: 'quota_exceeded' });
});

const actionQuest = () => ({ type: 'create_quest', ref: 'walk', title: 'Прогулянка', description: '', category: 'body', minutes: 10, frequency: 'once', weekdays: [], scheduledDate: '2026-11-17', goalId: null, goalRef: null });

test('action sharing is independent of profile/life consent and never sends private raw records', () => {
  const state = planState();
  state.messages = [user('Додай прогулянку')];
  state.expenses = [{ title: 'PRIVATE_TRANSACTION' }];
  state.checkIns = { day: { note: 'PRIVATE_JOURNAL' } };
  state.profile.avatar = 'PRIVATE_PHOTO';
  state.profile.lifeProfile.about = 'PRIVATE_INTAKE';
  state.quests[0].secret = 'PRIVATE_QUEST_SECRET';
  state.completions = { '2026-11-17': [state.quests[0].id] };
  for (const consent of [false, undefined, 'true', 1]) {
    state.profile.coachActionsConsent = consent;
    const payload = buildCoachActionPayload(state, state.messages, '2026-11-17');
    assert.equal(payload.actionsConsent, false);
    assert.equal(payload.actionContext, undefined);
  }
  state.profile.coachActionsConsent = true;
  const payload = buildCoachActionPayload(state, state.messages, '2026-11-17');
  assert.equal(payload.context, undefined);
  assert.ok(!JSON.stringify(payload).includes('PRIVATE'));
  assert.equal(payload.actionContext.quests[0].id, state.quests[0].id);
  assert.equal(payload.actionContext.review.byDay.length, 7);
  assert.equal(payload.actionContext.review.byDay.at(-1).questsCompleted, 1);
  state.profile.coachContextConsent = true;
  assert.equal(buildCoachActionPayload(state, state.messages, '2026-11-17').context.profile.lifeProfile.about, 'PRIVATE_INTAKE');
  state.profile.lifeProfile.aiConsent = false;
  assert.equal(buildCoachActionPayload(state, state.messages, '2026-11-17').context.profile.lifeProfile, undefined);
});

test('action payload bounds total bytes/history and prioritizes named records in bounded context', () => {
  const state = createInitialState('2026-11-17');
  state.profile.coachActionsConsent = true;
  state.quests = Array.from({ length: 200 }, (_, index) => ({ ...state.quests[0], id: `quest-${index}`, title: `Звичайний квест номер ${index}` }));
  state.quests[199].title = 'Особливе читання';
  state.messages = Array.from({ length: 10 }, (_, index) => index % 2 ? assistant('я'.repeat(5800)) : user('я'.repeat(5800)));
  state.messages.push(user('Познач Особливе читання виконаним сьогодні.'));
  const payload = buildCoachActionPayload(state, state.messages, '2026-11-17');
  assert.ok(new TextEncoder().encode(JSON.stringify(payload)).length <= 65536);
  assert.ok(payload.actionContext.quests.length <= 40);
  assert.equal(payload.actionContext.quests[0].id, 'quest-199');
  assert.equal(payload.actionContext.capacity.quests, 200);
  assert.match(payload.messages.at(-1).text, /Особливе читання/);
  assert.equal(payload.messages[0].role, 'user');
  for (const date of ['2026-02-30', '1999-12-31', 'bad']) assert.throws(() => buildCoachActionPayload(state, state.messages, date), { code: 'invalid_date' });
});

test('actions browser transport accepts creation without record consent and validates references against only sent context', async () => {
  const state = createInitialState('2026-11-17');
  state.messages = [user('Додай прогулянку')];
  let result = { text: 'Пропоную прогулянку.', actions: [actionQuest()], model: 'test' };
  let called;
  const client = createCoachClient({ isNative: false, fetch: async (url, options) => { called = { url, options }; return { status: 200, json: async () => result }; } });
  let payload = buildCoachActionPayload(state, state.messages, '2026-11-17');
  assert.equal((await client.act(payload)).actions[0].type, 'create_quest');
  assert.equal(called.url, '/api/coach/actions');
  assert.equal(called.options.credentials, 'omit');
  assert.deepEqual(JSON.parse(called.options.body), payload);
  result = { text: 'Пропоную відмітку.', actions: [{ type: 'complete_quest', ref: 'done', id: state.quests[0].id, date: '2026-11-17' }] };
  await assert.rejects(client.act(payload), { code: 'invalid_actions' });
  state.profile.coachActionsConsent = true;
  payload = buildCoachActionPayload(state, state.messages, '2026-11-17');
  assert.equal((await client.act(payload)).actions.length, 1);
  payload.actionContext.quests = [];
  await assert.rejects(client.act(payload), { code: 'invalid_actions' });
  await assert.rejects(client.act({ ...payload, actionsConsent: false }), { code: 'action_context_consent_required' });
});

test('native actions transport preserves clarification, strict outputs, error and abort behavior', async () => {
  let received;
  let data = { text: 'Яку саме ціль змінити?', actions: [], model: 'test' };
  const client = createCoachClient({ isNative: true, http: { request: async options => { received = options; return { status: 200, data }; } } });
  const state = createInitialState('2026-11-17');
  state.messages = [user('Допоможи з ціллю')];
  const payload = buildCoachActionPayload(state, state.messages, '2026-11-17');
  assert.deepEqual((await client.act(payload)).actions, []);
  assert.equal(received.url, `${EMULATOR_COACH_ORIGIN}/api/coach/actions`);
  assert.equal(received.method, 'POST');
  data = { text: 'Некоректна пропозиція', actions: [{ ...actionQuest(), xp: 1000 }] };
  await assert.rejects(client.act(payload), { code: 'invalid_actions' });
  data = { text: 'x'.repeat(6001), actions: [] };
  await assert.rejects(client.act(payload), { code: 'invalid_actions' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(client.act(payload, { signal: controller.signal }), { name: 'AbortError' });
});
