import { useState } from 'react';
import { ArrowCounterClockwise, ArrowUpRight, Barbell, BookOpen, Check, CheckCircle, ChatsCircle, Clock, Coins, Compass, Drop, Fire, MoonStars, PaperPlaneTilt, Plus, Sparkle, Target, Trash, Trophy, Wallet } from '@phosphor-icons/react';
import { CATEGORIES, localDate } from './model.js';
import './views.css';
import { CategoryIcon } from './CollectionDialog.jsx';
export { QuestsView } from './QuestViews.jsx';
export { HabitsView } from './HabitViews.jsx';
export { default as CoachView } from './CoachView.jsx';



const rankNames = ['Шукач', 'Мандрівник', 'Дослідник', 'Підкорювач', 'Майстер шляху'];
const entryCount = count => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'запис' : count % 10 >= 2 && count % 10 <= 4 && (count % 100 < 12 || count % 100 > 14) ? 'записи' : 'записів'}`;
const attributes = [{ id: 'strength', label: 'Сила', activity: 'Силові тренування', Icon: Barbell }, { id: 'endurance', label: 'Витривалість', activity: 'Кардіо та рух', Icon: Fire }, { id: 'intelligence', label: 'Інтелект', activity: 'Читання й навчання', Icon: BookOpen }, { id: 'discipline', label: 'Дисципліна', activity: 'Послідовність у справах', Icon: Target }, { id: 'charisma', label: 'Харизма', activity: 'Спілкування та зв’язки', Icon: ChatsCircle }];
const currency = new Intl.NumberFormat('uk-UA', { style: 'currency', currency: 'UAH', maximumFractionDigits: 2 });
const rewardOptions = [
  { id: 'first-summit', title: 'Перший рубіж', description: 'Твої маленькі кроки вже складаються у щось велике.', cost: 100, Icon: Compass },
  { id: 'steady-climber', title: 'Власний ритм', description: 'Відзнака за рух уперед у своєму темпі.', cost: 250, Icon: Fire },
  { id: 'new-horizon', title: 'Новий горизонт', description: 'Ти будуєш свою наступну версію. Крок за кроком.', cost: 500, Icon: Trophy },
];

function recentDays() {
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date();
    date.setDate(date.getDate() - 6 + index);
    return { key: localDate(date), label: date.toLocaleDateString('uk-UA', { weekday: 'short' }), full: date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }) };
  });
}

function ViewHeader({ eyebrow, title, description, children }) {
  return <div className="v-view-header"><div><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p className="muted">{description}</p></div>{children}</div>;
}

export function ProgressView({ state, stats, dispatch }) {
  const days = recentDays();
  const values = days.map(day => (state.completions[day.key] || []).reduce((sum, id) => sum + (state.quests.find(quest => quest.id === id)?.xp || 0), 0));
  const max = Math.max(100, ...values);
  const weekXp = values.reduce((sum, value) => sum + value, 0);
  return <div className="v-page">
    <ViewHeader eyebrow="КОЖЕН КРОК РАХУЄТЬСЯ" title="Подивись, як далеко ти йдеш" description="Твій прогрес — у діях, які ти вже зробив." />
    <div className="v-progress-overview"><div className="panel v-panel v-level-panel"><span className="eyebrow">ТВОЯ НАСТУПНА ВЕРСІЯ</span><div className="v-level-number">{String(stats.level).padStart(2, '0')}<span>рівень</span></div><h3>{rankNames[Math.min(stats.level - 1, rankNames.length - 1)]}</h3><div className="v-meter"><span style={{ width: `${stats.currentLevelXp / stats.nextLevelXp * 100}%` }} /></div><div className="v-meter-label"><span>{stats.currentLevelXp} / {stats.nextLevelXp} XP</span><span>до рівня {stats.level + 1}</span></div></div><div className="panel v-panel v-activity-panel"><div className="v-card-heading"><div><span className="eyebrow">ОСТАННІ 7 ДНІВ</span><h2>{weekXp} <span>XP</span></h2></div><span className="v-chart-key"><span />Досвід</span></div><div className="v-chart" role="img" aria-label={`Досвід за сім днів: ${days.map((day, index) => `${day.full} — ${values[index]} XP`).join(', ')}`}>{days.map((day, index) => <div className={`v-chart-column ${index === 6 ? 'is-today' : ''}`} key={day.key}><span className="v-chart-value">{values[index]}</span><div className="v-chart-track"><div className="v-chart-bar" style={{ height: `${values[index] / max * 100}%`, minHeight: values[index] ? 4 : 2 }} /></div><span>{day.label}</span></div>)}</div></div></div>
    <div className="v-stat-strip"><div><Sparkle size={24} weight="light" /><div><strong>{stats.totalXp} XP</strong><span>усього досвіду</span></div></div><div><Fire size={24} weight="light" /><div><strong>{stats.streak}</strong><span>днів у поточній серії</span></div></div><div><Trophy size={24} weight="light" /><div><strong>{state.rewards.length}</strong><span>відзнак відкрито</span></div></div></div>
    <section className="panel v-panel v-attributes"><div className="v-card-heading"><div><span className="eyebrow">ТВІЙ ПЕРСОНАЖ — ЦЕ ТИ</span><h2>Прокачуй себе в реальності</h2></div><span className="v-attribute-badge">5 характеристик</span></div><div className="v-attribute-grid">{attributes.map(({ id, label, activity, Icon }) => { const xp = stats.attributes?.[id] || 0; return <div className="v-attribute" key={id}><div className="v-attribute-top"><Icon size={22} weight="light" /><span>Рівень {Math.floor(xp / 100) + 1}</span></div><h3>{label}</h3><p>{activity}</p><div className="v-meter" role="progressbar" aria-label={label} aria-valuenow={xp % 100} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${xp % 100}%` }} /></div><span className="v-attribute-xp">{xp} XP</span></div>; })}</div><p className="v-footnote">Це ігрові показники виконаних дій. Кожні 100 XP відкривають новий рівень характеристики.</p></section>
    <section className="panel v-panel cv-category-balance"><div className="v-card-heading"><div><span className="eyebrow">ДЕСЯТЬ НАПРЯМІВ ЖИТТЯ</span><h2>Куди ти вкладаєш увагу</h2></div></div><p className="muted">Частка досвіду з виконаних квестів. Твій баланс може змінюватися разом із пріоритетами.</p><div>{CATEGORIES.map(category => { const xp = stats.categoryStats?.[category.id]?.totalXp || 0; const share = stats.totalXp ? Math.round(xp / stats.totalXp * 100) : 0; return <article key={category.id}><CategoryIcon category={category.id} size={17} /><span>{category.shortLabel}<small>{xp} XP</small></span><div className="v-meter"><span style={{ width: `${share}%` }} /></div><strong>{share}%</strong></article>; })}</div></section>
    <div className="section-heading v-reward-heading"><div><span className="eyebrow">ЗАСЛУЖЕНІ ВІДЗНАКИ</span><h2>Святкуй свій рух</h2></div><span className="v-balance"><Coins size={18} /> {stats.balance} XP доступно</span></div>
    <div className="v-reward-grid">{rewardOptions.map(({ id, title, description, cost, Icon }) => {
      const claimed = state.rewards.some(reward => reward.id === id);
      const canClaim = stats.balance >= cost;
      return <article key={id} className={`panel v-panel v-reward-card ${claimed ? 'is-unlocked' : ''}`}><div className="v-reward-icon"><Icon size={40} weight="light" /></div><span className="eyebrow">{claimed ? 'ТВОЯ ВІДЗНАКА' : `${cost} XP`}</span><h3>{title}</h3><p>{description}</p><button className={`button ${canClaim && !claimed ? 'button-primary' : 'button-ghost'}`} disabled={claimed || !canClaim} onClick={() => dispatch({ type: 'CLAIM_REWARD', id, cost })}>{claimed ? <><Check size={16} /> Відкрито</> : canClaim ? <>Відкрити відзнаку <ArrowUpRight size={16} /></> : `Ще ${cost - stats.balance} XP`}</button></article>;
    })}</div><p className="v-footnote">Відзнаки витрачають доступні XP. Твій рівень і загальний досвід при цьому зберігаються.</p>
  </div>;
}

export function MoneyView({ state, dispatch }) {
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState('Їжа');
  const [notice, setNotice] = useState('');
  const today = localDate();
  const currentMonth = today.slice(0, 7);
  const expenses = state.expenses || [];
  const monthExpenses = expenses.filter(expense => expense.date.startsWith(currentMonth));
  const monthTotal = monthExpenses.reduce((sum, expense) => sum + expense.amount, 0);
  const todayTotal = expenses.filter(expense => expense.date === today).reduce((sum, expense) => sum + expense.amount, 0);
  const groups = ['Їжа', 'Транспорт', 'Дім', 'Відпочинок', 'Інше'];
  function addExpense(event) {
    event.preventDefault();
    const numericAmount = Number(amount);
    if (!title.trim() || !Number.isFinite(numericAmount) || numericAmount <= 0 || numericAmount > 1000000) return;
    dispatch({ type: 'ADD_EXPENSE', expense: { title: title.trim(), amount: numericAmount, category, date: today } });
    setTitle(''); setAmount(''); setNotice('Витрату додано до твого журналу.');
  }
  return <div className="v-page">
    <ViewHeader eyebrow="БІЛЬШЕ УСВІДОМЛЕНОСТІ" title="Знай, куди йдуть твої гроші" description="Простий журнал витрат. Без осуду — лише ясна картина." />
    <div className="v-money-summary"><div className="panel v-panel"><span className="eyebrow">ЦЬОГО МІСЯЦЯ</span><h2>{currency.format(monthTotal)}</h2><p className="muted">{entryCount(monthExpenses.length)} у журналі</p><Wallet size={34} weight="light" /></div><div className="panel v-panel"><span className="eyebrow">СЬОГОДНІ</span><h2>{currency.format(todayTotal)}</h2><p className="muted">Усі витрати за {new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</p><Coins size={34} weight="light" /></div></div>
    <div className="v-money-layout"><section className="panel v-panel v-expense-list"><div className="v-card-heading"><h2>Журнал витрат</h2><span className="muted">{entryCount(expenses.length)}</span></div>{expenses.length ? [...expenses].reverse().map(expense => <div className="v-expense-row" key={expense.id}><span className="v-domain-mark"><Wallet size={19} weight="light" /></span><div><strong>{expense.title}</strong><span>{expense.category} · {new Date(`${expense.date}T12:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' })}</span></div><strong className="v-expense-amount">−{currency.format(expense.amount)}</strong><button className="icon-button" title="Видалити запис" aria-label={`Видалити витрату: ${expense.title}`} onClick={() => { dispatch({ type: 'DELETE_EXPENSE', id: expense.id }); setNotice('Запис видалено.'); }}><Trash size={17} /></button></div>) : <div className="v-empty"><Wallet size={38} weight="light" /><h3>Почни з однієї витрати</h3><p>Кава, продукти чи поїздка — будь-який запис допоможе побачити свої звички.</p></div>}</section><section className="panel v-panel v-expense-form"><span className="eyebrow">МАЛЕНЬКА ЗВИЧКА</span><h2>Записати витрату</h2><form onSubmit={addExpense}><label className="field">На що витратив?<input required maxLength={80} value={title} onChange={event => setTitle(event.target.value)} placeholder="Наприклад, обід" /></label><label className="field">Сума, ₴<input required type="number" inputMode="decimal" min="0.01" max="1000000" step="0.01" value={amount} onChange={event => setAmount(event.target.value)} placeholder="0.00" /></label><label className="field">Категорія<select aria-label="Категорія" value={category} onChange={event => setCategory(event.target.value)}>{groups.map(group => <option key={group}>{group}</option>)}</select></label><button className="button button-primary" type="submit">Додати витрату <Plus size={18} /></button><p className="v-form-notice" role="status">{notice}</p></form></section></div>
  </div>;
}
