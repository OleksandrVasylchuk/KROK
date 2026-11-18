import { STORAGE_KEY } from './model.js';
import { SyncError, createCloudSync, createSupabaseRemote } from './cloud-sync.js';
import { getAuthClient, getAuthSnapshot } from './auth-client.js';

const ACCOUNT_PREFIX = `${STORAGE_KEY}:account:`;
export const isAccountScope = scopeKey => typeof scopeKey === 'string' && scopeKey.startsWith(ACCOUNT_PREFIX);

async function loadPlatform() {
  const { Capacitor } = await import('@capacitor/core');
  if (!Capacitor.isNativePlatform()) return { native: false, label: 'Браузер' };
  return { native: true, label: Capacitor.getPlatform() === 'android' ? 'Android' : 'Застосунок', preferences: (await import('@capacitor/preferences')).Preferences };
}

/** Sync for the storage scope of one signed-in account on this device. */
export function createAccountSync(scopeKey, platformSource = loadPlatform) {
  if (!isAccountScope(scopeKey)) throw new Error('Синхронізація доступна лише для акаунта.');
  const key = 'krok-sync-v1:' + encodeURIComponent(scopeKey);
  let platformPromise;
  const platform = () => platformPromise ||= platformSource();
  const store = {
    async read() {
      const env = await platform();
      const raw = env.native ? (await env.preferences.get({ key })).value : globalThis.localStorage.getItem(key);
      try { return raw ? JSON.parse(raw) : null; } catch { return null; }
    },
    async write(meta) {
      const env = await platform(), value = JSON.stringify(meta);
      if (env.native) await env.preferences.set({ key, value }); else globalThis.localStorage.setItem(key, value);
    },
  };
  // Bind every call to the account that owns this scope; a stale call after an account switch is refused.
  const adapter = () => {
    const user = getAuthSnapshot().user;
    if (!user || !scopeKey.toLowerCase().endsWith(':' + user.id.toLowerCase())) throw new SyncError('auth', 'Сесія акаунта завершилась. Увійди ще раз, щоб продовжити синхронізацію.');
    return createSupabaseRemote(getAuthClient(), user.id);
  };
  const remote = {
    pull: async () => adapter().pull(),
    push: async (expected, payload) => adapter().push(expected, payload, (await platform()).label),
    remove: async () => adapter().remove(),
  };
  return createCloudSync({ remote, store });
}
