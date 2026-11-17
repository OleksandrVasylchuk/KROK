import { isQuestDue, isHabitDue, localDate } from './model.js';
import { parseReminderTime } from './reminders.js';

export const PLAN_REMINDER_SOURCE = 'krok-plan-v1';
export const PLAN_REMINDER_CHANNEL = 'krok-plan-v1';
export const MAX_PLAN_REMINDERS = 64;
export const DEFAULT_PLAN_SETTINGS = { version: 1, enabled: false, questTime: '18:00', morning: '09:00', day: '14:00', evening: '20:00', any: '18:00', quietStart: '22:00', quietEnd: '08:00', items: {}, snoozes: {} };
export class PlanReminderError extends Error { constructor(code, message) { super(message); this.name = 'PlanReminderError'; this.code = code; } }
const fail = (code, message) => { throw new PlanReminderError(code, message); };
const object = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const minutes = time => { const { hour, minute } = parseReminderTime(time); return hour * 60 + minute; };
export const inQuietHours = (time, settings) => {
  const value = minutes(time), start = minutes(settings.quietStart), end = minutes(settings.quietEnd);
  return start !== end && (start < end ? value >= start && value < end : value >= start || value < end);
};
function validScope(scope) { if (typeof scope !== 'string' || !scope.trim() || scope.length > 180 || /[\x00-\x1f]/.test(scope)) fail('scope', 'Не вдалося визначити профіль для нагадувань.'); return scope; }
export function normalizePlanSettings(value = {}) {
  if (!object(value)) value = {};
  const settings = { ...DEFAULT_PLAN_SETTINGS, ...value, version: 1, enabled: value.enabled === true, items: {}, snoozes: {} };
  for (const key of ['questTime','morning','day','evening','any','quietStart','quietEnd']) { settings[key] = value[key] ?? DEFAULT_PLAN_SETTINGS[key]; minutes(settings[key]); }
  for (const key of ['questTime','morning','day','evening','any']) if (inQuietHours(settings[key], settings)) fail('quiet_time', 'Час справ має бути поза тихими годинами.');
  if (object(value.items)) for (const [key, item] of Object.entries(value.items).slice(0, 300)) {
    if (!/^(quest|habit):.{1,180}$/.test(key) || !object(item)) continue;
    const time = item.time || '';
    if (time) { minutes(time); if (inQuietHours(time, settings)) fail('quiet_time', 'Індивідуальний час справи потрапляє в тихі години.'); }
    settings.items[key] = { disabled: item.disabled === true, time };
  }
  if (object(value.snoozes)) for (const [key, time] of Object.entries(value.snoozes).slice(0, 300)) {
    if (!/^(quest|habit):.{1,180}:\d{4}-\d{2}-\d{2}$/.test(key) || typeof time !== 'string' || !Number.isFinite(new Date(time).getTime())) continue;
    settings.snoozes[key] = new Date(time).toISOString();
  }
  return settings;
}
function outsideQuiet(date, settings) {
  const result = new Date(date);
  const time = String(result.getHours()).padStart(2,'0') + ':' + String(result.getMinutes()).padStart(2,'0');
  if (!inQuietHours(time, settings)) return result;
  const start = minutes(settings.quietStart), end = minutes(settings.quietEnd), current = minutes(time);
  if (start > end && current >= start) result.setDate(result.getDate() + 1);
  const { hour, minute } = parseReminderTime(settings.quietEnd); result.setHours(hour, minute, 0, 0);
  return result;
}
function notificationId(text, used) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) hash = Math.imul(hash ^ text.charCodeAt(i), 16777619) >>> 0;
  let id = 1000000000 + hash % 1000000000;
  while (used.has(id)) id = id === 1999999999 ? 1000000000 : id + 1;
  used.add(id); return id;
}
export function buildPlanReminders(state, scope, values, { now = new Date(), reservedIds = [] } = {}) {
  validScope(scope); const settings = normalizePlanSettings(values), candidates = [], seen = new Set();
  if (!Number.isFinite(now.getTime())) fail('date', 'Не вдалося визначити поточний час.');
  const start = new Date(now); start.setHours(0,0,0,0);
  for (let offset = 0; offset < 7; offset++) {
    const day = new Date(start); day.setDate(day.getDate() + offset); const date = localDate(day);
    for (const kind of ['quest','habit']) for (const item of (kind === 'quest' ? state.quests : state.habits) || []) {
      const itemKey = kind + ':' + item.id, override = settings.items[itemKey];
      if (override?.disabled || item.archived || !(kind === 'quest' ? isQuestDue(item, date) : isHabitDue(item, date))) continue;
      if (kind === 'quest' && ((state.completions?.[date] || []).includes(item.id) || (item.frequency === 'once' && Object.values(state.completions || {}).some(ids => ids.includes(item.id))))) continue;
      if (kind === 'habit' && (state.habitLogs?.[date]?.[item.id] || 0) >= item.target) continue;
      if (item.createdAt && item.createdAt > date) continue;
      const { hour, minute } = parseReminderTime(override?.time || (kind === 'quest' ? settings.questTime : settings[item.timeOfDay] || settings.any));
      let at = new Date(day); at.setHours(hour, minute, 0, 0);
      const key = itemKey + ':' + date;
      if (seen.has(key)) continue;
      seen.add(key);
      if (settings.snoozes[key]) at = outsideQuiet(new Date(settings.snoozes[key]), settings);
      if (at.getTime() <= now.getTime()) continue;
      candidates.push({ key, kind, itemId: item.id, date, at, title: item.title });
    }
  }
  candidates.sort((a,b) => a.at - b.at || a.key.localeCompare(b.key));
  const used = new Set(reservedIds);
  const notifications = candidates.slice(0, MAX_PLAN_REMINDERS).map(item => ({
    id: notificationId(scope + ':' + item.key, used), title: item.kind === 'quest' ? 'Твій квест у КРОК' : 'Маленька звичка — твій КРОК', body: item.title,
    channelId: PLAN_REMINDER_CHANNEL, schedule: { at: item.at, repeats: false, allowWhileIdle: false }, isExactNotification: false, isExactMandatory: false, autoCancel: true,
    extra: { source: PLAN_REMINDER_SOURCE, ownerScope: scope, destination: item.kind === 'quest' ? 'quests' : 'habits', kind: item.kind, itemId: item.itemId, occurrenceDate: item.date, key: item.key },
  }));
  return { notifications, total: candidates.length, omitted: Math.max(0,candidates.length - notifications.length), until: localDate(new Date(start.getFullYear(),start.getMonth(),start.getDate()+6)) };
}
async function defaultRuntime() {
  const { Capacitor } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) return { native: true, platform: Capacitor.getPlatform(), preferences: (await import('@capacitor/preferences')).Preferences, notifications: Capacitor.getPlatform() === 'android' ? (await import('@capacitor/local-notifications')).LocalNotifications : null };
  let storage; try { storage = globalThis.localStorage; } catch { storage = null; }
  return { native: false, platform: 'web', storage };
}
const owned = item => item.extra?.source === PLAN_REMINDER_SOURCE;
const sameScope = (item, scope) => owned(item) && item.extra.ownerScope === scope;
const matches = (actual, expected) => actual?.id === expected.id && actual.body === expected.body && actual.extra?.key === expected.extra.key && actual.extra?.ownerScope === expected.extra.ownerScope && new Date(actual.schedule?.at).getTime() === expected.schedule.at.getTime();

export function createPlanReminderService(runtimeSource = defaultRuntime, clock = () => new Date()) {
  let runtimePromise, queue = Promise.resolve(), epoch = 0, activeScope = null;
  const runtime = () => runtimePromise ||= Promise.resolve().then(() => typeof runtimeSource === 'function' ? runtimeSource() : runtimeSource);
  const serial = action => { const next = queue.then(action, action); queue = next.catch(() => {}); return next; };
  const supported = env => env.native && env.platform === 'android' && env.notifications;
  const key = scope => 'krok-plan-reminders-v1:' + encodeURIComponent(validScope(scope));
  const read = async (env, scope) => {
    const raw = env.native ? (await env.preferences.get({ key: key(scope) })).value : env.storage?.getItem(key(scope));
    if (!env.native && !env.storage) fail('storage', 'Налаштування нагадувань не вдалося прочитати.');
    if (!raw) return normalizePlanSettings();
    try { return normalizePlanSettings(JSON.parse(raw)); } catch { fail('settings', 'Налаштування нагадувань пошкоджені. Вимкни їх і збережи нові.'); }
  };
  const write = async (env, scope, settings) => {
    const value = JSON.stringify(normalizePlanSettings(settings));
    if (env.native) await env.preferences.set({ key: key(scope), value });
    else { if (!env.storage) fail('storage', 'Налаштування не вдалося зберегти.'); env.storage.setItem(key(scope), value); }
  };
  async function cancelWhere(env, predicate) {
    if (!supported(env)) return;
    const pending = (await env.notifications.getPending()).notifications || [];
    const targets = pending.filter(predicate).map(item => ({ id: item.id }));
    if (targets.length) {
      await env.notifications.cancel({ notifications: targets });
      const again = (await env.notifications.getPending()).notifications || [];
      if (again.some(predicate)) fail('not_cancelled', 'Android ще показує попередні нагадування. Повтори вимкнення.');
    }
    if (env.notifications.getDeliveredNotifications && env.notifications.removeDeliveredNotifications) {
      const delivered = (await env.notifications.getDeliveredNotifications()).notifications || [];
      const selected = delivered.filter(predicate);
      if (selected.length) await env.notifications.removeDeliveredNotifications({ notifications: selected });
    }
  }
  async function inspect(env, scope, state, settings) {
    settings ||= await read(env, scope);
    const plan = buildPlanReminders(state || { quests: [], habits: [] }, scope, settings, { now: clock() });
    if (!supported(env)) return { supported: false, enabled: false, savedEnabled: settings.enabled, permission: 'unavailable', settings, pending: 0, ...plan };
    const permission = await env.notifications.checkPermissions();
    const pending = (await env.notifications.getPending()).notifications || [];
    const channels = env.notifications.listChannels ? (await env.notifications.listChannels()).channels || [] : [];
    const blocked = channels.some(channel => channel.id === PLAN_REMINDER_CHANNEL && channel.importance === 0);
    return { supported: true, enabled: settings.enabled && permission.display === 'granted' && !blocked, savedEnabled: settings.enabled, permission: permission.display, blocked, settings, pending: pending.filter(item => sameScope(item, scope)).length, ...plan };
  }
  async function reconcile(env, state, scope, settings, token, requestPermission) {
    if (token !== epoch || activeScope !== scope) return { cancelled: true };
    if (!supported(env)) { if (requestPermission) await write(env,scope,{ ...settings, enabled: false }); return inspect(env,scope,state,{ ...settings, enabled: false }); }
    await cancelWhere(env, item => owned(item) && item.extra.ownerScope !== scope);
    if (token !== epoch) return { cancelled: true };
    if (!settings.enabled) { await cancelWhere(env,item=>sameScope(item,scope)); return inspect(env,scope,state,settings); }
    let permission = await env.notifications.checkPermissions();
    if (requestPermission && permission.display !== 'granted') permission = await env.notifications.requestPermissions();
    if (token !== epoch) return { cancelled: true };
    if (permission.display !== 'granted') {
      await cancelWhere(env,item=>sameScope(item,scope));
      if (requestPermission) fail('permission', 'Дозволь сповіщення для КРОК у налаштуваннях Android.');
      return inspect(env,scope,state,settings);
    }
    await env.notifications.createChannel({ id: PLAN_REMINDER_CHANNEL, name: 'Квести та звички КРОК', description: 'Нагадування про вибрані справи.', importance: 3, visibility: 0, vibration: true });
    if (env.notifications.listChannels && (await env.notifications.listChannels()).channels.some(channel=>channel.id===PLAN_REMINDER_CHANNEL && channel.importance===0)) fail('channel', 'Канал квестів і звичок вимкнений у налаштуваннях Android.');
    const pending = (await env.notifications.getPending()).notifications || [];
    const plan = buildPlanReminders(state,scope,settings,{ now:clock(), reservedIds:pending.filter(item=>!sameScope(item,scope)).map(item=>item.id) });
    const desired = new Map(plan.notifications.map(item=>[item.id,item]));
    await cancelWhere(env,item=>sameScope(item,scope) && !desired.has(item.id));
    if (token !== epoch) return { cancelled:true };
    const changed = plan.notifications.filter(item=>!matches(pending.find(old=>old.id===item.id),item));
    if (changed.length) {
      // Capacitor 8.3 may request permission from schedule(); re-check immediately before it.
      if ((await env.notifications.checkPermissions()).display !== 'granted') return inspect(env,scope,state,settings);
      if (token !== epoch) return { cancelled:true };
      await env.notifications.schedule({ notifications:changed });
    }
    if (token !== epoch) return { cancelled:true };
    const confirmed = (await env.notifications.getPending()).notifications || [];
    if (plan.notifications.some(item=>!matches(confirmed.find(old=>old.id===item.id),item))) fail('schedule_mismatch','Android не підтвердив новий розклад повністю. Повтори оновлення.');
    try { await write(env,scope,settings); } catch { fail('saved_schedule','Нагадування заплановані, але налаштування не збереглися. Перевір стан і повтори.'); }
    return inspect(env,scope,state,settings);
  }
  const service = {
    status: (scope,state) => serial(async()=>inspect(await runtime(),validScope(scope),state)),
    sync: (state,scope) => { validScope(scope); activeScope=scope; const token=++epoch; return serial(async()=>{const env=await runtime(); return reconcile(env,state,scope,await read(env,scope),token,false);}); },
    enable: (state,scope,values) => { validScope(scope); const settings=normalizePlanSettings({...values,enabled:true}); activeScope=scope; const token=++epoch; return serial(async()=>reconcile(await runtime(),state,scope,settings,token,true)); },
    disable: scope => { validScope(scope); ++epoch; return serial(async()=>{const env=await runtime(); let settings; try{settings=await read(env,scope);}catch{settings=normalizePlanSettings();} await cancelWhere(env,item=>sameScope(item,scope)); await write(env,scope,{...settings,enabled:false,snoozes:{}}); return inspect(env,scope,null,{...settings,enabled:false,snoozes:{}});}); },
    clearOwnedSchedules: () => { ++epoch; activeScope=null; return serial(async()=>cancelWhere(await runtime(),owned)); },
    snooze: (state,scope,kind,id,date,delay=30) => {
      validScope(scope); if(!['quest','habit'].includes(kind)||typeof id!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||delay!==30) fail('snooze','Невірна справа для перенесення.');
      activeScope=scope; const token=++epoch;
      return serial(async()=>{ const env=await runtime(), settings=await read(env,scope); if(!settings.enabled) fail('disabled','Спочатку ввімкни нагадування.');
        const plan=buildPlanReminders(state,scope,settings,{now:clock()}); const original=plan.notifications.find(item=>item.extra.key===`${kind}:${id}:${date}`); if(!original) fail('missing','Це нагадування вже неактуальне. Онови список.');
        const at=outsideQuiet(new Date(Math.max(clock().getTime(),original.schedule.at.getTime())+delay*60000),settings);
        settings.snoozes[`${kind}:${id}:${date}`]=at.toISOString(); return reconcile(env,state,scope,settings,token,false);
      });
    },
    listenNavigation: async (getActiveScope,callback) => {
      const env=await runtime(); if(!supported(env))return async()=>{};
      const handle=await env.notifications.addListener('localNotificationActionPerformed',event=>{
        const info=event.notification?.extra; if(!owned(event.notification||{})||info.ownerScope!==getActiveScope()||event.actionId==='dismiss'||!['quests','habits'].includes(info.destination))return;
        callback(info.destination,{kind:info.kind,id:info.itemId,date:info.occurrenceDate});
      }); return ()=>handle.remove();
    },
  };
  return service;
}
export const planReminders = createPlanReminderService();
