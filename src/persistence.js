import { CATEGORIES, createInitialState, restoreState, localDate, saveState, STORAGE_KEY } from './model.js';

const MAX_BACKUP_CHARACTERS = 8_000_000;
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isArray = Array.isArray;
const sameValue = (left, right) => {
  if (left === right) return true;
  if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
  if (isObject(left)) return isObject(right) && Object.keys(left).length === Object.keys(right).length && Object.keys(left).every(key => Object.hasOwn(right, key) && sameValue(left[key], right[key]));
  return false;
};
const requirePreservedFields = (raw, normalized, fields) => {
  for (const field of fields) if (Object.hasOwn(raw, field) && !sameValue(raw[field], normalized[field])) throw new Error('Копія містить пошкоджені або несумісні значення. Поточні дані не змінено.');
};

/** Validate the envelope before the model applies its backwards-compatible field normalizers. */
export function validateBackup(text) {
  if (typeof text !== 'string' || !text.trim() || text.length > MAX_BACKUP_CHARACTERS || new TextEncoder().encode(text).length > MAX_BACKUP_CHARACTERS) {
    throw new Error('Оберіть JSON-копію КРОК розміром до 8 МБ.');
  }
  let raw;
  try { raw = JSON.parse(text); }
  catch { throw new Error('Файл пошкоджений або не містить коректний JSON.'); }
  if (!isObject(raw) || raw.version !== 1 || (raw.schemaRevision !== undefined && (!Number.isInteger(raw.schemaRevision) || raw.schemaRevision < 1 || raw.schemaRevision > 6))) {
    throw new Error('Ця версія резервної копії не підтримується. Потрібна копія КРОК версії 1.');
  }
  if (!isObject(raw.profile)
    || typeof raw.profile.name !== 'string'
    || typeof raw.profile.goal !== 'string'
    || !CATEGORIES.some(category => category.id === raw.profile.focus)
    || typeof raw.profile.onboarded !== 'boolean'
    || !isArray(raw.quests) || !isArray(raw.habits)
    || !isObject(raw.completions) || !isObject(raw.habitLogs)
    || !isArray(raw.expenses) || !isArray(raw.rewards) || !isArray(raw.messages)
    || typeof raw.createdAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(raw.createdAt)) {
    throw new Error('У копії бракує даних профілю або прогресу. Поточні дані не змінено.');
  }
  if ((raw.goals !== undefined && !isArray(raw.goals)) || (raw.budgets !== undefined && (!isObject(raw.budgets) || !isObject(raw.budgets.categories) || typeof raw.budgets.monthLimit !== 'number')) || (raw.checkIns !== undefined && !isObject(raw.checkIns)) || (raw.dailyPlans !== undefined && !isArray(raw.dailyPlans)) || (raw.coachProposals !== undefined && !isArray(raw.coachProposals))) throw new Error('У копії пошкоджено цілі, бюджет, щоденник або пропозиції тренера. Поточні дані не змінено.');
  const today = localDate();
  if (raw.createdAt > today || raw.habits.some(habit => isObject(habit) && typeof habit.createdAt === 'string' && habit.createdAt > today) || (raw.goals ?? []).some(goal => isObject(goal) && typeof goal.createdAt === 'string' && goal.createdAt > today)) throw new Error('У копії вказано майбутню дату створення записів. Поточні дані не змінено.');
  let normalized;
  try { normalized = restoreState(raw); }
  catch { throw new Error('Копія містить пошкоджені записи. Поточні дані не змінено.'); }
  requirePreservedFields(raw.profile, normalized.profile, ['name', 'goal', 'focus', 'onboarded', 'avatar', 'portrait', 'coachTone', 'coachMode', 'coachContextConsent', 'bio', 'occupation', 'coachPlan', 'lifeProfile', 'coachActionsConsent', 'coachMemoryConsent', 'coachJournalConsent', 'start', 'weeklyMeeting']);
  requirePreservedFields(raw, normalized, ['createdAt', 'budgets', 'checkIns', 'demo', 'dailyPlans', 'coachProposals', 'coachMemory']);
  const acceptedDates = new Set();
  const appliedIds = new Set();
  for (const plan of normalized.dailyPlans) {
    if (plan.appliedQuestIds.some(id => appliedIds.has(id) || !normalized.quests.some(quest => quest.id === id)) || (plan.appliedQuestIds.length && acceptedDates.has(plan.date))) throw new Error('У копії пошкоджено зв’язки або історію щоденних планів. Поточні дані не змінено.');
    plan.appliedQuestIds.forEach(id => appliedIds.add(id));
    if (plan.appliedQuestIds.length) acceptedDates.add(plan.date);
  }
  // A normalizer may repair optional fields, but importing must never silently
  // discard records (or mistake the model's error fallback for a valid backup).
  const recordFields = {
    quests: ['id', 'title', 'description', 'category', 'attribute', 'xp', 'minutes', 'archived', 'frequency', 'weekdays', 'scheduledDate', 'goalId', 'timeOfDay'],
    habits: ['id', 'title', 'icon', 'target', 'unit', 'category', 'timeOfDay', 'archived', 'frequency', 'weekdays', 'createdAt'],
    expenses: ['id', 'title', 'amount', 'category', 'date', 'type', 'account', 'note'],
    rewards: ['id', 'cost', 'date'],
    messages: ['id', 'role', 'text', 'at', 'source'],
    goals: ['id', 'title', 'category', 'target', 'current', 'unit', 'deadline', 'description', 'status', 'createdAt'],
  };
  for (const key of ['quests', 'habits', 'expenses', 'rewards', 'messages', ...(raw.goals === undefined ? [] : ['goals'])]) {
    if (raw[key].length !== normalized[key].length
      || raw[key].some((item, index) => !isObject(item) || item.id !== normalized[key][index]?.id)) {
      throw new Error('Копія містить пошкоджені або несумісні записи. Поточні дані не змінено.');
    }
    raw[key].forEach((item, index) => requirePreservedFields(item, normalized[key][index], recordFields[key]));
  }
  for (const [date, ids] of Object.entries(raw.completions)) {
    if (!isArray(ids) || !Object.hasOwn(normalized.completions, date)
      || ids.length !== normalized.completions[date].length
      || ids.some((id, index) => id !== normalized.completions[date][index])) {
      throw new Error('У копії пошкоджено історію квестів або вказано майбутні дати. Поточні дані не змінено.');
    }
  }
  for (const [date, logs] of Object.entries(raw.habitLogs)) {
    if (!isObject(logs) || !Object.hasOwn(normalized.habitLogs, date)
      || Object.entries(logs).some(([id, value]) => normalized.habitLogs[date][id] !== value || value > (normalized.habits.find(habit => habit.id === id)?.target ?? -1))) {
      throw new Error('У копії пошкоджено історію звичок або вказано майбутні дати. Поточні дані не змінено.');
    }
  }
  return normalized;
}

/**
 * Injected adapters keep native IO testable without starting Capacitor.
 * A failed/corrupt read blocks ordinary writes until explicit recovery.
 */
export function createPersistence({ native = false, storage, preferences } = {}) {
  let blocked = true;
  let initialization;
  let writeQueue = Promise.resolve();
  let expectedBrowserRaw;

  const enqueue = (operation) => {
    const next = writeQueue.then(operation, operation);
    writeQueue = next.catch(() => false);
    return next;
  };

  const readBrowser = () => {
    if (!storage) return null;
    return storage.getItem(STORAGE_KEY);
  };

  const write = async (snapshot, { replace = false } = {}) => {
    try {
      if (native) {
        if (!preferences?.set) return false;
        await preferences.set({ key: STORAGE_KEY, value: snapshot });
        return true;
      }
      if (!replace) {
        let current;
        try { current = storage?.getItem(STORAGE_KEY); }
        catch { blocked = true; return false; }
        if (current !== expectedBrowserRaw) {
          // A second tab/PWA window may have changed the record before its
          // storage event reaches this window. Preserve that newer snapshot.
          blocked = true;
          return false;
        }
      }
      const saved = saveState(JSON.parse(snapshot), storage);
      if (saved) expectedBrowserRaw = snapshot;
      return saved;
    } catch { return false; }
  };

  const unavailable = (warning, state = createInitialState()) => ({
    state, warning, blocked: true, source: 'unavailable',
  });

  function initializePersistence() {
    if (initialization) return initialization;
    initialization = (async () => {
      let raw;
      let source;
      if (native) {
        try {
          if (!preferences?.get) throw new Error('Native preferences unavailable');
          const result = await preferences.get({ key: STORAGE_KEY });
          if (!result || !Object.hasOwn(result, 'value')) throw new Error('Invalid preferences response');
          raw = result.value;
          if (raw !== null && typeof raw !== 'string') throw new Error('Invalid preferences value');
          source = 'native';
        } catch {
          return unavailable('Не вдалося прочитати збереження на пристрої. Автозбереження зупинено, щоб зберегти попередній прогрес. Спробуйте перезапустити застосунок або відновіть резервну копію.');
        }
        // A native record is authoritative, even if it is damaged or empty.
        if (raw === null) {
          try { raw = readBrowser(); }
          catch {
            return unavailable('Не вдалося прочитати попередні вебдані. Перенесення і автозбереження зупинено; початкові дані залишилися без змін.');
          }
          source = raw === null ? 'new' : 'migration';
        }
      } else {
        try {
          if (!storage) throw new Error('Browser storage unavailable');
          raw = readBrowser();
          expectedBrowserRaw = raw;
          source = raw === null ? 'new' : 'browser';
        } catch {
          return unavailable('Браузер не дозволив прочитати локальне сховище. Автозбереження недоступне. Перевірте налаштування браузера або експортуйте прогрес перед закриттям.');
        }
      }

      let state;
      try { state = raw === null ? createInitialState() : validateBackup(raw); }
      catch {
        return unavailable('Збереження пошкоджене або має непідтримувану версію. Його не перезаписано. Відновіть коректну резервну копію або явно почніть заново.');
      }

      if (source === 'migration' && !await write(JSON.stringify(state))) {
        return unavailable('Не вдалося перенести прогрес у сховище пристрою. Початкові вебдані збережено; автозбереження зупинено до повторного запуску або відновлення копії.', state);
      }
      blocked = false;
      return { state, blocked: false, source };
    })();
    return initialization;
  }

  function serialize(state) {
    try {
      const text = JSON.stringify(state);
      validateBackup(text);
      return text;
    } catch { return null; }
  }

  function persistState(state) {
    // Capture at call time, rather than retaining a mutable state object in the queue.
    const snapshot = serialize(state);
    if (!snapshot) return Promise.resolve(false);
    return enqueue(async () => {
      await initializePersistence();
      if (blocked) return false;
      return write(snapshot);
    });
  }

  /** Call only after the user explicitly confirms importing a backup or starting over. */
  function recoverPersistence(state) {
    const snapshot = serialize(state);
    if (!snapshot) return Promise.resolve(false);
    return enqueue(async () => {
      await initializePersistence();
      const saved = await write(snapshot, { replace: true });
      if (saved) blocked = false;
      return saved;
    });
  }

  return { initializePersistence, persistState, recoverPersistence };
}

let defaultPersistence;
export let nativePlatform = false;

async function getDefaultPersistence() {
  if (!defaultPersistence) {
    defaultPersistence = (async () => {
      const { Capacitor } = await import('@capacitor/core');
      nativePlatform = Capacitor.isNativePlatform();
      let storage;
      try { storage = globalThis.localStorage; }
      catch {
        // Delay the error until a migration/browser read; native records remain readable.
        storage = { getItem() { throw new Error('Browser storage denied'); }, setItem() { throw new Error('Browser storage denied'); } };
      }
      const preferences = nativePlatform ? (await import('@capacitor/preferences')).Preferences : undefined;
      return createPersistence({ native: nativePlatform, storage, preferences });
    })();
  }
  return defaultPersistence;
}

export async function initializePersistence() {
  try { return await (await getDefaultPersistence()).initializePersistence(); }
  catch {
    return {
      state: createInitialState(), blocked: true, source: 'unavailable',
      warning: 'Не вдалося відкрити сховище. Попередні дані не змінено. Перезапустіть застосунок, щоб повторити спробу.',
    };
  }
}

export async function persistState(state) {
  try { return await (await getDefaultPersistence()).persistState(state); }
  catch { return false; }
}

export async function recoverPersistence(state) {
  try { return await (await getDefaultPersistence()).recoverPersistence(state); }
  catch { return false; }
}

/** User-initiated export: local download on web, platform share sheet for a local cache file on native. */
export async function exportBackup(state) {
  try {
    const text = JSON.stringify(validateBackup(JSON.stringify(state)), null, 2);
    const filename = `krok-backup-${localDate()}.json`;
    const { Capacitor } = await import('@capacitor/core');
    if (Capacitor.isNativePlatform()) {
      const [{ Filesystem, Directory, Encoding }, { Share }] = await Promise.all([
        import('@capacitor/filesystem'), import('@capacitor/share'),
      ]);
      const { uri } = await Filesystem.writeFile({
        path: filename, data: text, directory: Directory.Cache, encoding: Encoding.UTF8,
      });
      await Share.share({ title: 'Резервна копія КРОК', dialogTitle: 'Зберегти резервну копію', files: [uri] });
      return { status: 'shared' };
    }
    const blob = new Blob([text], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    try {
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      // Keep the object URL alive long enough for the browser's download handoff.
      setTimeout(() => URL.revokeObjectURL(url), 30_000);
    }
    return { status: 'downloaded' };
  } catch (error) {
    const message = String(error?.message ?? error ?? '');
    if (error?.name === 'AbortError' || /cancel(?:led|ed)?|dismiss(?:ed)?/i.test(message)) return { status: 'cancelled' };
    return { status: 'failed', error: 'Не вдалося експортувати копію. Спробуйте ще раз і перевірте вільне місце на пристрої.' };
  }
}
