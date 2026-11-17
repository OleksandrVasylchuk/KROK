import { STORAGE_KEY } from './model.js';
import { createDemoState } from './demo.js';
import * as realPersistence from './persistence.js';
import { accountStorageKey } from './auth-core.js';

export const isDemo = new URLSearchParams(globalThis.location?.search || '').get('demo') === '1';
export let activeStorageKey = isDemo ? 'krok-demo-v3' : STORAGE_KEY;
export { exportBackup, validateBackup } from './persistence.js';

// A separate physical key guarantees a demo action cannot replace personal data.
export function scopedStorage(storage, key) {
  return { getItem: () => storage.getItem(key), setItem: (_ignored, value) => storage.setItem(key, value) };
}
export function scopedPreferences(preferences, key) {
  return { get: () => preferences.get({ key }), set: ({ value }) => preferences.set({ key, value }) };
}
let demoPersistence;
const accountAdapters = new Map();
const pendingWrites = new Map();
export async function flushPersistence() { await pendingWrites.get(activeStorageKey); }
function scopeWrite(key, operation) {
  const job=(async()=>{try{return await operation(await accountPersistence(key));}catch{return false;}})();
  pendingWrites.set(key,job);
  job.finally(()=>{if(pendingWrites.get(key)===job)pendingWrites.delete(key);});
  return job;
}
export function selectPersistenceScope(scope) {
  const next = isDemo ? 'krok-demo-v3' : accountStorageKey(scope, STORAGE_KEY);
  if(next!==activeStorageKey){accountAdapters.delete(activeStorageKey);accountAdapters.delete(next);}
  activeStorageKey = next;
  return activeStorageKey;
}
async function accountPersistence(key) {
  if (!accountAdapters.has(key)) accountAdapters.set(key, (async () => {
    const { Capacitor } = await import('@capacitor/core');
    const native = Capacitor.isNativePlatform();
    let storage;
    try { storage = scopedStorage(globalThis.localStorage, key); }
    catch { storage = { getItem() { throw new Error('Storage unavailable'); }, setItem() { throw new Error('Storage unavailable'); } }; }
    const preferences = native ? scopedPreferences((await import('@capacitor/preferences')).Preferences,key) : undefined;
    return realPersistence.createPersistence({native,storage,preferences});
  })());
  return accountAdapters.get(key);
}
async function getDemoPersistence() {
  if (!demoPersistence) demoPersistence = (async () => {
    const { Capacitor } = await import('@capacitor/core');
    const native = Capacitor.isNativePlatform();
    let storage;
    try { storage = scopedStorage(globalThis.localStorage, activeStorageKey); }
    catch { storage = { getItem() { throw new Error('Storage unavailable'); }, setItem() { throw new Error('Storage unavailable'); } }; }
    const preferences = native ? scopedPreferences((await import('@capacitor/preferences')).Preferences, activeStorageKey) : undefined;
    return realPersistence.createPersistence({ native, storage, preferences });
  })();
  return demoPersistence;
}
// Cache the entire bootstrap, including its initial seed. Repeated startup calls
// must never reseed an adapter whose cached initial source was "new".
export function createDemoInitializer(getPersistence) {
  let initialization;
  return () => {
    if (!initialization) initialization = (async () => {
      try {
        const persistence = await getPersistence();
        const boot = await persistence.initializePersistence();
        if (boot.blocked) return { ...boot, state: createDemoState(), warning: 'Демопрофіль відкрито без збереження. Попередні демозаписи й особисті дані не змінено.' };
        if (boot.source === 'new') {
          const state = createDemoState();
          const saved = await persistence.recoverPersistence(state);
          return { state, source: 'demo', blocked: !saved, warning: saved ? undefined : 'Демопрофіль відкрито, але його зміни не вдалося зберегти.' };
        }
        return boot;
      } catch { return { state: createDemoState(), blocked: true, warning: 'Демопрофіль відкрито без збереження. Особисті дані не змінено.' }; }
    })();
    return initialization;
  };
}
const initializeDemo = createDemoInitializer(getDemoPersistence);
export async function initializePersistence() {
  const key=activeStorageKey;
  if(!isDemo) return (await accountPersistence(key)).initializePersistence();
  return initializeDemo();
}
export async function persistState(state) {
  // Capture the scope before asynchronous IO. A queued old-account save can
  // finish only in that account, even while AccountBoundary changes identity.
  const key=activeStorageKey;
  if(!isDemo) return scopeWrite(key,adapter=>adapter.persistState(state));
  try { return await (await getDemoPersistence()).persistState(state); } catch { return false; }
}
export async function recoverPersistence(state) {
  const key=activeStorageKey;
  if(!isDemo) return scopeWrite(key,adapter=>adapter.recoverPersistence(state));
  try { return await (await getDemoPersistence()).recoverPersistence(state); } catch { return false; }
}
