import { CATEGORIES, localDate, selectStats } from './model.js';
import { LIFE_DOMAIN_IDS, normalizeLifeProfile, validateDailyPlan } from './life-profile.js';
import { buildCoachActionContext, validateCoachActions } from './coach-actions.js';
import { buildCoachPersonalContext } from './coach-personal.js';

export const COACH_MESSAGE_LIMIT = 6000;
export const COACH_HISTORY_LIMIT = 24;
export const COACH_HISTORY_CHAR_LIMIT = 28000;
export const EMULATOR_COACH_ORIGIN = 'http://10.0.2.2:5177';
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const number = value => Number.isFinite(value) && value >= 0 ? value : 0;

export class CoachError extends Error {
  constructor(code, message) { super(message); this.name = 'CoachError'; this.code = code; }
}

export function coachApiBase(isNative, override = '') {
  if (!override) return isNative ? EMULATOR_COACH_ORIGIN : '';
  try {
    const url = new URL(override);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) throw new Error();
    return url.origin;
  } catch {
    throw new CoachError('invalid_endpoint', 'Адреса сервера тренера має бути HTTPS-адресою без шляху та пароля.');
  }
}

// Only the OpenAI conversation is transmitted. Legacy and local demo messages
// stay on the device, and recent turns are bounded before leaving the client.
export function coachHistory(messages) {
  const result = [];
  let length = 0;
  for (const message of [...(messages || [])].reverse()) {
    if (message.source !== 'openai' || !['user', 'assistant'].includes(message.role)) continue;
    const text = clean(message.text, COACH_MESSAGE_LIMIT);
    if (!text) continue;
    if (result.length >= COACH_HISTORY_LIMIT || length + text.length > COACH_HISTORY_CHAR_LIMIT) break;
    result.unshift({ role: message.role, text });
    length += text.length;
  }
  // Start with a user turn when a long history was truncated between turns.
  while (result[0]?.role === 'assistant') result.shift();
  return result;
}

export function coachContext(state) {
  const stats = selectStats(state);
  const profile = state.profile || {};
  const coachPlan = profile.coachPlan || {};
  const hasCoachPlan = (coachPlan.priorities || []).length || coachPlan.desiredChange || coachPlan.obstacle || coachPlan.dailyTime || coachPlan.extra;
  return {
    profile: {
      name: clean(profile.name, 40), goal: clean(profile.goal, 250), focus: clean(profile.focus, 40), bio: clean(profile.bio, 300), occupation: clean(profile.occupation, 80),
      ...(hasCoachPlan ? { coachPlan: {
        priorities: (coachPlan.priorities || []).slice(0, 3).map(id => clean(CATEGORIES.find(item => item.id === id)?.shortLabel, 40)).filter(Boolean),
        desiredChange: clean(coachPlan.desiredChange, 300),
        obstacle: clean(coachPlan.obstacle, 300),
        dailyTime: clean(coachPlan.dailyTime, 20),
        extra: clean(coachPlan.extra, 300),
      } } : {}),
      ...(profile.coachContextConsent === true && profile.lifeProfile?.aiConsent === true
        ? { lifeProfile: normalizeLifeProfile(profile.lifeProfile) } : {}),
    },
    goals: (state.goals || []).filter(goal => goal.status !== 'completed').slice(0, 12).map(goal => ({ title: clean(goal.title, 100), current: number(goal.current), target: number(goal.target), unit: clean(goal.unit, 30) })),
    habits: (state.habits || []).filter(habit => !habit.archived).slice(0, 20).map(habit => ({ title: clean(habit.title, 100), target: number(habit.target), unit: clean(habit.unit, 30) })),
    progress: { totalXp: number(stats.totalXp), streak: number(stats.streak) },
  };
}

export function buildCoachPayload(state, messages = state.messages) {
  const history = coachHistory(messages);
  if (!history.length || history.at(-1).role !== 'user') throw new CoachError('empty_message', 'Спочатку напиши повідомлення тренеру.');
  return {
    messages: history,
    tone: ['supportive', 'buddy', 'direct'].includes(state.profile?.coachTone) ? state.profile.coachTone : 'supportive',
    ...(state.profile?.coachContextConsent === true ? { context: coachContext(state) } : {}),
  };
}

/** Speech is reviewed as ordinary text. Existing-record context needs its own opt-in. */
export function buildCoachActionPayload(state, messages = state.messages, date = localDate()) {
  const payload = { ...buildCoachPayload(state, messages), date, actionsConsent: state.profile?.coachActionsConsent === true };
  const timestamp = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date || date < '2000-01-01' || date > '2200-12-31') throw new CoachError('invalid_date', 'Для дій тренера потрібна правильна дата.');
  if (payload.actionsConsent) {
    const context = buildCoachActionContext(state, date);
    const latest = payload.messages.at(-1).text.toLocaleLowerCase('uk');
    const rank = item => {
      const title = item.title.toLocaleLowerCase('uk');
      return (latest.includes(title) ? 100 : 0) + title.split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 2 && latest.includes(word)).length;
    };
    const prioritize = (items, limit) => [...items].sort((a, b) => rank(b) - rank(a)).slice(0, limit);
    payload.actionContext = { ...context, quests: prioritize(context.quests, 40), habits: prioritize(context.habits, 20), goals: prioritize(context.goals, 20) };
  }
  if (state.profile?.coachMemoryConsent === true || state.profile?.coachJournalConsent === true) payload.personalContext = buildCoachPersonalContext(state,date);
  const bytes = () => new TextEncoder().encode(JSON.stringify(payload)).length;
  // Keep the latest request and prefer named records when a long history needs trimming.
  while (bytes() > 64 * 1024 && payload.messages.length > 1) {
    payload.messages.shift();
    while (payload.messages[0]?.role === 'assistant') payload.messages.shift();
  }
  while (bytes() > 64 * 1024 && payload.actionContext) {
    const key = ['quests', 'habits', 'goals'].sort((a, b) => payload.actionContext[b].length - payload.actionContext[a].length)[0];
    if (payload.actionContext[key].length <= 5) break;
    payload.actionContext[key].pop();
  }
  if (bytes() > 64 * 1024) throw new CoachError('body_too_large', 'Повідомлення разом із дозволеним контекстом завелике. Скороти повідомлення або найдовші відповіді анкети.');
  return payload;
}

const filledDomains = profile => LIFE_DOMAIN_IDS.filter(id => {
  const domain = profile.domains[id];
  return domain.rating > 0 || domain.current || domain.desired || domain.obstacle;
});

function checkPlanConsent(payload) {
  if (payload?.consent !== true || payload?.assessment?.aiConsent !== true) {
    throw new CoachError('consent_required', 'Дозволь передати анкету ШІ, щоб отримати персональний план.');
  }
}

/** Explicitly shared questionnaire plus small progress summaries; never raw journals, photos or transactions. */
export function buildDailyPlanPayload(state, date = localDate()) {
  if (state.profile?.lifeProfile?.aiConsent !== true) throw new CoachError('consent_required', 'Дозволь передати анкету ШІ, щоб отримати персональний план.');
  const assessment = normalizeLifeProfile(state.profile.lifeProfile);
  if (!filledDomains(assessment).length) throw new CoachError('assessment_required', 'Заповни хоча б одну сферу життя перед створенням плану.');
  const timestamp = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) ? Date.parse(`${date}T12:00:00Z`) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== date) throw new CoachError('invalid_date', 'Для плану потрібна правильна дата.');
  const categoryCounts = Object.fromEntries(LIFE_DOMAIN_IDS.map(id => [id, 0]));
  const questMap = new Map((state.quests || []).map(quest => [quest.id, quest]));
  let completed = 0;
  let totalMinutes = 0;
  for (const [day, ids] of Object.entries(state.completions || {})) {
    const age = timestamp - Date.parse(`${day}T12:00:00Z`);
    if (!Number.isFinite(age) || age < 0 || age > 6 * 86400000 || !Array.isArray(ids)) continue;
    for (const id of new Set(ids)) {
      const quest = questMap.get(id);
      if (!quest || !LIFE_DOMAIN_IDS.includes(quest.category)) continue;
      completed += 1;
      totalMinutes += Math.min(60, number(quest.minutes));
      categoryCounts[quest.category] += 1;
    }
  }
  const entries = (items, field, limit) => (items || []).filter(item => field === 'goals' ? item.status !== 'completed' : !item.archived).slice(0, limit).map(item => ({
    title: clean(item.title, 100),
    ...(LIFE_DOMAIN_IDS.includes(item.category) ? { category: item.category } : {}),
    ...(field === 'goals' ? { current: Math.min(1e12, number(item.current)) } : {}),
    target: Math.min(1e12, number(item.target)), unit: clean(item.unit, 30),
  })).filter(item => item.title);
  const payload = {
    assessment,
    profile: { name: clean(state.profile.name, 40), goal: clean(state.profile.goal, 250) },
    progress: {
      goals: entries(state.goals, 'goals', 12), habits: entries(state.habits, 'habits', 20),
      recentQuests: { days: 7, completed, totalMinutes, byCategory: LIFE_DOMAIN_IDS.map(category => ({ category, completed: categoryCounts[category] })) },
    },
    date,
    tone: ['supportive', 'buddy', 'direct'].includes(state.profile.coachTone) ? state.profile.coachTone : 'supportive',
    consent: true,
    ...((state.profile?.coachMemoryConsent === true || state.profile?.coachJournalConsent === true) ? { personalContext: buildCoachPersonalContext(state,date) } : {}),
  };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 64 * 1024) throw new CoachError('body_too_large', 'Анкета завелика для одного запиту. Скороти найдовші відповіді.');
  return payload;
}

async function loadRuntime() {
  const { Capacitor, CapacitorHttp } = await import('@capacitor/core');
  return { isNative: Capacitor.isNativePlatform(), http: CapacitorHttp, fetch: globalThis.fetch?.bind(globalThis) };
}

export function createCoachClient(runtimeSource = loadRuntime, { baseUrl = import.meta.env?.VITE_COACH_API_BASE_URL || '', timeoutMs = 55000, accessTokenSource = runtimeSource === loadRuntime ? async () => (await import('./auth-client.js')).getAccessToken() : async () => null } = {}) {
  let runtimePromise;
  const runtime = () => runtimePromise ||= Promise.resolve().then(() => typeof runtimeSource === 'function' ? runtimeSource() : runtimeSource);

  async function request(path, payload, { signal } = {}) {
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const env = await runtime();
    if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
    const url = `${coachApiBase(env.isNative, baseUrl)}/api/coach${path}`;
    const controller = new AbortController();
    let timer;
    let rejectInterrupted;
    const interrupted = new Promise((_, reject) => { rejectInterrupted = reject; });
    const abort = () => { controller.abort(); rejectInterrupted(new DOMException('Aborted', 'AbortError')); };
    signal?.addEventListener('abort', abort, { once: true });
    timer = setTimeout(() => {
      rejectInterrupted(new CoachError('timeout', 'Тренер не встиг відповісти. Спробуй ще раз.'));
      controller.abort();
    }, timeoutMs);
    try {
      const headers = { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json' } : {}) };
      const operation = async () => {
        const accessToken = await accessTokenSource();
        if (controller.signal.aborted) throw new DOMException('Aborted','AbortError');
        if (typeof accessToken === 'string' && accessToken) headers.Authorization = `Bearer ${accessToken}`;
        if (env.isNative) return env.http.request({ url, method: payload ? 'POST' : 'GET', headers, ...(payload ? { data: payload } : {}), responseType: 'json', connectTimeout: 10000, readTimeout: timeoutMs, disableRedirects: true });
        const response = await env.fetch(url, { method: payload ? 'POST' : 'GET', headers, ...(payload ? { body: JSON.stringify(payload) } : {}), signal: controller.signal, cache: 'no-store', credentials: 'omit', redirect: 'error' });
        let data;
        try { data = await response.json(); } catch { throw new CoachError('invalid_response', 'Сервер тренера повернув незрозумілу відповідь. Перевір, чи запущено START.cmd.'); }
        return { status: response.status, data };
      };
      const response = await Promise.race([operation(), interrupted]);
      let data = response.data;
      if (typeof data === 'string') { try { data = JSON.parse(data); } catch { data = null; } }
      if (response.status < 200 || response.status >= 300) {
        throw new CoachError(clean(data?.error?.code, 80) || 'server_error', clean(data?.error?.message, 400) || 'Сервер тренера зараз недоступний. Спробуй ще раз.');
      }
      if (!data || typeof data !== 'object') throw new CoachError('invalid_response', 'Сервер тренера повернув незрозумілу відповідь.');
      return data;
    } catch (error) {
      if (error instanceof CoachError || error.name === 'AbortError') throw error;
      throw new CoachError('connection_failed', 'Не вдалося зв’язатися із сервером КРОК. Перевір з’єднання та запусти START.cmd на комп’ютері.');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    }
  }

  return {
    async status(options) {
      const data = await request('/status', null, options);
      if (data.provider !== 'openai' || typeof data.configured !== 'boolean') throw new CoachError('invalid_response', 'Сервер не повернув статус OpenAI. Перезапусти КРОК через START.cmd.');
      return { provider: 'openai', configured: data.configured, model: clean(data.model, 100) };
    },
    async send(payload, options) {
      const data = await request('', payload, options);
      const text = clean(data.text, COACH_MESSAGE_LIMIT);
      if (!text) throw new CoachError('empty_response', 'OpenAI повернув порожню відповідь. Спробуй ще раз.');
      return { text, model: clean(data.model, 100) };
    },
    async plan(payload, options) {
      checkPlanConsent(payload);
      const data = await request('/plan', payload, options);
      const assessment = normalizeLifeProfile(payload.assessment);
      const plan = validateDailyPlan(data.plan, { profile: assessment });
      const filled = filledDomains(assessment);
      if (!plan || plan.insights.length !== filled.length || plan.insights.some(item => !filled.includes(item.category))) {
        throw new CoachError('invalid_plan', 'План ШІ не відповідає анкеті або доступному часу. Спробуй ще раз.');
      }
      return { plan, model: clean(data.model, 100) };
    },
    async act(payload, options) {
      if (payload?.actionsConsent !== true && payload?.actionContext !== undefined) throw new CoachError('action_context_consent_required', 'Для передачі наявних записів потрібна окрема згода.');
      const data = await request('/actions', payload, options);
      const checked = validateCoachActions({ text: data.text, actions: data.actions }, { date: payload.date, context: payload.actionsConsent === true ? payload.actionContext : undefined, personalContext: payload.personalContext });
      if (!checked.ok) throw new CoachError('invalid_actions', 'Не вдалося перевірити запропоновані зміни. Уточни запит або спробуй ще раз.');
      return { ...checked.value, model: clean(data.model, 100) };
    },
  };
}

export const coachClient = createCoachClient();
