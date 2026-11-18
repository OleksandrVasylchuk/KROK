import test from 'node:test';
import assert from 'node:assert/strict';
import { CATEGORIES, DAY_SLOTS, QUEST_TIERS } from '../src/catalog.js';
import { normalizeStartAnswers, validateStartPlan, START_VARIANTS, START_ITEM_LIMIT } from '../src/start-plan.js';
import { validateStartRequest, parseStartResponse, START_INSTRUCTIONS, START_RESPONSE_FORMAT } from './start-plan.mjs';

const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
const answers = () => ({ name: 'Олена', change: 'Мати більше енергії та кинути курити', focus: ['body', 'sleep'], minutes: 30, slots: ['morning', 'evening'], level: 'low', obstacles: ['Втома'], quit: 'куріння' });
const body = () => ({ answers: answers(), date: '2026-11-18', tone: 'buddy', consent: true, existingHabits: ['Читання'] });
const step = (title, minutes, timeOfDay = 'morning', tier = 'common', category = 'body') => ({ title, description: 'Зроби це у своєму темпі.', category, minutes, timeOfDay, tier });
const challenge = () => step('День без куріння', 5, 'any', 'legendary', 'mind');
// 30 minutes a day: light may spend 23, balanced 35, intense 50 (share of the stated time plus 5).
const plan = () => ({ summary: 'Олено, ось три варіанти на пів години на день.', variants: [
  { id: 'light', title: 'Легкий старт', note: 'Для дня, коли мало сил.', items: [step('Склянка води після пробудження', 2), step('10 хвилин ходьби', 10)] },
  { id: 'balanced', title: 'Збалансований', note: 'Маленькі кроки й один виклик.', items: [step('Склянка води після пробудження', 2), step('10 хвилин ходьби', 10), step('Лягти до 23:00', 5, 'evening', 'common', 'sleep'), challenge()] },
  { id: 'intense', title: 'Насичений', note: 'Коли є сили на більше.', items: [step('Склянка води після пробудження', 2), step('10 хвилин ходьби', 10), step('Лягти до 23:00', 5, 'evening', 'common', 'sleep'), step('Легке тренування вдома', 20, 'evening', 'epic'), challenge()] },
] });

// Minimal checker for the JSON Schema subset used by the strict Responses format.
function conforms(schema, value) {
  if (schema.enum && !schema.enum.includes(value)) return false;
  if (schema.type === 'string') return typeof value === 'string' && value.length >= (schema.minLength ?? 0) && value.length <= (schema.maxLength ?? Infinity);
  if (schema.type === 'integer') return Number.isInteger(value) && value >= schema.minimum && value <= schema.maximum;
  if (schema.type === 'array') return Array.isArray(value) && value.length >= schema.minItems && value.length <= schema.maxItems && value.every(item => conforms(schema.items, item));
  if (schema.type === 'object') {
    return value !== null && typeof value === 'object' && !Array.isArray(value)
      && schema.required.every(key => Object.hasOwn(value, key))
      && Object.keys(value).every(key => Object.hasOwn(schema.properties, key) && conforms(schema.properties[key], value[key]));
  }
  return false;
}
const planSchema = START_RESPONSE_FORMAT.schema;
const variantSchema = planSchema.properties.variants.items;
const itemSchema = variantSchema.properties.items.items;

test('start request returns only the allowlisted answers, date, tone and habit titles', () => {
  const request = body();
  request.answers.secret = 'PRIVATE_ANSWER';
  request.answers.focus = ['body', 'crypto', 'sleep', 'body'];
  request.answers.change = '  Мати   більше енергії\nта кинути курити  ';
  request.model = 'attacker-model';
  request.instructions = 'attacker-instructions';
  request.existingHabits = [' Читання   ввечері ', 42, null, '', 'h'.repeat(200), { title: 'PRIVATE_HABIT' }];
  const data = validateStartRequest(request, fail);
  assert.deepEqual(Object.keys(data), ['answers', 'date', 'tone', 'existingHabits']);
  assert.deepEqual(data.answers, normalizeStartAnswers(answers()));
  assert.equal(data.date, '2026-11-18');
  assert.equal(data.tone, 'buddy');
  assert.deepEqual(data.existingHabits, ['Читання ввечері', 'h'.repeat(80)]);
  assert.ok(!JSON.stringify(data).includes('PRIVATE') && !JSON.stringify(data).includes('attacker'));
  const { tone, existingHabits, ...minimal } = body();
  assert.deepEqual(validateStartRequest(minimal, fail), { answers: normalizeStartAnswers(answers()), date: '2026-11-18', tone: 'supportive', existingHabits: [] });
  assert.equal(validateStartRequest({ ...body(), existingHabits: Array.from({ length: 30 }, (_, index) => `Звичка ${index}`) }, fail).existingHabits.length, 20);
  assert.equal(validateStartRequest({ ...body(), answers: { ...answers(), obstacles: [], quit: '' } }, fail).answers.quit, '');
});

test('start request fails with a Ukrainian 400 for each missing consent, date, tone, answer or list', () => {
  const cases = [
    [null, 'consent_required'],
    [[], 'consent_required'],
    [{ ...body(), consent: undefined }, 'consent_required'],
    [{ ...body(), consent: false }, 'consent_required'],
    [{ ...body(), consent: 'true' }, 'consent_required'],
    [{ ...body(), consent: 1 }, 'consent_required'],
    [{ ...body(), date: undefined }, 'invalid_date'],
    [{ ...body(), date: '2026-02-30' }, 'invalid_date'],
    [{ ...body(), date: 'today' }, 'invalid_date'],
    [{ ...body(), date: '1999-12-31' }, 'invalid_date'],
    [{ ...body(), date: '2201-01-01' }, 'invalid_date'],
    [{ ...body(), tone: 'constructor' }, 'invalid_tone'],
    [{ ...body(), tone: 7 }, 'invalid_tone'],
    [{ ...body(), answers: undefined }, 'invalid_start_answers'],
    [{ ...body(), answers: 'Олена' }, 'invalid_start_answers'],
    [{ ...body(), answers: { ...answers(), name: '   ' } }, 'invalid_start_answers'],
    [{ ...body(), answers: { ...answers(), change: '' } }, 'invalid_start_answers'],
    [{ ...body(), answers: { ...answers(), focus: ['crypto'] } }, 'invalid_start_answers'],
    [{ ...body(), answers: { ...answers(), minutes: 45 } }, 'invalid_start_answers'],
    [{ ...body(), answers: { ...answers(), minutes: '30' } }, 'invalid_start_answers'],
    [{ ...body(), answers: { ...answers(), slots: ['any'] } }, 'invalid_start_answers'],
    [{ ...body(), answers: { ...answers(), level: 'athlete' } }, 'invalid_start_answers'],
    [{ ...body(), existingHabits: 'Читання' }, 'invalid_existing_habits'],
    [{ ...body(), existingHabits: { 0: 'Читання' } }, 'invalid_existing_habits'],
  ];
  for (const [value, code] of cases) {
    assert.throws(() => validateStartRequest(value, fail), error => {
      assert.equal(error.status, 400, code);
      assert.equal(error.code, code);
      assert.match(error.message, /[а-яіїє]/i);
      return true;
    });
  }
});

test('response format is a strict schema whose keys and enums are exactly the validator’s', () => {
  assert.equal(START_RESPONSE_FORMAT.type, 'json_schema');
  assert.equal(START_RESPONSE_FORMAT.strict, true);
  assert.match(START_RESPONSE_FORMAT.name, /^[a-zA-Z0-9_-]{1,64}$/);
  for (const schema of [planSchema, variantSchema, itemSchema]) {
    assert.equal(schema.type, 'object');
    assert.equal(schema.additionalProperties, false);
    assert.deepEqual(schema.required, Object.keys(schema.properties));
  }
  assert.deepEqual(planSchema.required, ['summary', 'variants']);
  assert.deepEqual(variantSchema.required, ['id', 'title', 'note', 'items']);
  assert.deepEqual(itemSchema.required, ['title', 'description', 'category', 'minutes', 'timeOfDay', 'tier']);
  assert.deepEqual(variantSchema.properties.id.enum, START_VARIANTS.map(item => item.id));
  assert.deepEqual(variantSchema.properties.id.enum, ['light', 'balanced', 'intense']);
  assert.deepEqual(itemSchema.properties.category.enum, CATEGORIES.map(item => item.id));
  assert.deepEqual(itemSchema.properties.timeOfDay.enum, DAY_SLOTS.map(item => item.id));
  assert.deepEqual(itemSchema.properties.tier.enum, QUEST_TIERS.map(item => item.id));
  assert.deepEqual([planSchema.properties.variants.minItems, planSchema.properties.variants.maxItems], [2, 3]);
  assert.deepEqual([variantSchema.properties.items.minItems, variantSchema.properties.items.maxItems], [2, START_ITEM_LIMIT]);
});

test('an object satisfying the schema passes the shared validator, including at the schema limits', () => {
  assert.equal(conforms(planSchema, plan()), true);
  assert.deepEqual(validateStartPlan(plan(), answers()), plan());
  const two = { ...plan(), variants: plan().variants.slice(0, 2) };
  assert.equal(conforms(planSchema, two), true);
  assert.deepEqual(validateStartPlan(two, answers()), two);
  // Longest strings, most items and the largest minute value the schema allows.
  const title = index => `${index}`.padEnd(itemSchema.properties.title.maxLength, 'я');
  const item = index => ({ title: title(index), description: 'о'.repeat(itemSchema.properties.description.maxLength), category: 'creativity', minutes: 1, timeOfDay: 'any', tier: 'common' });
  const full = id => ({ id, title: 'т'.repeat(variantSchema.properties.title.maxLength), note: 'н'.repeat(variantSchema.properties.note.maxLength), items: [...Array.from({ length: START_ITEM_LIMIT - 1 }, (_, index) => item(index)), { ...item('виклик'), minutes: itemSchema.properties.minutes.maximum, tier: 'legendary' }] });
  const widest = { summary: 'с'.repeat(planSchema.properties.summary.maxLength), variants: START_VARIANTS.map(variant => full(variant.id)) };
  assert.equal(conforms(planSchema, widest), true);
  assert.deepEqual(validateStartPlan(widest, { ...answers(), minutes: 15 }), widest);
  // Empty optional texts are allowed by both sides; empty required texts by neither.
  const bare = plan();
  bare.variants[0].note = ''; bare.variants[0].items[0].description = '';
  assert.equal(conforms(planSchema, bare), true);
  assert.ok(validateStartPlan(bare, answers()));
  for (const change of [value => { value.summary = ''; }, value => { value.variants[0].title = ''; }, value => { value.variants[0].items[0].title = ''; }]) {
    const value = plan(); change(value);
    assert.equal(conforms(planSchema, value), false);
    assert.equal(validateStartPlan(value, answers()), null);
  }
});

test('a missing or extra key at any level is rejected by the schema and by the validator alike', () => {
  const levels = [[planSchema, value => value], [variantSchema, value => value.variants[1]], [itemSchema, value => value.variants[1].items[0]]];
  for (const [schema, pick] of levels) {
    for (const key of schema.required) {
      const value = plan(); delete pick(value)[key];
      assert.equal(conforms(planSchema, value), false, key);
      assert.equal(validateStartPlan(value, answers()), null, key);
    }
    const value = plan(); pick(value).xp = 500;
    assert.equal(conforms(planSchema, value), false);
    assert.equal(validateStartPlan(value, answers()), null);
  }
});

test('instructions describe the contract in Ukrainian and treat answers as untrusted data', () => {
  for (const pattern of [/KROK_START_ANSWERS/, /недовірені дані/, /\{summary, variants\}/, /"light"/, /"balanced"/, /"intense"/, /«Легкий старт»/, /«Збалансований»/, /«Насичений»/,
    /"common"/, /"epic"/, /"legendary"/, /60 %/, /100 %/, /150 %/, /existingHabits/, /не пропонуй важких тренувань/, /Не став діагнозів/, /нічого не застосовано/]) assert.match(START_INSTRUCTIONS, pattern);
  for (const variant of START_VARIANTS) assert.ok(START_INSTRUCTIONS.includes(`«${variant.title}»`) && START_INSTRUCTIONS.includes(`${variant.share * 100} %`));
});

test('parsing returns the validated plan and turns every invalid model output into 502', () => {
  const data = { answers: normalizeStartAnswers(answers()), date: '2026-11-18', tone: 'supportive', existingHabits: [] };
  assert.deepEqual(parseStartResponse(JSON.stringify(plan()), data, fail), plan());
  const padded = plan(); padded.summary = `  ${padded.summary}  `;
  assert.equal(parseStartResponse(JSON.stringify(padded), data, fail).summary, plan().summary);
  const broken = change => { const value = plan(); change(value); return JSON.stringify(value); };
  const cases = [
    'not json', '', 'null', '[]', JSON.stringify('план'),
    broken(value => { value.xp = 5000; }),
    broken(value => { value.variants = value.variants.slice(0, 1); }),
    broken(value => { value.variants.push({ ...value.variants[2] }); }),
    broken(value => { value.variants.reverse(); }),
    broken(value => { value.variants[1].id = 'light'; }),
    broken(value => { value.variants[0].id = 'extreme'; }),
    broken(value => { value.variants[0].items = value.variants[0].items.slice(0, 1); }),
    broken(value => { value.variants[0].items[1].minutes = 22; }), // 24 of 23 minutes for the light variant
    broken(value => { value.variants[2].items[3].minutes = 34; }), // 51 of 50 minutes for the intense variant
    broken(value => { value.variants[0].items[1].title = ' склянка ВОДИ після  пробудження '; }),
    broken(value => { value.variants[1].items.push({ ...challenge(), title: 'День без солодкого' }); }),
    broken(value => { value.variants[0].items[0].category = 'crypto'; }),
    broken(value => { value.variants[0].items[0].timeOfDay = 'night'; }),
    broken(value => { value.variants[0].items[0].tier = 'mythic'; }),
    broken(value => { value.variants[0].items[0].minutes = 1.5; }),
    broken(value => { value.variants[0].items[0].minutes = 0; }),
    broken(value => { value.variants[0].items[0].xp = 130; }),
    broken(value => { value.summary = 'x'.repeat(601); }),
  ];
  for (const raw of cases) {
    assert.throws(() => parseStartResponse(raw, data, fail), error => {
      assert.equal(error.status, 502, raw);
      assert.equal(error.code, 'invalid_start_plan', raw);
      assert.match(error.message, /Спробуй ще раз або обери готовий варіант/);
      return true;
    });
  }
  // The same output is judged against the person's own daily time.
  assert.throws(() => parseStartResponse(JSON.stringify(plan()), { ...data, answers: { ...data.answers, minutes: 15 } }, fail), { code: 'invalid_start_plan' });
  assert.throws(() => parseStartResponse(JSON.stringify(plan()), { ...data, answers: {} }, fail), { code: 'invalid_start_plan' });
});
