import { CATEGORIES } from './catalog.js';

export const LIFE_DOMAIN_IDS = Object.freeze(CATEGORIES.map(category => category.id));
const domainIds = new Set(LIFE_DOMAIN_IDS);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const integer = (value, min, max, fallback) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;

export function emptyLifeProfile() {
  return {
    version: 1, status: 'not_started', step: 0, dailyMinutes: 15, focus: [], about: '', aiConsent: false,
    domains: Object.fromEntries(LIFE_DOMAIN_IDS.map(id => [id, { rating: 0, current: '', desired: '', obstacle: '' }])),
  };
}

/** Allowlist the intake fields; normalization never infers consent from truthy values. */
export function normalizeLifeProfile(value) {
  const initial = emptyLifeProfile();
  if (!object(value)) return initial;
  return {
    version: 1,
    status: ['not_started', 'in_progress', 'completed', 'skipped'].includes(value.status) ? value.status : 'not_started',
    step: integer(value.step, 0, 11, 0),
    dailyMinutes: integer(value.dailyMinutes, 5, 120, 15),
    focus: Array.isArray(value.focus) ? [...new Set(value.focus.filter(id => domainIds.has(id)))].slice(0, 3) : [],
    about: text(value.about, 1000),
    aiConsent: value.aiConsent === true,
    domains: Object.fromEntries(LIFE_DOMAIN_IDS.map(id => {
      const entry = object(value.domains) && Object.hasOwn(value.domains, id) && object(value.domains[id]) ? value.domains[id] : {};
      return [id, { rating: integer(entry.rating, 0, 5, 0), current: text(entry.current, 500), desired: text(entry.desired, 500), obstacle: text(entry.obstacle, 500) }];
    })),
  };
}

const hasExactKeys = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const requiredText = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);

/** Validate provider output without repairing missing fields, granting XP, or accepting extras. */
export function validateDailyPlan(value, { profile } = {}) {
  if (!hasExactKeys(value, ['summary', 'insights', 'quests']) || !requiredText(value.summary, 800)
    || !Array.isArray(value.insights) || value.insights.length < 1 || value.insights.length > LIFE_DOMAIN_IDS.length
    || !Array.isArray(value.quests) || value.quests.length < 1 || value.quests.length > 5) return null;
  const seenCategories = new Set();
  const insights = [];
  for (const insight of value.insights) {
    if (!hasExactKeys(insight, ['category', 'observation', 'advice']) || !domainIds.has(insight.category)
      || seenCategories.has(insight.category) || !requiredText(insight.observation, 500) || !requiredText(insight.advice, 500)) return null;
    seenCategories.add(insight.category);
    insights.push({ category: insight.category, observation: insight.observation.trim(), advice: insight.advice.trim() });
  }
  const seenTitles = new Set();
  const quests = [];
  for (const quest of value.quests) {
    if (!hasExactKeys(quest, ['title', 'description', 'category', 'minutes']) || !requiredText(quest.title, 100)
      || !requiredText(quest.description, 400) || !domainIds.has(quest.category) || !integer(quest.minutes, 1, 60, 0)) return null;
    const title = quest.title.trim();
    const identity = title.normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ');
    if (seenTitles.has(identity)) return null;
    seenTitles.add(identity);
    quests.push({ title, description: quest.description.trim(), category: quest.category, minutes: quest.minutes });
  }
  if (profile !== undefined) {
    if (!object(profile) || !integer(profile.dailyMinutes, 5, 120, 0) || quests.reduce((sum, quest) => sum + quest.minutes, 0) > profile.dailyMinutes) return null;
  }
  return { summary: value.summary.trim(), insights, quests };
}
