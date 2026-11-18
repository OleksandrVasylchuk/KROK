import test from 'node:test';
import assert from 'node:assert/strict';
import { SYNC_MAX_BYTES, SyncError, createCloudSync, createSupabaseRemote, isPristine, normalizeSyncMeta, stateHash, summarizeState, syncPayload } from './cloud-sync.js';
import { createInitialState, reducer } from './model.js';
import { validateBackup } from './persistence.js';

const PHOTO = 'data:image/png;base64,iVBORw0KGgo=';
const clone = value => JSON.parse(JSON.stringify(value));
const withGoal = (state, title) => reducer(state, { type: 'ADD_GOAL', goal: { title, category: 'body', target: 10, unit: 'разів' } });

/** In-memory stand-in for the single cloud row, with the same revision rule as the SQL trigger. */
function cloud(initial = null) {
  const server = { row: initial, pulls: 0, pushes: 0, failWith: null };
  const remote = {
    async pull() { server.pulls++; if (server.failWith) throw server.failWith; return server.row ? clone(server.row) : null; },
    async push(expected, payload, device) {
      if (server.failWith) throw server.failWith;
      if ((server.row?.revision || 0) !== expected) return { conflict: true };
      server.pushes++;
      server.row = { revision: expected + 1, state: clone(payload), updatedAt: `2026-11-18T10:0${expected}:00.000Z`, device: device || 'Тест' };
      return { revision: server.row.revision, updatedAt: server.row.updatedAt };
    },
    async remove() { if (server.failWith) throw server.failWith; server.row = null; },
  };
  return { server, remote };
}
function device(remote, name = 'A') {
  let meta = null;
  const store = { read: async () => meta, write: async value => { meta = clone(value); } };
  return { sync: createCloudSync({ remote, store, device: name }), meta: () => meta };
}

test('nothing leaves the device before the explicit opt-in', async () => {
  const { server, remote } = cloud();
  const a = device(remote);
  assert.deepEqual(await a.sync.sync(withGoal(createInitialState(), 'Рух')), { status: 'disabled' });
  assert.equal(server.pulls, 0);
  assert.equal(server.row, null);
});

test('the first sync uploads the profile without the photo and later saves advance one revision', async () => {
  const { server, remote } = cloud();
  const a = device(remote);
  let state = withGoal(createInitialState(), 'Рух');
  state = { ...state, profile: { ...state.profile, avatar: PHOTO } };
  await a.sync.enable();
  const first = await a.sync.sync(state);
  assert.equal(first.status, 'synced'); assert.equal(first.pushed, true); assert.equal(first.revision, 1);
  assert.equal(server.row.state.profile.avatar, '', 'the uploaded photo stays on the device');
  assert.equal(server.row.state.goals[0].title, 'Рух');
  const idle = await a.sync.sync(state);
  assert.equal(idle.pushed, false); assert.equal(server.pushes, 1, 'an unchanged profile is not uploaded again');
  const next = await a.sync.sync(withGoal(state, 'Сон'));
  assert.equal(next.revision, 2); assert.equal(server.row.state.goals.length, 2);
});

test('a fresh second device adopts the cloud copy and keeps its own photo', async () => {
  const { remote } = cloud();
  const a = device(remote), b = device(remote, 'B');
  const source = withGoal(createInitialState(), 'Рух');
  await a.sync.enable(); await a.sync.sync(source);
  await b.sync.enable();
  const fresh = { ...createInitialState(), profile: { ...createInitialState().profile, avatar: PHOTO } };
  const result = await b.sync.sync(fresh);
  assert.equal(result.status, 'adopt');
  assert.equal(result.state.goals[0].title, 'Рух');
  assert.equal(result.state.profile.avatar, PHOTO);
  assert.equal(b.meta().revision, 0, 'the revision is recorded only after the local write succeeds');
  await b.sync.confirmAdopt(result.state, result.revision, result.updatedAt);
  assert.equal((await b.sync.sync(result.state)).pushed, false, 'adopting must not bounce the same data back');
});

test('an unchanged device follows newer cloud records; edits on both sides ask the person', async () => {
  const { server, remote } = cloud();
  const a = device(remote), b = device(remote, 'B');
  const base = withGoal(createInitialState(), 'Рух');
  await a.sync.enable(); await a.sync.sync(base);
  await b.sync.enable();
  const adopted = await b.sync.sync(createInitialState());
  await b.sync.confirmAdopt(adopted.state, adopted.revision, adopted.updatedAt);
  const fromB = withGoal(adopted.state, 'Читання');
  assert.equal((await b.sync.sync(fromB)).revision, 2);
  const follow = await a.sync.sync(base);
  assert.equal(follow.status, 'adopt'); assert.equal(follow.state.goals.length, 2);
  // A edits before it has seen revision 2: neither copy may win silently.
  const conflict = await a.sync.sync(withGoal(base, 'Вода'));
  assert.equal(conflict.status, 'conflict');
  assert.equal(conflict.local.summary.goals, 2); assert.equal(conflict.remote.summary.goals, 2);
  assert.equal(conflict.remote.device, 'B');
  assert.equal(server.row.revision, 2, 'a conflict changes nothing in the cloud');
  assert.equal(server.row.state.goals[1].title, 'Читання');
});

test('the person resolves a conflict either way and sync continues', async () => {
  const { server, remote } = cloud();
  const a = device(remote), b = device(remote, 'B');
  const base = withGoal(createInitialState(), 'Рух');
  await a.sync.enable(); await a.sync.sync(base);
  await b.sync.enable();
  const adopted = await b.sync.sync(createInitialState());
  await b.sync.confirmAdopt(adopted.state, adopted.revision, adopted.updatedAt);
  await b.sync.sync(withGoal(adopted.state, 'Читання'));
  const mine = withGoal(base, 'Вода');
  const conflict = await a.sync.sync(mine);
  const kept = await a.sync.keepLocal(mine, conflict.remote.revision);
  assert.equal(kept.status, 'synced'); assert.equal(server.row.revision, 3); assert.equal(server.row.state.goals[1].title, 'Вода');
  assert.equal((await a.sync.sync(mine)).pushed, false);
  // B still holds its own edit and now takes the cloud copy instead.
  const theirs = withGoal(adopted.state, 'Читання');
  assert.equal((await b.sync.sync(withGoal(theirs, 'Ще одна'))).status, 'conflict');
  const taken = await b.sync.takeRemote(theirs);
  assert.equal(taken.status, 'adopt'); assert.equal(taken.state.goals[1].title, 'Вода');
  await b.sync.confirmAdopt(taken.state, taken.revision, taken.updatedAt);
  assert.equal((await b.sync.sync(taken.state)).pushed, false);
});

test('keeping this device fails safely when the cloud changed again after the review', async () => {
  const { server, remote } = cloud();
  const a = device(remote);
  const base = withGoal(createInitialState(), 'Рух');
  await a.sync.enable(); await a.sync.sync(base);
  server.row = { ...server.row, revision: 5 };
  const result = await a.sync.keepLocal(withGoal(base, 'Вода'), 4);
  assert.equal(result.status, 'busy');
  assert.equal(server.row.revision, 5); assert.equal(server.row.state.goals.length, 1);
});

test('a used device meeting an existing cloud copy for the first time is a conflict, identical data just links', async () => {
  const { server, remote } = cloud();
  const a = device(remote), b = device(remote, 'B'), c = device(remote, 'C');
  const base = withGoal(createInitialState(), 'Рух');
  await a.sync.enable(); await a.sync.sync(base);
  await b.sync.enable();
  assert.equal((await b.sync.sync(withGoal(createInitialState(), 'Інше'))).status, 'conflict');
  await c.sync.enable();
  const linked = await c.sync.sync(validateBackup(JSON.stringify(base)));
  assert.equal(linked.status, 'synced'); assert.equal(linked.pushed, false);
  assert.equal(server.pushes, 1);
});

test('a cloud copy removed elsewhere is not uploaded again behind the person’s back', async () => {
  const { server, remote } = cloud();
  const a = device(remote), b = device(remote, 'B');
  const base = withGoal(createInitialState(), 'Рух');
  await a.sync.enable(); await a.sync.sync(base);
  await b.sync.enable();
  assert.deepEqual(await b.sync.removeCloudCopy(), { status: 'disabled', removed: true });
  assert.equal(server.row, null);
  const result = await a.sync.sync(withGoal(base, 'Вода'));
  assert.equal(result.status, 'removed');
  assert.equal(server.row, null);
  assert.deepEqual(await a.sync.sync(base), { status: 'disabled' });
});

test('network, session and server problems keep local data and report a readable state', async () => {
  const { server, remote } = cloud();
  const a = device(remote);
  const state = withGoal(createInitialState(), 'Рух');
  await a.sync.enable();
  for (const code of ['offline', 'auth', 'unavailable']) {
    server.failWith = new SyncError(code, 'x');
    const result = await a.sync.sync(state);
    assert.equal(result.status, code); assert.ok(result.message.length > 20);
  }
  server.failWith = new Error('unexpected');
  assert.equal((await a.sync.sync(state)).status, 'error');
  server.failWith = null;
  assert.equal((await a.sync.sync(state)).status, 'synced', 'the pending change is sent once the connection returns');
});

test('oversized profiles and unreadable cloud copies never overwrite anything', async () => {
  const { server, remote } = cloud();
  const a = device(remote);
  await a.sync.enable();
  const huge = { ...createInitialState(), padding: 'я'.repeat(SYNC_MAX_BYTES) };
  assert.equal((await a.sync.sync(huge)).status, 'too_large');
  assert.equal(server.pulls, 0);
  const b = device(cloud({ revision: 3, state: { version: 99 }, updatedAt: '2026-11-18T10:00:00.000Z', device: 'X' }).remote, 'B');
  await b.sync.enable();
  assert.equal((await b.sync.sync(createInitialState())).status, 'invalid_remote');
});

test('pristine means untouched, also after a reload from storage', () => {
  const fresh = createInitialState();
  assert.equal(isPristine(fresh), true);
  assert.equal(isPristine(validateBackup(JSON.stringify(fresh))), true);
  assert.equal(isPristine({ ...fresh, profile: { ...fresh.profile, avatar: PHOTO } }), true, 'a local photo alone is not a synced record');
  assert.equal(isPristine(withGoal(fresh, 'Рух')), false);
  assert.equal(isPristine(reducer(fresh, { type: 'UPDATE_PROFILE', profile: { name: 'Оля' } })), false);
  assert.equal(isPristine({ broken: true }), false);
});

test('fingerprints ignore key order and metadata is normalised', () => {
  assert.equal(stateHash({ a: 1, b: [1, { c: 2, d: 3 }] }), stateHash({ b: [1, { d: 3, c: 2 }], a: 1 }));
  assert.notEqual(stateHash({ a: 1 }), stateHash({ a: 2 }));
  assert.deepEqual(normalizeSyncMeta({ enabled: 'yes', revision: -4, hash: 'x' }), { version: 1, enabled: false, revision: 0, hash: '', syncedAt: '' });
  assert.equal(syncPayload({ profile: { avatar: PHOTO, name: 'Оля' }, quests: [] }).profile.avatar, '');
  assert.deepEqual(summarizeState({ quests: [{ archived: true }, {}], habits: [{}], goals: [{}, {}], expenses: [{}], messages: [], checkIns: { a: 1 }, completions: { a: ['q'], b: ['q', 'w'] } }), { quests: 1, habits: 1, goals: 2, expenses: 1, messages: 0, journalDays: 1, completions: 3 });
});

function fakeClient(responder) {
  const calls = [];
  const builder = operation => {
    const call = { operation, filters: {} }; calls.push(call);
    const chain = {
      select(columns) { call.columns = columns; return chain; },
      eq(field, value) { call.filters[field] = value; return chain; },
      maybeSingle() { call.single = true; return chain; },
      then(resolve, reject) { return Promise.resolve().then(() => responder(call)).then(resolve, reject); },
    };
    return chain;
  };
  return { calls, client: { from: table => ({ select: columns => { const chain = builder('select'); return chain.select(columns); }, insert: values => { const chain = builder('insert'); calls.at(-1).values = values; calls.at(-1).table = table; return chain; }, update: values => { const chain = builder('update'); calls.at(-1).values = values; return chain; }, delete: () => builder('delete') }) } };
}
const USER = '11111111-2222-3333-4444-555555555555';

test('the Supabase adapter scopes every call to the signed-in user and uses the last seen revision', async () => {
  const { calls, client } = fakeClient(call => call.operation === 'select' ? { data: { revision: '4', state: { version: 1 }, updated_at: '2026-11-18T10:00:00Z', device: 'Android' }, error: null, status: 200 }
    : call.operation === 'update' ? { data: call.filters.revision === 4 ? [{ revision: 5, updated_at: '2026-11-18T10:05:00Z', device: 'Браузер' }] : [], error: null, status: 200 }
      : call.operation === 'insert' ? { data: null, error: { code: '23505', message: 'duplicate key' }, status: 409 } : { data: null, error: null, status: 204 });
  const remote = createSupabaseRemote(client, USER);
  assert.deepEqual(await remote.pull(), { revision: 4, updatedAt: '2026-11-18T10:00:00Z', device: 'Android', state: { version: 1 } });
  assert.deepEqual(await remote.push(4, { version: 1 }, 'Браузер'), { revision: 5, updatedAt: '2026-11-18T10:05:00Z', device: 'Браузер' });
  assert.deepEqual(await remote.push(2, { version: 1 }, 'Браузер'), { conflict: true }, 'a stale revision updates no row');
  assert.deepEqual(await remote.push(0, { version: 1 }, 'Браузер'), { conflict: true }, 'an existing row is never replaced by an insert');
  await remote.remove();
  assert.ok(calls.filter(call => call.operation !== 'insert').every(call => call.filters.user_id === USER));
  assert.equal(calls.find(call => call.operation === 'insert').values.user_id, USER);
  assert.deepEqual(calls.find(call => call.operation === 'update').values, { revision: 5, state: { version: 1 }, device: 'Браузер' });
  assert.throws(() => createSupabaseRemote(client, 'not-a-user'), SyncError);
});

test('the Supabase adapter tells apart offline, expired session, missing table and size errors', async () => {
  const cases = [
    [{ data: null, error: { code: '', message: 'TypeError: Failed to fetch' }, status: 0 }, 'offline'],
    [{ data: null, error: { code: 'PGRST301', message: 'JWT expired' }, status: 401 }, 'auth'],
    [{ data: null, error: { code: 'PGRST205', message: 'Could not find the table' }, status: 404 }, 'unavailable'],
    [{ data: null, error: { code: '23514', message: 'check constraint' }, status: 400 }, 'too_large'],
    [{ data: null, error: { code: 'P0001', message: 'revision must advance by one' }, status: 400 }, 'error'],
    [{ data: { revision: 0, state: {} }, error: null, status: 200 }, 'error'],
  ];
  for (const [response, code] of cases) {
    const remote = createSupabaseRemote(fakeClient(() => response).client, USER);
    await assert.rejects(remote.pull(), error => error instanceof SyncError && error.code === code, code);
  }
  const thrown = createSupabaseRemote(fakeClient(() => { throw new TypeError('network down'); }).client, USER);
  await assert.rejects(thrown.pull(), error => error.code === 'offline');
});
