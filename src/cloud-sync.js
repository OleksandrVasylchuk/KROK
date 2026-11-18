import { createInitialState } from './model.js';
import { validateBackup } from './persistence.js';

export const SYNC_TABLE = 'krok_profiles';
export const SYNC_MAX_BYTES = 3_500_000;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);

export class SyncError extends Error {
  constructor(code, message) { super(message); this.name = 'SyncError'; this.code = code; }
}
const MESSAGES = {
  offline: 'Немає з’єднання. Записи збережено на пристрої й буде надіслано пізніше.',
  auth: 'Сесія акаунта завершилась. Увійди ще раз, щоб продовжити синхронізацію.',
  unavailable: 'Синхронізація ще не налаштована на сервері. Записи залишаються на цьому пристрої.',
  too_large: 'Записів забагато для одного збереження в хмарі. Синхронізацію призупинено; локальні дані не змінено.',
  invalid_remote: 'Хмарну копію не вдалося прочитати на цьому пристрої. Локальні записи не змінено. Онови застосунок або повтори пізніше.',
  busy: 'Записи змінюються на іншому пристрої. Спробуй синхронізувати ще раз за хвилину.',
  error: 'Не вдалося синхронізувати записи. Локальні дані збережено; спробуй ще раз.',
};
const failure = cause => {
  const code = cause instanceof SyncError && Object.hasOwn(MESSAGES, cause.code) ? cause.code : typeof cause === 'string' && Object.hasOwn(MESSAGES, cause) ? cause : 'error';
  return { status: code, message: MESSAGES[code] };
};

/** The uploaded photo is the largest and most personal field; it stays on the device that added it. */
export function syncPayload(state) {
  return { ...state, profile: { ...state.profile, avatar: '' } };
}

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (object(value)) return `{${Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value) ?? 'null';
}

/** Order-independent fingerprint: equal records give the same value on every device. */
export function stateHash(value) {
  const source = canonical(value);
  let a = 0x811c9dc5, b = 0x9e3779b9, c = 0x85ebca6b, d = 0xc2b2ae35;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193); b = Math.imul(b ^ code, 0x85ebca6b);
    c = Math.imul(c ^ code, 0xc2b2ae35); d = Math.imul(d ^ code, 0x27d4eb2f);
  }
  return [a, b, c, d].map(part => (part >>> 0).toString(16).padStart(8, '0')).join('') + ':' + source.length;
}

/** True only for a profile nobody has used yet, so replacing it cannot lose a record. */
export function isPristine(state) {
  try {
    const fresh = validateBackup(JSON.stringify(createInitialState(state.createdAt)));
    return stateHash(syncPayload(validateBackup(JSON.stringify(state)))) === stateHash(syncPayload(fresh));
  } catch { return false; }
}

export function summarizeState(state) {
  const count = value => Array.isArray(value) ? value.length : 0;
  return {
    quests: (state.quests || []).filter(item => !item.archived).length,
    habits: (state.habits || []).filter(item => !item.archived).length,
    goals: count(state.goals), expenses: count(state.expenses), messages: count(state.messages),
    journalDays: Object.keys(state.checkIns || {}).length,
    completions: Object.values(state.completions || {}).reduce((total, ids) => total + count(ids), 0),
  };
}

export function normalizeSyncMeta(value) {
  const meta = object(value) ? value : {};
  const revision = Number.isSafeInteger(meta.revision) && meta.revision > 0 ? meta.revision : 0;
  return {
    version: 1, enabled: meta.enabled === true, revision,
    hash: revision && typeof meta.hash === 'string' && meta.hash.length <= 80 ? meta.hash : '',
    syncedAt: typeof meta.syncedAt === 'string' && Number.isFinite(Date.parse(meta.syncedAt)) ? new Date(meta.syncedAt).toISOString() : '',
  };
}

/**
 * Whole-profile replication guarded by a server revision. It never merges two
 * edited copies: the person chooses which one to keep.
 * `remote`: pull() -> {revision,state,updatedAt,device}|null, push(expected,payload,device) -> {revision,updatedAt}|{conflict:true}, remove().
 * `store`: read() -> meta, write(meta).
 */
export function createCloudSync({ remote, store, device = '', validate = validateBackup }) {
  let queue = Promise.resolve();
  const serial = action => { const next = queue.then(action, action); queue = next.catch(() => {}); return next; };
  const readMeta = async () => normalizeSyncMeta(await store.read());
  const writeMeta = meta => store.write(normalizeSyncMeta(meta));
  const incomingState = (remoteState, local) => {
    const restored = validate(JSON.stringify(remoteState));
    return { ...restored, profile: { ...restored.profile, avatar: local?.profile?.avatar || '' } };
  };
  const synced = (meta, pushed) => ({ status: 'synced', pushed, revision: meta.revision, at: meta.syncedAt });

  async function reconcile(local, pristine) {
    const meta = await readMeta();
    if (!meta.enabled) return { status: 'disabled' };
    const payload = syncPayload(local), hash = stateHash(payload);
    if (new TextEncoder().encode(JSON.stringify(payload)).length > SYNC_MAX_BYTES) return failure('too_large');
    let current = await remote.pull();
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!current) {
        if (meta.revision > 0) {
          // Another device removed the cloud copy on purpose; do not silently upload it again.
          await writeMeta({ enabled: false });
          return { status: 'removed', message: 'Хмарну копію видалено з іншого пристрою. Синхронізацію тут вимкнено; записи на цьому пристрої збережено.' };
        }
        const pushed = await remote.push(0, payload, device);
        if (pushed.conflict) { current = await remote.pull(); continue; }
        const next = normalizeSyncMeta({ enabled: true, revision: pushed.revision, hash, syncedAt: pushed.updatedAt });
        await writeMeta(next);
        return synced(next, true);
      }
      if (current.revision === meta.revision) {
        if (hash === meta.hash) return synced(meta, false);
        const pushed = await remote.push(meta.revision, payload, device);
        if (pushed.conflict) { current = await remote.pull(); continue; }
        const next = normalizeSyncMeta({ enabled: true, revision: pushed.revision, hash, syncedAt: pushed.updatedAt });
        await writeMeta(next);
        return synced(next, true);
      }
      let incoming;
      try { incoming = incomingState(current.state, local); }
      catch { return failure('invalid_remote'); }
      const about = { revision: current.revision, updatedAt: current.updatedAt, device: current.device };
      if (stateHash(syncPayload(incoming)) === hash) {
        const next = normalizeSyncMeta({ enabled: true, revision: current.revision, hash, syncedAt: current.updatedAt });
        await writeMeta(next);
        return synced(next, false);
      }
      if (meta.revision > 0 ? hash === meta.hash : (pristine ?? isPristine(local))) return { status: 'adopt', state: incoming, ...about };
      return { status: 'conflict', remote: { ...about, summary: summarizeState(incoming) }, local: { summary: summarizeState(local) } };
    }
    return failure('busy');
  }

  const guarded = action => serial(async () => { try { return await action(); } catch (cause) { return failure(cause); } });

  return {
    status: () => serial(readMeta),
    /** Explicit, per-device opt-in. Nothing is uploaded before this call. */
    enable: () => serial(async () => { const meta = await readMeta(); await writeMeta({ ...meta, enabled: true }); return readMeta(); }),
    /** Stops replication from this device. The cloud copy and local records stay as they are. */
    disable: () => serial(async () => { const meta = await readMeta(); await writeMeta({ ...meta, enabled: false }); return readMeta(); }),
    sync: (local, { pristine } = {}) => guarded(() => reconcile(local, pristine)),
    /** Call only after the adopted state has been written to this device. */
    confirmAdopt: (state, revision, updatedAt) => serial(async () => {
      const next = normalizeSyncMeta({ enabled: true, revision, hash: stateHash(syncPayload(state)), syncedAt: updatedAt });
      await writeMeta(next);
      return next;
    }),
    /** Conflict decision "keep this device": replaces the cloud copy the person has just reviewed. */
    keepLocal: (local, reviewedRevision) => guarded(async () => {
      const meta = await readMeta();
      if (!meta.enabled) return { status: 'disabled' };
      const payload = syncPayload(local), hash = stateHash(payload);
      if (new TextEncoder().encode(JSON.stringify(payload)).length > SYNC_MAX_BYTES) return failure('too_large');
      const pushed = await remote.push(reviewedRevision, payload, device);
      if (pushed.conflict) return failure('busy');
      const next = normalizeSyncMeta({ enabled: true, revision: pushed.revision, hash, syncedAt: pushed.updatedAt });
      await writeMeta(next);
      return synced(next, true);
    }),
    /** Conflict decision "take the cloud copy": returns it for the caller to write, then confirmAdopt. */
    takeRemote: local => guarded(async () => {
      const meta = await readMeta();
      if (!meta.enabled) return { status: 'disabled' };
      const current = await remote.pull();
      if (!current) return failure('busy');
      let incoming;
      try { incoming = incomingState(current.state, local); }
      catch { return failure('invalid_remote'); }
      return { status: 'adopt', state: incoming, revision: current.revision, updatedAt: current.updatedAt, device: current.device };
    }),
    /** Deletes the cloud copy and turns replication off here. Local records are untouched. */
    removeCloudCopy: () => guarded(async () => {
      await remote.remove();
      await writeMeta({ enabled: false });
      return { status: 'disabled', removed: true };
    }),
  };
}

const text = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';

/** Maps supabase-js results to the engine contract. RLS limits every call to the signed-in user's own row. */
export function createSupabaseRemote(client, userId) {
  if (!client?.from || typeof userId !== 'string' || !/^[a-f0-9-]{36}$/i.test(userId)) throw new SyncError('auth', MESSAGES.auth);
  const table = () => client.from(SYNC_TABLE);
  const raise = (error, httpStatus) => {
    const code = String(error?.code || ''), status = Number(httpStatus) || 0, message = String(error?.message || '');
    if (['PGRST205', '42P01', 'PGRST202'].includes(code) || status === 404) throw new SyncError('unavailable', MESSAGES.unavailable);
    if (['PGRST301', 'PGRST302', '42501'].includes(code) || status === 401 || status === 403 || /jwt/i.test(message)) throw new SyncError('auth', MESSAGES.auth);
    if (code === '23514' || status === 413) throw new SyncError('too_large', MESSAGES.too_large);
    if (!code && (!status || /fetch|network|load failed/i.test(message))) throw new SyncError('offline', MESSAGES.offline);
    throw new SyncError('error', MESSAGES.error);
  };
  const run = async request => {
    let result;
    try { result = await request; } catch { throw new SyncError('offline', MESSAGES.offline); }
    return result;
  };
  const row = data => {
    if (!object(data) || !Number.isSafeInteger(Number(data.revision)) || Number(data.revision) < 1) throw new SyncError('error', MESSAGES.error);
    return { revision: Number(data.revision), updatedAt: text(data.updated_at, 40), device: text(data.device, 80) };
  };
  return {
    async pull() {
      const { data, error, status } = await run(table().select('revision,state,updated_at,device').eq('user_id', userId).maybeSingle());
      if (error) raise(error, status);
      if (!data) return null;
      if (!object(data.state)) throw new SyncError('error', MESSAGES.error);
      return { ...row(data), state: data.state };
    },
    async push(expected, payload, device) {
      if (expected === 0) {
        const { data, error, status } = await run(table().insert({ user_id: userId, revision: 1, state: payload, device: text(device, 80) }).select('revision,updated_at,device').maybeSingle());
        if (error?.code === '23505') return { conflict: true };
        if (error) raise(error, status);
        return data ? row(data) : { conflict: true };
      }
      const { data, error, status } = await run(table().update({ revision: expected + 1, state: payload, device: text(device, 80) }).eq('user_id', userId).eq('revision', expected).select('revision,updated_at,device'));
      if (error) raise(error, status);
      return Array.isArray(data) && data.length === 1 ? row(data[0]) : { conflict: true };
    },
    async remove() {
      const { error, status } = await run(table().delete().eq('user_id', userId));
      if (error) raise(error, status);
    },
  };
}
