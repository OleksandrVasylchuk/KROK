import { CATEGORIES, QUEST_TIERS, tierXp } from './catalog.js';
import { COACH_MEMORY_LIMIT, containsMemorySecret } from './coach-personal.js';

export const COACH_ACTION_LIMIT = 5;
export const COACH_PROPOSAL_LIMIT = 100;
const categories = new Set(CATEGORIES.map(item => item.id));
const icons = new Set(['water', 'book', 'moon', 'walk', 'food', 'mind', 'wallet', 'people', 'work', 'home', 'creative']);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const id = (value, max = 100) => typeof value === 'string' && value.length <= max && /^[a-zA-Z0-9_-]+$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const text = (value, max, required = true) => typeof value === 'string' && value.length <= max && (!required || value.trim().length > 0) && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value);
const integer = (value, min, max) => Number.isInteger(value) && value >= min && value <= max;
const amount = (value, min, max) => Number.isFinite(value) && value >= min && value <= max && value === Math.round(value * 100) / 100;
const exact = (value, keys) => object(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const fail = (code, message) => ({ ok: false, error: { code, message } });
const pass = value => ({ ok: true, value });
const titleKey = value => value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');
const todayDate = () => { const now = new Date(); return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`; };
const validDate = value => {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || value < '2000-01-01' || value > '2200-12-31') return false;
  const timestamp = Date.parse(`${value}T12:00:00Z`);
  return Number.isFinite(timestamp) && new Date(timestamp).toISOString().slice(0, 10) === value;
};
const shiftDate = (date, days) => new Date(Date.parse(`${date}T12:00:00Z`) + days * 86400000).toISOString().slice(0, 10);
const validWeekdays = value => Array.isArray(value) && value.length <= 7 && value.every(day => integer(day, 0, 6)) && new Set(value).size === value.length;
const due = (item, date) => !item.archived && (!item.createdAt || item.createdAt <= date) && (item.frequency === 'once' ? item.scheduledDate === date : item.frequency === 'weekdays' ? (item.weekdays || []).includes(new Date(`${date}T12:00:00Z`).getUTCDay()) : true);
const actionKeys = {
  create_quest: ['type', 'ref', 'title', 'description', 'category', 'minutes', 'frequency', 'weekdays', 'scheduledDate', 'goalId', 'goalRef'],
  create_habit: ['type', 'ref', 'title', 'category', 'icon', 'target', 'unit', 'timeOfDay', 'frequency', 'weekdays'],
  create_goal: ['type', 'ref', 'title', 'description', 'category', 'target', 'unit', 'deadline'],
  complete_quest: ['type', 'ref', 'id', 'date'],
  set_habit_count: ['type', 'ref', 'id', 'date', 'value'],
  set_goal_progress: ['type', 'ref', 'id', 'value'],
  create_memory: ['type', 'ref', 'text', 'category'],
  update_memory: ['type', 'ref', 'id', 'text', 'category'],
  delete_memory: ['type', 'ref', 'id'],
  record_expense: ['type', 'ref', 'title', 'amount', 'category', 'date', 'account', 'note'],
  update_quest: ['type', 'ref', 'id', 'title', 'description', 'minutes', 'frequency', 'weekdays', 'scheduledDate'],
  set_checkin: ['type', 'ref', 'date', 'mood', 'energy', 'note'],
  archive_quest: ['type', 'ref', 'id'],
  archive_habit: ['type', 'ref', 'id'],
};
// Since schema 6 a proposed quest may carry its level and part of day; earlier saved proposals stay valid.
const questExtras = ['tier', 'timeOfDay'];
const tiers = new Set(QUEST_TIERS.map(item => item.id));
const shaped = action => exact(action, actionKeys[action.type]) || (action.type === 'create_quest' && exact(action, [...actionKeys.create_quest, ...questExtras]));
const createsRecord = type => ['create_quest', 'create_habit', 'create_goal', 'create_memory', 'record_expense'].includes(type);
const memoryType = type => ['create_memory', 'update_memory', 'delete_memory'].includes(type);
const actionTargetId = (action, proposalId, index) => createsRecord(action.type) ? `coach-${proposalId}-${index}` : action.type === 'set_checkin' ? `checkin-${action.date}` : action.id;

function validateContent(value, { date = todayDate(), context, personalContext, structuralOnly = false } = {}) {
  if (!validDate(date) || !exact(value, ['text', 'actions']) || !text(value.text, 6000) || !Array.isArray(value.actions) || value.actions.length > COACH_ACTION_LIMIT) return fail('invalid_actions', 'Відповідь тренера має неправильний формат. Спробуй ще раз.');
  const refs = new Set(), changes = new Set(), titles = new Set();
  for (const action of value.actions) {
    if (!object(action) || typeof action.type !== 'string' || !Object.hasOwn(actionKeys, action.type) || !shaped(action) || !id(action.ref, 40) || refs.has(action.ref)) return fail('invalid_action', 'Тренер запропонував некоректну або повторну дію. Нічого не змінено.');
    refs.add(action.ref);
    if (['create_quest','create_habit','create_goal'].includes(action.type)) {
      if (!text(action.title, action.type === 'create_habit' ? 80 : 100) || !categories.has(action.category)) return fail('invalid_record', 'Перевір назву та сферу запропонованої дії.');
      const key = `${action.type}:${titleKey(action.title)}`;
      if (titles.has(key)) return fail('duplicate_action', 'У пропозиції повторюється один і той самий запис.');
      titles.add(key);
    } else if (['complete_quest','set_habit_count','set_goal_progress','update_quest','update_memory','delete_memory','archive_quest','archive_habit'].includes(action.type)) {
      if (!id(action.id)) return fail('invalid_id', 'Не вдалося визначити запис для зміни.');
      const key = `${memoryType(action.type) ? 'memory' : ['complete_quest','update_quest','archive_quest'].includes(action.type) ? 'quest' : ['set_habit_count','archive_habit'].includes(action.type) ? 'habit' : action.type}:${action.id}`;
      if (changes.has(key)) return fail('duplicate_action', 'Один запис не можна змінити двічі в одній пропозиції.');
      changes.add(key);
      if (['complete_quest','set_habit_count'].includes(action.type) && action.date !== date) return fail('invalid_date', 'Відмітити прогрес через тренера можна тільки за сьогодні.');
    }
    if (action.type === 'create_quest') {
      if (!text(action.description, 400, false) || !integer(action.minutes, 1, 180) || !['daily', 'weekdays', 'once'].includes(action.frequency) || !validWeekdays(action.weekdays) || (action.frequency === 'weekdays' && !action.weekdays.length) || (action.frequency === 'once' ? !validDate(action.scheduledDate) || action.scheduledDate < date : action.scheduledDate !== '') || (action.goalId !== null && !id(action.goalId)) || (action.goalRef !== null && !id(action.goalRef, 40)) || (action.goalId !== null && action.goalRef !== null) || (Object.hasOwn(action, 'tier') && (!tiers.has(action.tier) || !['any', 'morning', 'day', 'evening'].includes(action.timeOfDay)))) return fail('invalid_quest', 'У квесті некоректні тривалість, розклад, рівень або зв’язок із ціллю.');
    } else if (action.type === 'create_habit') {
      if (!icons.has(action.icon) || !integer(action.target, 1, 10000) || !text(action.unit, 30) || !['any', 'morning', 'day', 'evening'].includes(action.timeOfDay) || !['daily', 'weekdays'].includes(action.frequency) || !validWeekdays(action.weekdays) || (action.frequency === 'weekdays' && !action.weekdays.length)) return fail('invalid_habit', 'У звичці некоректні ціль, одиниці або розклад.');
    } else if (action.type === 'create_goal') {
      if (!text(action.description, 500, false) || !amount(action.target, 0.01, 10000000) || !text(action.unit, 30) || (action.deadline !== '' && (!validDate(action.deadline) || action.deadline < date))) return fail('invalid_goal', 'У цілі некоректні обсяг, одиниці або термін.');
    } else if (action.type === 'set_habit_count' && !integer(action.value, 0, 10000)) return fail('invalid_progress', 'Для звички потрібна ціла кількість у межах її цілі.');
    else if (action.type === 'set_goal_progress' && !amount(action.value, 0, 10000000)) return fail('invalid_progress', 'Для цілі потрібен невід’ємний прогрес із двома знаками після коми.');
    else if (['create_memory','update_memory'].includes(action.type)) {
      if (!text(action.text, 300) || /[\u0000-\u001f]/.test(action.text) || !categories.has(action.category) || containsMemorySecret(action.text)) return fail('invalid_memory', 'Пам’ять має містити короткий факт без паролів чи секретних ключів.');
      const key = `memory:${titleKey(action.text)}`;
      if (titles.has(key)) return fail('duplicate_memory', 'Один факт повторюється в пропозиції.');
      titles.add(key);
    } else if (action.type === 'record_expense') {
      if (!text(action.title, 80) || !text(action.category, 40) || !amount(action.amount, 0.01, 1000000) || !validDate(action.date) || action.date > date || !['cash','card'].includes(action.account) || !text(action.note,300,false)) return fail('invalid_expense', 'Перевір суму в гривнях, дату, категорію та спосіб оплати витрати.');
      const key = `expense:${action.date}:${titleKey(action.title)}:${action.amount}:${titleKey(action.category)}:${action.account}`;
      if (titles.has(key)) return fail('duplicate_expense', 'Ця витрата повторюється в пропозиції.');
      titles.add(key);
    } else if (action.type === 'update_quest') {
      if (!text(action.title,100) || !text(action.description,400,false) || !integer(action.minutes,1,180) || !['daily','weekdays','once'].includes(action.frequency) || !validWeekdays(action.weekdays) || (action.frequency === 'weekdays' && !action.weekdays.length) || (action.frequency === 'once' ? !validDate(action.scheduledDate) || action.scheduledDate < date : action.scheduledDate !== '')) return fail('invalid_quest_update', 'Перевір назву, тривалість і новий розклад квесту.');
    } else if (action.type === 'set_checkin') {
      if (action.date !== date || !integer(action.mood,1,5) || !integer(action.energy,1,5) || !text(action.note,500,false)) return fail('invalid_checkin','Підсумок дня потребує сьогоднішньої дати та оцінок настрою й енергії від 1 до 5.');
      if (changes.has('checkin')) return fail('duplicate_checkin', 'День можна підсумувати лише один раз у добірці.');
      changes.add('checkin');
    }
  }
  for (const action of value.actions) {
    if (action.type === 'create_quest' && action.goalRef !== null && !value.actions.some(other => other.type === 'create_goal' && other.ref === action.goalRef)) return fail('unknown_goal_ref', 'Квест посилається на ціль, якої немає в цій пропозиції.');
    if (structuralOnly) continue;
    const needsContext = ['complete_quest','set_habit_count','set_goal_progress','update_quest','archive_quest','archive_habit'].includes(action.type) || (action.type === 'create_quest' && action.goalId !== null);
    if (needsContext && (!object(context) || context.date !== date || !['quests', 'habits', 'goals'].every(key => Array.isArray(context[key])))) return fail('context_required', 'Щоб змінити наявний запис, дозволь тренеру бачити квести, звички й прогрес.');
    if (action.type === 'create_quest' && action.goalId !== null && !context.goals?.some(goal => goal.id === action.goalId)) return fail('unknown_goal', 'Цю ціль більше не знайдено. Онови пропозицію.');
    if (action.type === 'complete_quest' && !context.quests?.some(quest => quest.id === action.id && quest.dueToday !== false)) return fail('quest_not_due', 'Квест не знайдено серед доступних на сьогодні.');
    if (action.type === 'update_quest') {
      const quest = context.quests?.find(item => item.id === action.id);
      if (!quest || quest.completed || quest.hasCompletions) return fail('quest_update_unavailable','Через тренера можна змінювати лише активний квест, який ще не має виконань. Історію збережено.');
    }
    if (action.type === 'archive_quest' && !context.quests?.some(quest => quest.id === action.id)) return fail('quest_archive_unavailable', 'Цей квест уже в архіві або недоступний для зміни сьогодні.');
    if (action.type === 'archive_habit' && !context.habits?.some(habit => habit.id === action.id)) return fail('habit_archive_unavailable', 'Ця звичка вже в архіві або її не знайдено.');
    if (['update_memory','delete_memory'].includes(action.type) && (personalContext?.memoryConsent !== true || !personalContext.memory?.some(item => item.id === action.id))) return fail('memory_context_required','Щоб змінити або видалити факт, дозволь доступ до пам’яті або зміни його вручну.');
    if (action.type === 'set_habit_count') {
      const habit = context.habits?.find(item => item.id === action.id);
      if (!habit || habit.dueToday !== true) return fail('habit_not_due', 'Ця звичка сьогодні не запланована або вже в архіві.');
      if (action.value > habit.target) return fail('progress_exceeds_target', 'Кількість перевищує ціль звички.');
    }
    if (action.type === 'set_goal_progress') {
      const goal = context.goals?.find(item => item.id === action.id);
      if (!goal) return fail('unknown_goal', 'Цю ціль більше не знайдено.');
      if (action.value > goal.target) return fail('progress_exceeds_target', 'Прогрес перевищує ціль.');
    }
  }
  return pass({ text: value.text.trim(), actions: value.actions.map(action => ({ ...action, ...(action.weekdays ? { weekdays: [...action.weekdays] } : {}) })) });
}

/** Strict AI boundary. Omitting authorized context deliberately disables edits to existing records. */
export function validateCoachActions(value, options = {}) {
  return validateContent(value, { date: options.date, context: options.context, personalContext: options.personalContext });
}

/** An allowlisted snapshot only; the caller must obtain coachActionsConsent before transmission. */
export function buildCoachActionContext(state, date = todayDate()) {
  if (!validDate(date)) throw new RangeError('Invalid coach context date');
  const quests = state.quests || [], habits = state.habits || [], goals = state.goals || [];
  const completions = state.completions || {}, logs = state.habitLogs || {};
  const questMap = new Map(quests.map(quest => [quest.id, quest]));
  const activeHabits = habits.filter(habit => !habit.archived);
  const byDay = Array.from({ length: 7 }, (_, index) => {
    const day = shiftDate(date, index - 6);
    const done = [...new Set(completions[day] || [])].map(key => questMap.get(key)).filter(Boolean);
    const scheduled = activeHabits.filter(habit => due(habit, day));
    return { date: day, questsCompleted: done.length, plannedMinutes: done.reduce((total, quest) => total + quest.minutes, 0), habitsCompleted: scheduled.filter(habit => (logs[day]?.[habit.id] || 0) >= habit.target).length, habitsScheduled: scheduled.length };
  });
  return {
    date,
    quests: quests.filter(quest => !quest.archived && (due(quest,date) || !Object.values(completions).some(ids => ids.includes(quest.id))) && (quest.frequency !== 'once' || !Object.entries(completions).some(([day, ids]) => day !== date && ids.includes(quest.id)))).map(quest => ({ id: quest.id, title: quest.title, description: quest.description || '', category: quest.category, minutes: quest.minutes, frequency: quest.frequency, weekdays: quest.weekdays || [], scheduledDate: quest.scheduledDate || '', dueToday: due(quest,date), completed: (completions[date] || []).includes(quest.id), hasCompletions: Object.values(completions).some(ids => ids.includes(quest.id)) })),
    habits: activeHabits.map(habit => ({ id: habit.id, title: habit.title, category: habit.category, target: habit.target, unit: habit.unit, todayCount: logs[date]?.[habit.id] || 0, dueToday: due(habit, date) })),
    goals: goals.map(goal => ({ id: goal.id, title: goal.title, category: goal.category, current: goal.current, target: goal.target, unit: goal.unit, status: goal.status })),
    review: { days: 7, questCompletions: byDay.reduce((sum, day) => sum + day.questsCompleted, 0), plannedMinutes: byDay.reduce((sum, day) => sum + day.plannedMinutes, 0), habitCompletedDays: byDay.reduce((sum, day) => sum + day.habitsCompleted, 0), habitScheduledDays: byDay.reduce((sum, day) => sum + day.habitsScheduled, 0), byDay },
    capacity: { quests: quests.length, habits: habits.length, goals: goals.length },
  };
}

const canonical = value => Array.isArray(value) ? `[${value.map(canonical).join(',')}]` : object(value) ? `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}` : JSON.stringify(value);

/** Non-secret change token, not an authentication signature. Excludes messages, proposals and settings. */
export function coachStateFingerprint(state, date = todayDate()) {
  const source = canonical({ date, quests: state.quests || [], habits: state.habits || [], goals: state.goals || [], completions: state.completions || {}, habitLogs: state.habitLogs || {}, coachMemory: state.coachMemory || [], expenses: state.expenses || [], checkIns: state.checkIns || {} });
  let a = 0x811c9dc5, b = 0x9e3779b9, c = 0x85ebca6b, d = 0xc2b2ae35;
  for (let index = 0; index < source.length; index++) {
    const code = source.charCodeAt(index);
    a = Math.imul(a ^ code, 0x01000193); b = Math.imul(b ^ code, 0x85ebca6b);
    c = Math.imul(c ^ code, 0xc2b2ae35); d = Math.imul(d ^ code, 0x27d4eb2f);
  }
  return [a, b, c, d].map(value => (value >>> 0).toString(16).padStart(8, '0')).join('');
}

export function normalizeCoachProposal(value) {
  const keys = ['id', 'date', 'text', 'actions', 'model', 'sourceFingerprint', 'status', 'appliedIds'];
  if (!exact(value, keys) || !id(value.id, 60) || !validDate(value.date) || value.date > todayDate() || !text(value.model, 100) || typeof value.sourceFingerprint !== 'string' || !/^[a-f0-9]{32}$/.test(value.sourceFingerprint) || !['pending', 'applied', 'dismissed'].includes(value.status) || !Array.isArray(value.appliedIds) || value.appliedIds.some(value => !id(value)) || new Set(value.appliedIds).size !== value.appliedIds.length) return null;
  const content = validateContent({ text: value.text, actions: value.actions }, { date: value.date, structuralOnly: true });
  if (!content.ok || !content.value.actions.length || (value.status === 'applied' ? value.appliedIds.length !== value.actions.length : value.appliedIds.length !== 0)) return null;
  const expected = value.actions.map((action, index) => actionTargetId(action, value.id, index));
  if (value.status === 'applied' && expected.some((key, index) => key !== value.appliedIds[index])) return null;
  return { id: value.id, date: value.date, ...content.value, model: value.model, sourceFingerprint: value.sourceFingerprint, status: value.status, appliedIds: [...value.appliedIds] };
}

/** Resolve every action against the latest local state before a single atomic reducer commit. */
export function checkCoachProposal(state, proposal, { today = todayDate() } = {}) {
  const normalized = normalizeCoachProposal(proposal);
  if (!normalized) return fail('invalid_proposal', 'Пропозиція пошкоджена. Попроси тренера сформувати її знову.');
  const saved = (state.coachProposals || []).find(item => item.id === normalized.id);
  if ((saved && saved.status !== 'pending') || normalized.status !== 'pending') return fail('already_handled', 'Цю пропозицію вже застосовано або відхилено.');
  if (saved && canonical(saved) !== canonical(normalized)) return fail('proposal_changed', 'Збережена пропозиція відрізняється від показаної. Онови розмову.');
  if (!saved && (state.coachProposals || []).length >= COACH_PROPOSAL_LIMIT) return fail('proposal_capacity', 'Історія містить 100 пропозицій. Нові дії тренера поки не можна зберегти.');
  if (normalized.date !== today) return fail('day_changed', 'Настав інший день. Попроси нову пропозицію на сьогодні.');
  if (normalized.sourceFingerprint !== coachStateFingerprint(state, today)) return fail('stale_proposal', 'Твої записи змінилися. Попроси тренера оновити пропозицію.');
  const checked = validateCoachActions({ text: normalized.text, actions: normalized.actions }, { date: today, context: buildCoachActionContext(state, today), personalContext: { memoryConsent: true, memory: state.coachMemory || [] } });
  if (!checked.ok) return checked;
  const counts = { create_quest: (state.quests || []).length, create_habit: (state.habits || []).length, create_goal: (state.goals || []).length, create_memory: (state.coachMemory || []).length, record_expense: (state.expenses || []).length };
  const limits = { create_quest: 200, create_habit: 50, create_goal: 100, create_memory: COACH_MEMORY_LIMIT, record_expense: 10000 };
  const records = { create_quest: state.quests || [], create_habit: state.habits || [], create_goal: state.goals || [] };
  const allIds = new Set([...state.quests, ...state.habits, ...(state.goals || []), ...(state.coachMemory || []), ...(state.expenses || [])].map(item => item.id));
  const appliedIds = normalized.actions.map((action, index) => actionTargetId(action, normalized.id, index));
  if (new Set(appliedIds).size !== appliedIds.length) return fail('duplicate_target', 'Пропозиція містить неоднозначні посилання на записи.');
  for (const [index, action] of normalized.actions.entries()) {
    if (['create_memory','update_memory'].includes(action.type) && (state.coachMemory || []).some(item => item.id !== action.id && titleKey(item.text) === titleKey(action.text))) return fail('already_exists','Такий факт уже є в пам’яті.');
    if (action.type === 'record_expense' && (state.expenses || []).some(item => item.type !== 'income' && item.date === action.date && item.amount === action.amount && item.account === action.account && titleKey(item.title) === titleKey(action.title) && titleKey(item.category) === titleKey(action.category))) return fail('already_exists','Така витрата вже є за цю дату. Якщо це інша покупка, уточни її назву або додай вручну.');
    if (!createsRecord(action.type)) continue;
    if (++counts[action.type] > limits[action.type]) return fail('record_capacity', 'Недостатньо місця для всіх записів цієї пропозиції. Нічого не змінено.');
    if (allIds.has(appliedIds[index])) return fail('id_collision', 'Ці записи вже існують. Онови пропозицію.');
    if (records[action.type]?.some(item => !item.archived && item.status !== 'completed' && titleKey(item.title) === titleKey(action.title))) return fail('already_exists', `Запис «${action.title}» уже існує. Попроси змінити його замість створення копії.`);
  }
  const goalRefs = new Map(normalized.actions.flatMap((action, index) => action.type === 'create_goal' ? [[action.ref, appliedIds[index]]] : []));
  const operations = normalized.actions.map((action, index) => {
    const { type, ref, ...fields } = action;
    if (type === 'create_goal') return { type: 'ADD_GOAL', goal: { ...fields, id: appliedIds[index], current: 0 } };
    if (type === 'create_habit') return { type: 'ADD_HABIT', habit: { ...fields, id: appliedIds[index] } };
    if (type === 'create_quest') {
      const { goalRef, tier, ...quest } = fields;
      return { type: 'ADD_QUEST', quest: { ...quest, id: appliedIds[index], xp: tier ? tierXp(tier) : 30, goalId: goalRef === null ? quest.goalId : goalRefs.get(goalRef) } };
    }
    if (type === 'complete_quest') return { type: 'SET_QUEST_COMPLETED', id: action.id, date: action.date };
    if (type === 'set_habit_count') return { type: 'SET_HABIT_COUNT', id: action.id, date: action.date, value: action.value };
    if (type === 'create_memory') return { type: 'UPSERT_COACH_MEMORY', memory: { id: appliedIds[index], text: action.text, category: action.category } };
    if (type === 'update_memory') return { type: 'UPSERT_COACH_MEMORY', memory: { id: action.id, text: action.text, category: action.category } };
    if (type === 'delete_memory') return { type: 'DELETE_COACH_MEMORY', id: action.id };
    if (type === 'record_expense') return { type: 'ADD_EXPENSE', expense: { ...fields, id: appliedIds[index], type: 'expense' } };
    if (type === 'update_quest') { const { id, ...quest } = fields; return { type: 'UPDATE_QUEST', id, quest }; }
    if (type === 'archive_quest') return { type: 'ARCHIVE_QUEST', id: action.id };
    if (type === 'archive_habit') return { type: 'ARCHIVE_HABIT', id: action.id };
    if (type === 'set_checkin') return { type: 'SET_CHECKIN', date: action.date, checkIn: { mood: action.mood, energy: action.energy, note: action.note } };
    return { type: 'SET_GOAL_PROGRESS', id: action.id, value: action.value };
  });
  // A new quest can link a new goal regardless of the AI's presentation order.
  operations.sort((left, right) => Number(right.type === 'ADD_GOAL') - Number(left.type === 'ADD_GOAL'));
  return { ok: true, value: normalized, operations, appliedIds };
}
