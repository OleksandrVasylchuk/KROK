import test from 'node:test';
import assert from 'node:assert/strict';
import { createDemoInitializer, scopedStorage, scopedPreferences } from './app-persistence.js';
import { createPersistence } from './persistence.js';
import { createDemoState } from './demo.js';
import { createInitialState, STORAGE_KEY } from './model.js';

test('demo initialization and recovery never read or overwrite the personal browser record', async () => {
  const personal = JSON.stringify({ ...createInitialState(), profile: { ...createInitialState().profile, name: 'Особисті дані' } });
  const values = new Map([[STORAGE_KEY, personal]]);
  const store = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
  const adapter = createPersistence({ storage: scopedStorage(store, 'krok-demo-v3') });
  assert.equal((await adapter.initializePersistence()).source, 'new');
  const demo = createDemoState();
  assert.equal(await adapter.recoverPersistence(demo), true);
  assert.equal(values.get(STORAGE_KEY), personal);
  assert.equal(JSON.parse(values.get('krok-demo-v3')).profile.name, 'Олексій');
  assert.equal(await adapter.persistState({ ...demo, profile: { ...demo.profile, name: 'Змінений приклад' } }), true);
  assert.equal(values.get(STORAGE_KEY), personal);
});

test('native demo Preferences calls use only the demo key', async () => {
  const calls = [];
  const preferences = { get: async args => { calls.push(args); return { value: null }; }, set: async args => { calls.push(args); } };
  const adapter = createPersistence({ native: true, storage: { getItem: () => null }, preferences: scopedPreferences(preferences, 'krok-demo-v3') });
  await adapter.initializePersistence();
  assert.equal(await adapter.recoverPersistence(createDemoState()), true);
  assert.ok(calls.length >= 2);
  assert.ok(calls.every(call => call.key === 'krok-demo-v3'));
});

test('concurrent and repeated demo initialization seeds once and never replaces edits', async () => {
  const personal = JSON.stringify(createInitialState());
  const values = new Map([[STORAGE_KEY, personal]]); const writes = [];
  const store = { getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); writes.push(key); } };
  const adapter = createPersistence({ storage: scopedStorage(store, 'krok-demo-v3') });
  const initialize = createDemoInitializer(async () => adapter);
  const [first, second] = await Promise.all([initialize(), initialize()]);
  assert.equal(first, second); assert.equal(writes.length, 1);
  const edited = { ...first.state, profile: { ...first.state.profile, name: 'Мій змінений приклад' } };
  assert.equal(await adapter.persistState(edited), true);
  await initialize();
  assert.equal(writes.length, 2); assert.equal(JSON.parse(values.get('krok-demo-v3')).profile.name, 'Мій змінений приклад');
  assert.equal(values.get(STORAGE_KEY), personal);
});

test('unavailable or corrupt demo storage shows synthetic read-only content without writes', async () => {
  for (const value of ['{broken', null]) {
    let writes = 0;
    const storage = { getItem() { if (value === null) throw Error('Denied'); return value; }, setItem() { writes++; } };
    const adapter = createPersistence({ storage });
    const initialize = createDemoInitializer(async () => adapter);
    const boot = await initialize();
    assert.equal(boot.blocked, true); assert.equal(boot.state.profile.name, 'Олексій'); assert.equal(boot.state.demo.synthetic, true);
    assert.equal(await adapter.persistState(boot.state), false); assert.equal(writes, 0);
  }
});
