import test from 'node:test';
import assert from 'node:assert/strict';
import { createUsageGuard, MAX_INPUT_TOKENS, MAX_OUTPUT_TOKENS } from './ai-usage.mjs';

const CONFIG = { configured: true, supabaseUrl: 'https://qa-project.supabase.co', publishableKey: 'sb_publishable_qa_public_test_key_123456' };
const TOKEN = 'Bearer qa.token.12345678901234567890';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function fixture(respond = () => json({ allowed: true, user_requests_today: 1, user_daily_requests: 40 }), options = {}) {
  const calls = [];
  const guard = createUsageGuard({ getConfig: async () => CONFIG, fetchImpl: async (url, init) => { calls.push({ url, init }); return respond(url, init); }, ...options });
  return { guard, calls };
}

test('reserve calls the definer RPC with the public key and the caller token only', async () => {
  for (const kind of ['chat', 'plan', 'actions']) {
    const { guard, calls } = fixture();
    assert.deepEqual(await guard.reserve(TOKEN, kind), { allowed: true });
    assert.equal(calls.length, 1);
    const { url, init } = calls[0];
    assert.equal(url, 'https://qa-project.supabase.co/rest/v1/rpc/krok_ai_reserve');
    assert.equal(init.method, 'POST');
    assert.equal(init.redirect, 'error');
    assert.ok(init.signal instanceof AbortSignal);
    assert.deepEqual(init.headers, { apikey: CONFIG.publishableKey, Authorization: TOKEN, 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(init.body), { p_kind: kind });
  }
});

test('every denial reason is returned as a decision without extra fields', async () => {
  for (const reason of ['paused', 'user_daily', 'user_monthly', 'global_daily', 'global_monthly', 'global_budget']) {
    const { guard } = fixture(() => json({ allowed: false, reason, internal: 'not forwarded' }));
    assert.deepEqual(await guard.reserve(TOKEN, 'chat'), { allowed: false, reason });
  }
});

test('transport failures, error statuses and malformed or unknown replies throw so callers fail closed', async () => {
  const cases = [
    () => { throw new Error(`network ${TOKEN}`); },
    () => json({ message: 'permission denied' }, 401),
    () => json({ code: 'PGRST202' }, 404),
    () => json({ allowed: true }, 500),
    () => new Response('not json'),
    () => json(null),
    () => json([{ allowed: true }]),
    () => json('allowed'),
    () => json({}),
    () => json({ allowed: 'true' }),
    () => json({ allowed: 1 }),
    () => json({ allowed: false }),
    () => json({ allowed: false, reason: 'something_new' }),
    () => json({ allowed: false, reason: 'constructor' }),
    () => undefined,
  ];
  for (const respond of cases) {
    const { guard, calls } = fixture(respond);
    await assert.rejects(guard.reserve(TOKEN, 'chat'), error => !error.message.includes('qa.token') && !error.message.includes(CONFIG.publishableKey));
    assert.equal(calls.length, 1);
  }
});

test('timeout aborts the request and rejects even when the transport ignores the signal', async () => {
  let signal;
  const aborting = fixture((_url, init) => new Promise((_resolve, reject) => { signal = init.signal; init.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true }); }), { timeoutMs: 20 });
  await assert.rejects(aborting.guard.reserve(TOKEN, 'chat'));
  assert.equal(signal.aborted, true);
  const deaf = fixture(() => new Promise(() => {}), { timeoutMs: 20 });
  await assert.rejects(deaf.guard.reserve(TOKEN, 'chat'));
  const stalledBody = fixture(() => ({ ok: true, json: () => new Promise(() => {}) }), { timeoutMs: 20 });
  await assert.rejects(stalledBody.guard.reserve(TOKEN, 'chat'));
  assert.equal(await stalledBody.guard.settle(TOKEN, { input_tokens: 1, output_tokens: 1 }), false);
});

test('missing or malformed authorization, unknown kinds and broken configuration never reach the network', async () => {
  const { guard, calls } = fixture();
  for (const authorization of [undefined, null, '', 'Bearer short', 'Basic abcdefghijklmnopqrstuvwxyz', `${TOKEN}\r\nX-Injected: 1`, `${TOKEN} extra`, ['Bearer qa.token.12345678901234567890'], `bearer ${TOKEN.slice(7)}`]) {
    await assert.rejects(guard.reserve(authorization, 'chat'));
    assert.equal(await guard.settle(authorization, { input_tokens: 10, output_tokens: 5 }), false);
  }
  for (const kind of [undefined, '', 'image', 'CHAT', '__proto__']) await assert.rejects(guard.reserve(TOKEN, kind));
  assert.equal(calls.length, 0);
  for (const getConfig of [async () => ({ configured: false }), async () => null, async () => ({ configured: true, supabaseUrl: CONFIG.supabaseUrl }), async () => { throw new Error('broken'); }]) {
    const broken = createUsageGuard({ getConfig, fetchImpl: async () => { calls.push('network'); return json({ allowed: true }); } });
    await assert.rejects(broken.reserve(TOKEN, 'chat'));
    assert.equal(await broken.settle(TOKEN, { input_tokens: 1, output_tokens: 1 }), false);
  }
  assert.equal(calls.length, 0);
  assert.throws(() => createUsageGuard());
  assert.throws(() => createUsageGuard({ getConfig: async () => CONFIG, timeoutMs: 0 }));
});

test('settle sends clamped integer token counts and reports whether they were recorded', async () => {
  const cases = [
    [{ input_tokens: 1234, output_tokens: 321, total_tokens: 1555 }, { p_input: 1234, p_output: 321 }],
    [{ input_tokens: 10.9, output_tokens: 2.2 }, { p_input: 10, p_output: 2 }],
    [{ input_tokens: 1e12, output_tokens: 1e12 }, { p_input: MAX_INPUT_TOKENS, p_output: MAX_OUTPUT_TOKENS }],
    [{ input_tokens: -5, output_tokens: Number.NaN }, { p_input: 0, p_output: 0 }],
    [{ input_tokens: '700', output_tokens: Infinity }, { p_input: 0, p_output: 0 }],
    [{ input_tokens: null }, { p_input: 0, p_output: 0 }],
    [undefined, { p_input: 0, p_output: 0 }],
    [null, { p_input: 0, p_output: 0 }],
    ['usage', { p_input: 0, p_output: 0 }],
  ];
  assert.equal(MAX_INPUT_TOKENS, 60000);
  assert.equal(MAX_OUTPUT_TOKENS, 4000);
  for (const [usage, expected] of cases) {
    const { guard, calls } = fixture(() => json({ recorded: true }));
    assert.equal(await guard.settle(TOKEN, usage), true);
    assert.equal(calls[0].url, 'https://qa-project.supabase.co/rest/v1/rpc/krok_ai_settle');
    assert.equal(calls[0].init.redirect, 'error');
    assert.deepEqual(calls[0].init.headers, { apikey: CONFIG.publishableKey, Authorization: TOKEN, 'Content-Type': 'application/json' });
    assert.deepEqual(JSON.parse(calls[0].init.body), expected);
  }
});

test('settle never throws and returns false for any failure or unrecorded reply', async () => {
  for (const respond of [
    () => { throw new Error('network'); },
    () => json({ recorded: true }, 500),
    () => json({ recorded: false }),
    () => json({ recorded: 'true' }),
    () => json(null),
    () => new Response('not json'),
    () => undefined,
  ]) {
    const { guard } = fixture(respond);
    assert.equal(await guard.settle(TOKEN, { input_tokens: 10, output_tokens: 5 }), false);
  }
});
