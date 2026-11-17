import { CATEGORIES } from './catalog.js';
import { emptyLifeProfile, normalizeLifeProfile, validateDailyPlan } from './life-profile.js';
import { COACH_PROPOSAL_LIMIT, normalizeCoachProposal, checkCoachProposal } from './coach-actions.js';
import { COACH_MEMORY_LIMIT, normalizeCoachMemory } from './coach-personal.js';
import { DEFAULT_PORTRAIT } from './personal-portraits.js';
export { CATEGORIES } from './catalog.js';
export const STORAGE_KEY = 'krok-state-v1';

export const INITIAL_QUESTS = [
  { id: 'daily-move', title: '20 хвилин руху', description: 'Обери знайоме тренування й комфортний для себе темп.', category: 'body', xp: 40, minutes: 20, attribute: 'strength' },
  { id: 'daily-money', title: 'Запиши сьогоднішні витрати', description: 'Кава, дорога, покупки — зафіксуй, на що сьогодні пішли гроші.', category: 'money', xp: 30, minutes: 5, attribute: 'discipline' },
  { id: 'daily-connect', title: 'Напиши близькій людині', description: 'Запитай, як справи, поділися новиною або домовся про зустріч.', category: 'social', xp: 35, minutes: 5, attribute: 'charisma' },
  { id: 'daily-read', title: 'Прочитай 10 сторінок', description: 'Відклади телефон і приділи трохи уваги книжці, яку давно хотів прочитати.', category: 'growth', xp: 45, minutes: 15, attribute: 'intelligence' },
  { id: 'daily-cardio', title: 'Прогуляйся у своєму темпі', description: 'Вийди на свіже повітря та обери комфортний маршрут для короткої прогулянки.', category: 'body', xp: 25, minutes: 15, attribute: 'endurance' },
];

export const DEFAULT_HABITS = [
  { id: 'water', title: 'Пити воду', icon: 'water', category: 'nutrition', target: 8, unit: 'склянок', timeOfDay: 'any' },
  { id: 'book', title: 'Час для читання', icon: 'book', category: 'growth', target: 1, unit: 'сесія', timeOfDay: 'evening' },
  { id: 'moon', title: 'Вечір без скролінгу', icon: 'moon', category: 'sleep', target: 1, unit: 'вечір', timeOfDay: 'evening' },
];

const categoryIds = new Set(CATEGORIES.map((item) => item.id));
const coachTones = new Set(['supportive', 'buddy', 'direct']);
const coachTimeframes = new Set(['5', '10-15', '20-30', 'varies']);
const portraitPresets = new Set(['', 'photo-v1', 'traveler-v1']);
const defaultAttributes = Object.fromEntries(CATEGORIES.map(item => [item.id, item.attribute]));
const attributeIds = new Set(['strength', 'endurance', 'intelligence', 'discipline', 'charisma']);
const habitIcons = new Set(['water', 'book', 'moon', 'walk', 'food', 'mind', 'wallet', 'people', 'work', 'home', 'creative']);
const MAX_HABIT_TARGET = 10000;
const MAX_REWARDS = 500;
const cleanText = (value, max = 200) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isId = (value) => typeof value === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(value) && !['__proto__', 'constructor', 'prototype'].includes(value);
const uniqueId = (prefix) => `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`}`;
const integer = (value, min, max, fallback) => Number.isInteger(value) && value >= min && value <= max ? value : fallback;
const round = value => {
  const [coefficient, exponent = '0'] = String(value).split('e');
  return Math.round(Number(`${coefficient}e${Number(exponent) + 2}`)) / 100;
};
const weekdays = value => Array.isArray(value) && value.some(day => Number.isInteger(day) && day >= 0 && day <= 6) ? [...new Set(value.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b) : [1, 2, 3, 4, 5];

export function localDate(date = new Date()) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) throw new RangeError('Invalid date');
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function validDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(year, month - 1, day, 12);
  return year >= 2000 && year <= 2200 && localDate(date) === value;
}

function dayBefore(date) {
  const [year, month, day] = date.split('-').map(Number);
  return localDate(new Date(year, month - 1, day - 1, 12));
}

export function createInitialState(today = localDate()) {
  const createdAt = validDate(today) ? today : localDate();
  return {
    version: 1,
    schemaRevision: 5,
    profile: { name: 'Друже', goal: 'Щодня ставати трохи ближчим до себе.', focus: 'body', onboarded: false, avatar: '', portrait: DEFAULT_PORTRAIT, coachTone: 'supportive', coachMode: 'openai', coachContextConsent: false, coachActionsConsent: false, coachMemoryConsent: false, coachJournalConsent: false, coachPlan: { priorities: [], desiredChange: '', obstacle: '', dailyTime: '', extra: '', step: 0 }, lifeProfile: emptyLifeProfile(), bio: '', occupation: '' },
    quests: INITIAL_QUESTS.map(normalizeQuest),
    completions: {},
    habitLogs: {},
    habits: DEFAULT_HABITS.map(habit => normalizeHabit({ ...habit, createdAt })),
    expenses: [],
    rewards: [],
    messages: [],
    budgets: { monthLimit: 0, categories: {} },
    goals: [],
    checkIns: {},
    dailyPlans: [],
    coachProposals: [],
    coachMemory: [],
    createdAt,
  };
}

function normalizeQuest(quest) {
  if (!object(quest) || !isId(quest.id) || !cleanText(quest.title, 100) || !categoryIds.has(quest.category)) return null;
  const frequency = ['daily', 'weekdays', 'once'].includes(quest.frequency) ? quest.frequency : 'daily';
  if (frequency === 'once' && !validDate(quest.scheduledDate)) return null;
  return {
    id: quest.id,
    title: cleanText(quest.title, 100),
    description: cleanText(quest.description, 400),
    category: quest.category,
    attribute: attributeIds.has(quest.attribute) ? quest.attribute : defaultAttributes[quest.category],
    xp: integer(quest.xp, 5, 150, 30),
    minutes: integer(quest.minutes, 1, 180, 10),
    archived: quest.archived === true,
    frequency,
    weekdays: weekdays(quest.weekdays),
    scheduledDate: validDate(quest.scheduledDate) ? quest.scheduledDate : '',
    goalId: isId(quest.goalId) ? quest.goalId : null,
  };
}

function normalizeHabit(habit) {
  if (!object(habit) || !isId(habit.id) || !cleanText(habit.title, 80)) return null;
  return { id: habit.id, title: cleanText(habit.title, 80), icon: habitIcons.has(habit.icon) ? habit.icon : 'book', target: integer(habit.target, 1, MAX_HABIT_TARGET, 1), unit: cleanText(habit.unit, 30) || 'разів', category: categoryIds.has(habit.category) ? habit.category : ({ water: 'nutrition', moon: 'sleep' }[habit.icon] ?? 'growth'), timeOfDay: ['any', 'morning', 'day', 'evening'].includes(habit.timeOfDay) ? habit.timeOfDay : 'any', archived: habit.archived === true, frequency: habit.frequency === 'weekdays' ? 'weekdays' : 'daily', weekdays: weekdays(habit.weekdays), createdAt: validDate(habit.createdAt) ? habit.createdAt : '' };
}

function normalizeExpense(expense) {
  if (!object(expense) || !isId(expense.id) || !Number.isFinite(expense.amount) || expense.amount <= 0 || expense.amount > 1_000_000 || !validDate(expense.date)) return null;
  const title = cleanText(expense.title, 80);
  const amount = round(expense.amount);
  if (!title || amount <= 0) return null;
  return { id: expense.id, title, amount, category: cleanText(expense.category, 40) || 'Інше', date: expense.date, type: expense.type === 'income' ? 'income' : 'expense', account: expense.account === 'cash' ? 'cash' : 'card', note: cleanText(expense.note, 300) };
}

export function normalizeBudget(budget) {
  const normalized = { monthLimit: 0, categories: {} };
  if (!object(budget)) return normalized;
  if (Number.isFinite(budget.monthLimit) && budget.monthLimit >= 0 && budget.monthLimit <= 10_000_000) normalized.monthLimit = round(budget.monthLimit);
  if (object(budget.categories)) for (const [label, value] of Object.entries(budget.categories).slice(0, 100)) {
    const key = cleanText(label, 40);
    if (key && !['__proto__', 'constructor', 'prototype'].includes(key) && Number.isFinite(value) && value >= 0 && value <= 10_000_000) normalized.categories[key] = round(value);
  }
  return normalized;
}

export function normalizeGoal(goal) {
  if (!object(goal) || !isId(goal.id) || !cleanText(goal.title, 100) || !categoryIds.has(goal.category) || !Number.isFinite(goal.target) || goal.target <= 0 || goal.target > 10_000_000) return null;
  const target = round(goal.target);
  if (!target || (goal.current !== undefined && (!Number.isFinite(goal.current) || goal.current < 0 || goal.current > target))) return null;
  const current = goal.status === 'completed' ? target : round(goal.current ?? 0);
  return { id: goal.id, title: cleanText(goal.title, 100), category: goal.category, target, current, unit: cleanText(goal.unit, 30) || 'кроків', deadline: validDate(goal.deadline) ? goal.deadline : '', description: cleanText(goal.description, 500), status: current >= target ? 'completed' : 'active', createdAt: validDate(goal.createdAt) ? goal.createdAt : localDate() };
}

export function normalizeCheckIn(checkIn) {
  if (!object(checkIn) || !integer(checkIn.mood, 1, 5, 0) || !integer(checkIn.energy, 1, 5, 0)) return null;
  return { mood: checkIn.mood, energy: checkIn.energy, note: cleanText(checkIn.note, 500) };
}

function normalizeCoachPlan(value, fallback = {}) {
  const plan = object(value) ? value : object(fallback) ? fallback : {};
  const fallbackPriorities = Array.isArray(fallback?.priorities) ? fallback.priorities : [];
  return {
    priorities: Array.isArray(plan.priorities)
      ? [...new Set(plan.priorities.filter(id => categoryIds.has(id)))].slice(0, 3)
      : fallbackPriorities.filter(id => categoryIds.has(id)).slice(0, 3),
    desiredChange: cleanText(plan.desiredChange, 300),
    obstacle: cleanText(plan.obstacle, 300),
    dailyTime: coachTimeframes.has(plan.dailyTime) ? plan.dailyTime : '',
    extra: cleanText(plan.extra, 300),
    step: integer(plan.step, 0, 5, integer(fallback?.step, 0, 5, 0)),
  };
}

function migrateLifeProfile(profile) {
  const plan = normalizeCoachPlan(profile.coachPlan);
  const result = emptyLifeProfile();
  result.focus = plan.priorities;
  result.dailyMinutes = ({ '5': 5, '10-15': 15, '20-30': 30 })[plan.dailyTime] ?? 15;
  result.about = cleanText(plan.extra || profile.bio, 1000);
  for (const id of result.focus) result.domains[id] = { ...result.domains[id], desired: plan.desiredChange, obstacle: plan.obstacle };
  if (result.focus.length || result.about || plan.desiredChange || plan.obstacle || plan.dailyTime) result.status = 'in_progress';
  return result;
}

function normalizeDailyPlan(value) {
  if (!object(value) || !isId(value.id) || !validDate(value.date) || value.date > localDate()
    || typeof value.model !== 'string' || !value.model.trim() || value.model.length > 100) return null;
  const allowed = new Set(['id', 'date', 'summary', 'insights', 'quests', 'model', 'appliedQuestIds', 'sourceFingerprint']);
  if (Object.keys(value).some(key => !allowed.has(key))) return null;
  const content = validateDailyPlan({ summary: value.summary, insights: value.insights, quests: value.quests });
  if (!content) return null;
  const applied = value.appliedQuestIds === undefined ? [] : value.appliedQuestIds;
  if (!Array.isArray(applied) || (applied.length > 0 && applied.length !== content.quests.length) || applied.some(id => !isId(id)) || new Set(applied).size !== applied.length) return null;
  if (Object.hasOwn(value, 'sourceFingerprint') && (typeof value.sourceFingerprint !== 'string' || !/^[a-f0-9]{64}$/.test(value.sourceFingerprint))) return null;
  return { id: value.id, date: value.date, ...content, model: value.model.trim(), appliedQuestIds: [...applied], ...(value.sourceFingerprint === undefined ? {} : { sourceFingerprint: value.sourceFingerprint }) };
}

export function isQuestDue(quest, date = localDate()) {
  if (!quest || quest.archived || !validDate(date)) return false;
  if (quest.frequency === 'once') return quest.scheduledDate === date;
  if (quest.frequency === 'weekdays') { const [y, m, d] = date.split('-').map(Number); return weekdays(quest.weekdays).includes(new Date(y, m - 1, d, 12).getDay()); }
  return true;
}
export const selectActiveQuests = (state, date = localDate()) => state.quests.filter(quest => isQuestDue(quest, date) && (quest.frequency !== 'once' || !Object.entries(state.completions).some(([completedDate, ids]) => completedDate !== date && ids.includes(quest.id))));
export const isHabitDue = (habit, date = localDate()) => isQuestDue(habit, date);
export const selectActiveHabits = (state, date = localDate()) => state.habits.filter(habit => isHabitDue(habit, date));

export function habitStreak(state, id, date = localDate()) {
  const habit = state.habits.find(item => item.id === id);
  if (!habit || !validDate(date)) return 0;
  const schedule = { ...habit, archived: false };
  const start = habit.createdAt || state.createdAt;
  let cursor = date, streak = 0, firstDue = true;
  for (let i = 0; i < 3660 && (!start || cursor >= start); i++, cursor = dayBefore(cursor)) {
    if (!isHabitDue(schedule, cursor)) continue;
    const done = (state.habitLogs[cursor]?.[id] ?? 0) >= habit.target;
    if (firstDue && cursor === date && !done) { firstDue = false; continue; }
    firstDue = false;
    if (!done) break;
    streak++;
  }
  return streak;
}

function normalizeMessage(message) {
  if (!object(message) || !isId(message.id) || !['user', 'assistant'].includes(message.role) || !cleanText(message.text, 6000)) return null;
  const at = new Date(message.at);
  return { id: message.id, role: message.role, text: cleanText(message.text, 6000), source: message.source === 'openai' ? 'openai' : 'local', at: Number.isFinite(at.getTime()) ? at.toISOString() : new Date().toISOString() };
}

function uniqueItems(items, normalize, limit) {
  if (!Array.isArray(items)) return [];
  const result = [];
  const seen = new Set();
  for (const raw of items.slice(0, limit)) {
    const item = normalize(raw);
    if (item && !seen.has(item.id)) { result.push(item); seen.add(item.id); }
  }
  return result;
}

function normalizeProfile(profile, fallback) {
  if (!object(profile)) return fallback;
  const avatar = profile.avatar === '' || (typeof profile.avatar === 'string' && profile.avatar.length <= 1_500_000 && /^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(profile.avatar)) ? profile.avatar : (fallback.avatar ?? '');
  // Preserve explicit legacy selections and custom photos. Public presentation
  // ignores personal presets without rewriting the stored profile or backup.
  const portrait = Object.hasOwn(profile, 'portrait') ? (portraitPresets.has(profile.portrait) ? profile.portrait : '') : (avatar ? '' : DEFAULT_PORTRAIT);
  return {
    name: cleanText(profile.name, 40) || fallback.name,
    goal: cleanText(profile.goal, 250) || fallback.goal,
    bio: cleanText(profile.bio, 300),
    occupation: cleanText(profile.occupation, 80),
    focus: categoryIds.has(profile.focus) ? profile.focus : fallback.focus,
    onboarded: typeof profile.onboarded === 'boolean' ? profile.onboarded : fallback.onboarded,
    coachTone: coachTones.has(profile.coachTone) ? profile.coachTone : (coachTones.has(fallback.coachTone) ? fallback.coachTone : 'supportive'),
    coachMode: profile.coachMode === 'local' ? 'local' : 'openai',
    coachContextConsent: profile.coachContextConsent === true,
    coachActionsConsent: profile.coachActionsConsent === true,
    coachMemoryConsent: profile.coachMemoryConsent === true,
    coachJournalConsent: profile.coachJournalConsent === true,
    coachPlan: normalizeCoachPlan(profile.coachPlan, fallback.coachPlan),
    lifeProfile: Object.hasOwn(profile, 'lifeProfile') ? normalizeLifeProfile(profile.lifeProfile) : migrateLifeProfile(profile),
    avatar,
    portrait,
  };
}

export function restoreState(raw) {
  if (!object(raw) || raw.version !== 1) return createInitialState();
  const initial = createInitialState();
  const quests = uniqueItems(raw.quests, normalizeQuest, 200);
  const habits = uniqueItems(raw.habits, normalizeHabit, 50);
  const state = {
    ...initial,
    profile: normalizeProfile(raw.profile, initial.profile),
    quests: quests.length ? quests : initial.quests,
    habits: habits.length ? habits : initial.habits,
    createdAt: validDate(raw.createdAt) ? raw.createdAt : initial.createdAt,
    expenses: uniqueItems(raw.expenses, normalizeExpense, 10000).filter(expense => expense.date <= localDate()),
    messages: uniqueItems(raw.messages, normalizeMessage, 500),
    budgets: normalizeBudget(raw.budgets),
    goals: uniqueItems(raw.goals, normalizeGoal, 100),
    dailyPlans: uniqueItems(raw.dailyPlans, normalizeDailyPlan, 30),
    coachProposals: uniqueItems(raw.coachProposals, normalizeCoachProposal, COACH_PROPOSAL_LIMIT),
    coachMemory: uniqueItems(raw.coachMemory, normalizeCoachMemory, COACH_MEMORY_LIMIT).filter(item => item.updatedAt <= localDate()),
    ...(object(raw.demo) && raw.demo.synthetic === true ? { demo: { synthetic: true, description: cleanText(raw.demo.description, 200) } } : {}),
  };
  state.habits = state.habits.map(habit => ({ ...habit, createdAt: habit.createdAt || state.createdAt }));
  const goalIds = new Set(state.goals.map(goal => goal.id));
  state.quests = state.quests.map(quest => ({ ...quest, goalId: goalIds.has(quest.goalId) ? quest.goalId : null }));
  const questIds = new Set(state.quests.map((quest) => quest.id));
  const today = localDate();
  if (object(raw.completions)) {
    for (const [date, ids] of Object.entries(raw.completions)) {
      if (validDate(date) && date <= today && Array.isArray(ids)) state.completions[date] = [...new Set(ids.filter((id) => questIds.has(id)))];
    }
  }
  if (object(raw.habitLogs)) {
    for (const [date, logs] of Object.entries(raw.habitLogs)) {
      if (!validDate(date) || date > today || !object(logs)) continue;
      state.habitLogs[date] = {};
      for (const habit of state.habits) if (Object.hasOwn(logs, habit.id)) state.habitLogs[date][habit.id] = integer(logs[habit.id], 0, MAX_HABIT_TARGET, 0);
    }
  }
  if (object(raw.checkIns)) for (const [date, checkIn] of Object.entries(raw.checkIns)) {
    const normalized = normalizeCheckIn(checkIn);
    if (validDate(date) && date <= today && normalized) state.checkIns[date] = normalized;
  }
  const rewards = uniqueItems(raw.rewards, (reward) => object(reward) && isId(reward.id) && integer(reward.cost, 1, 100000, 0) && validDate(reward.date) && reward.date <= today ? { id: reward.id, cost: reward.cost, date: reward.date } : null, MAX_REWARDS);
  let available = selectStats(state).totalXp;
  for (const reward of rewards) {
    if (reward.cost <= available) { state.rewards.push(reward); available -= reward.cost; }
  }
  return state;
}

export function loadState(storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    const raw = target?.getItem(STORAGE_KEY);
    return raw ? restoreState(JSON.parse(raw)) : createInitialState();
  } catch { return createInitialState(); }
}

export function saveState(state, storage) {
  try {
    const target = storage ?? globalThis.localStorage;
    if (!target) return false;
    target.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch { return false; }
}

export function reducer(state, action) {
  const today = localDate();
  const date = action?.date ?? today;
  if (!object(action)) return state;
  switch (action.type) {
    case 'SET_QUEST_COMPLETED': {
      const quest = state.quests.find(item => item.id === action.id);
      if (!validDate(date) || date > today || !isQuestDue(quest, date)) return state;
      const completed = state.completions[date] ?? [];
      if (completed.includes(action.id) || (quest.frequency === 'once' && Object.values(state.completions).some(ids => ids.includes(quest.id)))) return state;
      return { ...state, completions: { ...state.completions, [date]: [...completed, action.id] } };
    }
    case 'TOGGLE_QUEST': {
      const quest = state.quests.find(item => item.id === action.id);
      if (!validDate(date) || date > today || !isQuestDue(quest, date)) return state;
      const completed = state.completions[date] ?? [];
      const isDone = completed.includes(action.id);
      if (!isDone && quest.frequency === 'once' && Object.values(state.completions).some(ids => ids.includes(quest.id))) return state;
      // Spent XP remains earned: prevent reversing a completion already funding a reward.
      if (isDone && selectStats(state).balance < quest.xp) return state;
      return { ...state, completions: { ...state.completions, [date]: isDone ? completed.filter((id) => id !== action.id) : [...completed, action.id] } };
    }
    case 'ADD_QUEST': {
      const quest = normalizeQuest({ ...action.quest, id: action.quest?.id ?? uniqueId('quest') });
      if (!quest || state.quests.length >= 200 || state.quests.some((item) => item.id === quest.id)) return state;
      if (quest.goalId && !(state.goals ?? []).some(goal => goal.id === quest.goalId)) return state;
      return { ...state, quests: [...state.quests, quest] };
    }
    case 'UPDATE_QUEST': {
      const old = state.quests.find(item => item.id === action.id);
      if (!old || !object(action.quest)) return state;
      const quest = normalizeQuest({ ...old, ...action.quest, id: old.id });
      if (!quest || (quest.goalId && !(state.goals ?? []).some(goal => goal.id === quest.goalId))) return state;
      const recorded = Object.values(state.completions).some(ids => ids.includes(old.id));
      if (recorded && ['xp', 'attribute', 'category'].some(key => quest[key] !== old[key])) return state;
      return { ...state, quests: state.quests.map(item => item.id === old.id ? quest : item) };
    }
    case 'ARCHIVE_QUEST':
    case 'RESTORE_QUEST': return state.quests.some(item => item.id === action.id) ? { ...state, quests: state.quests.map(item => item.id === action.id ? { ...item, archived: action.type === 'ARCHIVE_QUEST' } : item) } : state;
    case 'LOG_HABIT':
    case 'SET_HABIT_COUNT':
    case 'RESET_HABIT': {
      const habit = state.habits.find((item) => item.id === action.id);
      if (!habit || !validDate(date) || date > today || !isHabitDue(habit, date)) return state;
      const logs = state.habitLogs[date] ?? {};
      const current = logs[action.id] ?? 0;
      if (action.type === 'LOG_HABIT' && !integer(action.amount ?? 1, 1, MAX_HABIT_TARGET, 0)) return state;
      if (action.type === 'SET_HABIT_COUNT' && integer(action.value, 0, habit.target, -1) === -1) return state;
      const value = action.type === 'RESET_HABIT' ? 0 : action.type === 'SET_HABIT_COUNT' ? action.value : Math.min(habit.target, current + (action.amount ?? 1));
      if (value === current) return state;
      return { ...state, habitLogs: { ...state.habitLogs, [date]: { ...logs, [action.id]: value } } };
    }
    case 'ADD_HABIT': {
      const habit = normalizeHabit({ ...action.habit, id: action.habit?.id ?? uniqueId('habit'), createdAt: today });
      if (!habit || state.habits.length >= 50 || state.habits.some((item) => item.id === habit.id)) return state;
      return { ...state, habits: [...state.habits, habit] };
    }
    case 'UPDATE_HABIT': {
      const old = state.habits.find(item => item.id === action.id);
      if (!old || !object(action.habit)) return state;
      const habit = normalizeHabit({ ...old, ...action.habit, id: old.id, createdAt: old.createdAt });
      if (!habit || (habit.target !== old.target && Object.values(state.habitLogs).some(logs => (logs[old.id] ?? 0) > 0))) return state;
      return { ...state, habits: state.habits.map(item => item.id === old.id ? habit : item) };
    }
    case 'ARCHIVE_HABIT':
    case 'RESTORE_HABIT': return state.habits.some(item => item.id === action.id) ? { ...state, habits: state.habits.map(item => item.id === action.id ? { ...item, archived: action.type === 'ARCHIVE_HABIT' } : item) } : state;
    case 'ADD_EXPENSE': {
      const expense = normalizeExpense({ ...action.expense, id: action.expense?.id ?? uniqueId('expense'), date: action.expense?.date ?? today });
      if (!expense || expense.date > today || state.expenses.length >= 10000 || state.expenses.some((item) => item.id === expense.id)) return state;
      return { ...state, expenses: [expense, ...state.expenses] };
    }
    case 'UPDATE_EXPENSE': {
      const old = state.expenses.find(item => item.id === action.id);
      if (!old || !object(action.expense)) return state;
      const expense = normalizeExpense({ ...old, ...action.expense, id: old.id });
      if (!expense || expense.date > today) return state;
      return { ...state, expenses: state.expenses.map(item => item.id === old.id ? expense : item) };
    }
    case 'DELETE_EXPENSE': return state.expenses.some((item) => item.id === action.id) ? { ...state, expenses: state.expenses.filter((item) => item.id !== action.id) } : state;
    case 'UPDATE_BUDGET': {
      if (!object(action.budget)) return state;
      const merged = { ...(state.budgets ?? { monthLimit: 0, categories: {} }), ...action.budget };
      if (!Number.isFinite(merged.monthLimit) || merged.monthLimit < 0 || merged.monthLimit > 10_000_000 || !object(merged.categories) || Object.values(merged.categories).some(value => !Number.isFinite(value) || value < 0 || value > 10_000_000)) return state;
      return { ...state, budgets: normalizeBudget(merged) };
    }
    case 'ADD_GOAL': {
      const goal = normalizeGoal({ ...action.goal, id: action.goal?.id ?? uniqueId('goal'), createdAt: today });
      if (!goal || (state.goals ?? []).length >= 100 || (state.goals ?? []).some(item => item.id === goal.id)) return state;
      return { ...state, goals: [...(state.goals ?? []), goal] };
    }
    case 'UPDATE_GOAL': {
      const old = (state.goals ?? []).find(item => item.id === action.id);
      if (!old || !object(action.goal)) return state;
      const patch = { ...old, ...action.goal, id: old.id, createdAt: old.createdAt };
      if ((action.goal.current !== undefined || action.goal.target !== undefined) && action.goal.status === undefined) patch.status = 'active';
      const goal = normalizeGoal(patch);
      if (!goal) return state;
      return { ...state, goals: state.goals.map(item => item.id === old.id ? goal : item) };
    }
    case 'LOG_GOAL':
    case 'SET_GOAL_PROGRESS': {
      const old = (state.goals ?? []).find(item => item.id === action.id);
      const amount = action.type === 'LOG_GOAL' ? action.amount : action.value;
      if (!old || !Number.isFinite(amount) || amount < 0 || (action.type === 'LOG_GOAL' && amount === 0) || (action.type === 'SET_GOAL_PROGRESS' && amount > old.target)) return state;
      const current = round(action.type === 'LOG_GOAL' ? Math.min(old.target, old.current + amount) : amount);
      return { ...state, goals: state.goals.map(item => item.id === old.id ? { ...old, current, status: current >= old.target ? 'completed' : 'active' } : item) };
    }
    case 'DELETE_GOAL': return (state.goals ?? []).some(item => item.id === action.id) ? { ...state, goals: state.goals.filter(item => item.id !== action.id), quests: state.quests.map(quest => quest.goalId === action.id ? { ...quest, goalId: null } : quest) } : state;
    case 'SET_CHECKIN': {
      const checkIn = normalizeCheckIn(action.checkIn);
      if (!checkIn || !validDate(date) || date > today) return state;
      return { ...state, checkIns: { ...(state.checkIns ?? {}), [date]: checkIn } };
    }
    case 'DELETE_CHECKIN': return validDate(date) && date <= today && Object.hasOwn(state.checkIns ?? {}, date) ? { ...state, checkIns: Object.fromEntries(Object.entries(state.checkIns).filter(([key]) => key !== date)) } : state;
    case 'UPSERT_COACH_MEMORY': {
      const memory = normalizeCoachMemory({ ...action.memory, id: action.memory?.id ?? uniqueId('memory'), updatedAt: today });
      if (!memory) return state;
      const items = state.coachMemory || [];
      const existing = items.find(item => item.id === memory.id);
      if ((!existing && items.length >= COACH_MEMORY_LIMIT) || items.some(item => item.id !== memory.id && item.text.toLocaleLowerCase('uk') === memory.text.toLocaleLowerCase('uk'))) return state;
      return { ...state, coachMemory: existing ? items.map(item => item.id === memory.id ? memory : item) : [...items,memory] };
    }
    case 'DELETE_COACH_MEMORY': return (state.coachMemory || []).some(item => item.id === action.id) ? { ...state, coachMemory: state.coachMemory.filter(item => item.id !== action.id) } : state;
    case 'UPDATE_PROFILE': return { ...state, profile: normalizeProfile({ ...state.profile, ...action.profile }, state.profile) };
    case 'SAVE_COACH_PROPOSAL': {
      const proposal = normalizeCoachProposal(action.proposal);
      const current = state.coachProposals ?? [];
      if (!proposal || proposal.status !== 'pending' || proposal.date !== today || current.length >= COACH_PROPOSAL_LIMIT || current.some(item => item.id === proposal.id)) return state;
      return { ...state, coachProposals: [...current, proposal] };
    }
    case 'DISMISS_COACH_PROPOSAL': {
      if (!(state.coachProposals ?? []).some(item => item.id === action.id && item.status === 'pending')) return state;
      return { ...state, coachProposals: state.coachProposals.map(item => item.id === action.id ? { ...item, status: 'dismissed' } : item) };
    }
    case 'APPLY_COACH_PROPOSAL': {
      const proposal = (state.coachProposals ?? []).find(item => item.id === action.id);
      const checked = checkCoachProposal(state, proposal, { today });
      if (!checked.ok) return state;
      let next = state;
      for (const operation of checked.operations) {
        const updated = reducer(next, operation);
        if (operation.type.startsWith('ADD_') && updated === next) return state;
        if (operation.type === 'SET_QUEST_COMPLETED' && !(updated.completions[operation.date] ?? []).includes(operation.id)) return state;
        if (operation.type === 'SET_HABIT_COUNT' && (updated.habitLogs[operation.date]?.[operation.id] ?? 0) !== operation.value) return state;
        if (operation.type === 'SET_GOAL_PROGRESS' && updated.goals.find(item => item.id === operation.id)?.current !== operation.value) return state;
        if (operation.type === 'UPSERT_COACH_MEMORY' && !updated.coachMemory?.some(item => item.id === operation.memory.id && item.text === operation.memory.text.trim() && item.category === operation.memory.category)) return state;
        if (operation.type === 'DELETE_COACH_MEMORY' && updated.coachMemory?.some(item => item.id === operation.id)) return state;
        if (operation.type === 'UPDATE_QUEST' && updated === next) return state;
        if (operation.type === 'SET_CHECKIN' && !Object.entries(operation.checkIn).every(([key,value]) => updated.checkIns?.[operation.date]?.[key] === (typeof value === 'string' ? value.trim() : value))) return state;
        next = updated;
      }
      if (localDate() !== today) return state;
      return { ...next, coachProposals: next.coachProposals.map(item => item.id === proposal.id ? { ...item, status: 'applied', appliedIds: checked.appliedIds } : item) };
    }
    case 'SAVE_DAILY_PLAN': {
      const plan = normalizeDailyPlan(action.plan);
      const current = state.dailyPlans ?? [];
      // Reusing an ID never overwrites a saved preview or its accepted marker.
      if (!plan || plan.appliedQuestIds.length || current.some(item => item.id === plan.id)) return state;
      const next = [...current, plan];
      while (next.length > 30) {
        const discard = next.findIndex(item => item.date !== today || !item.appliedQuestIds.length);
        next.splice(discard === -1 ? 0 : discard, 1);
      }
      return { ...state, dailyPlans: next };
    }
    case 'APPLY_DAILY_PLAN': {
      const plans = state.dailyPlans ?? [];
      const plan = plans.find(item => item.id === action.id);
      if (!plan || plan.date !== today || plan.appliedQuestIds.length || plans.some(item => item.date === today && item.appliedQuestIds.length)) return state;
      if (plan.sourceFingerprint && action.sourceFingerprint !== plan.sourceFingerprint) return state;
      const supplied = action.quests === undefined ? plan.quests : action.quests;
      if (!Array.isArray(supplied) || supplied.length > plan.quests.length) return state;
      const content = validateDailyPlan({ summary: plan.summary, insights: plan.insights, quests: supplied }, { profile: normalizeLifeProfile(state.profile.lifeProfile) });
      if (!content || state.quests.length + content.quests.length > 200) return state;
      const additions = content.quests.map(quest => normalizeQuest({ ...quest, id: uniqueId('plan-quest'), xp: 30, attribute: defaultAttributes[quest.category], frequency: 'once', scheduledDate: today }));
      if (additions.some(quest => !quest || state.quests.some(existing => existing.id === quest.id)) || new Set(additions.map(quest => quest.id)).size !== additions.length) return state;
      return { ...state, quests: [...state.quests, ...additions], dailyPlans: plans.map(item => item.id === plan.id ? { ...item, quests: content.quests, appliedQuestIds: additions.map(quest => quest.id) } : item) };
    }
    case 'CLAIM_REWARD': {
      if (!isId(action.id) || !integer(action.cost, 1, 100000, 0) || state.rewards.length >= MAX_REWARDS || state.rewards.some((reward) => reward.id === action.id) || selectStats(state).balance < action.cost) return state;
      return { ...state, rewards: [...state.rewards, { id: action.id, cost: action.cost, date: today }] };
    }
    case 'ADD_MESSAGE': {
      const message = normalizeMessage({ ...action.message, id: action.message?.id ?? uniqueId('message'), at: action.message?.at ?? new Date().toISOString() });
      if (!message || state.messages.some((item) => item.id === message.id)) return state;
      return { ...state, messages: [...state.messages, message].slice(-500) };
    }
    case 'RESET': return createInitialState();
    default: return state;
  }
}

export function selectStats(state, today = localDate()) {
  const questById = new Map(state.quests.map((quest) => [quest.id, quest]));
  const activeQuests = selectActiveQuests(state, today);
  const activeIds = new Set(activeQuests.map(quest => quest.id));
  const categoryStats = Object.fromEntries(CATEGORIES.map(({ id }) => [id, { totalXp: 0, completed: 0, todayCompleted: 0, todayTotal: activeQuests.filter((quest) => quest.category === id).length }]));
  const attributes = Object.fromEntries([...attributeIds].map((id) => [id, 0]));
  let totalXp = 0;
  let todayXp = 0;
  let todayCompleted = 0;
  const activeDates = new Set();
  for (const [date, rawIds] of Object.entries(state.completions)) {
    if (!validDate(date) || date > today || !Array.isArray(rawIds)) continue;
    for (const id of new Set(rawIds)) {
      const quest = questById.get(id);
      if (!quest) continue;
      totalXp += quest.xp;
      attributes[attributeIds.has(quest.attribute) ? quest.attribute : defaultAttributes[quest.category]] += quest.xp;
      categoryStats[quest.category].totalXp += quest.xp;
      categoryStats[quest.category].completed += 1;
      activeDates.add(date);
      if (date === today) { todayXp += quest.xp; if (activeIds.has(id)) { todayCompleted += 1; categoryStats[quest.category].todayCompleted += 1; } }
    }
  }
  let cursor = activeDates.has(today) ? today : dayBefore(today);
  let streak = 0;
  while (activeDates.has(cursor)) { streak += 1; cursor = dayBefore(cursor); }
  const spent = state.rewards.reduce((sum, reward) => sum + reward.cost, 0);
  return { totalXp, level: Math.floor(totalXp / 300) + 1, currentLevelXp: totalXp % 300, nextLevelXp: 300, streak, todayCompleted, todayTotal: activeQuests.length, todayXp, balance: Math.max(0, totalXp - spent), categoryStats, attributes };
}

export function selectFinance(state, options = {}) {
  if (typeof options === 'string') options = { month: options };
  const month = /^\d{4}-(?:0[1-9]|1[0-2])$/.test(options.month ?? '') ? options.month : localDate().slice(0, 7);
  const monthly = state.expenses.filter(item => item.date.startsWith(`${month}-`));
  const cents = items => items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0) / 100;
  const income = cents(monthly.filter(item => item.type === 'income'));
  const expenses = monthly.filter(item => item.type !== 'income');
  const expense = cents(expenses);
  const limit = state.budgets?.monthLimit ?? 0;
  const categoryLimits = state.budgets?.categories ?? {};
  const labels = [...new Set([...expenses.map(item => item.category), ...Object.keys(categoryLimits)])];
  const byCategory = labels.map(category => { const amount = cents(expenses.filter(item => item.category === category)); return { category, amount, percent: expense ? round(amount / expense * 100) : 0, limit: Object.hasOwn(categoryLimits, category) ? categoryLimits[category] : 0 }; }).sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category, 'uk'));
  const [year, monthIndex] = month.split('-').map(Number);
  const days = new Date(year, monthIndex, 0, 12).getDate();
  const daily = Array.from({ length: days }, (_, index) => { const date = `${month}-${String(index + 1).padStart(2, '0')}`; const entries = monthly.filter(item => item.date === date); return { date, income: cents(entries.filter(item => item.type === 'income')), expense: cents(entries.filter(item => item.type !== 'income')) }; });
  const query = cleanText(options.query, 100).toLocaleLowerCase('uk-UA');
  const transactions = monthly.filter(item => (!options.category || options.category === 'all' || item.category === options.category) && (!options.type || options.type === 'all' || (item.type ?? 'expense') === options.type) && (!query || `${item.title} ${item.note ?? ''} ${item.category}`.toLocaleLowerCase('uk-UA').includes(query))).sort((a, b) => b.date.localeCompare(a.date));
  return { month, income, expense, balance: round(income - expense), limit, remaining: limit ? round(limit - expense) : null, savingRate: income ? round((income - expense) / income * 100) : null, byCategory, daily, transactions, transactionCount: monthly.length };
}

export function coachReply(message, state) {
  const input = cleanText(message, 2000).toLocaleLowerCase('uk-UA');
  const stats = selectStats(state);
  const completed = new Set(state.completions[localDate()] ?? []);
  const activeQuests = selectActiveQuests(state);
  const nextQuest = activeQuests.find((quest) => quest.category === state.profile.focus && !completed.has(quest.id)) ?? activeQuests.find((quest) => !completed.has(quest.id));
  const tone = coachTones.has(state.profile.coachTone) ? state.profile.coachTone : 'supportive';
  const say = (supportive, buddy, direct) => ({ supportive, buddy, direct })[tone];
  if (/як (ти )?працю|справжн|штучн|\bai\b|(?:^|[^\p{L}])ші(?:$|[^\p{L}])/u.test(input)) return say(
    'Я — локальний помічник КРОК із готовими сценаріями, без підключення до ШІ. Бачу твої квести та прогрес у цьому браузері й можу запропонувати наступний маленький крок. Спробуй: «Що зробити сьогодні?»',
    'По-чесному, друже: я локальний помічник із готовими сценаріями, без підключення до ШІ. Беру твої квести й прогрес із цього браузера та підказую, з чого почати. Запитай: «Що зробити сьогодні?»',
    'Факти: локальні сценарії, без підключення до ШІ. Використовую квести та прогрес із цього браузера. Можу запропонувати наступну дію, показати прогрес або допомогти з обліком витрат.',
  );
  if (/втом|важко|нема(?:є)? сил|без сил|мотива|лін|зрив|не мож|пропуст/.test(input)) return say(
    `Сьогодні можна зменшити темп. Обери одну дію на 5 хвилин і дозволь собі зупинитися після неї. ${nextQuest ? `Наприклад, почни квест «${nextQuest.title}» у зручному для себе обсязі.` : 'Твої квести на сьогодні вже виконані — час відпочити.'} Пропущений день не перекреслює того, що вже зроблено.`,
    `Друже, не тягни на собі весь список. ${nextQuest ? `Давай так: 5 хвилин на «${nextQuest.title}», а далі подивишся по силах.` : 'Ти вже закрив сьогоднішні квести — тепер можна видихнути.'} Один важкий день не обнуляє твій шлях. Якщо потрібен відпочинок — відпочинь.`,
    `Зменшуємо обсяг. ${nextQuest ? `Обери «${nextQuest.title}» і виділи 5 хвилин на початок. Потім оціни, чи хочеш продовжити.` : 'Квести виконані. На сьогодні досить.'} Виснаження не ігноруй: відпочинок теж потрібен. Завтра повернися до плану.`,
  );
  if (/грош|фінанс|витрат|бюджет|економ|покуп/.test(input)) {
    const sum = state.expenses.filter((expense) => expense.date === localDate() && expense.type !== 'income').reduce((total, expense) => total + expense.amount, 0);
    const amount = sum.toLocaleString('uk-UA', { maximumFractionDigits: 2 });
    return say(
      `Почни з видимості: запиши сьогоднішні витрати в розділі «Гроші». ${sum ? `Зараз у тебе записано ${amount} ₴ за сьогодні.` : 'За сьогодні ще немає записів.'} Потім обери одну покупку й запитай себе, чи вона була для тебе корисною. Тут ми ведемо облік, а не оцінюємо твої рішення.`,
      `Давай розберемося з грошима без самокритики. ${sum ? `За сьогодні вже записано ${amount} ₴.` : 'За сьогодні витрат ще не записано.'} Згадай каву, дорогу й покупки та додай їх у «Гроші». Потім глянь, які з них були того варті. Спершу просто побачимо картину.`,
      `План: відкрий «Гроші» й запиши всі сьогоднішні витрати. Зараз у журналі: ${amount} ₴. Перевір пропущені покупки. Обери одну категорію, за якою хочеш стежити цього тижня.`,
    );
  }
  if (/друг|стосунк|близьк|соціал|спілку|людин|самот/.test(input)) return say(
    'Обери одну людину, з якою давно не говорив. Можна почати просто: «Привіт, сьогодні згадав про тебе. Як ти?» Невелике щире повідомлення — уже крок. Якщо зараз не хочеться спілкуватися, заплануй це на зручний день.',
    'Згадай когось, із ким давно не балакав. Без ідеального приводу: «Привіт, як ти? Давно не списувалися». Оце вже хороший початок, друже. Не треба змушувати себе до великої розмови — короткого повідомлення вистачить.',
    'Одна дія: обери близьку людину й напиши коротке повідомлення. Запитай, як справи. За бажанням запропонуй час для розмови. Якщо сьогодні не готовий — постав конкретний зручний день.',
  );
  if (/спорт|тренув|тіло|рух|прогул/.test(input)) return say(
    'Почни з квесту на рух, який тобі комфортний: наприклад, короткої прогулянки. Виділи зручний час і відзнач виконання, коли завершиш. Навантаження та темп обирай за своїм самопочуттям.',
    'Давай трохи порухаємося: вибери знайоме тренування або просто вийди на прогулянку. Без рекордів заради галочки, друже — у своєму темпі. Закінчиш — відзнач квест і забери свій досвід.',
    'Обери комфортний квест на рух. Визнач час початку. Працюй у темпі, що відповідає самопочуттю. Після завершення відзнач результат. Біль і виснаження не є завданням.',
  );
  if (/звичк|сон|воду|читан/.test(input)) return say(
    'Прив’яжи одну звичку до того, що вже робиш щодня: після сніданку — сторінка книжки, перед вечірнім відпочинком — телефон убік. У розділі «Звички» можна додати власну ціль і відмічати її. Почни з кількості, яку легко повторити.',
    'Бери одну звичку, друже. Наприклад: поснідав — прочитав сторінку. Не треба перебудовувати весь день одразу. Додай її у «Звички», постав посильну ціль і відмічай. Так буде простіше повернутися до неї завтра.',
    'Обери одну звичку. Вкажи, після якої щоденної дії її виконуватимеш. Постав мінімальний посильний обсяг у розділі «Звички». Виконав — відзнач. Збільшуй ціль лише коли готовий.',
  );
  if (/прогрес|рівень|досяг|сері|сил[ауи]|інтелект|витривал/.test(input)) return say(
    `Твій поточний рівень — ${stats.level}, зароблено ${stats.totalXp} XP. Сьогодні виконано ${stats.todayCompleted} із ${stats.todayTotal} квестів, поточна серія — ${stats.streak} дн. ${stats.todayCompleted ? 'Кожен із цих кроків уже твій.' : 'Перший виконаний квест запустить сьогоднішній прогрес.'}`,
    `Дивись, друже: рівень ${stats.level}, у скарбничці досвіду ${stats.totalXp} XP. Сьогодні закрито ${stats.todayCompleted} із ${stats.todayTotal} квестів, серія — ${stats.streak} дн. ${stats.todayCompleted ? 'Це твої реальні зроблені кроки. Рухаємось у твоєму темпі.' : 'Давай почнемо з одного посильного квесту.'}`,
    `Факти: рівень ${stats.level}; ${stats.totalXp} XP; сьогодні ${stats.todayCompleted}/${stats.todayTotal} квестів; серія ${stats.streak} дн. ${nextQuest ? `Наступна дія: «${nextQuest.title}».` : 'План на сьогодні завершено. Відпочинь.'}`,
  );
  if (!nextQuest) return say(
    'Усі сьогоднішні квести виконані. Зупинися на хвилину й поміть, що вдалося. Можеш записати нову ціль або просто відпочити — завтра почнеться новий день.',
    'Усе на сьогодні закрито, друже. Можна видихнути й зайнятися чимось приємним. Завтра продовжиш — додаткові галочки зараз не обов’язкові.',
    'Усі сьогоднішні квести виконані. Зафіксуй результат. Завершуй день і відпочивай. Наступний план — завтра.',
  );
  return say(
    `Твоя ціль: ${state.profile.goal} Пропоную почати з «${nextQuest.title}» — приблизно ${nextQuest.minutes} хв. ${nextQuest.description} Після завершення відзнач квест: отримаєш ${nextQuest.xp} XP. Я працюю за локальними сценаріями; можеш також запитати про звички, витрати чи прогрес.`,
    `Друже, давай один крок до твоєї цілі: ${state.profile.goal} Бери «${nextQuest.title}» — близько ${nextQuest.minutes} хв. ${nextQuest.description} Зробиш — відзначиш і забереш ${nextQuest.xp} XP. Мої підказки працюють за локальними сценаріями.`,
    `Ціль: ${state.profile.goal} Наступна дія: «${nextQuest.title}». Час: приблизно ${nextQuest.minutes} хв. ${nextQuest.description} Заверши й відзнач квест: +${nextQuest.xp} XP. Це локальна сценарна підказка.`,
  );
}
