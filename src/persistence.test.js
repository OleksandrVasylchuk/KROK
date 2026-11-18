import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, localDate, reducer, STORAGE_KEY } from './model.js';
import { createPersistence, validateBackup } from './persistence.js';
import { createDemoState } from './demo.js';

function memoryStorage(value = null) {
  const values = new Map(value === null ? [] : [[STORAGE_KEY, value]]);
  const writes = [];
  return {
    values, writes,
    getItem: (key) => values.get(key) ?? null,
    setItem(key, next) { writes.push({ key, value: next }); values.set(key, next); },
  };
}

function preferences(value = null) {
  const store = { value, writes: [], reads: 0 };
  store.get = async () => { store.reads += 1; return { value: store.value }; };
  store.set = async ({ key, value: next }) => { store.writes.push({ key, value: next }); store.value = next; };
  return store;
}

function fullState() {
  let state = createInitialState();
  state = reducer(state, { type: 'UPDATE_PROFILE', profile: { name: 'Олександр', goal: 'Щодня читати', coachTone: 'direct', avatar: 'data:image/png;base64,YWJj', onboarded: true } });
  state = reducer(state, { type: 'TOGGLE_QUEST', id: state.quests[0].id });
  state = reducer(state, { type: 'CLAIM_REWARD', id: 'reward-coffee', cost: 20 });
  state = reducer(state, { type: 'LOG_HABIT', id: 'water' });
  state.habitLogs[localDate()].book = 0;
  state.habitLogs[localDate()].moon = 0;
  state = reducer(state, { type: 'ADD_EXPENSE', expense: { title: 'Книга', amount: 125, category: 'Розвиток' } });
  return state;
}

test('backup round-trip preserves profile, avatar, tone, completions, rewards and expenses', () => {
  const state = fullState();
  assert.deepEqual(validateBackup(JSON.stringify(state)), state);
});

test('portrait backups preserve selections, migrate missing fields, and reject invalid presets', () => {
  const state = fullState();
  for (const portrait of ['', 'photo-v1', 'traveler-v1']) {
    state.profile.portrait = portrait;
    assert.deepEqual(validateBackup(JSON.stringify(state)), state);
  }
  delete state.profile.portrait;
  const legacy = validateBackup(JSON.stringify(state));
  assert.equal(legacy.profile.portrait, '');
  assert.equal(legacy.profile.avatar, state.profile.avatar);
  for (const portrait of ['unknown', '/portraits/elsewhere.png', null, 1, {}]) {
    state.profile.portrait = portrait;
    assert.throws(() => validateBackup(JSON.stringify(state)), /несумісні|пошкоджені/);
  }
});

test('expanded v0.3 backup round-trips all categories, schedules, finance, goals and check-ins', () => {
  const state = createDemoState();
  state.profile.focus = 'creativity';
  assert.deepEqual(validateBackup(JSON.stringify(state)), state);
});

test('old backups without expanded fields migrate without losing records', () => {
  const state = fullState();
  delete state.schemaRevision; delete state.budgets; delete state.goals; delete state.checkIns;
  delete state.profile.bio; delete state.profile.occupation;
  for (const expense of state.expenses) { delete expense.type; delete expense.account; delete expense.note; }
  for (const quest of state.quests) for (const key of ['archived', 'frequency', 'weekdays', 'scheduledDate', 'goalId']) delete quest[key];
  for (const habit of state.habits) for (const key of ['category', 'timeOfDay', 'frequency', 'weekdays', 'archived', 'createdAt']) delete habit[key];
  const restored = validateBackup(JSON.stringify(state));
  assert.equal(restored.schemaRevision, 6); assert.deepEqual(restored.completions, state.completions);
  assert.deepEqual(restored.rewards, state.rewards); assert.equal(restored.expenses[0].amount, state.expenses[0].amount);
  assert.deepEqual(restored.goals, []); assert.deepEqual(restored.checkIns, {});
});

test('malformed expanded fields cannot silently disappear or normalize into different user data', () => {
  const corruptions = [
    state => { state.budgets.monthLimit = -50; },
    state => { state.budgets.categories['Продукти'] = '500'; },
    state => { state.goals[0].current = state.goals[0].target + 1; },
    state => { state.goals[0].status = 'lost'; },
    state => { state.quests[0].frequency = 'random'; },
    state => { state.quests[0].goalId = 'missing-goal'; },
    state => { state.habits[0].timeOfDay = 'midnight'; },
    state => { state.checkIns[localDate()].mood = 9; },
    state => { state.expenses[0].type = 'transfer'; },
    state => { state.expenses[0].account = 'unknown'; },
    state => { state.profile.bio = 'x'.repeat(301); },
    state => { state.schemaRevision = 7; },
    state => { state.rewards[0].date = '2199-01-01'; },
    state => { state.goals[0].createdAt = '2199-01-01'; },
    state => { state.habits[0].createdAt = '2199-01-01'; },
    state => { state.createdAt = '2199-01-01'; },
    state => { state.habitLogs = JSON.parse('{"__proto__":{}}'); },
  ];
  for (const corrupt of corruptions) { const state = createDemoState(); corrupt(state); assert.throws(() => validateBackup(JSON.stringify(state))); }
});

test('legacy version 1 profile gains optional fields without losing its progress', () => {
  const state = fullState();
  delete state.profile.avatar;
  delete state.profile.coachTone;
  const result = validateBackup(JSON.stringify(state));
  assert.equal(result.profile.goal, state.profile.goal);
  assert.equal(result.profile.avatar, '');
  assert.equal(result.profile.coachTone, 'supportive');
  assert.deepEqual(result.completions, state.completions);
  assert.deepEqual(result.rewards, state.rewards);
});

test('wrong versions, missing shape, invalid JSON and oversized inputs fail instead of resetting', () => {
  for (const raw of ['{broken', 'null', '{}', JSON.stringify({ ...createInitialState(), version: 2 }), JSON.stringify({ ...createInitialState(), completions: [] }), JSON.stringify({ ...createInitialState(), profile: {} }), ' '.repeat(8_000_001)]) {
    assert.throws(() => validateBackup(raw));
  }
});

test('corrupt nested records cannot trigger the model fallback and silently replace progress', () => {
  const malformed = fullState();
  malformed.messages = [{ id: 'bad-date', role: 'user', text: 'Message', at: { toString: 1, valueOf: 1 } }];
  assert.throws(() => validateBackup(JSON.stringify(malformed)));
  const missingQuest = fullState();
  missingQuest.completions[localDate()].push('unknown-quest');
  assert.throws(() => validateBackup(JSON.stringify(missingQuest)));
  const invalidHabit = fullState();
  invalidHabit.habitLogs[localDate()].water = 999;
  assert.throws(() => validateBackup(JSON.stringify(invalidHabit)));
  const missingRecords = fullState();
  missingRecords.quests = [];
  assert.throws(() => validateBackup(JSON.stringify(missingRecords)));
});

test('browser reads the existing key and saves to the same location', async () => {
  const initial = fullState();
  const storage = memoryStorage(JSON.stringify(initial));
  const adapter = createPersistence({ storage });
  const boot = await adapter.initializePersistence();
  assert.equal(boot.source, 'browser');
  assert.equal(boot.blocked, false);
  assert.deepEqual(boot.state, initial);
  assert.equal(storage.writes.length, 0);
  const next = reducer(initial, { type: 'LOG_HABIT', id: 'water' });
  assert.equal(await adapter.persistState(next), true);
  assert.equal(storage.writes[0].key, STORAGE_KEY);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), next);
});

test('a stale browser window cannot overwrite another window before its storage event arrives', async () => {
  const storage = memoryStorage();
  const firstWindow = createPersistence({ storage });
  const secondWindow = createPersistence({ storage });
  await Promise.all([firstWindow.initializePersistence(), secondWindow.initializePersistence()]);
  const newer = fullState();
  assert.equal(await firstWindow.persistState(newer), true);
  const savedElsewhere = storage.getItem(STORAGE_KEY);
  const stale = createInitialState();
  stale.profile.name = 'Stale window';
  assert.equal(await secondWindow.persistState(stale), false);
  assert.equal(storage.getItem(STORAGE_KEY), savedElsewhere);
  assert.equal(await secondWindow.persistState(stale), false);
  assert.equal(storage.writes.length, 1);
});

test('explicit recovery can supersede an external browser write and refresh its expected snapshot', async () => {
  const storage = memoryStorage(JSON.stringify(createInitialState()));
  const adapter = createPersistence({ storage });
  await adapter.initializePersistence();
  storage.setItem(STORAGE_KEY, JSON.stringify(fullState()));
  assert.equal(await adapter.persistState(createInitialState()), false);
  const chosen = fullState();
  chosen.profile.name = 'Confirmed replacement';
  assert.equal(await adapter.recoverPersistence(chosen), true);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), chosen);
  const next = reducer(chosen, { type: 'LOG_HABIT', id: 'water' });
  assert.equal(await adapter.persistState(next), true);
  assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), next);
});

test('browser comparison uses the exact original raw value and tracks successful own writes', async () => {
  const state = fullState();
  const storage = memoryStorage(JSON.stringify(state, null, 2));
  const adapter = createPersistence({ storage });
  await adapter.initializePersistence();
  assert.equal(await adapter.persistState(state), true);
  const next = reducer(state, { type: 'LOG_HABIT', id: 'water' });
  assert.equal(await adapter.persistState(next), true);
  storage.values.delete(STORAGE_KEY);
  assert.equal(await adapter.persistState(next), false);
  assert.equal(storage.getItem(STORAGE_KEY), null);
});

test('browser read failure after initialization blocks saves without touching the stored record', async () => {
  const state = fullState();
  const original = JSON.stringify(state);
  const storage = memoryStorage(original);
  const adapter = createPersistence({ storage });
  await adapter.initializePersistence();
  storage.getItem = () => { throw new Error('Access revoked'); };
  assert.equal(await adapter.persistState(createInitialState()), false);
  assert.equal(storage.values.get(STORAGE_KEY), original);
  assert.equal(storage.writes.length, 0);
  storage.getItem = (key) => storage.values.get(key) ?? null;
  assert.equal(await adapter.persistState(state), false);
  assert.equal(await adapter.recoverPersistence(state), true);
  assert.equal(await adapter.persistState(state), true);
});

test('native record is authoritative over a newer-looking webview record', async () => {
  const nativeState = fullState();
  const nativeStore = preferences(JSON.stringify(nativeState));
  const web = memoryStorage(JSON.stringify(createInitialState()));
  const adapter = createPersistence({ native: true, preferences: nativeStore, storage: web });
  assert.deepEqual((await adapter.initializePersistence()).state, nativeState);
  const changed = reducer(nativeState, { type: 'LOG_HABIT', id: 'water' });
  assert.equal(await adapter.persistState(changed), true);
  assert.deepEqual(JSON.parse(nativeStore.value), changed);
  assert.equal(web.writes.length, 0);
});

test('healthy native record still opens if browser storage access is denied', async () => {
  const nativeState = fullState();
  const store = preferences(JSON.stringify(nativeState));
  const storage = { getItem() { throw new Error('Denied'); } };
  const adapter = createPersistence({ native: true, preferences: store, storage });
  const boot = await adapter.initializePersistence();
  assert.equal(boot.blocked, false);
  assert.deepEqual(boot.state, nativeState);
});

test('missing native record migrates web state once and leaves the original available', async () => {
  const state = fullState();
  const original = JSON.stringify(state);
  const web = memoryStorage(original);
  const nativeStore = preferences();
  const adapter = createPersistence({ native: true, preferences: nativeStore, storage: web });
  const [first, second] = await Promise.all([adapter.initializePersistence(), adapter.initializePersistence()]);
  assert.equal(first.source, 'migration');
  assert.deepEqual(first, second);
  assert.deepEqual(first.state, state);
  assert.deepEqual(JSON.parse(nativeStore.value), state);
  assert.equal(nativeStore.reads, 1);
  assert.equal(nativeStore.writes.length, 1);
  assert.equal(web.getItem(STORAGE_KEY), original);
  assert.equal(web.writes.length, 0);
});

test('native read failure blocks all ordinary writes and does not fall back to web data', async () => {
  const nativeStore = preferences('recoverable-but-unreadable');
  nativeStore.get = async () => { throw new Error('Device IO failed'); };
  const web = memoryStorage(JSON.stringify(fullState()));
  const adapter = createPersistence({ native: true, preferences: nativeStore, storage: web });
  const boot = await adapter.initializePersistence();
  assert.equal(boot.blocked, true);
  assert.ok(boot.warning);
  assert.equal(await adapter.persistState(createInitialState()), false);
  assert.equal(nativeStore.value, 'recoverable-but-unreadable');
  assert.equal(nativeStore.writes.length, 0);
  assert.equal(web.writes.length, 0);
});

test('corrupt native or browser records remain intact until explicit recovery', async () => {
  for (const native of [true, false]) {
    for (const corrupt of ['{broken', '', JSON.stringify({ version: 9 })]) {
      const store = preferences(corrupt);
      const web = memoryStorage(corrupt);
      const adapter = createPersistence({ native, preferences: store, storage: web });
      assert.equal((await adapter.initializePersistence()).blocked, true);
      assert.equal(await adapter.persistState(createInitialState()), false);
      assert.equal(native ? store.value : web.getItem(STORAGE_KEY), corrupt);
      const restored = fullState();
      assert.equal(await adapter.recoverPersistence(restored), true);
      assert.deepEqual(JSON.parse(native ? store.value : web.getItem(STORAGE_KEY)), restored);
      assert.equal(await adapter.persistState(restored), true);
    }
  }
});

test('failed migration leaves the old record and blocks subsequent autosaves', async () => {
  const state = fullState();
  const original = JSON.stringify(state);
  const web = memoryStorage(original);
  const store = preferences();
  store.set = async () => { throw new Error('Quota'); };
  const adapter = createPersistence({ native: true, preferences: store, storage: web });
  const boot = await adapter.initializePersistence();
  assert.equal(boot.blocked, true);
  assert.deepEqual(boot.state, state);
  assert.equal(await adapter.persistState(state), false);
  assert.equal(web.getItem(STORAGE_KEY), original);
  assert.equal(store.value, null);
});

test('native async writes execute in call order and use immutable snapshots', async () => {
  const store = preferences();
  const started = [];
  const releases = [];
  store.set = ({ value }) => new Promise((resolve) => {
    started.push(JSON.parse(value).profile.name);
    releases.push(() => { store.value = value; resolve(); });
  });
  const adapter = createPersistence({ native: true, preferences: store });
  await adapter.initializePersistence();
  const first = createInitialState(); first.profile.name = 'First';
  const second = createInitialState(); second.profile.name = 'Second';
  const a = adapter.persistState(first);
  const b = adapter.persistState(second);
  first.profile.name = 'Mutated after enqueue';
  await new Promise(setImmediate);
  assert.deepEqual(started, ['First']);
  releases.shift()();
  assert.equal(await a, true);
  await new Promise(setImmediate);
  assert.deepEqual(started, ['First', 'Second']);
  releases.shift()();
  assert.equal(await b, true);
  assert.equal(JSON.parse(store.value).profile.name, 'Second');
});

test('storage quota and write failures are reported without throwing or breaking the queue', async () => {
  const store = preferences(JSON.stringify(createInitialState()));
  let fail = true;
  store.set = async ({ value }) => { if (fail) throw new Error('Quota'); store.value = value; };
  const adapter = createPersistence({ native: true, preferences: store });
  await adapter.initializePersistence();
  assert.equal(await adapter.persistState(fullState()), false);
  fail = false;
  assert.equal(await adapter.persistState(fullState()), true);
  const web = memoryStorage();
  web.setItem = () => { throw new Error('Quota'); };
  const browser = createPersistence({ storage: web });
  assert.equal(await browser.persistState(createInitialState()), false);
});

test('browser read failure preserves unknown data and cannot be silently reset', async () => {
  let writes = 0;
  const storage = { getItem() { throw new Error('Denied'); }, setItem() { writes += 1; } };
  const adapter = createPersistence({ storage });
  const boot = await adapter.initializePersistence();
  assert.equal(boot.blocked, true);
  assert.equal(await adapter.persistState(createInitialState()), false);
  assert.equal(writes, 0);
});

test('fresh native installation starts at version 1 without inventing progress', async () => {
  const store = preferences();
  const adapter = createPersistence({ native: true, preferences: store });
  const boot = await adapter.initializePersistence();
  assert.equal(boot.source, 'new');
  assert.equal(boot.blocked, false);
  assert.equal(boot.state.createdAt, localDate());
  assert.deepEqual(boot.state.completions, {});
  assert.equal(store.writes.length, 0);
});
