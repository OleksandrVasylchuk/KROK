import { CATEGORIES } from './catalog.js';

export const COACH_MEMORY_LIMIT = 50;
const categories = new Set(CATEGORIES.map(item => item.id));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const clean = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
export const validPersonalDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && value >= '2000-01-01' && value <= '2200-12-31' && Number.isFinite(Date.parse(`${value}T12:00:00Z`)) && new Date(`${value}T12:00:00Z`).toISOString().slice(0, 10) === value;
export const containsMemorySecret = value => /\bsk-(?:proj-|svcacct-)?[a-zA-Z0-9_-]{15,}|-----BEGIN [A-Z ]*PRIVATE KEY|(?:пароль|password|api[_ -]?key|секретний ключ)\s*[:=]\s*\S+/iu.test(value);

export function normalizeCoachMemory(value) {
  if (!object(value) || !id(value.id) || !categories.has(value.category) || typeof value.text !== 'string' || value.text.length > 300 || !value.text.trim() || /[\u0000-\u001f]/.test(value.text) || containsMemorySecret(value.text) || !validPersonalDate(value.updatedAt)) return null;
  return { id: value.id, text: value.text.trim(), category: value.category, updatedAt: value.updatedAt };
}

/** Independent opt-ins. The caller explicitly includes this result in an AI request. */
export function buildCoachPersonalContext(state, date) {
  if (!validPersonalDate(date)) throw new RangeError('Invalid personal context date');
  const memoryConsent = state.profile?.coachMemoryConsent === true;
  const journalConsent = state.profile?.coachJournalConsent === true;
  const context = { memoryConsent, journalConsent };
  if (memoryConsent) context.memory = (state.coachMemory || []).slice(0, COACH_MEMORY_LIMIT).map(normalizeCoachMemory).filter(Boolean);
  if (journalConsent) {
    const first = new Date(Date.parse(`${date}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
    context.checkIns = Object.entries(state.checkIns || {}).filter(([day]) => validPersonalDate(day) && day >= first && day <= date).sort(([a],[b])=>a.localeCompare(b)).slice(-7).map(([day, value]) => ({ date: day, mood: value.mood, energy: value.energy, note: clean(value.note, 500) }));
  }
  return context;
}

/** Strict independent privacy gate shared by API action and daily-plan handlers. */
export function validateCoachPersonalContext(body, date, fail) {
  if (!object(body)) return { memoryConsent: false, journalConsent: false };
  for (const field of ['memoryConsent','journalConsent']) if (body[field] !== undefined && typeof body[field] !== 'boolean') fail(400, 'invalid_personal_consent', 'Дозволи пам’яті та щоденника мають бути явно увімкнені або вимкнені.');
  const result = { memoryConsent: body.memoryConsent === true, journalConsent: body.journalConsent === true };
  if (!result.memoryConsent && body.memory !== undefined) fail(400, 'memory_consent_required', 'Для передачі пам’яті потрібен окремий дозвіл.');
  if (!result.journalConsent && body.checkIns !== undefined) fail(400, 'journal_consent_required', 'Для передачі щоденника потрібен окремий дозвіл.');
  if (result.memoryConsent) {
    if (!Array.isArray(body.memory) || body.memory.length > COACH_MEMORY_LIMIT) fail(400, 'invalid_memory', 'Не вдалося прочитати пам’ять тренера.');
    const seen = new Set();
    result.memory = body.memory.map(raw => {
      const item = normalizeCoachMemory(raw);
      if (!item || item.updatedAt > date || seen.has(item.id)) fail(400, 'invalid_memory', 'Пам’ять містить некоректний або повторний запис.');
      seen.add(item.id);
      return item;
    });
  }
  if (result.journalConsent) {
    const first = new Date(Date.parse(`${date}T12:00:00Z`) - 6 * 86400000).toISOString().slice(0, 10);
    if (!Array.isArray(body.checkIns) || body.checkIns.length > 7) fail(400, 'invalid_checkins', 'Для огляду доступні записи за останні сім днів.');
    const seen = new Set();
    result.checkIns = body.checkIns.map(item => {
      if (!object(item) || !validPersonalDate(item.date) || item.date < first || item.date > date || seen.has(item.date) || !Number.isInteger(item.mood) || item.mood < 1 || item.mood > 5 || !Number.isInteger(item.energy) || item.energy < 1 || item.energy > 5 || typeof item.note !== 'string' || item.note.length > 500) fail(400, 'invalid_checkins', 'Підсумок дня має некоректну дату або оцінки.');
      seen.add(item.date);
      return { date: item.date, mood: item.mood, energy: item.energy, note: item.note.trim() };
    });
  }
  return result;
}
