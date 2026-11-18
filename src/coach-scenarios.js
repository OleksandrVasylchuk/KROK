import { localDate, weeklyMeetingDue } from './model.js';

export const SCENARIO_ANSWER_LIMIT = 600;
const TIME_OPTIONS = [['5', '5 хвилин'], ['10-15', '10–15 хвилин'], ['20-30', '20–30 хвилин'], ['varies', 'Залежить від дня']];

/** Scripted questions are asked locally; only the final composed message is one model request. */
export const COACH_SCENARIOS = {
  intro: {
    id: 'intro', title: 'Знайомство за дві хвилини', sendLabel: 'Отримати мій план',
    lead: 'Три короткі запитання — і тренер запропонує одну ціль та до трьох посильних кроків.',
    questions: [
      { id: 'change', label: 'Що хочу змінити', text: 'Що ти хочеш змінити передусім?', hint: 'Одним-двома реченнями, своїми словами.', placeholder: 'Наприклад, мати більше енергії вранці', required: true },
      { id: 'time', label: 'Скільки маю часу на день', text: 'Скільки часу на день ти реально маєш на це?', hint: 'Чесний орієнтир, не обіцянка.', placeholder: 'Наприклад, 15 хвилин після роботи', required: true, options: TIME_OPTIONS.map(([, label]) => label) },
      { id: 'obstacle', label: 'Що заважає', text: 'Що найчастіше заважає?', hint: 'Можна пропустити.', placeholder: 'Наприклад, втома ввечері або важко почати', required: false },
    ],
    request: 'Запропонуй для мого підтвердження одну ціль і до трьох посильних перших кроків-квестів, пов’язаних із цією ціллю, які вміщуються в названий час. Перший крок має бути на сьогодні й займати кілька хвилин. Не додавай звичок, пам’яті чи інших записів і не дублюй наявні справи, якщо бачиш їх. Якщо моїх відповідей замало, щоб сформулювати ціль, постав одне уточнювальне запитання замість пропозиції.',
  },
  morning: {
    id: 'morning', title: 'Ранок: обираємо головне', sendLabel: 'Скласти план дня',
    lead: 'Три запитання — і тренер допоможе вибрати головне на сьогодні.',
    questions: [
      { id: 'energy', label: 'Самопочуття та енергія', text: 'Як ти сьогодні? Оціни енергію від 1 до 5 і скажи, якщо щось турбує.', hint: 'Достатньо кількох слів.', placeholder: 'Наприклад, енергія 3, трохи не виспався', required: true },
      { id: 'time', label: 'Час на свої кроки сьогодні', text: 'Скільки часу сьогодні реально маєш на свої кроки?', hint: 'Краще менше, але чесно.', placeholder: 'Наприклад, 20 хвилин увечері', required: true },
      { id: 'main', label: 'Головне на сьогодні', text: 'Яка одна справа сьогодні найважливіша?', hint: 'Можна пропустити — тренер запропонує сам.', placeholder: 'Наприклад, зробити зарядку або закрити звіт', required: false },
    ],
    request: 'Допоможи обрати головне на сьогодні: запропонуй для мого підтвердження до трьох посильних справ у межах названого часу. Якщо бачиш мої наявні квести, спершу спирайся на них і не дублюй; нову справу на сьогодні створюй лише за потреби. За втоми зменшуй навантаження й не підвищуй фізичне навантаження автоматично.',
  },
  evening: {
    id: 'evening', title: 'Вечір: підсумок дня', sendLabel: 'Підбити підсумок',
    lead: 'Чотири запитання — тренер запропонує відмітки, запис дня й одну зміну на завтра.',
    questions: [
      { id: 'done', label: 'Що вдалося', text: 'Що сьогодні вдалося? Назви справи, які зробив.', hint: 'Назви їх так, як вони записані у плані, якщо пам’ятаєш.', placeholder: 'Наприклад, зробив зарядку і прочитав 10 сторінок', required: true },
      { id: 'blocked', label: 'Що завадило', text: 'Що завадило або було важко?', hint: 'Можна пропустити.', placeholder: 'Наприклад, затримався на роботі', required: false },
      { id: 'mood', label: 'Настрій та енергія (1–5)', text: 'Оціни настрій та енергію від 1 до 5.', hint: 'Дві оцінки: спершу настрій, потім енергія.', placeholder: 'Наприклад, настрій 4, енергія 2', required: true },
      { id: 'spend', label: 'Витрати за сьогодні', text: 'Чи були витрати, які варто записати?', hint: 'Назви суму, на що і чим платив — карткою чи готівкою. Можна пропустити.', placeholder: 'Наприклад, 180 гривень на обід карткою', required: false },
    ],
    request: 'Запропонуй для одного підтвердження: відмітки виконання лише для справ, які я прямо назвав, якщо маєш доступ до моїх записів; запис настрою та енергії, якщо я назвав обидві оцінки; названі витрати з явною сумою; і одну зміну на завтра — спростити або перенести справу, що не вдалася, чи один посильний крок на завтрашню дату. Не карай за пропущене, не створюй борг і не вгадуй те, чого я не казав.',
  },
  weekly: {
    id: 'weekly', title: 'Тижнева зустріч із тренером', sendLabel: 'Підбити тиждень', needsRecords: true,
    lead: 'Чотири запитання — тренер підсумує тиждень і запропонує, що полегшити, посилити, додати чи прибрати.',
    questions: [
      { id: 'done', label: 'Що вдалося цього тижня', text: 'Що цього тижня вдалося найкраще?', hint: 'Назви справи або зміни, якими задоволений.', placeholder: 'Наприклад, п’ять днів робив зарядку', required: true },
      { id: 'missed', label: 'Що не вдалося', text: 'Що не вдалося або давалося важко?', hint: 'Без оцінок — це матеріал для корекції. Можна пропустити.', placeholder: 'Наприклад, вечірнє читання майже щодня пропускав', required: false },
      { id: 'load', label: 'Яким був план', text: 'Яким був розпорядок цього тижня?', hint: 'Від цього залежить напрям змін.', placeholder: 'Заважкий, якраз чи залегкий', required: true, options: ['Заважкий — полегшити', 'Якраз — залишити', 'Залегкий — посилити'] },
      { id: 'change', label: 'Що додати або прибрати', text: 'Що хочеш додати або прибрати?', hint: 'Можна пропустити — тренер запропонує сам.', placeholder: 'Наприклад, прибрати читання, додати прогулянку', required: false },
    ],
    request: 'Проведи тижневу зустріч: коротко підсумуй тиждень за моїми словами та доступними записами — що вдалося, а що ні. Потім запропонуй для одного підтвердження до п’яти змін розпорядку в названий мною бік: прибрати або спростити те, що не йде, посилити те, що вже легко, додати нове, якщо я просив. Кожному новому квесту дай рівень і частину дня. Не посилюй фізичне навантаження після тижня з пропусками, втомою чи болем і не карай за пропущене.',
  },
};

export const scenarioAnswer = value => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, SCENARIO_ANSWER_LIMIT) : '';

/** One ordinary user message: visible in the chat, editable history, no hidden instructions. */
export function buildScenarioMessage(id, answers) {
  const scenario = COACH_SCENARIOS[id];
  if (!scenario) throw new Error('Невідомий сценарій розмови.');
  const values = scenario.questions.map((question, index) => scenarioAnswer(answers?.[index]));
  if (scenario.questions.some((question, index) => question.required && !values[index])) throw new Error('Дай відповідь на обов’язкові запитання сценарію.');
  const lines = scenario.questions.map((question, index) => `${question.label}: ${values[index] || 'не вказано'}`);
  return `${scenario.title}.\n${lines.join('\n')}\n\n${scenario.request}`;
}

/** Introduction answers also stay in the local coach profile; they are shared only with the existing consent. */
export function scenarioProfilePatch(id, answers, profile = {}) {
  if (id !== 'intro') return null;
  const [change, time, obstacle] = COACH_SCENARIOS.intro.questions.map((question, index) => scenarioAnswer(answers?.[index]));
  if (!change) return null;
  const plan = profile.coachPlan || {};
  const dailyTime = TIME_OPTIONS.find(([, label]) => label === time)?.[0] || plan.dailyTime || '';
  return { coachPlan: { priorities: Array.isArray(plan.priorities) ? plan.priorities : [], extra: plan.extra || '', step: plan.step || 0, desiredChange: change.slice(0, 300), obstacle: (obstacle || plan.obstacle || '').slice(0, 300), dailyTime } };
}

/** A hint for the home screen only. It never starts a conversation or a request by itself. */
export function suggestedScenario(state, now = new Date()) {
  const today = localDate(now), hour = now.getHours();
  const startedWithCoach = Boolean(state.profile?.start) || (state.goals || []).length > 0 || (state.coachProposals || []).some(proposal => proposal.status === 'applied');
  if (!startedWithCoach) return 'intro';
  if (weeklyMeetingDue(state, today)) return 'weekly';
  if (hour >= 18 && !state.checkIns?.[today]) return 'evening';
  if (hour >= 5 && hour < 12) return 'morning';
  return null;
}
