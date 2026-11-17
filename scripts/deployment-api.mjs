import { createAuthApi } from './auth-api.mjs';
import { createCoachApi } from './coach-api.mjs';
import { validateAuthConfig } from '../src/auth-core.js';

const ROUTES = new Set(['/api/auth/config', '/api/coach', '/api/coach/status', '/api/coach/plan', '/api/coach/actions']);

function exactOrigin(value) {
  if (typeof value !== 'string' || !value || value !== value.trim() || /[\s\\*]/.test(value)) throw new Error('Invalid deployment origin');
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error('Invalid deployment origin');
  return url.origin;
}

/** Trusted configuration only: never derive access from Host or forwarded headers. */
export function deploymentPolicy(env = process.env) {
  const origins = new Set();
  if (env.KROK_ALLOWED_ORIGINS) {
    for (const value of env.KROK_ALLOWED_ORIGINS.split(',')) origins.add(exactOrigin(value.trim()));
  }
  for (const name of ['VERCEL_URL', 'VERCEL_PROJECT_PRODUCTION_URL']) {
    const host = env[name];
    if (!host) continue;
    // These Vercel variables are hostnames without a protocol or path.
    if (!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/i.test(host) || host.includes('..')) throw new Error('Invalid deployment hostname');
    origins.add(exactOrigin(`https://${host}`));
  }
  if (!origins.size) throw new Error('Deployment origin is not configured');
  return { allowedOrigins: [...origins], allowedHosts: [...new Set([...origins].map(origin => new URL(origin).host))] };
}

/** Empty/invalid beta configuration grants no paid access. Email comes from verified Supabase user data. */
export function betaUserAllowed(user, env = process.env) {
  const emails = String(env.KROK_AI_ALLOWED_EMAILS || '').split(',').map(value => value.trim().toLowerCase()).filter(value => /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/.test(value));
  const email = typeof user?.email === 'string' ? user.email.trim().toLowerCase() : '';
  return user?.is_anonymous === false && typeof user?.email_confirmed_at === 'string'
    && Number.isFinite(Date.parse(user.email_confirmed_at)) && emails.includes(email);
}

function jsonError(res, status, code, message) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify({ error: { code, message } }));
}

/** Node runtime only. No local files/DPAPI, account data storage, or provider calls at module load. */
export function createDeploymentApi({ env = process.env, fetchImpl = globalThis.fetch, coachOptions = {} } = {}) {
  const policy = deploymentPolicy(env);
  const auth = createAuthApi({
    ...policy, requireAuth: true, fetchImpl,
    getConfig: async () => validateAuthConfig({ configured: true, supabaseUrl: env.SUPABASE_URL, publishableKey: env.SUPABASE_PUBLISHABLE_KEY, googleEnabled: env.KROK_GOOGLE_AUTH === 'true' }),
    allowUser: user => betaUserAllowed(user, env),
  });
  // These in-memory limits are per warm function instance, not distributed user quotas.
  const coach = createCoachApi({
    ...coachOptions, ...policy, fetchImpl, timeoutMs: 45000, hosted: true,
    model: env.OPENAI_MODEL || 'gpt-6-luna', getApiKey: async () => env.OPENAI_API_KEY?.trim() || '',
  });
  return async (req, res) => {
    try {
      if (await auth(req, res)) return;
      if (req.aborted || res.destroyed) return;
      if (await coach(req, res)) return;
      jsonError(res, 404, 'not_found', 'Такого запиту до КРОК немає.');
    } catch {
      jsonError(res, 503, 'service_unavailable', 'Сервіс КРОК тимчасово недоступний. Спробуй пізніше.');
    }
  };
}

let deployed;
/** Fixed route supplied by each entry file; query strings cannot select another operation. */
export function deploymentHandler(pathname) {
  if (!ROUTES.has(pathname)) throw new Error('Unknown deployment route');
  return async (req, res) => {
    const originalUrl = req.url;
    req.url = pathname;
    try {
      deployed ??= createDeploymentApi();
      await deployed(req, res);
    } catch {
      jsonError(res, 503, 'deployment_configuration_error', 'Налаштування сервера КРОК потребують перевірки.');
    } finally { req.url = originalUrl; }
  };
}
