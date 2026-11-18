import { useEffect, useReducer, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUpRight, Barbell, Bell, BookOpen, Camera, CaretDown, CaretRight, ChartLineUp, Check, CheckSquare, ChatsCircle, Clock, Compass, DotsThree, Drop, Fire, Flag, GearSix, Heartbeat, House, Lightning, List, Mountains, MoonStars, Plus, ShieldCheck, Sparkle, Sun, Target, Trophy, Wallet, X } from '@phosphor-icons/react';
import { CATEGORIES, localDate, reducer, selectStats, selectActiveQuests, isHabitDue, selectFinance, needsStart } from './model.js';
import StartFlow from './StartFlow.jsx';
import { SlotSelect, TierBadge, TierPicker, groupBySlot } from './QuestMeta.jsx';
import { QuestsView, HabitsView, ProgressView, CoachView } from './Views.jsx';
import MoneyView from './MoneyView.jsx';
import GoalsView from './GoalsView.jsx';
import JournalView, { DailyCheckIn } from './JournalView.jsx';
import { DOMAIN_ICONS, ScheduleFields } from './CollectionDialog.jsx';
import { exportBackup, persistState, recoverPersistence, isDemo, activeStorageKey } from './app-persistence.js';
import './life.css';
import { InstallPanel, PlatformStatus, isNative } from './PlatformUI.jsx';
import DataTransfer from './DataTransfer.jsx';
import DeviceSettings from './DeviceSettings.jsx';
import { listenReminderNavigation } from './reminders.js';
import { Avatar, CharacterArt, PortraitPicker } from './CharacterPortrait.jsx';
import LifeJourney from './LifeJourney.jsx';
import JourneyEntry from './JourneyEntry.jsx';
import AccountPanel from './AccountPanel.jsx';
import CoachMemory from './CoachMemory.jsx';
import DayCycle, { WeeklyMeetingCard } from './DayCycle.jsx';
import AppearanceSettings, { useAppearance } from './AppearanceSettings.jsx';
import ImpulseToday from './ImpulseToday.jsx';
import { applyAppearance } from './appearance.js';
import { planReminders, planActionEffect } from './plan-reminders.js';
import PlanReminders from './PlanReminders.jsx';
import CloudSyncPanel, { useCloudSync } from './CloudSyncPanel.jsx';

const NAV = [
  { id: 'today', label: 'Мій день', Icon: House },
  { id: 'journey', label: 'Мій маршрут', Icon: Compass },
  { id: 'quests', label: 'Квести', Icon: Flag },
  { id: 'habits', label: 'Звички', Icon: CheckSquare },
  { id: 'goals', label: 'Мої цілі', Icon: Target },
  { id: 'progress', label: 'Мій прогрес', Icon: ChartLineUp },
  { id: 'money', label: 'Фінанси', Icon: Wallet },
  { id: 'journal', label: 'Щоденник', Icon: BookOpen },
  { id: 'coach', label: 'Тренер', Icon: Sparkle },
];
const domainIcons = DOMAIN_ICONS;
const habitIcons = { water: Drop, book: BookOpen, moon: MoonStars };
const attributes = [{ id: 'strength', name: 'Сила', Icon: Barbell }, { id: 'endurance', name: 'Витривалість', Icon: Heartbeat }, { id: 'intelligence', name: 'Інтелект', Icon: BookOpen }, { id: 'discipline', name: 'Дисципліна', Icon: Target }, { id: 'charisma', name: 'Харизма', Icon: ChatsCircle }];
const ranks = ['Шукач', 'Мандрівник', 'Дослідник', 'Підкорювач', 'Майстер шляху'];

function Logo() { return <div className="brand"><span className="brand-mark" aria-hidden="true"><i /><i /><i /></span><span>крок<span className="brand-dot">.</span></span></div>; }
function ProgressBar({ value, label, className = '' }) { return <div className={`progress-track ${className}`} role="progressbar" aria-label={label} aria-valuenow={Math.round(value)} aria-valuemin={0} aria-valuemax={100}><span style={{ transform: `scaleX(${Math.max(0, Math.min(value, 100)) / 100})` }} /></div>; }

function Modal({ title, subtitle, children, onClose, canClose = true }) {
  const ref = useRef(null);
  const opener = useRef(document.activeElement);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      const previous = opener.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className="modal" aria-label={title} onCancel={event => { event.preventDefault(); if (canClose) onClose(); }} onClick={event => { if (canClose && event.target === ref.current) { const box = ref.current.getBoundingClientRect(); if (event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom) onClose(); } }}><div className="modal-content">{canClose && <button type="button" className="icon-button modal-close" aria-label="Закрити" onClick={onClose}><X size={20} /></button>}<span className="eyebrow">ТВІЙ НАСТУПНИЙ КРОК</span><h2>{title}</h2><p className="modal-subtitle">{subtitle}</p>{children}</div></dialog>;
}

function ProfileForm({ state, dispatch, onClose, notify, disabled = false, gated = false }) {
  const [draft, setDraft] = useState(state.profile);
  const [error, setError] = useState('');
  function upload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 1_000_000) { setError('Обери JPG, PNG або WebP до 1 МБ.'); return; }
    const reader = new FileReader();
    reader.onload = () => { setDraft(old => ({ ...old, avatar: reader.result, portrait: '' })); setError(''); };
    reader.onerror = () => setError('Не вдалося прочитати фото. Спробуй інший файл.');
    reader.readAsDataURL(file);
  }
  return <form className="form-stack" inert={disabled} onSubmit={e => { e.preventDefault(); if (disabled) return; dispatch({ type: 'UPDATE_PROFILE', profile: { ...draft, onboarded: gated ? draft.onboarded : true } }); notify(gated ? 'Профіль збережено' : 'Твій маршрут налаштовано'); onClose(); }}>
    <div className="profile-upload"><Avatar profile={draft} large /><div><label className="button button-ghost upload-button"><Camera size={17} /> Додати своє фото<input aria-label="Фото профілю" type="file" accept="image/png,image/jpeg,image/webp" onChange={upload} /></label><p>Завантажене фото зберігається на цьому пристрої.</p>{draft.avatar && <button type="button" className="text-button" onClick={() => setDraft({ ...draft, avatar: '', portrait: '' })}>Прибрати завантажене фото</button>}</div></div>
    <PortraitPicker value={draft.portrait} disabled={disabled} onChange={portrait => setDraft(old => ({...old,portrait}))} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <label className="field">Як тебе звати?<input autoComplete="given-name" value={draft.name === 'Друже' ? '' : draft.name} placeholder="Твоє ім’я" maxLength={40} required onChange={e => setDraft({ ...draft, name: e.target.value })} /></label>
    <label className="field">До чого ти хочеш прийти?<textarea value={draft.goal} maxLength={200} required rows={3} onChange={e => setDraft({ ...draft, goal: e.target.value })} placeholder="Більше енергії, впевненості та часу на себе" /></label>
    <label className="field">Чим займаєшся?<input value={draft.occupation || ''} maxLength={80} onChange={e => setDraft({ ...draft, occupation: e.target.value })} placeholder="Робота, навчання, власний проєкт…" /></label>
    <label className="field">Трохи про себе<textarea value={draft.bio || ''} maxLength={300} rows={2} onChange={e => setDraft({ ...draft, bio: e.target.value })} placeholder="Що любиш і чому хочеш приділяти більше уваги" /></label>
    <fieldset className="focus-field"><legend>На чому зосередимось спочатку?</legend><div>{CATEGORIES.map(category => { const Icon = domainIcons[category.id]; return <label key={category.id} className={draft.focus === category.id ? 'selected' : ''}><input type="radio" name="focus" value={category.id} checked={draft.focus === category.id} onChange={() => setDraft({ ...draft, focus: category.id })} /><Icon size={20} weight="light" />{category.shortLabel}</label>; })}</div></fieldset>
    <button className="button button-primary submit-button" type="submit">Зберегти мій маршрут <span className="button-circle"><ArrowRight size={18} /></span></button>
  </form>;
}

function QuestForm({ state, dispatch, onClose, notify, goalId }) {
  const [category, setCategory] = useState(state.goals?.find(g => g.id === goalId)?.category || 'body');
  const [schedule, setSchedule] = useState({ frequency: 'daily', weekdays: [1,2,3,4,5], scheduledDate: localDate() });
  const [error, setError] = useState('');
  const [xp, setXp] = useState(20);
  const [slot, setSlot] = useState('any');
  return <form className="form-stack" onSubmit={e => { e.preventDefault(); if (state.quests.length >= 200) { setError('Досягнуто ліміту 200 квестів. Новий квест не створено; введені дані залишилися у формі.'); return; } const form = new FormData(e.currentTarget); if (!String(form.get('title')).trim() || (schedule.frequency === 'weekdays' && !schedule.weekdays.length)) {setError('Вкажи назву та хоча б один день повторення.');return;} dispatch({ type: 'ADD_QUEST', quest: { ...schedule, goalId: form.get('goalId') || null, title: form.get('title'), description: form.get('description'), category, minutes: Number(form.get('minutes')), xp, timeOfDay: slot, attribute: form.get('attribute') } }); notify('Квест додано до розпорядку'); onClose(); }}>
    <label className="field">Що хочеш зробити?<input name="title" required maxLength={100} placeholder="Наприклад, вивчити 10 нових слів" autoFocus /></label>
    <label className="field">Короткий план<textarea name="description" maxLength={400} rows={2} placeholder="Що допоможе зробити цей крок?" /></label>
    <div className="form-row"><label className="field">Напрям<select aria-label="Напрям" value={category} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(c => <option value={c.id} key={c.id}>{c.shortLabel}</option>)}</select></label><label className="field">Характеристика<select aria-label="Характеристика" name="attribute" key={category} defaultValue={CATEGORIES.find(c => c.id === category)?.attribute}>{attributes.map(a => <option value={a.id} key={a.id}>{a.name}</option>)}</select></label></div>
    <TierPicker xp={xp} onChange={setXp} />
    <div className="form-row"><label className="field">Час, хвилин<input type="number" name="minutes" min="1" max="180" defaultValue="15" required /></label><SlotSelect value={slot} onChange={setSlot} /></div>
    <ScheduleFields values={schedule} onChange={setSchedule} />
    <label className="field">До якої цілі веде?<select name="goalId" defaultValue={goalId || ''}><option value="">Самостійний квест</option>{(state.goals || []).filter(g => g.status === 'active').map(g => <option key={g.id} value={g.id}>{g.title}</option>)}</select></label>
    <p className="form-hint">Нагороду можна отримати один раз у запланований день. Числовий прогрес цілі відмічай окремо.</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary submit-button" type="submit">Додати квест <span className="button-circle"><Plus size={18} /></span></button>
  </form>;
}

function HabitForm({ state, dispatch, onClose, notify }) {
  const [schedule, setSchedule] = useState({ frequency: 'daily', weekdays: [1,2,3,4,5] });
  const [error, setError] = useState('');
  return <form className="form-stack" onSubmit={e => { e.preventDefault(); if (state.habits.length >= 50) { setError('Досягнуто ліміту 50 звичок. Нову звичку не створено; введені дані залишилися у формі.'); return; } const form = new FormData(e.currentTarget); if (!String(form.get('title')).trim() || !String(form.get('unit')).trim() || (schedule.frequency === 'weekdays' && !schedule.weekdays.length)) {setError('Вкажи назву, одиницю та дні повторення.');return;} dispatch({ type: 'ADD_HABIT', habit: { ...schedule, category: form.get('category'), timeOfDay: form.get('timeOfDay'), title: form.get('title'), target: Number(form.get('target')), unit: form.get('unit'), icon: form.get('icon') } }); notify('Звичку додано'); onClose(); }}>
    <label className="field">Твоя нова звичка<input name="title" required maxLength={80} placeholder="Наприклад, зробити перерву від екрана" autoFocus /></label>
    <div className="form-row"><label className="field">Ціль на день<input name="target" type="number" min="1" max="10000" defaultValue="1" required /></label><label className="field">Одиниця<input name="unit" defaultValue="разів" required maxLength={30} /></label></div>
    <div className="form-row"><label className="field">Напрям<select name="category">{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.shortLabel}</option>)}</select></label><label className="field">Час дня<select name="timeOfDay"><option value="any">Коли зручно</option><option value="morning">Ранок</option><option value="day">День</option><option value="evening">Вечір</option></select></label></div>
    <label className="field">Позначка<select name="icon">{[['book','Книга'],['water','Вода'],['moon','Відпочинок'],['walk','Рух'],['food','Їжа'],['mind','Спокій'],['wallet','Гроші'],['people','Люди'],['work','Робота'],['home','Дім'],['creative','Творчість']].map(([id,label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <ScheduleFields values={schedule} onChange={setSchedule} allowOnce={false} />
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary submit-button" type="submit">Створити звичку <span className="button-circle"><Plus size={18} /></span></button>
  </form>;
}

function Character({ state, stats, onProfile, onProgress }) {
  return <section className="panel character-panel"><div className="card-top"><span className="eyebrow">ТВІЙ ПЕРСОНАЖ</span><button className="icon-button" aria-label="Налаштувати персонажа" onClick={onProfile}><DotsThree size={23} /></button></div>
    <CharacterArt profile={state.profile} level={stats.level} onEdit={onProfile} />
    <h2>{ranks[Math.min(stats.level - 1, ranks.length - 1)]}</h2><p className="character-sub">{stats.totalXp ? `${state.profile.name} · ${stats.totalXp.toLocaleString('uk-UA')} XP власних перемог` : 'Твоя історія тільки починається'}</p>
    <div className="xp-line"><span>Рівень {stats.level}</span><span>{stats.currentLevelXp} <small>/ {stats.nextLevelXp} XP</small></span></div><ProgressBar value={stats.currentLevelXp / stats.nextLevelXp * 100} label="Досвід до нового рівня" />
    <div className="character-attributes">{attributes.map(({ id, name, Icon }) => <div key={id}><Icon size={16} weight="light" /><span>{name}</span><div className="attribute-track"><i style={{ transform: `scaleX(${((stats.attributes?.[id] || 0) % 100) / 100})` }} /></div><strong>{Math.floor((stats.attributes?.[id] || 0) / 100) + 1}</strong></div>)}</div>
    <button className="character-footer" onClick={onProgress}>Мій розвиток <ArrowUpRight size={17} /></button>
  </section>;
}

function DailyQuests({ state, dispatch, stats, setPage, onAddQuest, notify }) {
  const [filter, setFilter] = useState('all');
  const done = state.completions[localDate()] || [];
  const plannedIds = new Set((state.dailyPlans || []).filter(plan => plan.date === localDate()).flatMap(plan => plan.appliedQuestIds));
  const quests = groupBySlot(selectActiveQuests(state).filter(q => filter === 'all' || q.category === filter).sort((a, b) => Number(plannedIds.has(b.id)) - Number(plannedIds.has(a.id)))).flatMap(group => group.quests).slice(0, 8);
  function toggle(quest) {
    if (done.includes(quest.id) && stats.balance < quest.xp) { notify('Цей досвід уже обміняно на нагороду'); return; }
    dispatch({ type: 'TOGGLE_QUEST', id: quest.id });
    if (!done.includes(quest.id)) notify(`Крок зроблено! +${quest.xp} XP`);
  }
  return <section className="daily-quests"><div className="section-heading"><h2>Твої квести на сьогодні <span className="count-badge">{stats.todayCompleted}/{stats.todayTotal}</span></h2><button className="text-button" onClick={() => setPage('quests')}>Усі квести <ArrowUpRight size={15} /></button></div>
    <div className="quest-tabs" role="group" aria-label="Напрям квестів"><button className={filter === 'all' ? 'active' : ''} onClick={() => setFilter('all')}>Усі напрями</button>{CATEGORIES.map(c => <button key={c.id} className={filter === c.id ? 'active' : ''} onClick={() => setFilter(c.id)}>{c.shortLabel}</button>)}</div>
    <div className="quest-list">{quests.map(quest => { const Icon = domainIcons[quest.category]; const complete = done.includes(quest.id); return <div key={quest.id} className={`quest-row ${complete ? 'complete' : ''}`}><button className="quest-check" aria-label={`${complete ? 'Скасувати' : 'Виконати'}: ${quest.title}`} aria-pressed={complete} onClick={() => toggle(quest)}>{complete && <Check size={14} weight="bold" />}</button><span className={`domain-icon ${quest.category}`}><Icon size={23} weight="light" /></span><div className="quest-content"><button onClick={() => toggle(quest)}>{quest.title}</button><span>{CATEGORIES.find(c => c.id === quest.category)?.shortLabel}<i /> <Clock size={12} /> {quest.minutes} хв</span></div><span className="quest-xp"><TierBadge xp={quest.xp} /> +{quest.xp} <small>XP</small></span></div>; })}</div>
    <button className="add-quest" onClick={onAddQuest}><Plus size={17} /> Додати квест до розпорядку</button>
  </section>;
}

function Today(props) {
  const { palette } = useAppearance();
  if (palette !== 'impulse') return <ClassicToday {...props} />;
  return <ImpulseToday {...props} character={<Character state={props.state} stats={props.stats} onProfile={() => props.openModal('profile')} onProgress={() => props.setPage('progress')} />} />;
}

function ClassicToday({ state, dispatch, stats, setPage, openModal, notify, disabled = false }) {
  const [allDomains, setAllDomains] = useState(false);
  const dueQuests = selectActiveQuests(state);
  const finance = selectFinance(state, { month: localDate().slice(0,7) });
  const done = state.completions[localDate()] || [];
  const progress = stats.todayTotal ? stats.todayCompleted / stats.todayTotal * 100 : 0;
  const focus = CATEGORIES.find(c => c.id === state.profile.focus) || CATEGORIES[0];
  const minutes = state.quests.reduce((total, q) => total + (done.includes(q.id) ? q.minutes : 0), 0);
  return <><div className="welcome-row"><div><div className="greeting"><Sun size={18} weight="light" /> Привіт, {state.profile.name === 'Друже' ? 'друже' : state.profile.name}!</div><h1>Сьогодні — ще один крок.</h1><p>Твоя краща версія починається з маленьких дій.</p></div><div className="streak"><span className="streak-icon"><Fire size={24} weight="light" /></span><div><strong>{stats.streak} <span>{stats.streak === 1 ? 'день' : 'днів'}</span></strong><small>твоя серія</small></div></div></div>
    <WeeklyMeetingCard state={state} disabled={disabled} />
    <CoachView state={state} dispatch={dispatch} entry="home" disabled={disabled} onJourney={() => setPage('journey')} />
    <DayCycle state={state} disabled={disabled} onMemory={() => openModal('memory')} />
    <JourneyEntry state={state} onOpen={() => setPage('journey')} />
    <div className="day-grid"><div className="day-main">
      <section className="journey-hero"><img className="journey-image" src="/journey.png" alt="Мандрівник біля підніжжя гори зі світлою стежкою до вершини" /><div className="hero-shade" /><div className="hero-copy"><span className="hero-eyebrow"><span /> НОВИЙ ДЕНЬ. НОВИЙ РІВЕНЬ.</span><h2>Не ідеальний.<br />Але кращий,<br /><em>ніж учора.</em></h2><p>Великі зміни складаються<br />з маленьких перемог.</p><button className="button button-primary" onClick={() => document.getElementById('daily-quests').scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' })}>Зробити крок <span className="button-circle"><ArrowRight size={17} /></span></button></div><div className="hero-coordinate"><Mountains size={18} weight="light" /><span>ТВІЙ ВЛАСНИЙ МАРШРУТ</span></div></section>
      <div className="domain-grid">{(allDomains ? CATEGORIES : CATEGORIES.slice(0,4)).map(category => { const Icon = domainIcons[category.id]; const total = dueQuests.filter(q => q.category === category.id).length; const completed = dueQuests.filter(q => q.category === category.id && done.includes(q.id)).length; return <button key={category.id} className={`domain-card ${category.id}`} onClick={() => setPage(category.id === 'money' ? 'money' : 'quests')}><div><Icon size={23} weight="light" /><ArrowUpRight size={15} className="domain-arrow" /></div><h3>{category.shortLabel}</h3><div className="domain-bottom"><span>{completed} <small>/ {total} квестів</small></span><span className="domain-small-line"><i style={{ transform: `scaleX(${total ? completed / total : 0})` }} /></span></div></button>; })}</div>
      <button className="text-button domain-toggle" onClick={() => setAllDomains(!allDomains)}>{allDomains ? 'Згорнути напрями' : 'Усі 10 напрямів життя'} <CaretDown size={14} /></button>
      <div id="daily-quests"><DailyQuests state={state} dispatch={dispatch} stats={stats} setPage={setPage} onAddQuest={() => openModal('quest')} notify={notify} /></div>
      <section className="daily-habits"><div className="section-heading"><h2>Маленькі звички</h2><button className="text-button" onClick={() => setPage('habits')}>Усі звички <ArrowUpRight size={15} /></button></div><div className="mini-habits">{state.habits.filter(h => isHabitDue(h, localDate())).slice(0, 3).map(habit => { const value = state.habitLogs[localDate()]?.[habit.id] || 0; const Icon = habitIcons[habit.icon] || BookOpen; return <button className={`mini-habit ${value >= habit.target ? 'done' : ''}`} key={habit.id} onClick={() => { if (value < habit.target) { dispatch({ type: 'LOG_HABIT', id: habit.id }); notify(value + 1 >= habit.target ? 'Звичку виконано на сьогодні' : 'Ще один маленький крок'); } else { setPage('habits'); } }}><Icon size={23} weight="light" /><span>{habit.title}<small>{value} / {habit.target} {habit.unit}</small></span><span className="mini-habit-action">{value >= habit.target ? <Check size={15} /> : <Plus size={15} />}</span></button>; })}</div></section>
      <section className="dashboard-goals"><div className="section-heading"><h2>Твої найближчі вершини</h2><button className="text-button" onClick={() => setPage('goals')}>Усі цілі <ArrowUpRight size={15} /></button></div>{(state.goals || []).filter(g => g.status === 'active').slice(0,3).map(goal => <button className="dashboard-goal" key={goal.id} onClick={() => setPage('goals')}><span>{goal.title}<small>{Math.round(goal.current / goal.target * 100)}%</small></span><div className="life-track"><span style={{width:`${goal.current / goal.target * 100}%`}} /></div></button>)}{!(state.goals || []).some(g => g.status === 'active') && <button className="add-quest" onClick={() => setPage('goals')}><Plus size={17} /> Обрати першу ціль</button>}</section>
      <DailyCheckIn {...{state,dispatch,setPage}} />
      <button className="dashboard-finance" onClick={() => setPage('money')}><span className="eyebrow">ФІНАНСИ ЦЬОГО МІСЯЦЯ <ArrowUpRight size={17} /></span><strong>{finance.expense.toLocaleString('uk-UA')} ₴</strong><p>Витрати · дохід {finance.income.toLocaleString('uk-UA')} ₴{finance.limit > 0 ? ` · ${finance.remaining >= 0 ? 'до ліміту' : 'понад ліміт'} ${Math.abs(finance.remaining).toLocaleString('uk-UA')} ₴` : ' · встанови свій бюджет'}</p></button>
    </div><aside className="day-aside">
      <Character state={state} stats={stats} onProfile={() => openModal('profile')} onProgress={() => setPage('progress')} />
      <section className="panel day-progress"><div className="card-top"><span className="eyebrow">СЬОГОДНІ В ОБ’ЄКТИВІ</span><Target size={18} weight="light" /></div><div className="day-progress-heading"><h3>Кожен крок<br />має значення.</h3><div className="day-ring" style={{ '--progress': `${progress}%` }}><span>{Math.round(progress)}<small>%</small></span></div></div><div className="day-metrics"><div><strong>{stats.todayXp} <span>XP</span></strong><small>досвіду отримано</small></div><div><strong>{minutes} <span>хв</span></strong><small>інвестиції в себе</small></div></div></section>
      <section className="coach-card"><div className="coach-card-heading"><span className="coach-symbol"><Sparkle size={22} weight="light" /></span><span>Твій тренер<small>Поруч на кожному кроці</small></span><span className="demo-pill">ПОРАДА</span></div><p>Розкажи, що хочеш змінити, — разом знайдемо посильний наступний крок.</p><button className="text-button" onClick={() => setPage('coach')}>Налаштувати тренера <ArrowRight size={16} /></button></section>
      <button className="focus-note" onClick={() => openModal('profile')}><span><span className="eyebrow">ТВІЙ ФОКУС</span><strong>{focus.label}</strong></span><ArrowUpRight size={18} /></button>
    </aside></div>
    {!state.profile.onboarded && <div className="setup-banner"><div><Compass size={23} weight="light" /><span><strong>Це твій шлях. Зробімо його особистим.</strong><small>Додай ім’я, фото й ціль — і вирушай.</small></span></div><button className="button button-ghost" onClick={() => openModal('profile')}>Налаштувати профіль <ArrowUpRight size={16} /></button></div>}
  </>;
}

export default function App({ initialState, initialWarning }) {
  const [state, dispatch] = useReducer((currentState, action) => action.type === 'RESTORE_STATE' ? action.state : reducer(currentState, action), initialState);
  const [page, setCurrentPage] = useState(() => {
    const requested = window.location.hash.slice(1);
    if (!isDemo && !initialWarning && !requested && initialState.profile.lifeProfile?.status === 'in_progress') return 'journey';
    return NAV.some(n => n.id === requested) ? requested : 'today';
  });
  const [modal, setModal] = useState(null);
  const [questGoalId, setQuestGoalId] = useState(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [saveFailed, setSaveFailed] = useState(false);
  const [savedSnapshot, setSavedSnapshot] = useState(null);
  const [storageWarning, setStorageWarning] = useState(initialWarning || '');
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [externalChange, setExternalChange] = useState(false);
  const writeGuard = useRef(false);
  const restoreGuard = useRef(false);
  const [dayTick, setDayTick] = useState(0);
  const durableState = useRef(null);
  const toastTimeout = useRef(null);
  const nativeState = useRef(null);
  nativeState.current = { state, page, modal, menuOpen };
  const stats = selectStats(state);
  const current = NAV.find(n => n.id === page);
  const writeBlocked = Boolean(storageWarning || externalChange || restoreBusy || saveFailed);
  const writeBlockedRef = useRef(false);
  writeBlockedRef.current = writeBlocked;
  const planListener = useRef(null);
  // A brand-new profile answers the start questions before the tools open. Used profiles are never blocked.
  const gated = !isDemo && needsStart(state);
  const cloud = useCloudSync({ scope: activeStorageKey, state, savedSnapshot, blocked: writeBlocked, adopt: restoreData, notify });
  async function exportCopy() { const result = await exportBackup(nativeState.current.state); if (result.status === 'failed') notify(result.error || 'Не вдалося зберегти копію'); else if (result.status === 'downloaded') notify('Копію записів збережено у файл'); }
  useEffect(() => applyAppearance(), []);
  useEffect(() => { if (modal) window.dispatchEvent(new Event('krok:pause-coach')); }, [modal]);
  useEffect(() => {
    if (isDemo || writeBlocked) return undefined;
    let active = true;
    const refresh = () => {
      const saved = durableState.current;
      if (!saved || saved.scope !== activeStorageKey || saved.state !== nativeState.current.state || writeGuard.current || restoreGuard.current) return;
      planReminders.sync(saved.state, saved.scope).catch(error => { if (active) notify(error.message || 'Не вдалося оновити нагадування для справ.'); });
    };
    refresh();
    const visible = () => { if (document.visibilityState === 'visible') refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; document.removeEventListener('visibilitychange', visible); };
  }, [dayTick, writeBlocked]);
  useEffect(() => {
    if (isDemo) return undefined;
    let disposed = false, remove;
    // The durable copy of exactly the state on screen; waits briefly for a save in flight (cold start from a notification button).
    const settledState = async () => {
      for (let attempt = 0; attempt < 20 && !disposed; attempt++) {
        if (writeBlockedRef.current || writeGuard.current || restoreGuard.current) return null;
        const saved = durableState.current;
        if (saved && saved.scope === activeStorageKey && saved.state === nativeState.current.state) return saved;
        await new Promise(resolve => setTimeout(resolve, 150));
      }
      return null;
    };
    const answer = async info => {
      if (writeBlockedRef.current || writeGuard.current || restoreGuard.current) { notify('Зараз зміни не зберігаються. Відміть справу у списку, коли запис відновиться.'); return; }
      const effect = planActionEffect(nativeState.current.state, info, localDate());
      if (effect.type === 'none') { if (effect.message) notify(effect.message); return; }
      if (effect.type === 'dispatch') { dispatch(effect.action); notify(effect.message); return; }
      const saved = await settledState();
      if (disposed) return;
      if (!saved) { notify('Не вдалося оновити нагадування: зміни ще не збережені. Повтори у «Нагадуваннях».'); return; }
      try {
        if (effect.type === 'snooze') await planReminders.snooze(saved.state, saved.scope, info.kind, info.id, info.date);
        else await planReminders.skip(saved.state, saved.scope, info.kind, info.id, info.date);
        if (!disposed) notify(effect.message);
      } catch (error) { if (!disposed) notify(error.message || 'Не вдалося оновити нагадування.'); }
    };
    // Registered before the legacy daily listener: a button tapped while the app was closed is delivered to the first listener only.
    planListener.current = planReminders.listenNavigation(() => activeStorageKey, (destination, info) => {
      setModal(null); setPage(destination === 'habits' ? 'habits' : 'quests');
      if (info && info.action !== 'open') answer(info);
    }).then(cleanup => { if (disposed) cleanup(); else remove = cleanup; }).catch(() => {});
    return () => { disposed = true; remove?.(); };
  }, []);
  function notify(message) { setToast(message); clearTimeout(toastTimeout.current); toastTimeout.current = setTimeout(() => setToast(''), 3500); }
  function setPage(next) { setCurrentPage(next); window.location.hash = next; setMenuOpen(false); window.scrollTo({ top: 0, behavior: 'instant' }); }
  async function switchMode() {
    if (restoreGuard.current || writeGuard.current) { notify('Заверши відновлення або онови дані цього вікна.'); return; }
    if (!await persistState(nativeState.current.state)) { notify('Спочатку збережи резервну копію: поточні зміни не вдалося записати.'); return; }
    const url = new URL(window.location.href); if (isDemo) url.searchParams.delete('demo'); else url.searchParams.set('demo','1'); url.hash='today'; window.location.assign(url);
  }
  async function restoreData(restored) {
    if (restoreGuard.current || writeGuard.current) return false;
    restoreGuard.current = true; setRestoreBusy(true);
    try {
      if (!await recoverPersistence(restored)) return false;
      nativeState.current.state = restored;
      dispatch({ type: 'RESTORE_STATE', state: restored });
      setStorageWarning(''); setSaveFailed(false); setModal(null);
      return true;
    } finally { restoreGuard.current = false; setRestoreBusy(false); }
  }
  useEffect(() => {
    if (restoreGuard.current || writeGuard.current) return undefined;
    let active = true;
    const scope = activeStorageKey;
    persistState(state).then(saved => {
      if (!active) return;
      setSaveFailed(!saved);
      if (!saved || scope !== activeStorageKey || nativeState.current.state !== state || writeGuard.current || restoreGuard.current) return;
      durableState.current = { state, scope };
      setSavedSnapshot(state);
      if (!isDemo && !storageWarning && !externalChange) planReminders.sync(state, scope).catch(error => { if (active) notify(error.message || 'Не вдалося оновити нагадування для справ.'); });
    });
    return () => { active = false; };
  }, [state, storageWarning, externalChange]);
  useEffect(() => {
    if (isNative) return;
    const changed = event => {
      if (event.key !== activeStorageKey && event.key !== null) return;
      if (event.newValue === JSON.stringify(nativeState.current.state)) return;
      writeGuard.current = true; setExternalChange(true);
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  useEffect(() => {
    if (!isNative) return;
    let disposed = false; const cleanup = [];
    const keep = handle => { if (disposed) handle.remove(); else cleanup.push(() => handle.remove()); };
    async function connect() {
      const { App: NativeApp } = await import('@capacitor/app');
      keep(await NativeApp.addListener('backButton', async () => {
        if (restoreGuard.current) return;
        const currentState = nativeState.current;
        const dialog = Array.from(document.querySelectorAll('dialog[open]')).at(-1);
        if (dialog) { dialog.dispatchEvent(new Event('cancel', {cancelable:true})); return; }
        if (currentState.menuOpen) { setMenuOpen(false); return; }
        if (currentState.page === 'today') {
          const closeCoach = new Event('krok:close-home-coach', { cancelable: true });
          if (!window.dispatchEvent(closeCoach)) return;
        }
        if (currentState.page !== 'today') { setPage('today'); return; }
        await persistState(currentState.state);
        await NativeApp.minimizeApp();
      }));
      keep(await NativeApp.addListener('appStateChange', ({ isActive }) => {
        if (isActive) setDayTick(t => t + 1);
        else if (!restoreGuard.current) persistState(nativeState.current.state);
      }));
      await planListener.current;
      const remove = await listenReminderNavigation(() => { setModal(null); setPage('quests'); });
      if (disposed) remove(); else cleanup.push(remove);
    }
    connect().catch(() => {});
    return () => { disposed = true; cleanup.forEach(remove => remove()); };
  }, []);
  useEffect(() => { const sync = () => { const next = window.location.hash.slice(1); if (NAV.some(n => n.id === next)) setCurrentPage(next); }; window.addEventListener('hashchange', sync); const timer = setInterval(() => setDayTick(t => t + 1), 60_000); return () => { window.removeEventListener('hashchange', sync); clearInterval(timer); clearTimeout(toastTimeout.current); }; }, []);
  useEffect(() => { if (!menuOpen) return; const onEscape = e => { if (e.key === 'Escape') setMenuOpen(false); }; window.addEventListener('keydown', onEscape); return () => window.removeEventListener('keydown', onEscape); }, [menuOpen]);
  return <div className="app-shell"><a className="skip-link" href="#main">До вмісту</a>{menuOpen && <button className="sidebar-scrim" aria-label="Закрити навігацію" onClick={() => setMenuOpen(false)} />}
    <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`}><button className="brand-button" onClick={() => setPage('today')} aria-label="Крок — головна"><Logo /></button><div className="sidebar-tagline">СТАВАЙ СОБОЮ. ЩОДНЯ.</div><div className="nav-label">ТВІЙ ПРОСТІР</div><nav aria-label="Основна навігація">{(gated ? [] : NAV).map(({ id, label, Icon }) => <button key={id} onClick={() => setPage(id)} className={`nav-item ${page === id ? 'active' : ''}`} aria-current={page === id ? 'page' : undefined}><Icon size={21} weight={page === id ? 'regular' : 'light'} /><span>{label}</span>{id === 'quests' && <span className="nav-count">{Math.max(0, stats.todayTotal - stats.todayCompleted)}</span>}{id === 'coach' && <span className="nav-new">ЧАТ</span>}</button>)}</nav>
    <div className="sidebar-bottom"><div className="sidebar-quote"><span className="quote-rule" /><p>Не змагайся з іншими.<br />Перевершуй себе.</p><Mountains size={52} weight="thin" /></div><button className="nav-item settings" onClick={() => setModal('profile')}><GearSix size={21} weight="light" /><span>Налаштування</span></button><button className="sidebar-profile" onClick={() => setModal('profile')}><Avatar profile={state.profile} /><span><strong>{state.profile.name}</strong><small>Рівень {stats.level} · {ranks[Math.min(stats.level - 1, ranks.length - 1)]}</small></span><CaretRight size={16} /></button></div></aside>
    <div className="workspace"><header className="topbar"><div className="breadcrumb"><button className="icon-button mobile-menu" onClick={() => setMenuOpen(!menuOpen)} aria-expanded={menuOpen} aria-label="Відкрити меню"><List size={23} /></button><span>Мій простір</span><CaretRight size={13} /><strong>{current.label}</strong></div><div className="topbar-right"><button type="button" className="icon-button account-topbar" aria-label="Акаунт і реєстрація" onClick={() => setModal('account')}><ShieldCheck size={21} /></button><button type="button" className="icon-button theme-toggle" aria-label="Світла або темна тема" onClick={() => setModal('appearance')}><Sun size={20} /></button><span className="date-label">{new Date().toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' })}</span><span className="topbar-divider" /><button className="icon-button" aria-label="Інформація про нагадування" onClick={() => setModal('reminders')}><Bell size={21} weight="light" /></button><button className="topbar-avatar" onClick={() => setModal('profile')} aria-label="Відкрити профіль"><Avatar profile={state.profile} /><CaretDown size={12} /></button></div></header>
    <main id="main" className="main-content"><PlatformStatus />{isDemo && <div className="demo-banner"><Compass size={19} /><div><strong>Демопрофіль Олексія</strong><p>Вигаданий приклад із місяцем історії. Можна змінювати все — особистий прогрес зберігається окремо.</p></div><button className="text-button" onClick={switchMode}>Мій профіль <ArrowRight size={15} /></button></div>}{(storageWarning || saveFailed) && <div role="alert" className="storage-warning">{storageWarning || 'Не вдалося зберегти зміни. Збережи копію своїх даних перед закриттям застосунку.'}<button className="text-button" onClick={() => setModal('profile')}>Відкрити профіль і копії даних <ArrowRight size={15} /></button></div>}
    {cloud.available && ['conflict', 'error'].includes(cloud.status.phase) && modal !== 'account' && <div role="alert" className="storage-warning sync-banner">{cloud.status.phase === 'conflict' ? 'Записи на цьому пристрої та в хмарі відрізняються. Обери, яку версію залишити.' : cloud.status.message || 'Не вдалося синхронізувати записи. Локальні дані збережено.'}<button className="text-button" onClick={() => setModal('account')}>Відкрити синхронізацію <ArrowRight size={15} /></button></div>}
    {gated && <StartFlow state={state} dispatch={dispatch} notify={notify} disabled={writeBlocked} onAccount={() => setModal('account')} onDemo={switchMode} />}
    {!gated && page === 'today' && <Today {...{ state, dispatch, stats, setPage, notify }} disabled={Boolean(storageWarning || externalChange || restoreBusy || saveFailed)} openModal={id => {if (id === 'quest') setQuestGoalId(null);setModal(id);}} />}
    {!gated && page === 'journey' && <LifeJourney {...{state, dispatch, notify}} disabled={Boolean(storageWarning || externalChange || restoreBusy || saveFailed)} onClose={() => setPage('today')} onApplied={() => setPage('today')} />}
    {!gated && page === 'quests' && <QuestsView {...{ state, dispatch, stats }} onAddQuest={() => {setQuestGoalId(null);setModal('quest');}} />}
    {!gated && page === 'habits' && <HabitsView {...{ state, dispatch }} onAddHabit={() => setModal('habit')} />}
    {!gated && page === 'goals' && <GoalsView {...{state,dispatch,setPage}} onAddQuest={id => {setQuestGoalId(id);setModal('quest');}} />}
    {!gated && page === 'journal' && <JournalView {...{state,dispatch}} />}
    {!gated && page === 'progress' && <ProgressView {...{ state, dispatch, stats }} />}
    {!gated && page === 'money' && <MoneyView {...{ state, dispatch }} />}
    {!gated && page === 'coach' && <CoachView {...{ state, dispatch }} disabled={Boolean(storageWarning || externalChange || restoreBusy || saveFailed)} onJourney={() => setPage('journey')} />}
    <footer className="page-footer"><button className="text-button" onClick={() => setModal('install')}>{isNative ? 'КРОК ДЛЯ ANDROID' : 'ВСТАНОВИТИ КРОК'} <ArrowUpRight size={13} /></button><span><ShieldCheck size={13} weight="light" /> {cloud.status.enabled ? 'Прогрес на пристрої та в акаунті' : 'Прогрес на пристрої'} <i /> v0.9.0</span></footer></main></div>
    {!gated && <nav className="mobile-tabs" aria-label="Швидка навігація">{['today','quests','habits','money'].map(id => {const {label,Icon}=NAV.find(n => n.id===id);return <button key={id} aria-current={page === id ? 'page' : undefined} onClick={() => setPage(id)}><Icon size={23} weight={page === id ? 'fill' : 'light'} /><span>{id==='today'?'Сьогодні':label}</span></button>;})}<button aria-label="Усі розділи" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)} aria-current={!['today','quests','habits','money'].includes(page)?'page':undefined}><List size={23}/><span>Ще</span></button></nav>}
    {modal === 'profile' && <Modal title="Почнемо з тебе." subtitle="Власна ціль. Власний темп. Власний шлях." canClose={!restoreBusy} onClose={() => { if (!restoreGuard.current) setModal(null); }}><div className="settings-links"><button type="button" className="button button-ghost" onClick={() => setModal('account')}><ShieldCheck size={18} /> Акаунт і реєстрація</button><button type="button" className="button button-ghost" onClick={() => setModal('memory')}><Sparkle size={18} /> Пам’ять тренера</button><button type="button" className="button button-ghost" onClick={() => setModal('appearance')}><Sun size={18} /> Світла й темна тема</button></div><ProfileForm {...{ state, dispatch, notify }} disabled={restoreBusy} gated={gated} onClose={() => setModal(null)} /><div className="mode-switch"><Compass size={24} /><div><strong>{isDemo ? 'Готовий до власного маршруту?' : 'Подивись, як це працює.'}</strong><p>{isDemo ? 'Повернися до особистого профілю. Зміни демоприкладу залишаться в окремому сховищі.' : 'Олексій уже місяць веде звички, цілі й витрати. Це вигаданий приклад, який можна спробувати.'}</p><button disabled={restoreBusy} className="button button-ghost" onClick={switchMode}>{isDemo ? 'Відкрити мій профіль' : 'Відкрити демопрофіль'} <ArrowRight size={16} /></button></div></div><DataTransfer state={state} blocked={Boolean(storageWarning)} notify={notify} onRestore={restoreData} /><button disabled={restoreBusy} className="text-button install-profile-link" onClick={() => setModal('install')}>{isNative ? 'Про застосунок' : 'Встановити КРОК на пристрій'} <ArrowUpRight size={16} /></button></Modal>}
    {modal === 'account' && <Modal title="Твій акаунт КРОК" subtitle="Google або електронна пошта." onClose={() => setModal(null)}><AccountPanel disabled={writeBlocked || savedSnapshot !== state} cloud={cloud.available} />{cloud.available && <CloudSyncPanel cloud={cloud} state={state} disabled={writeBlocked || savedSnapshot !== state} onExport={exportCopy} onTransfer={async local => { const moved = await restoreData(local); if (moved) notify('Записи локального профілю скопійовано в акаунт'); return moved; }} />}</Modal>}
    {modal === 'memory' && <Modal title="Що тренер знає про тебе" subtitle="Збережені факти та дозволи на контекст." onClose={() => setModal(null)}><CoachMemory {...{state,dispatch}} disabled={writeBlocked} /></Modal>}
    {modal === 'appearance' && <Modal title="Твій КРОК. Твої кольори." subtitle="Обери світлу, темну або системну тему." onClose={() => setModal(null)}><AppearanceSettings /></Modal>}
    {modal === 'quest' && <Modal title="Ще одна маленька перемога." subtitle="Обери дію, яку реально виконати сьогодні." onClose={() => setModal(null)}><QuestForm state={state} goalId={questGoalId} dispatch={dispatch} notify={notify} onClose={() => setModal(null)} /></Modal>}
    {modal === 'habit' && <Modal title="Знайди свій ритм." subtitle="Невелика дія, яка поступово стає частиною тебе." onClose={() => setModal(null)}><HabitForm state={state} dispatch={dispatch} notify={notify} onClose={() => setModal(null)} /></Modal>}
    {modal === 'reminders' && <Modal title="Знайди свій час." subtitle="Обери час, частоту й тихі години." onClose={() => setModal(null)}>{isDemo ? <div className="form-stack"><p className="life-muted">У демопрофілі нагадування не вмикаються. Налаштуй зручний час у своєму профілі.</p><button className="button button-primary" onClick={switchMode}>Перейти до мого профілю <ArrowRight size={17}/></button></div> : <><DeviceSettings remaining={stats.todayTotal - stats.todayCompleted} onClose={() => setModal(null)} notify={notify} onInstall={() => setModal('install')} /><PlanReminders state={state} scope={activeStorageKey} disabled={writeBlocked || savedSnapshot !== state} /></>}</Modal>}
    {modal === 'install' && <Modal title="КРОК завжди поруч." subtitle="На телефоні. На комп’ютері. У твоєму темпі." onClose={() => setModal(null)}><InstallPanel /></Modal>}
    {externalChange && <Modal title="Прогрес змінився в іншому вікні." subtitle="Це вікно призупинило збереження, щоб не перезаписати новіші дані. Завантаж актуальний прогрес. Незбережені поля відкритих форм буде закрито." canClose={false}><div className="form-stack"><button className="button button-primary" onClick={() => window.location.reload()}>Завантажити актуальні дані <ArrowRight size={17} /></button><button className="button button-ghost" onClick={async () => { const result = await exportBackup(state); if (result.status === 'failed') notify(result.error || 'Не вдалося зберегти копію'); else if (result.status === 'downloaded') notify('Копію цього вікна збережено'); }}>Зберегти копію цього вікна <ArrowDown size={17} /></button></div></Modal>}
    <div className={`toast ${toast ? 'visible' : ''}`} role="status" aria-live="polite">{toast && <><span><Check size={15} weight="bold" /></span>{toast}</>}</div>
  </div>;
}
