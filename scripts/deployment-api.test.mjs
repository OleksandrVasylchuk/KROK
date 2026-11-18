import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { betaUserAllowed, createDeploymentApi, deploymentPolicy } from './deployment-api.mjs';

const USER = { id: '11111111-1111-4111-8111-111111111111', email: 'tester@example.test', is_anonymous: false, email_confirmed_at: '2026-01-01T12:00:00Z' };
const ENV = { KROK_ALLOWED_ORIGINS: 'https://krok.example.test', SUPABASE_URL: 'https://qa-project.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_qa_public_test_key_123456', KROK_AI_ALLOWED_EMAILS: 'tester@example.test', OPENAI_API_KEY: 'sk-synthetic-deployment-test-key' };
const TOKEN = 'Bearer qa.token.12345678901234567890';
const MESSAGE = { messages: [{ role: 'user', text: 'Порадь невеликий крок.' }], tone: 'supportive' };
const completion = () => new Response(JSON.stringify({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Почни з однієї короткої прогулянки.' }] }] }));

async function fixture(t, { env = {}, user = USER, authStatus = 200, upstream, rpc } = {}) {
  const calls = [];
  const handler = createDeploymentApi({ env: { ...ENV, ...env }, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (url.endsWith('/auth/v1/user')) return new Response(JSON.stringify(user), { status: authStatus });
    if (rpc && url.startsWith(`${ENV.SUPABASE_URL}/rest/v1/rpc/`)) return rpc(url.slice(`${ENV.SUPABASE_URL}/rest/v1/rpc/`.length), options);
    assert.equal(url, 'https://api.openai.com/v1/responses');
    return upstream ? upstream(options) : completion();
  } });
  const server = http.createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  function request({ path = '/api/coach', method = 'POST', headers = {}, raw, body = MESSAGE } = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request({ hostname: '127.0.0.1', port, path, method, headers: { Host: 'krok.example.test', Origin: 'https://krok.example.test', 'Content-Type': 'application/json', Authorization: TOKEN, ...headers } }, res => {
        const chunks = [];
        res.on('data', chunk => chunks.push(chunk));
        res.on('end', () => { const text = Buffer.concat(chunks).toString(); resolve({ status: res.statusCode, headers: res.headers, text, data: text ? JSON.parse(text) : null }); });
      });
      req.on('error', reject);
      req.end(['GET', 'OPTIONS'].includes(method) ? undefined : raw ?? JSON.stringify(body));
    });
  }
  return { request, port, calls, providerCalls: () => calls.filter(call => call.url.includes('api.openai.com')), usageCalls: () => calls.filter(call => call.url.includes('/rest/v1/')) };
}
const USAGE = { input_tokens: 640, output_tokens: 48, total_tokens: 688 };
const completionWithUsage = () => new Response(JSON.stringify({ status: 'completed', usage: USAGE, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Почни з однієї короткої прогулянки.' }] }] }));
const usageRpc = (reserve = { allowed: true, user_requests_today: 1, user_daily_requests: 40 }, settle = { recorded: true }) => name => new Response(JSON.stringify(name === 'krok_ai_reserve' ? reserve : settle));

test('deployment origins come only from exact trusted HTTPS configuration', () => {
  const policy = deploymentPolicy({ KROK_ALLOWED_ORIGINS: 'https://KROK.example.test/, https://other.example.test', VERCEL_URL: 'krok-build-team.vercel.app', VERCEL_PROJECT_PRODUCTION_URL: 'krok.example.test' });
  assert.deepEqual(policy.allowedHosts, ['krok.example.test', 'other.example.test', 'krok-build-team.vercel.app']);
  assert.deepEqual(policy.allowedOrigins, ['https://krok.example.test', 'https://other.example.test', 'https://krok-build-team.vercel.app']);
  for (const value of ['http://krok.example.test', 'https://*.vercel.app', 'https://good.test/path', 'https://good.test/?x=1', 'https://user:pass@good.test', 'https://good.test/#hash', 'https://good.test,']) assert.throws(() => deploymentPolicy({ KROK_ALLOWED_ORIGINS: value }));
  for (const value of ['https://krok.vercel.app', 'krok.vercel.app/path', 'good.test@evil.test', 'good.test..evil.test']) assert.throws(() => deploymentPolicy({ VERCEL_URL: value }));
  assert.throws(() => deploymentPolicy({}));
});

test('beta access requires exact server-verified confirmed email and nonanonymous user', () => {
  assert.equal(betaUserAllowed(USER, ENV), true);
  assert.equal(betaUserAllowed({ ...USER, email: 'TESTER@example.test' }, { KROK_AI_ALLOWED_EMAILS: 'second@example.test, Tester@example.test ' }), true);
  for (const user of [{ ...USER, email: 'not-tester@example.test' }, { ...USER, is_anonymous: true }, { ...USER, is_anonymous: undefined }, { ...USER, email_confirmed_at: null }, { ...USER, email_confirmed_at: 'invalid' }]) assert.equal(betaUserAllowed(user, ENV), false);
  assert.equal(betaUserAllowed(USER, {}), false);
  assert.equal(betaUserAllowed(USER, { KROK_AI_ALLOWED_EMAILS: '*' }), false);
});

test('public configuration and status disclose no server key and make no provider call', async t => {
  const f = await fixture(t);
  const config = await f.request({ path: '/api/auth/config', method: 'GET', headers: { Authorization: '' } });
  assert.equal(config.status, 200);
  assert.deepEqual(config.data, { configured: true, supabaseUrl: ENV.SUPABASE_URL, publishableKey: ENV.SUPABASE_PUBLISHABLE_KEY, googleEnabled: false });
  const status = await f.request({ path: '/api/coach/status', method: 'GET' });
  assert.equal(status.status, 200);
  assert.equal(status.data.configured, true);
  assert.equal(status.headers['cache-control'], 'no-store');
  assert.equal((config.text + status.text).includes(ENV.OPENAI_API_KEY), false);
  assert.equal(f.calls.length, 0);
});

test('missing or secret Supabase configuration fails closed despite a configured model key', async t => {
  for (const env of [{ SUPABASE_URL: '', SUPABASE_PUBLISHABLE_KEY: '' }, { SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never_use_as_public' }]) {
    const f = await fixture(t, { env });
    for (const path of ['/api/auth/config', '/api/coach', '/api/coach/plan', '/api/coach/actions']) {
      const result = await f.request({ path, method: path === '/api/auth/config' ? 'GET' : 'POST' });
      assert.equal(result.status, 503);
      assert.equal(result.data.error.code, 'auth_configuration_error');
    }
    assert.equal(f.calls.length, 0);
  }
});

test('paid routes reject missing tokens, expired sessions and non-beta users before model requests', async t => {
  const f = await fixture(t);
  for (const path of ['/api/coach', '/api/coach/plan', '/api/coach/actions']) assert.equal((await f.request({ path, headers: { Authorization: '' } })).status, 401);
  assert.equal(f.calls.length, 0);
  const expired = await fixture(t, { authStatus: 401 });
  assert.equal((await expired.request()).data.error.code, 'session_expired');
  assert.equal(expired.providerCalls().length, 0);
  for (const setup of [{ env: { KROK_AI_ALLOWED_EMAILS: '' } }, { user: { ...USER, email: 'other@example.test' } }, { user: { ...USER, email_confirmed_at: null } }]) {
    const denied = await fixture(t, setup);
    const result = await denied.request();
    assert.equal(result.status, 403);
    assert.equal(result.data.error.code, 'beta_access_required');
    assert.equal(denied.providerCalls().length, 0);
  }
});

test('untrusted hosts/origins and forwarded host spoofing are rejected before auth fetch', async t => {
  const f = await fixture(t);
  for (const headers of [{ Host: 'evil.test' }, { Origin: 'https://evil.test' }, { Host: 'other-team.vercel.app', 'X-Forwarded-Host': 'krok.example.test' }, { Origin: 'null' }]) {
    const response = await f.request({ headers });
    assert.equal(response.status, 403);
  }
  assert.equal(f.calls.length, 0);
});

test('Authorization preflight is accepted without login; unexpected headers/methods are denied', async t => {
  const f = await fixture(t);
  for (const path of ['/api/coach', '/api/coach/plan', '/api/coach/actions']) {
    const response = await f.request({ path, method: 'OPTIONS', headers: { Authorization: '', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type, authorization' } });
    assert.equal(response.status, 204);
    assert.equal(response.headers['access-control-allow-origin'], 'https://krok.example.test');
    assert.match(response.headers['access-control-allow-headers'], /Authorization/);
  }
  for (const path of ['/api/coach', '/api/auth/config']) {
    const response = await f.request({ path, method: 'OPTIONS', headers: { 'Access-Control-Request-Headers': 'x-injected' } });
    assert.equal(response.status, 403);
  }
  assert.equal((await f.request({ method: 'OPTIONS', headers: { 'Access-Control-Request-Method': 'DELETE' } })).status, 403);
  assert.equal(f.calls.length, 0);
});

test('verified beta user reaches bounded raw JSON handler with the existing response contract', async t => {
  const f = await fixture(t);
  const response = await f.request();
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { text: 'Почни з однієї короткої прогулянки.', model: 'gpt-6-luna' });
  assert.equal(f.providerCalls().length, 1);
  const payload = JSON.parse(f.providerCalls()[0].options.body);
  assert.equal(payload.store, false);
  assert.equal(payload.max_output_tokens, 1200);
  assert.equal(response.text.includes(ENV.OPENAI_API_KEY), false);
  assert.equal((await f.request({ raw: '{broken' })).status, 400);
  assert.equal((await f.request({ raw: JSON.stringify({ text: 'x'.repeat(65536) }) })).status, 413);
  assert.equal(f.providerCalls().length, 1);
  assert.equal((await f.request({ path: '/api/unknown', method: 'GET' })).status, 404);
});

test('missing hosted model key has a public-facing error and never calls OpenAI', async t => {
  const f = await fixture(t, { env: { OPENAI_API_KEY: '' } });
  const response = await f.request();
  assert.equal(response.status, 503);
  assert.equal(response.data.error.code, 'not_configured');
  assert.equal(response.text.includes('SETUP-AI'), false);
  assert.equal(f.providerCalls().length, 0);
});

test('durable usage accounting stays off unless KROK_AI_USAGE is exactly enforce', async t => {
  for (const KROK_AI_USAGE of [undefined, '', 'true', '1', 'ENFORCE', 'enforce ', 'off']) {
    const f = await fixture(t, { env: { KROK_AI_USAGE }, upstream: completionWithUsage, rpc: usageRpc({ allowed: false, reason: 'paused' }) });
    const response = await f.request();
    assert.equal(response.status, 200);
    assert.deepEqual(response.data, { text: 'Почни з однієї короткої прогулянки.', model: 'gpt-6-luna' });
    assert.equal(f.usageCalls().length, 0);
    assert.equal(f.providerCalls().length, 1);
  }
});

test('enforced usage reserves with the caller token before the model call and settles provider usage', async t => {
  for (const [path, body, kind] of [['/api/coach', MESSAGE, 'chat'], ['/api/coach/actions', { ...MESSAGE, date: '2026-11-17', actionsConsent: false }, 'actions']]) {
    const f = await fixture(t, { env: { KROK_AI_USAGE: 'enforce' }, rpc: usageRpc(), upstream: () => path === '/api/coach' ? completionWithUsage()
      : new Response(JSON.stringify({ status: 'completed', usage: USAGE, output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: JSON.stringify({ text: 'Про яку звичку йдеться?', actions: [] }) }] }] })) });
    const response = await f.request({ path, body });
    assert.equal(response.status, 200);
    assert.deepEqual(f.calls.map(call => call.url), [`${ENV.SUPABASE_URL}/auth/v1/user`, `${ENV.SUPABASE_URL}/rest/v1/rpc/krok_ai_reserve`, 'https://api.openai.com/v1/responses', `${ENV.SUPABASE_URL}/rest/v1/rpc/krok_ai_settle`]);
    const [reserve, settle] = f.usageCalls();
    for (const call of [reserve, settle]) {
      assert.equal(call.options.method, 'POST');
      assert.equal(call.options.redirect, 'error');
      assert.deepEqual(call.options.headers, { apikey: ENV.SUPABASE_PUBLISHABLE_KEY, Authorization: TOKEN, 'Content-Type': 'application/json' });
      assert.equal(JSON.stringify(call.options).includes(ENV.OPENAI_API_KEY), false);
    }
    assert.deepEqual(JSON.parse(reserve.options.body), { p_kind: kind });
    assert.deepEqual(JSON.parse(settle.options.body), { p_input: 640, p_output: 48 });
    assert.equal(f.providerCalls()[0].options.headers.Authorization, `Bearer ${ENV.OPENAI_API_KEY}`);
    assert.equal(response.text.includes('qa.token'), false);
  }
});

test('enforced usage denials and storage failures never reach OpenAI', async t => {
  const denials = [['paused', 503, 'service_paused'], ['user_daily', 429, 'user_daily_limit'], ['user_monthly', 429, 'user_monthly_limit'], ['global_daily', 429, 'service_daily_limit'], ['global_monthly', 429, 'service_budget_reached'], ['global_budget', 429, 'service_budget_reached']];
  for (const [reason, status, code] of denials) {
    const f = await fixture(t, { env: { KROK_AI_USAGE: 'enforce' }, rpc: usageRpc({ allowed: false, reason }) });
    for (const path of ['/api/coach', '/api/coach/actions']) {
      const response = await f.request({ path, body: { ...MESSAGE, date: '2026-11-17', actionsConsent: false } });
      assert.equal(response.status, status);
      assert.equal(response.data.error.code, code);
    }
    assert.equal(f.usageCalls().length, 2);
    assert.equal(f.usageCalls().every(call => call.url.endsWith('/krok_ai_reserve')), true);
    assert.equal(f.providerCalls().length, 0);
  }
  for (const rpc of [
    () => new Response(JSON.stringify({ code: 'PGRST202', message: 'function not found' }), { status: 404 }),
    () => new Response(JSON.stringify({ message: 'JWT expired' }), { status: 401 }),
    () => new Response('upstream error', { status: 500 }),
    () => new Response('not json'),
    () => new Response(JSON.stringify({ allowed: false, reason: 'unknown' })),
    () => new Response(JSON.stringify({ allowed: 'true' })),
    () => { throw new Error('network'); },
  ]) {
    const f = await fixture(t, { env: { KROK_AI_USAGE: 'enforce' }, rpc });
    const response = await f.request();
    assert.equal(response.status, 503);
    assert.equal(response.data.error.code, 'usage_unavailable');
    assert.equal(f.usageCalls().length, 1);
    assert.equal(f.providerCalls().length, 0);
  }
});

test('enforced usage keeps the beta gate first and a failed settle keeps the reply', async t => {
  const outsider = await fixture(t, { env: { KROK_AI_USAGE: 'enforce' }, user: { ...USER, email: 'other@example.test' }, rpc: usageRpc() });
  assert.equal((await outsider.request()).data.error.code, 'beta_access_required');
  assert.equal(outsider.usageCalls().length + outsider.providerCalls().length, 0);
  const anonymous = await fixture(t, { env: { KROK_AI_USAGE: 'enforce' }, rpc: usageRpc() });
  assert.equal((await anonymous.request({ headers: { Authorization: '' } })).status, 401);
  assert.equal((await anonymous.request({ raw: '{broken' })).status, 400);
  assert.equal(anonymous.usageCalls().length + anonymous.providerCalls().length, 0);
  const unsettled = await fixture(t, { env: { KROK_AI_USAGE: 'enforce' }, upstream: completionWithUsage, rpc: name => name === 'krok_ai_reserve' ? new Response(JSON.stringify({ allowed: true })) : new Response('down', { status: 500 }) });
  const response = await unsettled.request();
  assert.equal(response.status, 200);
  assert.deepEqual(response.data, { text: 'Почни з однієї короткої прогулянки.', model: 'gpt-6-luna' });
  assert.equal(unsettled.usageCalls().length, 2);
  const broken = await fixture(t, { env: { KROK_AI_USAGE: 'enforce', SUPABASE_PUBLISHABLE_KEY: 'sb_secret_never_use_as_public' }, rpc: usageRpc() });
  assert.equal((await broken.request()).data.error.code, 'auth_configuration_error');
  assert.equal(broken.calls.length, 0);
});

test('client cancellation aborts an in-flight provider request without retrying', async t => {
  let notifyStarted, notifyAborted;
  const started = new Promise(resolve => { notifyStarted = resolve; });
  const aborted = new Promise(resolve => { notifyAborted = resolve; });
  const f = await fixture(t, { upstream: options => new Promise((resolve, reject) => {
    notifyStarted();
    options.signal.addEventListener('abort', () => { notifyAborted(); reject(new DOMException('Aborted', 'AbortError')); }, { once: true });
  }) });
  const req = http.request({ hostname: '127.0.0.1', port: f.port, path: '/api/coach', method: 'POST', headers: { Host: 'krok.example.test', 'Content-Type': 'application/json', Authorization: TOKEN } });
  req.on('error', () => {});
  req.end(JSON.stringify(MESSAGE));
  await started;
  req.destroy();
  await Promise.race([aborted, new Promise((_, reject) => { const timer = setTimeout(() => reject(new Error('Provider was not aborted')), 1500); timer.unref(); })]);
  assert.equal(f.providerCalls().length, 1);
});
