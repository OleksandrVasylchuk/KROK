export const CATEGORIES = [
  { id: 'body', label: 'Тіло та енергія', shortLabel: 'Тіло', color: '#ee9863', icon: 'walk', attribute: 'strength', description: 'Рух у своєму темпі та відчуття сили.' },
  { id: 'money', label: 'Фінансова ясність', shortLabel: 'Гроші', color: '#b6c68e', icon: 'wallet', attribute: 'discipline', description: 'Свідомі витрати, бюджет і власні пріоритети.' },
  { id: 'social', label: 'Близькі люди', shortLabel: 'Стосунки', color: '#c3afd9', icon: 'people', attribute: 'charisma', description: 'Увага до людей, із якими добре.' },
  { id: 'growth', label: 'Особистий розвиток', shortLabel: 'Навчання', color: '#8cbcca', icon: 'book', attribute: 'intelligence', description: 'Знання, книжки та нові навички.' },
  { id: 'nutrition', label: 'Харчування', shortLabel: 'Харчування', color: '#c4b67e', icon: 'food', attribute: 'discipline', description: 'Час на їжу та зручний побутовий ритм.' },
  { id: 'sleep', label: 'Сон і відновлення', shortLabel: 'Сон', color: '#a7a5d2', icon: 'moon', attribute: 'endurance', description: 'Спокійний вечір і час для відпочинку.' },
  { id: 'mind', label: 'Спокій та увага', shortLabel: 'Спокій', color: '#92bbb0', icon: 'mind', attribute: 'discipline', description: 'Помічай свій стан і залишай місце для пауз.' },
  { id: 'career', label: 'Робота й кар’єра', shortLabel: 'Кар’єра', color: '#b0b9d0', icon: 'work', attribute: 'intelligence', description: 'Важливі задачі, професійні навички та фокус.' },
  { id: 'home', label: 'Дім і порядок', shortLabel: 'Дім', color: '#c4aa90', icon: 'home', attribute: 'discipline', description: 'Простір, у якому легше жити.' },
  { id: 'creativity', label: 'Творчість і захоплення', shortLabel: 'Творчість', color: '#d4a0ae', icon: 'creative', attribute: 'intelligence', description: 'Роби щось цікаве без вимоги ідеального результату.' },
];

export const FINANCE_CATEGORIES = [
  ['groceries', 'Продукти', '#b6c68e', 'food'], ['cafe', 'Кафе та ресторани', '#d8ac83', 'cafe'],
  ['transport', 'Транспорт', '#8cbcca', 'car'], ['housing', 'Житло', '#b0b9d0', 'home'],
  ['utilities', 'Комунальні послуги', '#a8b8a0', 'bills'], ['health', 'Здоров’я', '#d2a1a1', 'health'],
  ['sport', 'Спорт', '#ee9863', 'sport'], ['education', 'Освіта', '#a7a5d2', 'book'],
  ['fun', 'Розваги', '#c3afd9', 'game'], ['shopping', 'Покупки', '#c4aa90', 'bag'],
  ['subscriptions', 'Підписки', '#9ab2b9', 'repeat'], ['gifts', 'Подарунки', '#d4a0ae', 'gift'],
  ['travel', 'Подорожі', '#92bbb0', 'travel'], ['salary', 'Зарплата', '#c4b67e', 'work'],
  ['other', 'Інше', '#a8aaa6', 'other'],
].map(([id, label, color, icon]) => ({ id, label, color, icon }));

const quest = (id, title, category, xp, minutes, description, extra = {}) => ({ id, title, category, xp, minutes, description, attribute: CATEGORIES.find(item => item.id === category).attribute, frequency: 'daily', weekdays: [1, 2, 3, 4, 5], scheduledDate: '', archived: false, goalId: null, timeOfDay: 'any', ...extra });
export const QUEST_TEMPLATES = [
  quest('tpl-strength', 'Знайоме тренування у своєму темпі', 'body', 50, 25, 'Обери звичне комфортне тренування та залиш час на відпочинок.', { frequency: 'weekdays', weekdays: [1, 3, 5] }),
  quest('tpl-walk', 'Прогулянка без поспіху', 'body', 25, 20, 'Пройдися знайомим маршрутом і зверни увагу на те, що навколо.', { attribute: 'endurance' }),
  quest('tpl-move-break', 'Перерва на рух', 'body', 15, 5, 'Відійди від екрана та трохи порухайся так, як тобі зручно.', { attribute: 'endurance' }),
  quest('tpl-budget', 'Запиши витрати за день', 'money', 25, 5, 'Додай покупки, транспорт і дрібні витрати у свій журнал.'),
  quest('tpl-subscriptions', 'Переглянь одну підписку', 'money', 30, 10, 'Перевір її вартість і виріши, чи користуєшся нею зараз.'),
  quest('tpl-money-plan', 'Сплануй покупки на тиждень', 'money', 35, 15, 'Склади короткий список потрібного перед наступним походом у магазин.', { frequency: 'weekdays', weekdays: [0] }),
  quest('tpl-message', 'Напиши близькій людині', 'social', 30, 5, 'Запитай, як справи, або поділися маленькою новиною.'),
  quest('tpl-call', 'Знайди час на розмову', 'social', 40, 20, 'Домовся про зручний для вас обох час без інших справ.', { frequency: 'weekdays', weekdays: [6] }),
  quest('tpl-read', 'Прочитай десять сторінок', 'growth', 40, 15, 'Відклади телефон і повернися до книжки.'),
  quest('tpl-language', 'Практика іноземної мови', 'growth', 35, 15, 'Повтори знайомі слова або послухай короткий уривок.'),
  quest('tpl-course', 'Один урок свого курсу', 'growth', 45, 25, 'Пройди невеликий урок і запиши одну корисну думку.', { frequency: 'weekdays', weekdays: [2, 4] }),
  quest('tpl-lunch', 'Пообідай без екрана', 'nutrition', 20, 20, 'Залиш телефон осторонь і виділи час на їжу.'),
  quest('tpl-cook', 'Приготуй просту домашню страву', 'nutrition', 40, 30, 'Обери знайомий рецепт із доступних продуктів.'),
  quest('tpl-evening', 'Підготуй спокійний вечір', 'sleep', 25, 15, 'Закінчи дрібні справи й обери час, коли відкладеш екран.'),
  quest('tpl-sleep-plan', 'Заплануй час відпочинку', 'sleep', 20, 5, 'Подивися на завтрашній день і залиш достатньо часу для себе.'),
  quest('tpl-checkin', 'Перевір, як ти зараз', 'mind', 20, 5, 'Познач настрій та енергію і напиши кілька слів про свій день.'),
  quest('tpl-pause', 'Кілька хвилин тиші', 'mind', 15, 5, 'Відклади повідомлення, сядь зручно й зроби коротку паузу.'),
  quest('tpl-focus', 'Один блок зосередженої роботи', 'career', 45, 25, 'Обери одну конкретну задачу та прибери зайві сповіщення.', { frequency: 'weekdays' }),
  quest('tpl-career-note', 'Онови один пункт портфоліо', 'career', 40, 20, 'Опиши свіжу задачу, результат або навичку.', { frequency: 'weekdays', weekdays: [5] }),
  quest('tpl-desk', 'Наведи лад на робочому столі', 'home', 20, 10, 'Прибери зайве й залиш те, що знадобиться завтра.'),
  quest('tpl-room', 'Одна невелика зона порядку', 'home', 30, 15, 'Полиця, шухляда чи кухня — обери лише одну ділянку.', { frequency: 'weekdays', weekdays: [6] }),
  quest('tpl-sketch', 'Зроби невеликий ескіз', 'creativity', 30, 15, 'Малюй предмет поруч або те, що уявляєш. Результат може бути недосконалим.'),
  quest('tpl-music', 'Час для музики', 'creativity', 35, 20, 'Пограй знайомий уривок або уважно послухай новий альбом.'),
  quest('tpl-photo', 'Поміть і сфотографуй цікаву деталь', 'creativity', 20, 10, 'Знайди незвичне світло, фактуру чи маленьку сцену свого дня.'),
];

const habit = (id, title, category, icon, target, unit, timeOfDay = 'any', extra = {}) => ({ id, title, category, icon, target, unit, timeOfDay, frequency: 'daily', weekdays: [1, 2, 3, 4, 5], archived: false, ...extra });
export const HABIT_TEMPLATES = [
  habit('ht-water', 'Моя ціль пиття води', 'nutrition', 'water', 6, 'склянок'),
  habit('ht-read', 'Трохи читання', 'growth', 'book', 1, 'сесія', 'evening'),
  habit('ht-evening', 'Вечір без скролінгу', 'sleep', 'moon', 1, 'вечір', 'evening'),
  habit('ht-walk', 'Вийти на прогулянку', 'body', 'walk', 1, 'прогулянка', 'day'),
  habit('ht-breaks', 'Рухатися між справами', 'body', 'walk', 3, 'перерви', 'day', { frequency: 'weekdays' }),
  habit('ht-breakfast', 'Сніданок без поспіху', 'nutrition', 'food', 1, 'раз', 'morning'),
  habit('ht-homemeal', 'Домашня їжа', 'nutrition', 'food', 1, 'страва', 'day'),
  habit('ht-rest', 'Відкласти роботу ввечері', 'sleep', 'moon', 1, 'вечір', 'evening'),
  habit('ht-journal', 'Короткий запис про день', 'mind', 'mind', 1, 'запис', 'evening'),
  habit('ht-quiet', 'Хвилина без повідомлень', 'mind', 'mind', 2, 'паузи'),
  habit('ht-expenses', 'Записати витрати', 'money', 'wallet', 1, 'раз', 'evening'),
  habit('ht-list', 'Список перед покупкою', 'money', 'wallet', 1, 'список'),
  habit('ht-contact', 'Поцікавитися справами близьких', 'social', 'people', 1, 'контакт'),
  habit('ht-listen', 'Розмова без телефона', 'social', 'people', 1, 'розмова', 'evening'),
  habit('ht-english', 'Практикувати мову', 'growth', 'book', 1, 'сесія', 'morning'),
  habit('ht-priority', 'Обрати головну задачу дня', 'career', 'work', 1, 'задача', 'morning', { frequency: 'weekdays' }),
  habit('ht-focus', 'Блок зосередженої роботи', 'career', 'work', 2, 'блоки', 'day', { frequency: 'weekdays' }),
  habit('ht-desk', 'Чистий робочий стіл', 'home', 'home', 1, 'раз', 'evening'),
  habit('ht-tidy', 'Прибрати одну річ на місце', 'home', 'home', 3, 'речі'),
  habit('ht-create', 'Час для свого захоплення', 'creativity', 'creative', 1, 'сесія', 'evening'),
];

// A quest's level is its reward band, so earned XP and the level can never disagree.
export const QUEST_TIERS = [
  { id: 'common', label: 'Звичайний', xp: 20, hint: 'Маленька щоденна дія' },
  { id: 'epic', label: 'Епічний', xp: 60, hint: 'Потребує часу й зусиль' },
  { id: 'legendary', label: 'Легендарний', xp: 130, hint: 'Виклик на цілий день' },
];
export const questTier = xp => xp >= 100 ? 'legendary' : xp >= 50 ? 'epic' : 'common';
export const tierXp = tier => (QUEST_TIERS.find(item => item.id === tier) || QUEST_TIERS[0]).xp;
export const DAY_SLOTS = [
  { id: 'morning', label: 'Ранок' }, { id: 'day', label: 'День' }, { id: 'evening', label: 'Вечір' }, { id: 'any', label: 'Будь-коли' },
];
