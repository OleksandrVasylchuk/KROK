import { useState } from 'react';
import { ArrowRight, ArrowUpRight, BookOpen, Brain, Check, Drop, Fire, Lightning, MoonStars, Plus, Smiley, SmileyMeh, SmileySad, Sparkle, Target, Wallet } from '@phosphor-icons/react';
import { CATEGORIES, isHabitDue, localDate, selectActiveQuests, selectFinance } from './model.js';
import CoachView from './CoachView.jsx';
import DayCycle, { WeeklyMeetingCard } from './DayCycle.jsx';
import { TierBadge, groupBySlot } from './QuestMeta.jsx';
import JourneyEntry from './JourneyEntry.jsx';
import { DailyCheckIn } from './JournalView.jsx';

const habitIcons = { water: Drop, book: BookOpen, moon: MoonStars };
const moods = [
  { label: 'Добре', Icon: Smiley, text: 'Сьогодні почуваюся добре.' },
  { label: 'Спокійно', Icon: SmileyMeh, text: 'Сьогодні почуваюся спокійно.' },
  { label: 'Втомлено', Icon: SmileySad, text: 'Сьогодні почуваюся втомлено. Допоможи обрати легкий темп без збільшення навантаження.' },
];

export default function ImpulseToday({ state, dispatch, stats, setPage, openModal, notify, character, disabled = false }) {
  const [showAll, setShowAll] = useState(false);
  const today = localDate();
  const done = state.completions[today] || [];
  const plannedIds = new Set((state.dailyPlans || []).filter(plan => plan.date === today).flatMap(plan => plan.appliedQuestIds));
  const quests = selectActiveQuests(state).sort((a, b) => Number(plannedIds.has(b.id)) - Number(plannedIds.has(a.id)));
  // Once any quest has a part of day, the list becomes the day's routine and is shown whole.
  const routine = quests.some(quest => quest.timeOfDay && quest.timeOfDay !== 'any');
  const ordered = groupBySlot(quests).flatMap(group => group.quests);
  const visibleQuests = routine || showAll ? ordered : ordered.slice(0, 3);
  const habits = state.habits.filter(habit => isHabitDue(habit, today));
  const goals = (state.goals || []).filter(goal => goal.status === 'active');
  const finance = selectFinance(state, { month: today.slice(0, 7) });
  const checkIn = state.checkIns?.[today];
  const completed = quests.filter(quest => done.includes(quest.id)).length;
  const name = state.profile.name === 'Друже' ? 'друже' : state.profile.name;
  const money = value => value.toLocaleString('uk-UA', { maximumFractionDigits: 2 });

  function prepare(text) {
    if (!disabled) window.dispatchEvent(new CustomEvent('krok:coach-prompt', { detail: { text } }));
  }
  function toggleQuest(quest) {
    if (disabled) return;
    if (done.includes(quest.id) && stats.balance < quest.xp) { notify('Цей досвід уже обміняно на нагороду'); return; }
    dispatch({ type: 'TOGGLE_QUEST', id: quest.id });
    if (!done.includes(quest.id)) notify(`Крок зроблено! +${quest.xp} XP`);
  }

  return <div className="impulse-today">
    <header className="impulse-welcome">
      <div><p className="impulse-greeting">Привіт, {name}<span aria-hidden="true">.</span></p><h1>Твій день. <span>Твій темп.</span></h1></div>
      <button className="impulse-streak" type="button" onClick={() => setPage('progress')} aria-label={`Поточна серія: ${stats.streak} днів. Відкрити прогрес`}><Fire size={20} weight="light" /><strong>{stats.streak}</strong><span>днів поспіль</span><ArrowUpRight size={16} /></button>
    </header>

    <div className="impulse-layout">
      <div className="impulse-main">
        <WeeklyMeetingCard state={state} disabled={disabled} />
        <button className="impulse-time-prompt" type="button" disabled={disabled} onClick={() => prepare('У мене є 20 хвилин на себе сьогодні. Допоможи обрати до трьох головних посильних кроків у цей час. Спочатку врахуй наявні справи, якщо я дозволив доступ до них. Якщо потрібно, уточни мою енергію. Не дублюй квести й не підвищуй фізичне навантаження автоматично.')}>
          <span className="impulse-time-icon" aria-hidden="true"><Sparkle size={27} weight="fill" /></span><span><strong>Маєш 20 хвилин?</strong><span>Оберемо головне.</span></span><ArrowRight size={23} />
        </button>

        <div className="impulse-coach"><CoachView state={state} dispatch={dispatch} entry="home" disabled={disabled} onJourney={() => setPage('journey')} /></div>

        <section className="impulse-mood" aria-label="Самопочуття сьогодні">
          <div className="impulse-section-heading"><h2>Як ти сьогодні?</h2><button type="button" className="impulse-text-link" onClick={() => setPage('journal')} aria-label="Відкрити щоденник"><ArrowUpRight size={18} /></button></div>
          <div className="impulse-mood-options">{moods.map(({ label, Icon, text }) => <button type="button" disabled={disabled} key={label} onClick={() => prepare(`${text} Допоможи підлаштувати сьогоднішній план. Якщо пропонуватимеш запис у щоденник, спочатку запитай мої оцінки настрою та енергії від 1 до 5, не визначай їх за мене.`)}><Icon size={23} weight="light" /><span>{label}</span></button>)}</div>
          <p className="impulse-mood-note">{checkIn ? `Сьогодні збережено: настрій ${checkIn.mood}/5 · енергія ${checkIn.energy}/5.` : 'Обери відчуття — підготуємо повідомлення тренеру.'}</p>
        </section>

        <section id="daily-quests" className="impulse-quests daily-quests" aria-label="План на сьогодні">
          <div className="impulse-section-heading"><h2>{routine ? 'Розпорядок дня' : 'План на сьогодні'}</h2><button className="impulse-text-link" type="button" onClick={() => setPage('quests')}>Усі квести <ArrowUpRight size={16} /></button></div>
          <ol className="impulse-quest-list">{visibleQuests.map((quest, index) => {
            const complete = done.includes(quest.id);
            const slotStart = routine && (index === 0 || (visibleQuests[index - 1].timeOfDay || 'any') !== (quest.timeOfDay || 'any'));
            return <li key={quest.id} className={`impulse-quest-row quest-row ${complete ? 'complete' : ''} ${slotStart ? 'has-slot' : ''}`} data-slot={slotStart ? { morning: 'Ранок', day: 'День', evening: 'Вечір' }[quest.timeOfDay] || 'Будь-коли' : undefined}>
              <span className="impulse-quest-number" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
              <div className="impulse-quest-copy"><button type="button" disabled={disabled} onClick={() => toggleQuest(quest)}>{quest.title}</button><span>{CATEGORIES.find(category => category.id === quest.category)?.shortLabel}<i aria-hidden="true">·</i>{quest.minutes} хв<i aria-hidden="true">·</i>+{quest.xp} XP <TierBadge xp={quest.xp} /></span></div>
              <button className="impulse-quest-check quest-check" type="button" disabled={disabled} aria-label={`${complete ? 'Скасувати' : 'Виконати'}: ${quest.title}`} aria-pressed={complete} onClick={() => toggleQuest(quest)}>{complete && <Check size={18} weight="bold" />}</button>
            </li>;
          })}</ol>
          {!quests.length && <div className="impulse-empty"><Target size={27} weight="light" /><p>Сьогодні є місце для нового кроку.</p><button type="button" disabled={disabled} onClick={() => prepare('Допоможи обрати один посильний квест на сьогодні. Спочатку запитай, що для мене зараз важливо і скільки часу я маю.')}><span>Обрати з тренером</span><ArrowRight size={17} /></button></div>}
          <button className="impulse-day-progress" type="button" onClick={() => setPage('progress')} aria-label={`Виконано ${completed} із ${quests.length} квестів. Відкрити прогрес`}>
            <strong>{completed} із {quests.length} кроків</strong>
            <span className="impulse-progress-segments" aria-hidden="true">{quests.length <= 10 ? quests.map(quest => <i key={quest.id} className={done.includes(quest.id) ? 'is-complete' : ''} />) : <span className="impulse-progress-continuous"><i style={{ transform: `scaleX(${completed / quests.length})` }} /></span>}</span><ArrowRight size={23} />
          </button>
          {!routine && quests.length > 3 && <button type="button" className="impulse-expand" aria-expanded={showAll} onClick={() => setShowAll(value => !value)}>{showAll ? 'Показати три найближчі' : `Ще квести: ${quests.length - 3}`}<Plus size={15} className={showAll ? 'is-open' : ''} /></button>}
          <button type="button" className="impulse-add-quest" disabled={disabled} onClick={() => openModal('quest')}><Plus size={16} /> Додати квест до розпорядку</button>
        </section>

        <div className="impulse-secondary">
          <section className="impulse-habits"><div className="impulse-section-heading"><h2>Твій щоденний ритм</h2><button type="button" className="impulse-text-link" onClick={() => setPage('habits')}>Звички <ArrowUpRight size={16} /></button></div><div className="impulse-habit-list">{habits.slice(0, 3).map(habit => {
            const value = state.habitLogs[today]?.[habit.id] || 0; const Icon = habitIcons[habit.icon] || Lightning;
            return <button type="button" className="impulse-habit" key={habit.id} disabled={disabled} onClick={() => { if (value >= habit.target) { setPage('habits'); return; } dispatch({ type: 'LOG_HABIT', id: habit.id }); notify(value + 1 >= habit.target ? 'Звичку виконано на сьогодні' : 'Ще один маленький крок'); }}><Icon size={23} weight="light" /><span><strong>{habit.title}</strong><small>{value} / {habit.target} {habit.unit}</small></span><span className="impulse-habit-mark">{value >= habit.target ? <Check size={17} /> : <Plus size={17} />}</span></button>;
          })}{!habits.length && <button className="impulse-habit" type="button" disabled={disabled} onClick={() => openModal('habit')}><Plus size={21} /><span>Додати маленьку звичку</span><ArrowUpRight size={18} /></button>}</div></section>
          <DayCycle state={state} disabled={disabled} onMemory={() => openModal('memory')} />
          <details className="impulse-checkin"><summary><BookOpen size={20} /> Записати день самостійно <Plus size={17} /></summary><DailyCheckIn state={state} dispatch={dispatch} setPage={setPage} /></details>
        </div>
      </div>

      <aside className="impulse-aside" aria-label="Мій напрям і розвиток">
        <section className="impulse-direction"><div className="impulse-section-heading"><span className="impulse-kicker">Твій орієнтир</span><Target size={23} weight="light" /></div><h2>{state.profile.goal || 'Знайти свій наступний крок.'}</h2><button type="button" className="impulse-text-link" onClick={() => openModal('profile')}>Уточнити мій напрям <ArrowUpRight size={17} /></button><div className="impulse-direction-metrics"><span><strong>{stats.todayXp}</strong> XP сьогодні</span><span><strong>{stats.level}</strong> рівень</span></div></section>
        <section className="impulse-goals"><div className="impulse-section-heading"><h2>Ближче до свого</h2><button className="impulse-text-link" type="button" onClick={() => setPage('goals')}>Цілі <ArrowUpRight size={16} /></button></div>{goals.slice(0, 3).map(goal => <button key={goal.id} type="button" className="impulse-goal" onClick={() => setPage('goals')}><span>{goal.title}<strong>{Math.round(goal.current / goal.target * 100)}%</strong></span><span className="impulse-goal-track"><i style={{ transform: `scaleX(${Math.min(1, goal.current / goal.target)})` }} /></span></button>)}{!goals.length && <button type="button" className="impulse-empty-goal" onClick={() => setPage('goals')}><Plus size={19} /><span>Обрати першу ціль</span><ArrowRight size={18} /></button>}</section>
        <button type="button" className="impulse-finance" onClick={() => setPage('money')}><span className="impulse-section-heading"><span><Wallet size={20} /> Витрати місяця</span><ArrowUpRight size={20} /></span><strong>{money(finance.expense)} <span>₴</span></strong><span className="impulse-finance-note">Дохід {money(finance.income)} ₴{finance.limit > 0 ? ` · ${finance.remaining >= 0 ? 'до ліміту' : 'понад ліміт'} ${money(Math.abs(finance.remaining))} ₴` : ' · бюджет ще не задано'}</span></button>
        <JourneyEntry state={state} compact onOpen={() => setPage('journey')} />
        <div className="impulse-character">{character}</div>
        <button type="button" className="impulse-memory" onClick={() => openModal('memory')}><Brain size={22} weight="light" /><span><strong>Пам’ять тренера</strong><small>Ти вирішуєш, що зберігати.</small></span><ArrowUpRight size={18} /></button>
      </aside>
    </div>
  </div>;
}
