export const DAILY_REMINDER_ID = 43101;
export const REMINDER_CHANNEL_ID = 'krok-daily-v1';
export const REMINDER_SETTINGS_KEY = 'krok-reminders-v1';
export const DEFAULT_REMINDER_TIME = '19:00';

class ReminderError extends Error {
  constructor(code, message, cause) {
    super(message, cause ? { cause } : undefined);
    this.name = 'ReminderError';
    this.code = code;
    this.userMessage = message;
  }
}

export function parseReminderTime(value) {
  if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    throw new ReminderError('invalid_time', 'Обери час у форматі години:хвилини.');
  }
  const [hour, minute] = value.split(':').map(Number);
  return { hour, minute };
}

function normalizedSettings(value) {
  let time = DEFAULT_REMINDER_TIME;
  try { parseReminderTime(value?.time); time = value.time; } catch { /* Invalid stored time falls back to an editable default. */ }
  return { version: 1, enabled: value?.enabled === true, time };
}

export function buildDailyReminder(time) {
  const { hour, minute } = parseReminderTime(time);
  return {
    id: DAILY_REMINDER_ID,
    title: 'Час для твого КРОКу',
    body: 'Одна маленька дія сьогодні. Відкрий свій план і зроби наступний крок.',
    channelId: REMINDER_CHANNEL_ID,
    schedule: { on: { hour, minute, second: 0 }, repeats: true, allowWhileIdle: false },
    isExactNotification: false,
    isExactMandatory: false,
    autoCancel: true,
    extra: { destination: 'quests', source: 'krok-daily' },
  };
}

async function loadRuntime() {
  const { Capacitor } = await import('@capacitor/core');
  const isNative = Capacitor.isNativePlatform();
  const platform = Capacitor.getPlatform();
  if (isNative) {
    const { Preferences } = await import('@capacitor/preferences');
    const notifications = platform === 'android' ? (await import('@capacitor/local-notifications')).LocalNotifications : null;
    return { isNative, platform, preferences: Preferences, notifications };
  }
  let storage;
  try { storage = globalThis.localStorage; } catch { storage = null; }
  return { isNative: false, platform, storage, notifications: null };
}

// One queue per service keeps permission dialogs, rescheduling and cancellation ordered.
// The injectable runtime also lets tests exercise native failures without a device.
export function createReminderService(runtimeSource = loadRuntime) {
  let runtimePromise;
  let queue = Promise.resolve();
  const runtime = () => runtimePromise ||= Promise.resolve().then(() => typeof runtimeSource === 'function' ? runtimeSource() : runtimeSource);
  const serial = operation => {
    const result = queue.then(operation, operation);
    queue = result.catch(() => undefined);
    return result;
  };
  const supported = env => env.isNative && env.platform === 'android' && Boolean(env.notifications);

  async function readSettings(env) {
    const value = env.isNative
      ? (await env.preferences.get({ key: REMINDER_SETTINGS_KEY })).value
      : env.storage?.getItem(REMINDER_SETTINGS_KEY);
    if (!env.isNative && !env.storage) throw new ReminderError('storage_unavailable', 'Браузер не дозволяє зберегти налаштування.');
    if (!value) return normalizedSettings(null);
    try { return normalizedSettings(JSON.parse(value)); } catch { return normalizedSettings(null); }
  }

  async function writeSettings(env, settings) {
    const value = JSON.stringify(normalizedSettings(settings));
    if (env.isNative) await env.preferences.set({ key: REMINDER_SETTINGS_KEY, value });
    else {
      if (!env.storage) throw new ReminderError('storage_unavailable', 'Браузер не дозволяє зберегти налаштування.');
      env.storage.setItem(REMINDER_SETTINGS_KEY, value);
    }
  }

  async function inspect(env) {
    let settings = normalizedSettings(null);
    let storageWarning = '';
    try { settings = await readSettings(env); } catch { storageWarning = 'Не вдалося прочитати збережені налаштування.'; }
    if (!supported(env)) return { ...settings, enabled: false, savedEnabled: settings.enabled, supported: false, platform: env.platform, permission: 'unavailable', scheduled: false, storageWarning };
    const [permission, pending, channels] = await Promise.all([
      env.notifications.checkPermissions(), env.notifications.getPending(),
      env.notifications.listChannels ? env.notifications.listChannels() : Promise.resolve({ channels: [] }),
    ]);
    const notification = pending.notifications.find(item => item.id === DAILY_REMINDER_ID);
    const channelBlocked = channels.channels.some(channel => channel.id === REMINDER_CHANNEL_ID && channel.importance === 0);
    const on = notification?.schedule?.on;
    let time = settings.time;
    if (Number.isInteger(on?.hour) && Number.isInteger(on?.minute)) {
      const pendingTime = `${String(on.hour).padStart(2, '0')}:${String(on.minute).padStart(2, '0')}`;
      try { parseReminderTime(pendingTime); time = pendingTime; } catch { /* Retain the validated preference if the platform response is incomplete. */ }
    }
    return { ...settings, time, savedEnabled: settings.enabled, supported: true, platform: env.platform, permission: permission.display, scheduled: Boolean(notification), channelBlocked, enabled: Boolean(notification) && permission.display === 'granted' && !channelBlocked, storageWarning };
  }

  return {
    status: () => serial(async () => inspect(await runtime())),

    saveTime: time => serial(async () => {
      parseReminderTime(time);
      const env = await runtime();
      if (supported(env)) throw new ReminderError('use_schedule', 'Щоб змінити час, онови нагадування.');
      await writeSettings(env, { enabled: false, time });
      return inspect(env);
    }),

    enable: time => serial(async () => {
      const notification = buildDailyReminder(time);
      const env = await runtime();
      if (!supported(env)) throw new ReminderError('unsupported', 'Фонові нагадування доступні в Android-застосунку КРОК.');
      let permission = await env.notifications.checkPermissions();
      // Called exclusively by the explicit Enable/Update button, never on startup.
      if (permission.display !== 'granted') permission = await env.notifications.requestPermissions();
      if (permission.display !== 'granted') throw new ReminderError('permission_denied', 'Дозвіл не надано. Увімкни сповіщення для КРОК у налаштуваннях Android і спробуй ще раз.');
      await env.notifications.createChannel({ id: REMINDER_CHANNEL_ID, name: 'Щоденний КРОК', description: 'Одне нагадування про твій щоденний план.', importance: 3, visibility: 1, vibration: true });
      if (env.notifications.listChannels) {
        const { channels } = await env.notifications.listChannels();
        if (channels.some(channel => channel.id === REMINDER_CHANNEL_ID && channel.importance === 0)) throw new ReminderError('channel_disabled', 'Канал «Щоденний КРОК» вимкнено в Android. Дозволь його в налаштуваннях сповіщень застосунку.');
      }
      // Reusing this ID replaces our existing schedule; other notifications stay intact.
      await env.notifications.schedule({ notifications: [notification] });
      const pending = await env.notifications.getPending();
      const confirmed = pending.notifications.find(item => item.id === DAILY_REMINDER_ID);
      if (!confirmed) throw new ReminderError('not_scheduled', 'Android не підтвердив нагадування. Спробуй увімкнути його ще раз.');
      // An existing ID alone does not prove that Android replaced its old time.
      const confirmedTime = confirmed.schedule?.on;
      if ((Number.isInteger(confirmedTime?.hour) && confirmedTime.hour !== notification.schedule.on.hour)
        || (Number.isInteger(confirmedTime?.minute) && confirmedTime.minute !== notification.schedule.on.minute)) {
        throw new ReminderError('schedule_mismatch', 'Android ще показує попередній час нагадування. Спробуй оновити його ще раз.');
      }
      try { await writeSettings(env, { enabled: true, time }); }
      catch (error) { throw new ReminderError('storage_after_enable', 'Нагадування заплановано, але не вдалося зберегти його налаштування. Перевір стан нижче.', error); }
      return inspect(env);
    }),

    disable: () => serial(async () => {
      const env = await runtime();
      let settings = normalizedSettings(null);
      try { settings = await readSettings(env); } catch { /* Cancellation must still work if preference reads fail. */ }
      if (supported(env)) {
        await env.notifications.cancel({ notifications: [{ id: DAILY_REMINDER_ID }] });
        const pending = await env.notifications.getPending();
        if (pending.notifications.some(item => item.id === DAILY_REMINDER_ID)) throw new ReminderError('not_cancelled', 'Android ще показує активне нагадування. Спробуй вимкнути його ще раз.');
      }
      try { await writeSettings(env, { ...settings, enabled: false }); }
      catch (error) { throw new ReminderError('storage_after_disable', 'Нагадування вимкнено, але не вдалося зберегти налаштування.', error); }
      return inspect(env);
    }),

    listen: async callback => {
      const env = await runtime();
      if (!supported(env)) return async () => {};
      const handle = await env.notifications.addListener('localNotificationActionPerformed', action => {
        if (action.notification?.id !== DAILY_REMINDER_ID || action.actionId === 'dismiss') return;
        callback(action.notification.extra?.destination === 'today' ? 'today' : 'quests');
      });
      return () => handle.remove();
    },
  };
}

const service = createReminderService();
export const getReminderStatus = () => service.status();
export const saveReminderTime = time => service.saveTime(time);
export const enableDailyReminder = time => service.enable(time);
export const disableDailyReminder = () => service.disable();
export const listenReminderNavigation = callback => service.listen(callback);
