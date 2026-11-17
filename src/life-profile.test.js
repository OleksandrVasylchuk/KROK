import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES } from './catalog.js';
import { LIFE_DOMAIN_IDS, emptyLifeProfile, normalizeLifeProfile, validateDailyPlan } from './life-profile.js';

const plan = () => ({ summary: 'Залиш трохи простору для себе.', insights: [{ category: 'body', observation: 'Тобі бракує часу на рух.', advice: 'Почни з короткої знайомої прогулянки.' }], quests: [{ title: 'Прогулянка поруч із домом', description: 'Обери зручний маршрут і свій темп.', category: 'body', minutes: 10 }] });

test('new intake covers all life domains, has no answers, and never assumes consent', () => {
  const value = emptyLifeProfile();
  assert.deepEqual(LIFE_DOMAIN_IDS, CATEGORIES.map(item => item.id));
  assert.deepEqual(Object.keys(value.domains), LIFE_DOMAIN_IDS);
  assert.equal(value.status, 'not_started'); assert.equal(value.dailyMinutes, 15); assert.equal(value.aiConsent, false);
  assert.ok(Object.values(value.domains).every(item => item.rating === 0 && !item.current && !item.desired && !item.obstacle));
  value.domains.body.current = 'Own draft';
  assert.equal(emptyLifeProfile().domains.body.current, '');
});

test('intake normalization allowlists fields, bounds text and never coerces consent', () => {
  const raw = { version: 9, status: 'completed', step: 99, dailyMinutes: '30', focus: ['body', 'body', 'bad', 'sleep', 'mind', 'career'], about: 'x'.repeat(1100), aiConsent: 'true', secret: 'private', domains: { body: { rating: 6, current: 'a'.repeat(550), desired: '  Спокій  ', obstacle: '', secret: 'private' }, bogus: { rating: 5 } } };
  const value = normalizeLifeProfile(raw);
  assert.equal(value.version, 1); assert.equal(value.step, 0); assert.equal(value.dailyMinutes, 15);
  assert.deepEqual(value.focus, ['body', 'sleep', 'mind']); assert.equal(value.about.length, 1000);
  assert.equal(value.domains.body.current.length, 500); assert.equal(value.domains.body.desired, 'Спокій'); assert.equal(value.domains.body.rating, 0);
  assert.ok(!('secret' in value)); assert.ok(!('secret' in value.domains.body)); assert.ok(!('bogus' in value.domains));
  for (const consent of [undefined, null, 1, 'true', {}, []]) assert.equal(normalizeLifeProfile({ aiConsent: consent }).aiConsent, false);
  assert.equal(normalizeLifeProfile({ aiConsent: true }).aiConsent, true);
  assert.deepEqual(normalizeLifeProfile(null), emptyLifeProfile());
});

test('AI plan validator trims valid content and optionally enforces the chosen daily time', () => {
  const value = plan(); value.summary = ` ${value.summary} `;
  assert.equal(validateDailyPlan(value).summary, value.summary.trim());
  assert.ok(validateDailyPlan(value, { profile: { dailyMinutes: 10 } }));
  assert.equal(validateDailyPlan(value, { profile: { dailyMinutes: 5 } }), null);
  assert.equal(validateDailyPlan(value, { profile: { dailyMinutes: '10' } }), null);
  const extra = { title: 'Пауза без екрана', description: 'Відклади телефон.', category: 'mind', minutes: 6 };
  assert.equal(validateDailyPlan({ ...plan(), quests: [...plan().quests, extra] }, { profile: { dailyMinutes: 15 } }), null);
});

test('malformed AI content cannot silently become quests or supply rewards', () => {
  const corruptions = [
    value => { value.extra = 'unexpected'; }, value => { value.summary = ''; }, value => { value.summary = 'x'.repeat(801); },
    value => { value.insights = []; }, value => { value.insights.push({ ...value.insights[0] }); }, value => { value.insights[0].category = 'unknown'; },
    value => { value.insights[0].observation = ' '; }, value => { value.insights[0].advice = 'x'.repeat(501); }, value => { value.insights[0].extra = true; },
    value => { value.quests = []; }, value => { value.quests = Array.from({ length: 6 }, (_, i) => ({ ...value.quests[0], title: `Крок ${i}` })); },
    value => { value.quests[0].xp = 99999; }, value => { value.quests[0].description = ''; }, value => { value.quests[0].title = 'x'.repeat(101); },
    value => { value.quests[0].minutes = 1.5; }, value => { value.quests[0].minutes = 61; }, value => { value.quests[0].minutes = 0; },
    value => { value.quests[0].category = 'bogus'; }, value => { value.quests[0].title = 'bad\u0000title'; },
    value => { value.quests.push({ ...value.quests[0], title: ` ${value.quests[0].title.toUpperCase()} ` }); },
  ];
  for (const corrupt of corruptions) { const value = plan(); corrupt(value); assert.equal(validateDailyPlan(value), null); }
});
