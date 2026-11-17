import { createInitialState, isHabitDue, isQuestDue, localDate } from './model.js';
import { HABIT_TEMPLATES, QUEST_TEMPLATES } from './catalog.js';

/** Synthetic, deterministic example. Never call this to initialize personal storage. */
export function createDemoState(today = localDate()) {
  const [year, month, day] = today.split('-').map(Number);
  const offset = days => localDate(new Date(year, month - 1, day + days, 12));
  const start = offset(-29);
  const state = createInitialState(start);
  state.demo = { synthetic: true, description: 'Вигаданий профіль Олексія. Усі записи створені лише для знайомства із застосунком.' };
  state.profile = { ...state.profile, name: 'Олексій', goal: 'Мати більше енергії, читати регулярно й зібрати запас на подорож.', focus: 'body', onboarded: true, coachTone: 'buddy', occupation: 'Продуктовий дизайнер', bio: 'Працюю з дому, люблю книжки та прогулянки містом. Вчу англійську й шукаю свій спокійний ритм.' };
  const questIds = ['tpl-strength', 'tpl-walk', 'tpl-budget', 'tpl-message', 'tpl-read', 'tpl-lunch', 'tpl-evening', 'tpl-checkin', 'tpl-focus', 'tpl-desk', 'tpl-sketch', 'tpl-course'];
  state.quests = questIds.map((id, index) => ({ ...QUEST_TEMPLATES.find(item => item.id === id), id: `demo-q-${index}`, weekdays: [...QUEST_TEMPLATES.find(item => item.id === id).weekdays] }));
  state.quests[10] = { ...state.quests[10], frequency: 'weekdays', weekdays: [2, 6] };
  const habitIds = ['ht-water', 'ht-read', 'ht-evening', 'ht-walk', 'ht-journal', 'ht-expenses', 'ht-contact', 'ht-priority', 'ht-desk', 'ht-create'];
  state.habits = habitIds.map((id, index) => ({ ...HABIT_TEMPLATES.find(item => item.id === id), id: `demo-h-${index}`, createdAt: start, weekdays: [...HABIT_TEMPLATES.find(item => item.id === id).weekdays] }));
  for (let ago = 29; ago >= 0; ago--) {
    const date = offset(-ago);
    state.completions[date] = [9, 18].includes(ago) ? [] : state.quests.filter((quest, index) => isQuestDue(quest, date) && (ago === 0 ? [1, 2, 7].includes(index) : (ago * 3 + index) % 5 !== 0 && (ago + index) % 7 !== 0)).map(quest => quest.id);
    state.habitLogs[date] = {};
    state.habits.forEach((habit, index) => {
      if (!isHabitDue(habit, date)) return;
      const completed = ago === 0 ? index < 3 : (ago + index * 2) % 5 !== 0;
      state.habitLogs[date][habit.id] = habit.target > 1 ? Math.max(0, habit.target - (completed ? 0 : 2)) : Number(completed);
    });
  }
  const dailyPurchases = [
    ['Продукти на вечерю', 'Продукти', 328.5], ['Капучино та сендвіч', 'Кафе та ресторани', 165],
    ['Дорога містом', 'Транспорт', 60], ['Овочі та фрукти', 'Продукти', 246.8],
    ['Обід із колегою', 'Кафе та ресторани', 285], ['Побутові дрібниці', 'Покупки', 179.9],
    ['Книжка на вихідні', 'Освіта', 340], ['Квиток у кіно', 'Розваги', 220],
    ['Чай для мами', 'Подарунки', 195], ['Продукти на кілька днів', 'Продукти', 587.4],
  ];
  let sequence = 0;
  const add = (date, title, category, amount, type = 'expense', note = '') => state.expenses.push({ id: `demo-transaction-${sequence++}`, date, title, category, amount, type, account: sequence % 6 === 0 ? 'cash' : 'card', note });
  for (let ago = 29; ago >= 0; ago--) {
    const date = offset(-ago);
    const purchase = dailyPurchases[(29 - ago) % dailyPurchases.length];
    add(date, ...purchase);
    add(date, ago % 3 === 0 ? 'Проїзд у трамваї' : 'Кава з собою', ago % 3 === 0 ? 'Транспорт' : 'Кафе та ресторани', ago % 3 === 0 ? 30 : 65);
  }
  const months = [...new Set(Array.from({ length: 30 }, (_, index) => offset(-index).slice(0, 7)))];
  for (const currentMonth of months) {
    add(`${currentMonth}-01`, 'Оплата за основну роботу', 'Зарплата', 42000, 'income', 'Місячна оплата роботи дизайнера.');
    add(`${currentMonth}-01`, 'Оренда квартири', 'Житло', 11000);
    if (`${currentMonth}-05` <= today) add(`${currentMonth}-05`, 'Електрика, вода та інтернет', 'Комунальні послуги', 1845.6);
    if (`${currentMonth}-08` <= today) add(`${currentMonth}-08`, 'Музичний сервіс', 'Підписки', 109);
    if (`${currentMonth}-10` <= today) add(`${currentMonth}-10`, 'Абонемент у зал', 'Спорт', 1200);
    if (`${currentMonth}-12` <= today) add(`${currentMonth}-12`, 'Невеликий дизайн-проєкт', 'Інше', 5500, 'income', 'Додатковий проєкт після основної роботи.');
  }
  state.expenses.sort((a, b) => b.date.localeCompare(a.date));
  state.budgets = { monthLimit: 28000, categories: { 'Продукти': 6000, 'Кафе та ресторани': 2500, 'Транспорт': 1500, 'Житло': 11000, 'Комунальні послуги': 2200, 'Освіта': 1500, 'Спорт': 1200, 'Розваги': 1200, 'Підписки': 500 } };
  state.goals = [
    { id: 'demo-goal-book', title: 'Прочитати книжку про дизайн', category: 'growth', target: 300, current: 180, unit: 'сторінок', deadline: offset(20), description: 'Читати потроху ввечері й занотовувати цікаві ідеї.', status: 'active', createdAt: start },
    { id: 'demo-goal-walk', title: 'Місяць із прогулянками', category: 'body', target: 30, current: 22, unit: 'прогулянки', deadline: offset(14), description: 'Знайти приємні маршрути поруч із домом.', status: 'active', createdAt: start },
    { id: 'demo-goal-trip', title: 'Відкласти на подорож', category: 'money', target: 20000, current: 6400, unit: '₴', deadline: offset(75), description: 'Невелика поїздка в гори без поспіху.', status: 'active', createdAt: start },
    { id: 'demo-goal-course', title: 'Завершити модуль англійської', category: 'growth', target: 12, current: 12, unit: 'уроків', deadline: offset(-3), description: 'Повторив матеріал та пройшов підсумкові вправи.', status: 'completed', createdAt: start },
  ];
  state.quests[1].goalId = 'demo-goal-walk'; state.quests[4].goalId = 'demo-goal-book'; state.quests[2].goalId = 'demo-goal-trip';
  const notes = ['Спокійний день. Допомогла прогулянка після роботи.', 'Трохи втомився від зустрічей, увечері хочу тиші.', 'Завершив складну задачу й знайшов час для книжки.', 'Менше сил, ніж зазвичай. Залишив тільки основні справи.', 'Добре поговорили з другом. Хочу частіше знаходити на це час.'];
  for (let ago = 13; ago >= 0; ago--) state.checkIns[offset(-ago)] = { mood: [4, 3, 4, 2, 5][ago % 5], energy: [4, 3, 3, 2, 4][ago % 5], note: notes[ago % notes.length] };
  state.rewards = [{ id: 'first-summit', cost: 100, date: offset(-20) }, { id: 'steady-climber', cost: 250, date: offset(-8) }];
  state.messages = [{ id: 'demo-chat-1', source: 'local', role: 'user', text: 'Як повернутися до ритму після складного тижня?', at: new Date(`${offset(-1)}T18:00:00`).toISOString() }, { id: 'demo-chat-2', source: 'local', role: 'assistant', text: 'Друже, почни з одного посильного кроку. Прогулянка або кілька сторінок — уже достатньо для повернення. Ці підказки працюють за локальними сценаріями.', at: new Date(`${offset(-1)}T18:00:01`).toISOString() }];
  return state;
}
