import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDailyReminder, createReminderService, DAILY_REMINDER_ID, DEFAULT_REMINDER_TIME, parseReminderTime, REMINDER_CHANNEL_ID, REMINDER_SETTINGS_KEY } from './reminders.js';

function nativeHarness({ permission = 'granted', requestedPermission = 'granted' } = {}) {
  const values = new Map();
  const pending = new Map();
  const calls = [];
  let listener;
  let display = permission;
  const env = {
    isNative: true, platform: 'android',
    preferences: {
      get: async ({ key }) => ({ value: values.get(key) || null }),
      set: async ({ key, value }) => { values.set(key, value); },
    },
    notifications: {
      checkPermissions: async () => { calls.push('check'); return { display }; },
      requestPermissions: async () => { calls.push('request'); display = requestedPermission; return { display }; },
      getPending: async () => ({ notifications: [...pending.values()] }),
      createChannel: async channel => { calls.push(['channel', channel]); },
      schedule: async ({ notifications }) => { calls.push(['schedule', notifications]); notifications.forEach(item => pending.set(item.id, structuredClone(item))); return { notifications: notifications.map(({ id }) => ({ id })) }; },
      cancel: async ({ notifications }) => { calls.push(['cancel', notifications]); notifications.forEach(({ id }) => pending.delete(id)); },
      addListener: async (event, callback) => { calls.push(['listen', event]); listener = callback; return { remove: async () => { calls.push('remove-listener'); listener = undefined; } }; },
    },
  };
  return { env, service: createReminderService(env), values, pending, calls, setPermission: value => { display = value; }, emit: action => listener?.(action) };
}

test('daily reminder validates local time and explicitly requests inexact scheduling', () => {
  assert.deepEqual(parseReminderTime('00:00'), { hour: 0, minute: 0 });
  assert.deepEqual(parseReminderTime('23:59'), { hour: 23, minute: 59 });
  for (const invalid of ['24:00', '09:60', '9:00', '', null, '09:00Z']) assert.throws(() => parseReminderTime(invalid), { code: 'invalid_time' });
  const reminder = buildDailyReminder('08:35');
  assert.deepEqual(reminder.schedule, { on: { hour: 8, minute: 35, second: 0 }, repeats: true, allowWhileIdle: false });
  assert.equal(reminder.isExactNotification, false);
  assert.equal(reminder.isExactMandatory, false);
  assert.equal(reminder.extra.destination, 'quests');
});

test('reading status and registering navigation never requests permission or schedules', async () => {
  const h = nativeHarness({ permission: 'prompt' });
  const state = await h.service.status();
  await h.service.listen(() => {});
  assert.equal(state.enabled, false);
  assert.equal(state.permission, 'prompt');
  assert.equal(h.calls.includes('request'), false);
  assert.equal(h.calls.some(call => Array.isArray(call) && call[0] === 'schedule'), false);
});

test('explicit enabling requests permission first then persists confirmed native schedule', async () => {
  const h = nativeHarness({ permission: 'prompt' });
  const state = await h.service.enable('20:15');
  assert.equal(state.enabled, true);
  assert.equal(state.time, '20:15');
  assert.equal(h.pending.size, 1);
  assert.equal(JSON.parse(h.values.get(REMINDER_SETTINGS_KEY)).enabled, true);
  assert.ok(h.calls.indexOf('request') < h.calls.findIndex(call => Array.isArray(call) && call[0] === 'schedule'));
});

test('denied permission never creates a channel, schedules or persists enabled', async () => {
  const h = nativeHarness({ permission: 'prompt', requestedPermission: 'denied' });
  await assert.rejects(h.service.enable('20:00'), { code: 'permission_denied' });
  assert.equal(h.pending.size, 0);
  assert.equal(h.values.size, 0);
  assert.equal(h.calls.some(call => Array.isArray(call) && ['schedule', 'channel'].includes(call[0])), false);
});

test('changing time replaces only the stable reminder ID and disable preserves unrelated notifications', async () => {
  const h = nativeHarness();
  h.pending.set(99, { id: 99 });
  await h.service.enable('08:00');
  await h.service.enable('22:30');
  assert.equal(h.pending.size, 2);
  assert.deepEqual(h.pending.get(DAILY_REMINDER_ID).schedule.on, { hour: 22, minute: 30, second: 0 });
  const state = await h.service.disable();
  assert.equal(state.enabled, false);
  assert.equal(state.scheduled, false);
  assert.equal(h.pending.has(99), true);
  assert.deepEqual(h.calls.find(call => Array.isArray(call) && call[0] === 'cancel')[1], [{ id: DAILY_REMINDER_ID }]);
});

test('disable queued during a permission dialog wins after enable completes', async () => {
  const h = nativeHarness({ permission: 'prompt' });
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  h.env.notifications.requestPermissions = async () => { await gate; h.setPermission('granted'); return { display: 'granted' }; };
  const enabling = h.service.enable('18:45');
  const disabling = h.service.disable();
  release();
  await Promise.all([enabling, disabling]);
  assert.equal(h.pending.has(DAILY_REMINDER_ID), false);
  assert.equal(JSON.parse(h.values.get(REMINDER_SETTINGS_KEY)).enabled, false);
});

test('pending platform state is authoritative when preferences are stale or permission revoked', async () => {
  const h = nativeHarness();
  h.values.set(REMINDER_SETTINGS_KEY, JSON.stringify({ enabled: true, time: '06:00' }));
  const missing = await h.service.status();
  assert.equal(missing.enabled, false);
  assert.equal(missing.savedEnabled, true);
  h.pending.set(DAILY_REMINDER_ID, buildDailyReminder('21:40'));
  const active = await h.service.status();
  assert.equal(active.enabled, true);
  assert.equal(active.time, '21:40');
  h.setPermission('denied');
  const revoked = await h.service.status();
  assert.equal(revoked.enabled, false);
  assert.equal(revoked.scheduled, true);
});

test('a successful native schedule with failed preference write reports partial success honestly', async () => {
  const h = nativeHarness();
  h.env.preferences.set = async () => { throw new Error('storage full'); };
  await assert.rejects(h.service.enable('19:20'), { code: 'storage_after_enable' });
  assert.equal((await h.service.status()).enabled, true);
  assert.equal((await h.service.status()).time, '19:20');
});

test('a disabled Android channel is reported as blocked even when global permission is granted', async () => {
  const h = nativeHarness();
  await h.service.enable('19:20');
  h.env.notifications.listChannels = async () => ({ channels: [{ id: REMINDER_CHANNEL_ID, importance: 0 }] });
  const blocked = await h.service.status();
  assert.equal(blocked.permission, 'granted');
  assert.equal(blocked.scheduled, true);
  assert.equal(blocked.channelBlocked, true);
  assert.equal(blocked.enabled, false);
  await assert.rejects(h.service.enable('19:30'), { code: 'channel_disabled' });
  assert.equal(h.pending.get(DAILY_REMINDER_ID).schedule.on.minute, 20);
});

test('failed cancellation is not reported or persisted as disabled', async () => {
  const h = nativeHarness();
  await h.service.enable('17:10');
  h.env.notifications.cancel = async () => {};
  await assert.rejects(h.service.disable(), { code: 'not_cancelled' });
  assert.equal(JSON.parse(h.values.get(REMINDER_SETTINGS_KEY)).enabled, true);
  assert.equal((await h.service.status()).enabled, true);
});

test('a failed replacement cannot report the old pending reminder as the newly selected time', async () => {
  const h = nativeHarness();
  await h.service.enable('17:10');
  h.env.notifications.schedule = async () => ({ notifications: [{ id: DAILY_REMINDER_ID }] });
  await assert.rejects(h.service.enable('20:30'), { code: 'schedule_mismatch' });
  assert.equal(JSON.parse(h.values.get(REMINDER_SETTINGS_KEY)).time, '17:10');
  assert.equal((await h.service.status()).time, '17:10');
});

test('corrupt settings are recoverable and cancellation still works when reads fail', async () => {
  const h = nativeHarness();
  h.values.set(REMINDER_SETTINGS_KEY, '{broken');
  assert.equal((await h.service.status()).time, DEFAULT_REMINDER_TIME);
  await h.service.enable('10:20');
  h.env.preferences.get = async () => { throw new Error('read error'); };
  const result = await h.service.disable();
  assert.equal(result.enabled, false);
  assert.equal(result.scheduled, false);
  assert.match(result.storageWarning, /Не вдалося прочитати/);
});

test('browser remembers preferred time without native permission or fake background scheduling', async () => {
  const values = new Map();
  const service = createReminderService({ isNative: false, platform: 'web', storage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) } });
  const saved = await service.saveTime('12:40');
  assert.equal(saved.supported, false);
  assert.equal(saved.enabled, false);
  assert.equal(saved.time, '12:40');
  await assert.rejects(service.enable('12:40'), { code: 'unsupported' });
  assert.equal(JSON.parse(values.get(REMINDER_SETTINGS_KEY)).enabled, false);
  const remove = await service.listen(() => assert.fail('web cannot receive native actions'));
  await remove();
});

test('notification action routes only our reminder and removes only its own listener', async () => {
  const h = nativeHarness();
  const routes = [];
  const remove = await h.service.listen(route => routes.push(route));
  h.emit({ actionId: 'tap', notification: { id: 99 } });
  h.emit({ actionId: 'dismiss', notification: { id: DAILY_REMINDER_ID } });
  h.emit({ actionId: 'tap', notification: { id: DAILY_REMINDER_ID, extra: { destination: 'quests' } } });
  h.emit({ actionId: 'tap', notification: { id: DAILY_REMINDER_ID, extra: { destination: 'today' } } });
  h.emit({ actionId: 'tap', notification: { id: DAILY_REMINDER_ID, extra: { destination: 'https://untrusted.example' } } });
  assert.deepEqual(routes, ['quests', 'today', 'quests']);
  await remove();
  assert.equal(h.calls.at(-1), 'remove-listener');
  h.emit({ actionId: 'tap', notification: { id: DAILY_REMINDER_ID } });
  assert.equal(routes.length, 3);
});
