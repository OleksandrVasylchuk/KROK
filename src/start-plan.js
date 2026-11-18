import { CATEGORIES, DAY_SLOTS, QUEST_TIERS } from './catalog.js';

const categoryIds = new Set(CATEGORIES.map(item => item.id));
const slotIds = new Set(DAY_SLOTS.map(item => item.id));
const tierIds = new Set(QUEST_TIERS.map(item => item.id));
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clean = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const plain = (value, max) => typeof value === 'string' && value.trim().length > 0 && value.length <= max && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const titleKey = value => value.normalize('NFKC').toLocaleLowerCase('uk-UA').replace(/\s+/g, ' ').trim();

export const START_MINUTES = [15, 30, 60, 90];
export const START_OBSTACLES = ['Брак часу', 'Втома', 'Важко почати', 'Забуваю', 'Немає чіткого плану', 'Швидко кидаю'];
export const START_LEVELS = [['low', 'Майже не рухаюсь'], ['some', 'Рухаюсь час від часу'], ['regular', 'Тренуюсь регулярно']];

/**
 * The first-run questions. This list is the single place to change their wording,
 * order or options; `id` values are read by the plan builders below.
 */
export const START_QUESTIONS = [
  { id: 'name', type: 'text', title: 'Як до тебе звертатися?', hint: 'Так тебе називатиме тренер.', placeholder: 'Твоє ім’я', max: 40, required: true },
  { id: 'change', type: 'longtext', title: 'Що ти хочеш змінити в житті передусім?', hint: 'Одним-двома реченнями, своїми словами.', placeholder: 'Наприклад, мати більше енергії та кинути курити', max: 300, required: true },
  { id: 'focus', type: 'multi', title: 'Які сфери зараз найважливіші?', hint: 'Обери від однієї до трьох. Решту можна додати пізніше.', options: CATEGORIES.map(item => [item.id, item.shortLabel]), limit: 3, required: true },
  { id: 'minutes', type: 'choice', title: 'Скільки часу на день ти реально маєш на себе?', hint: 'Чесний орієнтир, не обіцянка. Краще менше, але щодня.', options: START_MINUTES.map(value => [value, value < 60 ? `${value} хвилин` : value === 60 ? '1 година' : '1,5 години']), required: true },
  { id: 'slots', type: 'multi', title: 'Коли тобі найзручніше діяти?', hint: 'Розпорядок спиратиметься на ці частини дня.', options: DAY_SLOTS.filter(item => item.id !== 'any').map(item => [item.id, item.label]), limit: 3, required: true },
  { id: 'level', type: 'choice', title: 'Як зараз із рухом?', hint: 'Щоб не почати з надто важкого.', options: START_LEVELS, required: true },
  { id: 'obstacles', type: 'multi', title: 'Що найчастіше заважає?', hint: 'Обери до двох. Можна пропустити.', options: START_OBSTACLES.map(value => [value, value]), limit: 2, required: false },
  { id: 'quit', type: 'text', title: 'Є звичка, якої хочеш позбутися?', hint: 'Наприклад, куріння чи солодке. Можна пропустити.', placeholder: 'Наприклад, куріння', max: 60, required: false },
];

/** Allowlist and bound every answer; unknown options are dropped, never guessed. */
export function normalizeStartAnswers(raw) {
  const value = object(raw) ? raw : {};
  const list = (items, allowed, limit) => Array.isArray(items) ? [...new Set(items.filter(item => allowed.has(item)))].slice(0, limit) : [];
  return {
    name: clean(value.name, 40),
    change: clean(value.change, 300),
    focus: list(value.focus, categoryIds, 3),
    minutes: START_MINUTES.includes(value.minutes) ? value.minutes : 0,
    slots: list(value.slots, new Set(['morning', 'day', 'evening']), 3),
    level: START_LEVELS.some(([id]) => id === value.level) ? value.level : '',
    obstacles: list(value.obstacles, new Set(START_OBSTACLES), 2),
    quit: clean(value.quit, 60),
  };
}

export function startAnswersComplete(answers) {
  const value = normalizeStartAnswers(answers);
  return Boolean(value.name && value.change && value.focus.length && value.minutes && value.slots.length && value.level);
}

export const START_VARIANTS = [
  { id: 'light', title: 'Легкий старт', share: 0.6 },
  { id: 'balanced', title: 'Збалансований', share: 1 },
  { id: 'intense', title: 'Насичений', share: 1.5 },
];
export const START_ITEM_LIMIT = 8;
const variantBudget = (answers, id) => Math.round(answers.minutes * START_VARIANTS.find(item => item.id === id).share) + 5;
// A day-long challenge is not a time block, so it does not spend the minute budget.
const spends = item => item.tier === 'legendary' ? 0 : item.minutes;

function validateItem(item) {
  if (!exact(item, ['title', 'description', 'category', 'minutes', 'timeOfDay', 'tier']) || !plain(item.title, 100) || typeof item.description !== 'string' || item.description.length > 300
    || !categoryIds.has(item.category) || !Number.isInteger(item.minutes) || item.minutes < 1 || item.minutes > 180 || !slotIds.has(item.timeOfDay) || !tierIds.has(item.tier)) return null;
  return { title: item.title.trim(), description: item.description.trim(), category: item.category, minutes: item.minutes, timeOfDay: item.timeOfDay, tier: item.tier };
}

/** One routine option: 2–8 distinct steps inside its minute budget, at most one day-long challenge. */
export function validateStartVariant(value, answers) {
  const profile = normalizeStartAnswers(answers);
  if (!exact(value, ['id', 'title', 'note', 'items']) || !START_VARIANTS.some(item => item.id === value.id) || !plain(value.title, 60) || typeof value.note !== 'string' || value.note.length > 300
    || !Array.isArray(value.items) || value.items.length < 2 || value.items.length > START_ITEM_LIMIT || !profile.minutes) return null;
  const items = [], seen = new Set();
  for (const raw of value.items) {
    const item = validateItem(raw);
    // A step may sit only in a part of day the person chose, or float.
    if (!item || seen.has(titleKey(item.title)) || (item.timeOfDay !== 'any' && !profile.slots.includes(item.timeOfDay))) return null;
    seen.add(titleKey(item.title));
    items.push(item);
  }
  if (items.filter(item => item.tier === 'legendary').length > 1 || items.reduce((total, item) => total + spends(item), 0) > variantBudget(profile, value.id)) return null;
  return { id: value.id, title: value.title.trim(), note: value.note.trim(), items };
}

/** Strict boundary for a generated plan (model or local): 2–3 variants in the fixed light → intense order. */
export function validateStartPlan(value, answers) {
  if (!exact(value, ['summary', 'variants']) || !plain(value.summary, 600) || !Array.isArray(value.variants) || value.variants.length < 2 || value.variants.length > 3) return null;
  const variants = value.variants.map(variant => validateStartVariant(variant, answers));
  if (variants.some(variant => !variant)) return null;
  const order = variants.map(variant => START_VARIANTS.findIndex(item => item.id === variant.id));
  if (order.some((index, position) => position > 0 && index <= order[position - 1])) return null;
  return { summary: value.summary.trim(), variants };
}

// Ready-made steps used when the model is unavailable or was not asked. [title, description, minutes, preferred part of day]
const TEMPLATES = {
  body: { common: ['10 хвилин руху', 'Розминка, присідання або швидка ходьба — у своєму темпі.', 10, 'morning'], epic: ['Тренування', 'Зал, пробіжка чи домашнє тренування. Зупинись, якщо щось болить.', 45, 'evening'] },
  money: { common: ['Запиши витрати за день', 'Додай покупки, дорогу й дрібниці у «Фінанси».', 5, 'evening'], epic: ['Переглянь витрати тижня', 'Подивись, на що пішли гроші, і обери один ліміт.', 20, 'evening'] },
  social: { common: ['Напиши близькій людині', 'Запитай, як справи, або домовся про зустріч.', 5, 'day'], epic: ['Час із близькими без телефона', 'Вечеря, прогулянка чи дзвінок без поспіху.', 45, 'evening'] },
  growth: { common: ['Прочитай 10 сторінок', 'Книжка або стаття, яка тобі справді цікава.', 15, 'evening'], epic: ['Урок або курс', 'Один урок із конспектом головної думки.', 40, 'day'] },
  nutrition: { common: ['Додай овочі до однієї страви', 'Один прийом їжі сьогодні — з овочами чи фруктами.', 5, 'day'], epic: ['Приготуй їжу на завтра', 'Проста страва, щоб не шукати перекус на ходу.', 40, 'evening'] },
  sleep: { common: ['Лягти до 23:00', 'Постав нагадування й відклади телефон заздалегідь.', 5, 'evening'], epic: ['Година без екрана перед сном', 'Книжка, душ або розмова замість стрічки.', 60, 'evening'] },
  mind: { common: ['5 хвилин тиші', 'Без телефона: подихай і поміть, як ти зараз.', 5, 'morning'], epic: ['Прогулянка без навушників', 'Пройдися й дай голові відпочити.', 30, 'day'] },
  career: { common: ['Одна головна справа дня', 'Запиши її зранку й зроби першою.', 10, 'morning'], epic: ['Година глибокої роботи', 'Без сповіщень, над одним важливим завданням.', 60, 'day'] },
  home: { common: ['10 хвилин порядку', 'Одна поверхня або один куток — і досить.', 10, 'evening'], epic: ['Розбери одну зону вдома', 'Шафа, стіл чи полиця від початку до кінця.', 45, 'day'] },
  creativity: { common: ['15 хвилин для хобі', 'Малюй, грай, пиши — без вимоги до результату.', 15, 'evening'], epic: ['Година улюбленої справи', 'Заплануй її як зустріч із собою.', 60, 'evening'] },
};
const FALLBACK_FOCUS = ['body', 'sleep', 'mind'];

/** Deterministic plan from templates. It is labelled as such in the interface and never calls the model. */
export function buildLocalStartPlan(raw) {
  const answers = normalizeStartAnswers(raw);
  if (!startAnswersComplete(answers)) return null;
  const focus = [...answers.focus, ...FALLBACK_FOCUS.filter(id => !answers.focus.includes(id))];
  const slot = preferred => answers.slots.includes(preferred) ? preferred : answers.slots[0];
  const step = (category, tier) => {
    const [title, description, minutes, preferred] = TEMPLATES[category][tier];
    // A beginner's first training is shorter; nobody starts above their stated daily time.
    const capped = tier === 'epic' ? Math.max(10, Math.min(category === 'body' && answers.level === 'low' ? 20 : minutes, answers.minutes)) : minutes;
    return { title: category === 'body' && tier === 'epic' && answers.level === 'low' ? 'Легке тренування' : title, description, category, minutes: capped, timeOfDay: slot(preferred), tier };
  };
  const challenge = answers.quit ? { title: `День без: ${answers.quit}`.slice(0, 100), description: 'Один день за раз. Відміть увечері, якщо вдалося; зрив не скасовує попередні дні.', category: 'mind', minutes: 5, timeOfDay: answers.slots.includes('evening') ? 'evening' : 'any', tier: 'legendary' } : null;
  const fit = (id, candidates, minimum) => {
    const budget = variantBudget(answers, id), items = [];
    let spent = 0;
    for (const item of candidates) {
      if (items.length >= START_ITEM_LIMIT) break;
      if (spent + spends(item) > budget && items.length >= minimum) continue;
      // The first steps are always kept; with very little time they shrink to share what is left.
      if (items.length < minimum && item.tier !== 'legendary') item.minutes = Math.min(item.minutes, Math.max(1, Math.floor((budget - spent) / (minimum - items.length))));
      items.push(item); spent += spends(item);
    }
    return items;
  };
  const commons = focus.slice(0, Math.max(2, answers.focus.length)).map(id => step(id, 'common'));
  const epics = answers.focus.map(id => step(id, 'epic'));
  const variants = [
    { id: 'light', title: 'Легкий старт', note: 'Кілька маленьких кроків, щоб увійти в ритм без напруги.', items: fit('light', commons.map(item => ({ ...item })), 2) },
    { id: 'balanced', title: 'Збалансований', note: 'Маленькі кроки щодня й одна серйозніша справа.', items: fit('balanced', [...commons.map(item => ({ ...item })), ...epics.slice(0, 1).map(item => ({ ...item })), ...(challenge ? [{ ...challenge }] : [])], 2) },
    { id: 'intense', title: 'Насичений', note: 'Для дня, коли є сили: більше кроків і більший виклик.', items: fit('intense', [...commons.map(item => ({ ...item })), ...epics.map(item => ({ ...item })), ...(challenge ? [{ ...challenge }] : [])], 2) },
  ];
  // Drop a variant that ended up identical to the lighter one (very small daily time).
  const distinct = variants.filter((variant, index) => index === 0 || JSON.stringify(variant.items) !== JSON.stringify(variants[index - 1].items));
  const plan = { summary: `${answers.name}, ось варіанти розпорядку на ${answers.minutes} хвилин на день. Обери той, що зараз посильний, — його можна буде змінити на тижневій зустрічі.`, variants: distinct.length >= 2 ? distinct : variants.slice(0, 2) };
  return validateStartPlan(plan, answers);
}

/** Request body for the model. Sent only after the person's explicit consent on the last step. */
export function buildStartRequest(raw, { date, tone = 'supportive', habits = [] } = {}) {
  const answers = normalizeStartAnswers(raw);
  if (!startAnswersComplete(answers)) throw new Error('Дай відповідь на обов’язкові запитання.');
  return { answers, date, tone, consent: true, existingHabits: habits.filter(habit => !habit.archived).slice(0, 20).map(habit => clean(habit.title, 80)).filter(Boolean) };
}
