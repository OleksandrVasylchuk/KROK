const BEARER = /^Bearer [A-Za-z0-9_.-]{20,8192}$/;
const KINDS = new Set(['chat', 'plan', 'actions']);
const REASONS = new Set(['paused', 'user_daily', 'user_monthly', 'global_daily', 'global_monthly', 'global_budget']);
// Same bounds as public.krok_ai_settle; the database clamps again.
export const MAX_INPUT_TOKENS = 60000;
export const MAX_OUTPUT_TOKENS = 4000;

function isObject(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function tokens(value, max) { return Number.isFinite(value) && value > 0 ? Math.min(Math.floor(value), max) : 0; }

/**
 * Durable per-user limits through Supabase SECURITY DEFINER functions, called with the
 * user's own verified bearer token. No service-role key. Errors never carry tokens or keys.
 */
export function createUsageGuard({ getConfig, fetchImpl = fetch, timeoutMs = 5000 } = {}) {
  if (typeof getConfig !== 'function') throw new Error('Usage guard requires the auth configuration.');
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Invalid usage guard timeout.');

  async function rpc(name, authorization, body) {
    if (typeof authorization !== 'string' || !BEARER.test(authorization)) throw new Error('Usage check needs a signed-in session.');
    let config;
    try { config = await getConfig(); } catch { throw new Error('Usage storage configuration is invalid.'); }
    if (config?.configured !== true || typeof config.supabaseUrl !== 'string' || typeof config.publishableKey !== 'string') throw new Error('Usage storage is not configured.');
    const controller = new AbortController();
    let timer;
    // The race also bounds an implementation that ignores the abort signal or stalls on the body.
    const timeout = new Promise((_resolve, reject) => { timer = setTimeout(() => { controller.abort(); reject(new Error('Usage storage timed out.')); }, timeoutMs); });
    const call = (async () => {
      let response;
      try {
        response = await fetchImpl(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
          method: 'POST', redirect: 'error', signal: controller.signal,
          headers: { apikey: config.publishableKey, Authorization: authorization, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
      } catch { throw new Error('Usage storage is unreachable.'); }
      if (!response?.ok) throw new Error('Usage storage rejected the request.');
      try { return await response.json(); } catch { throw new Error('Usage storage returned an unreadable reply.'); }
    })();
    call.catch(() => {});
    try { return await Promise.race([call, timeout]); } finally { clearTimeout(timer); }
  }

  return {
    /** Resolves to a decision; throws when no trustworthy decision exists, so callers fail closed. */
    async reserve(authorization, kind) {
      if (!KINDS.has(kind)) throw new Error('Unknown usage kind.');
      const result = await rpc('krok_ai_reserve', authorization, { p_kind: kind });
      if (isObject(result) && result.allowed === true) return { allowed: true };
      if (isObject(result) && result.allowed === false && REASONS.has(result.reason)) return { allowed: false, reason: result.reason };
      throw new Error('Usage storage returned an unexpected reply.');
    },
    /** Best-effort accounting from an OpenAI Responses `usage` object. Never throws. */
    async settle(authorization, usage) {
      try {
        const result = await rpc('krok_ai_settle', authorization, {
          p_input: tokens(usage?.input_tokens, MAX_INPUT_TOKENS), p_output: tokens(usage?.output_tokens, MAX_OUTPUT_TOKENS),
        });
        return isObject(result) && result.recorded === true;
      } catch { return false; }
    },
  };
}
