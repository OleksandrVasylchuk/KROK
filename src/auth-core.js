export const NATIVE_AUTH_REDIRECT = 'app.krok.mobile://auth/callback';
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
export function validateAuthConfig(raw) {
  if (!raw?.configured) return { configured: false };
  let url;
  try { url = new URL(raw.supabaseUrl); } catch { throw new Error('Некоректне налаштування сервісу акаунтів.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('Сервіс акаунтів має використовувати HTTPS.');
  const key = raw.publishableKey;
  // Only new publishable keys are accepted. Secret/service-role keys must never reach a client.
  if (typeof key !== 'string' || !/^sb_publishable_[a-zA-Z0-9_-]{16,200}$/.test(key)) throw new Error('Потрібен публічний publishable key Supabase.');
  return { configured: true, supabaseUrl: url.origin, publishableKey: key, googleEnabled: raw.googleEnabled === true };
}
export function accountScope(config, user) {
  if (!user) return 'local';
  if (!config?.configured || !UUID.test(user.id)) throw new Error('Не вдалося визначити акаунт.');
  return `${new URL(config.supabaseUrl).hostname}:${user.id.toLowerCase()}`;
}
export function accountStorageKey(scope, localKey = 'krok-state-v1') {
  if (scope === 'local') return localKey;
  if (typeof scope !== 'string' || !/^[a-z0-9.-]+:[a-f0-9-]{36}$/i.test(scope)) throw new Error('Некоректна область збереження.');
  return `${localKey}:account:${scope}`;
}
export function validateCredentials(email, password, { signup = false } = {}) {
  const normalized = String(email || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized) || normalized.length > 254) throw new Error('Введи коректну електронну пошту.');
  if (password !== undefined && (typeof password !== 'string' || password.length > 128 || password.length < (signup ? 10 : 1))) throw new Error(signup ? 'Пароль має містити від 10 до 128 символів.' : 'Введи пароль.');
  return { email: normalized, ...(password !== undefined ? { password } : {}) };
}
export function authError(error) {
  const code = String(error?.code || '');
  if (['invalid_credentials','email_not_confirmed'].includes(code)) return code === 'email_not_confirmed' ? 'Підтверди пошту за посиланням у листі, а потім увійди.' : 'Не вдалося увійти. Перевір пошту й пароль.';
  if (code.includes('rate_limit') || error?.status === 429) return 'Забагато спроб. Зачекай трохи й повтори.';
  if (code === 'weak_password') return 'Обери надійніший пароль.';
  if (['provider_disabled','validation_failed'].includes(code)) return 'Цей спосіб входу ще не налаштовано. Спробуй вхід поштою.';
  return 'Сервіс акаунтів не виконав запит. Перевір з’єднання й спробуй ще раз.';
}
export function isAuthCallback(value, redirect) {
  try { const url = new URL(value), target = new URL(redirect); return url.protocol === target.protocol && url.host === target.host && url.pathname === target.pathname && (url.searchParams.has('code') || url.searchParams.has('error')); } catch { return false; }
}

/** Pure orchestration around the official SDK; runtime/browser and SDK are injected for tests. */
export function createAuthController({ client, config, runtime, onChange = () => {} }) {
  let current = { phase: 'ready', configured: true, user: null, scope: 'local', recovery: false, googleEnabled: config.googleEnabled };
  const seenCodes = new Set();
  let alive = true;
  const publish = (session, event) => {
    if (!alive) return;
    const user = session?.user && UUID.test(session.user.id) ? { id: session.user.id, email: String(session.user.email || '').slice(0,254) } : null;
    current = { ...current, user, scope: accountScope(config,user), recovery: event === 'PASSWORD_RECOVERY' || (event === 'TOKEN_REFRESHED' && current.recovery) };
    onChange(current);
  };
  const unwrap = async request => { const result = await request; if (result.error) throw new Error(authError(result.error)); return result.data; };
  const redirect = runtime.native ? NATIVE_AUTH_REDIRECT : `${runtime.origin}/?auth=callback`;
  const subscription = client.auth.onAuthStateChange((event, session) => { if(event!=='INITIAL_SESSION')publish(session,event); });
  async function callback(url) {
    if (!isAuthCallback(url,redirect)) return false;
    const parsed = new URL(url);
    if (parsed.searchParams.has('error')) {if(!runtime.native)runtime.clearCallback?.();else await runtime.closeBrowser?.();throw new Error('Вхід скасовано або не дозволено. Спробуй ще раз.');}
    const code = parsed.searchParams.get('code');
    if (!code || code.length > 2048 || seenCodes.has(code)) return false;
    seenCodes.add(code);
    try { const data = await unwrap(client.auth.exchangeCodeForSession(code)); publish(data?.session, data?.redirectType === 'recovery' ? 'PASSWORD_RECOVERY' : 'SIGNED_IN'); }
    finally { if (!runtime.native) runtime.clearCallback?.(); else await runtime.closeBrowser?.(); }
    return true;
  }
  return {
    snapshot: () => current,
    async initialize() { const data = await unwrap(client.auth.getSession()); if (runtime.url && isAuthCallback(runtime.url,redirect)) await callback(runtime.url); else publish(data?.session,'INITIAL_SESSION'); return current; },
    callback,
    async signIn(email,password) { const data = await unwrap(client.auth.signInWithPassword(validateCredentials(email,password))); publish(data?.session,'SIGNED_IN'); },
    async signUp(email,password) { const data = await unwrap(client.auth.signUp({ ...validateCredentials(email,password,{signup:true}), options: { emailRedirectTo: redirect } })); if (data?.session) publish(data.session,'SIGNED_IN'); return { confirmationRequired: !data?.session }; },
    async reset(email) { await unwrap(client.auth.resetPasswordForEmail(validateCredentials(email).email,{ redirectTo: redirect })); },
    async updatePassword(password) { validateCredentials(current.user?.email || 'account@example.test',password,{signup:true}); if (!current.user || !current.recovery) throw new Error('Відкрий посилання відновлення з листа.'); await unwrap(client.auth.updateUser({password})); current={...current,recovery:false};onChange(current); },
    async google() { if (!config.googleEnabled) throw new Error('Вхід через Google ще не налаштовано.'); const data=await unwrap(client.auth.signInWithOAuth({provider:'google',options:{redirectTo:redirect,skipBrowserRedirect:true}})); const url=new URL(data?.url); if(url.origin!==config.supabaseUrl||!url.pathname.startsWith('/auth/v1/authorize')) throw new Error('Некоректна адреса входу.'); await runtime.openBrowser(url.href); },
    async signOut() { await unwrap(client.auth.signOut({scope:'local'})); publish(null,'SIGNED_OUT'); },
    async token() { const data=await unwrap(client.auth.getSession()); return data?.session?.access_token || null; },
    dispose() { alive=false;subscription?.data?.subscription?.unsubscribe(); },
  };
}
