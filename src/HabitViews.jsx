import { useState } from 'react';
import { Archive, ArrowCounterClockwise, BookOpen, Brain, Briefcase, CalendarBlank, Check, ChatsCircle, Clock, Drop, Fire, ForkKnife, House, MagnifyingGlass, MoonStars, Palette, PencilSimple, PersonSimpleWalk, Plus, Sun, Target, Wallet } from '@phosphor-icons/react';
import { CATEGORIES, habitStreak, isHabitDue, localDate, selectActiveHabits } from './model.js';
import { HABIT_TEMPLATES } from './catalog.js';
import CollectionDialog, { CategoryFilters, CategoryIcon, dateLabel, recurrenceLabel, ScheduleFields } from './CollectionDialog.jsx';

const HABIT_ICONS = { water: Drop, book: BookOpen, moon: MoonStars, walk: PersonSimpleWalk, food: ForkKnife, mind: Brain, wallet: Wallet, people: ChatsCircle, work: Briefcase, home: House, creative: Palette };
const ICON_OPTIONS = [{ id: 'water', label: 'Вода' }, { id: 'book', label: 'Книга' }, { id: 'moon', label: 'Відпочинок' }, { id: 'walk', label: 'Рух' }, { id: 'food', label: 'Харчування' }, { id: 'mind', label: 'Уважність' }, { id: 'wallet', label: 'Гроші' }, { id: 'people', label: 'Люди' }, { id: 'work', label: 'Робота' }, { id: 'home', label: 'Дім' }, { id: 'creative', label: 'Творчість' }];
const TIMES = [{ id: 'any', label: 'Будь-коли' }, { id: 'morning', label: 'Вранці' }, { id: 'day', label: 'Удень' }, { id: 'evening', label: 'Увечері' }];
const HABIT_LIMIT_MESSAGE = 'Досягнуто ліміту 50 звичок разом з архівом. Нові звички не додаються. Можна повернути звичку з архіву або відредагувати наявну.';

function daysBack(count) {
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() - count + index + 1);
    return { key: localDate(date), number: date.getDate(), label: date.toLocaleDateString('uk-UA', { weekday: 'short' }), full: date.toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' }) };
  });
}

function historyStats(habit, state, days) {
  const created = habit.createdAt || state.createdAt;
  const eligible = days.filter(day => (!created || day.key >= created) && isHabitDue({ ...habit, archived: false }, day.key));
  const completed = eligible.filter(day => (state.habitLogs[day.key]?.[habit.id] || 0) >= habit.target).length;
  return { completed, total: eligible.length, ratio: eligible.length ? Math.round(completed / eligible.length * 100) : 0 };
}

function HabitEditor({ habit, state, dispatch, onClose, onNotice }) {
  const [draft, setDraft] = useState({ ...habit, category: habit.category || 'growth', frequency: habit.frequency || 'daily', weekdays: habit.weekdays || [1, 2, 3, 4, 5], timeOfDay: habit.timeOfDay || 'any' });
  const [error, setError] = useState('');
  const hasHistory = Object.values(state.habitLogs).some(logs => (logs[habit.id] || 0) > 0);
  return <CollectionDialog title="Звичка під твій ритм" description="Вибери конкретну дію й посильну ціль на день." onClose={onClose}>
    <form className="form-stack cv-editor" onSubmit={event => { event.preventDefault(); if (!draft.title.trim() || !draft.unit.trim()) { setError('Додай назву звички й одиницю виміру.'); return; } if (draft.frequency === 'weekdays' && !draft.weekdays.length) { setError('Обери хоча б один день тижня.'); return; } dispatch({ type: 'UPDATE_HABIT', id: habit.id, habit: { ...draft, title: draft.title.trim(), target: Number(draft.target), unit: draft.unit.trim() } }); onNotice('Звичку оновлено. Історія відміток збережена.'); onClose(); }}>
      <label className="field">Назва звички<input required maxLength={80} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} autoFocus /></label>
      <div className="cv-form-grid"><label className="field">Напрям<select aria-label="Напрям звички" value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value })}>{CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.shortLabel}</option>)}</select></label><label className="field">Коли зручно?<select aria-label="Час доби звички" value={draft.timeOfDay} onChange={event => setDraft({ ...draft, timeOfDay: event.target.value })}>{TIMES.map(time => <option value={time.id} key={time.id}>{time.label}</option>)}</select></label><label className="field">Ціль на день<input type="number" min={1} max={10000} step={1} required disabled={hasHistory} value={draft.target} onChange={event => setDraft({ ...draft, target: event.target.value })} /></label><label className="field">Одиниця виміру<input maxLength={30} required value={draft.unit} onChange={event => setDraft({ ...draft, unit: event.target.value })} /></label></div>
      {hasHistory && <p className="cv-help-note">Ціль зафіксована після першої відмітки, щоб минулі результати не змінювались. Для нової цілі створи окрему звичку.</p>}
      <ScheduleFields values={draft} onChange={setDraft} allowOnce={false} />
      <label className="field">Позначка<select aria-label="Позначка звички" value={draft.icon} onChange={event => setDraft({ ...draft, icon: event.target.value })}>{ICON_OPTIONS.map(icon => <option value={icon.id} key={icon.id}>{icon.label}</option>)}</select></label>
      {error && <p className="cv-error" role="alert">{error}</p>}<button type="submit" className="button button-primary submit-button">Зберегти звичку <Check size={17} /></button>
    </form>
  </CollectionDialog>;
}

function HabitLibrary({ state, dispatch, onClose, onNotice }) {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const atCapacity = state.habits.length >= 50;
  function add(template, existing) {
    if (!existing?.archived && atCapacity) { setNotice(HABIT_LIMIT_MESSAGE); return; }
    if (existing?.archived) dispatch({ type: 'RESTORE_HABIT', id: existing.id });
    else { const { id, ...habit } = template; dispatch({ type: 'ADD_HABIT', habit }); }
    const text = existing?.archived ? 'Звичку повернуто з архіву.' : 'Звичку додано до твого ритму.';
    setNotice(text); onNotice(text);
  }
  const templates = HABIT_TEMPLATES.filter(habit => (category === 'all' || habit.category === category) && habit.title.toLocaleLowerCase('uk-UA').includes(search.toLocaleLowerCase('uk-UA').trim()));
  return <CollectionDialog wide title="Ритуали, що стають частиною тебе" description={`${HABIT_TEMPLATES.length} ідей для звичайного дня. Обери одну або дві й почни у своєму темпі.`} onClose={onClose}>
    <div className="cv-library-tools"><label className="cv-search"><MagnifyingGlass size={18} /><input aria-label="Пошук у бібліотеці звичок" type="search" placeholder="Знайти ритуал…" value={search} onChange={event => setSearch(event.target.value)} /></label><CategoryFilters value={category} onChange={setCategory} label="Напрям бібліотеки звичок" /></div><p className="cv-notice" role="status">{notice}</p>
    {atCapacity && <p className="cv-help-note" role="status">{HABIT_LIMIT_MESSAGE}</p>}
    <div className="cv-library-grid">{templates.map(template => {
      const matching = state.habits.filter(habit => habit.title === template.title && habit.category === template.category);
      const existing = matching.find(habit => !habit.archived) || matching[0];
      const added = existing && !existing.archived;
      const blocked = !added && !existing?.archived && atCapacity;
      return <article className="cv-template" key={template.id}><div className="cv-template-top"><CategoryIcon category={template.category} /><span className="cv-template-tag">{TIMES.find(time => time.id === template.timeOfDay)?.label || 'Будь-коли'}</span></div><h3>{template.title}</h3><p>{template.description || `${template.target} ${template.unit} · ${recurrenceLabel(template)}`}</p><div className="cv-template-meta"><span><Target size={13} />{template.target} {template.unit}</span><span>{CATEGORIES.find(category => category.id === template.category)?.shortLabel}</span></div><button type="button" disabled={Boolean(added || blocked)} className={`button ${added || blocked ? 'button-ghost' : 'button-primary'}`} onClick={() => add(template, existing)}>{added ? <><Check size={16} /> Уже у твоєму ритмі</> : existing?.archived ? <><ArrowCounterClockwise size={16} /> Повернути</> : blocked ? 'Ліміт 50 звичок' : <><Plus size={16} /> Додати звичку</>}</button></article>;
    })}</div>{!templates.length && <div className="v-empty"><BookOpen size={32} weight="light" /><h3>Спробуй інший пошук</h3><p>Можеш створити й власний ритуал — такий, який потрібен саме тобі.</p></div>}
  </CollectionDialog>;
}

function HabitCard({ habit, state, dispatch, historyDays, onEdit, onNotice }) {
  const [amount, setAmount] = useState(1);
  const today = localDate();
  const Icon = HABIT_ICONS[habit.icon] || Target;
  const due = isHabitDue(habit, today);
  const count = state.habitLogs[today]?.[habit.id] || 0;
  const done = count >= habit.target;
  const history = historyStats(habit, state, historyDays);
  const streak = habitStreak(state, habit.id, today);
  const created = habit.createdAt || state.createdAt;
  function log(event) {
    event.preventDefault();
    dispatch({ type: 'LOG_HABIT', id: habit.id, amount: Math.max(1, Math.min(habit.target, Number(amount) || 1)) });
    onNotice('Крок до звички зафіксовано.');
  }
  return <article className={`panel v-panel v-habit-card cv-habit-card ${habit.archived ? 'is-archived' : ''}`}>
    <div className="v-card-heading"><span className="v-domain-mark"><Icon size={24} weight="light" /></span><div className="cv-item-actions">{habit.archived ? <button className="icon-button" aria-label={`Повернути звичку: ${habit.title}`} title="Повернути з архіву" onClick={() => { dispatch({ type: 'RESTORE_HABIT', id: habit.id }); onNotice('Звичку повернуто до активних.'); }}><ArrowCounterClockwise size={18} /></button> : <><button className="icon-button" aria-label={`Редагувати звичку: ${habit.title}`} title="Редагувати" onClick={() => onEdit(habit)}><PencilSimple size={17} /></button><button className="icon-button" aria-label={`Архівувати звичку: ${habit.title}`} title="Архівувати зі збереженням історії" onClick={() => { dispatch({ type: 'ARCHIVE_HABIT', id: habit.id }); onNotice('Звичку архівовано. Відмітки збережені.'); }}><Archive size={17} /></button></>}</div></div>
    <h3>{habit.title}</h3><div className="cv-habit-meta"><span>{CATEGORIES.find(category => category.id === habit.category)?.shortLabel || 'Розвиток'}</span><span>{TIMES.find(time => time.id === habit.timeOfDay)?.label || 'Будь-коли'}</span></div>
    <div className="cv-habit-value-line"><div className="v-habit-value">{count}<span> / {habit.target} {habit.unit}</span></div><span className="cv-streak"><Fire size={14} />{streak} у серії</span></div><div className="v-meter"><span style={{ width: `${Math.min(count / habit.target, 1) * 100}%` }} /></div>
    <div className="cv-history-heading"><span><CalendarBlank size={13} />{historyDays.length === 7 ? 'Останні 7 днів' : 'Останні 30 днів'}</span><strong>{history.completed}/{history.total} · {history.ratio}%</strong></div>
    <div className={`cv-habit-history ${historyDays.length > 7 ? 'is-month' : ''}`} aria-label={`Історія звички: ${habit.title}`}>{historyDays.map(day => {
      const dayCount = state.habitLogs[day.key]?.[habit.id] || 0;
      const eligible = (!created || day.key >= created) && isHabitDue({ ...habit, archived: false }, day.key);
      const dayDone = dayCount >= habit.target;
      const label = `${day.full}: ${created && day.key < created ? 'звичку ще не створено' : `${dayCount} з ${habit.target}${!eligible ? ', день поза поточним розкладом' : ''}`}`;
      return <div key={day.key} className={`${day.key === today ? 'is-today' : ''} ${!eligible && !dayCount ? 'is-off' : ''}`}><span>{historyDays.length === 7 ? day.label : null}</span><span className={`cv-history-dot ${dayDone ? 'is-done' : dayCount ? 'is-partial' : ''}`} title={label} aria-label={label}>{dayDone && historyDays.length === 7 ? <Check size={13} weight="bold" /> : historyDays.length > 7 ? day.number : day.key === today ? '·' : null}</span></div>;
    })}</div><div className="cv-habit-schedule"><Clock size={13} />{recurrenceLabel(habit)}{habit.archived && <span>В архіві</span>}</div>
    {!habit.archived && due && <form className="v-habit-actions cv-log-habit" onSubmit={log}>{habit.target > 1 && !done && <input type="number" min={1} max={habit.target} step={1} required aria-label={`Скільки додати: ${habit.title}`} value={amount} onChange={event => setAmount(event.target.value)} />}<button type="submit" disabled={done} className={`button ${done ? 'button-ghost' : 'button-primary'}`}>{done ? <><Check size={16} /> Виконано</> : <><Plus size={16} />{habit.target > 1 ? 'Додати' : 'Відмітити виконання'}</>}</button><button type="button" className="icon-button" disabled={!count} aria-label={`Скинути сьогодні: ${habit.title}`} title="Скинути за сьогодні" onClick={() => { dispatch({ type: 'RESET_HABIT', id: habit.id }); onNotice('Сьогоднішню відмітку скинуто.'); }}><ArrowCounterClockwise size={18} /></button></form>}
    {!habit.archived && !due && <div className="cv-habit-rest"><MoonStars size={17} /> Сьогодні поза розкладом</div>}
  </article>;
}

export function HabitsView({ state, dispatch, onAddHabit }) {
  const [category, setCategory] = useState('all');
  const [scope, setScope] = useState('today');
  const [timeOfDay, setTimeOfDay] = useState('all');
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState(7);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [notice, setNotice] = useState('');
  const today = localDate();
  const todayHabits = selectActiveHabits(state, today);
  const completed = todayHabits.filter(habit => (state.habitLogs[today]?.[habit.id] || 0) >= habit.target).length;
  const scoped = scope === 'today' ? todayHabits : state.habits.filter(habit => scope === 'archived' ? habit.archived : !habit.archived);
  const habits = scoped.filter(habit => (category === 'all' || habit.category === category) && (timeOfDay === 'all' || (habit.timeOfDay || 'any') === timeOfDay) && habit.title.toLocaleLowerCase('uk-UA').includes(search.toLocaleLowerCase('uk-UA').trim()));
  const days = daysBack(period);
  return <div className="v-page cv-page">
    <div className="v-view-header"><div><span className="eyebrow">СИЛА ПОВТОРЕННЯ</span><h1>Твої маленькі ритуали</h1><p className="muted">Ранок, день чи вечір — знайди діям своє місце у твоєму житті.</p></div><div className="cv-header-actions"><button className="button button-ghost" onClick={() => setLibraryOpen(true)}><BookOpen size={18} /> Бібліотека</button><button className="button button-primary" onClick={onAddHabit}><Plus size={18} /> Додати звичку</button></div></div>
    <div className="v-habit-intro panel v-panel"><div><span className="eyebrow">СЬОГОДНІ</span><h2>{completed}<span> / {todayHabits.length}</span></h2><p className="muted">ритуалів за твоїм розкладом</p></div><p>Не ідеальна серія.<br />А ритм, до якого хочеться повертатись.</p><div className="v-habit-ring" style={{ '--progress': `${todayHabits.length ? completed / todayHabits.length * 100 : 0}%` }}><Check size={27} weight="light" /></div></div>
    <div className="cv-toolbar"><div className="cv-scope" role="group" aria-label="Список звичок">{[{ id: 'today', label: 'Сьогодні' }, { id: 'all', label: 'Усі активні' }, { id: 'archived', label: 'Архів' }].map(item => <button type="button" key={item.id} aria-pressed={scope === item.id} className={scope === item.id ? 'is-active' : ''} onClick={() => setScope(item.id)}>{item.label}</button>)}</div><label className="cv-search"><MagnifyingGlass size={17} /><input type="search" aria-label="Пошук звичок" placeholder="Знайти свій ритуал…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <CategoryFilters value={category} onChange={setCategory} label="Напрям звичок" />
    <div className="cv-habit-filters"><label className="cv-filter-select"><Sun size={16} /><select aria-label="Час доби" value={timeOfDay} onChange={event => setTimeOfDay(event.target.value)}><option value="all">Увесь день</option>{TIMES.map(time => <option key={time.id} value={time.id}>{time.label}</option>)}</select></label><div className="cv-period" role="group" aria-label="Період історії звичок"><button className={period === 7 ? 'is-active' : ''} aria-pressed={period === 7} onClick={() => setPeriod(7)}>7 днів</button><button className={period === 30 ? 'is-active' : ''} aria-pressed={period === 30} onClick={() => setPeriod(30)}>30 днів</button></div></div>
    <p className="cv-notice" role="status">{notice}</p>
    <div className="v-habit-grid">{habits.map(habit => <HabitCard key={habit.id} habit={habit} state={state} dispatch={dispatch} historyDays={days} onEdit={setEditing} onNotice={setNotice} />)}</div>
    {!habits.length && <div className="panel v-panel v-empty"><CalendarBlank size={36} weight="light" /><h3>{scope === 'archived' ? 'Архів поки порожній' : 'Знайди ритм для цього дня'}</h3><p>{scope === 'archived' ? 'Архів зберігає твої відмітки. Поверни звичку, коли захочеш продовжити.' : 'За цими фільтрами звичок немає. Переглянь усі активні або обери ідею в бібліотеці.'}</p>{scope !== 'archived' && <button className="button button-ghost" onClick={() => setLibraryOpen(true)}>Обрати ритуал <BookOpen size={16} /></button>}</div>}
    <p className="v-footnote">Відсоток враховує дні за поточним розкладом від моменту створення звички. Серія — послідовні заплановані виконання; вихідні її не переривають.</p>
    {libraryOpen && <HabitLibrary state={state} dispatch={dispatch} onClose={() => setLibraryOpen(false)} onNotice={setNotice} />}
    {editing && <HabitEditor habit={editing} state={state} dispatch={dispatch} onClose={() => setEditing(null)} onNotice={setNotice} />}
  </div>;
}
