import { useState } from 'react';
import { Archive, ArrowCounterClockwise, BookOpen, Check, CheckCircle, Clock, Flag, MagnifyingGlass, PencilSimple, Plus, Sparkle, Target } from '@phosphor-icons/react';
import { CATEGORIES, localDate, selectActiveQuests } from './model.js';
import { QUEST_TEMPLATES } from './catalog.js';
import { SlotSelect, TierBadge, TierPicker, slotLabel } from './QuestMeta.jsx';
import CollectionDialog, { ATTRIBUTE_OPTIONS, CategoryFilters, CategoryIcon, recurrenceLabel, ScheduleFields } from './CollectionDialog.jsx';

const QUEST_LIMIT_MESSAGE = 'Досягнуто ліміту 200 квестів разом з архівом. Нові квести не додаються. Можна повернути квест з архіву або відредагувати наявний.';

function QuestEditor({ quest, state, dispatch, onClose, onNotice }) {
  const [draft, setDraft] = useState({ ...quest, frequency: quest.frequency || 'daily', weekdays: quest.weekdays || [1, 2, 3, 4, 5], scheduledDate: quest.scheduledDate || localDate(), goalId: quest.goalId || '' });
  const [error, setError] = useState('');
  const hasHistory = Object.values(state.completions).some(ids => ids.includes(quest.id));
  const goals = (state.goals || []).filter(goal => goal.status !== 'completed' || goal.id === draft.goalId);
  function save(event) {
    event.preventDefault();
    if (!draft.title.trim()) { setError('Додай назву квесту.'); return; }
    if (draft.frequency === 'weekdays' && !draft.weekdays.length) { setError('Обери хоча б один день тижня.'); return; }
    dispatch({ type: 'UPDATE_QUEST', id: quest.id, quest: { ...draft, title: draft.title.trim(), description: draft.description.trim(), xp: Number(draft.xp), minutes: Number(draft.minutes), goalId: draft.goalId || null } });
    onNotice('Квест оновлено. Твоя історія виконань збережена.'); onClose();
  }
  return <CollectionDialog title="Налаштуй свій квест" description="Реальна дія, зручний розклад і зрозумілий наступний крок." onClose={onClose}>
    <form className="form-stack cv-editor" onSubmit={save}>
      <label className="field">Назва квесту<input required maxLength={100} value={draft.title} onChange={event => setDraft({ ...draft, title: event.target.value })} autoFocus /></label>
      <label className="field">Що саме зробити?<textarea rows={3} maxLength={400} value={draft.description} onChange={event => setDraft({ ...draft, description: event.target.value })} /></label>
      {hasHistory && <p className="cv-help-note">Квест уже приносив досвід. Напрям, характеристика та рівень зафіксовані, щоб зберегти чесну історію.</p>}
      <div className="cv-form-grid"><label className="field">Напрям<select aria-label="Напрям квесту" disabled={hasHistory} value={draft.category} onChange={event => setDraft({ ...draft, category: event.target.value, attribute: CATEGORIES.find(category => category.id === event.target.value)?.attribute || draft.attribute })}>{CATEGORIES.map(category => <option key={category.id} value={category.id}>{category.shortLabel}</option>)}</select></label><label className="field">Характеристика<select aria-label="Характеристика квесту" disabled={hasHistory} value={draft.attribute} onChange={event => setDraft({ ...draft, attribute: event.target.value })}>{ATTRIBUTE_OPTIONS.map(attribute => <option key={attribute.id} value={attribute.id}>{attribute.label}</option>)}</select></label><SlotSelect value={draft.timeOfDay || 'any'} onChange={timeOfDay => setDraft({ ...draft, timeOfDay })} /><label className="field">Час, хв<input type="number" required min={1} max={180} value={draft.minutes} onChange={event => setDraft({ ...draft, minutes: event.target.value })} /></label></div>
      <TierPicker xp={Number(draft.xp)} disabled={hasHistory} onChange={xp => setDraft({ ...draft, xp })} />
      <ScheduleFields values={draft} onChange={setDraft} />
      <label className="field">До якої цілі веде?<select aria-label="Ціль квесту" value={draft.goalId} onChange={event => setDraft({ ...draft, goalId: event.target.value })}><option value="">Без прив’язки до цілі</option>{goals.map(goal => <option key={goal.id} value={goal.id}>{goal.title}</option>)}</select></label>
      {error && <p className="cv-error" role="alert">{error}</p>}
      <button className="button button-primary submit-button" type="submit">Зберегти квест <Check size={17} /></button>
    </form>
  </CollectionDialog>;
}

function QuestLibrary({ state, dispatch, onClose, onNotice }) {
  const [category, setCategory] = useState('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const atCapacity = state.quests.length >= 200;
  const templates = QUEST_TEMPLATES.filter(item => (category === 'all' || item.category === category) && `${item.title} ${item.description}`.toLocaleLowerCase('uk-UA').includes(search.toLocaleLowerCase('uk-UA').trim()));
  function add(template, existing) {
    if (!existing?.archived && atCapacity) { setNotice(QUEST_LIMIT_MESSAGE); return; }
    if (existing?.archived) dispatch({ type: 'RESTORE_QUEST', id: existing.id });
    else { const { id, ...quest } = template; dispatch({ type: 'ADD_QUEST', quest }); }
    const text = existing?.archived ? 'Квест повернуто з архіву.' : 'Квест додано до твого плану.';
    setNotice(text); onNotice(text);
  }
  return <CollectionDialog wide title="Бібліотека маленьких перемог" description={`${QUEST_TEMPLATES.length} готових ідей. Додай те, що підходить саме тобі; розклад можна змінити.`} onClose={onClose}>
    <div className="cv-library-tools"><label className="cv-search"><MagnifyingGlass size={18} /><input aria-label="Пошук у бібліотеці квестів" type="search" placeholder="Знайти дію…" value={search} onChange={event => setSearch(event.target.value)} /></label><CategoryFilters value={category} onChange={setCategory} label="Напрям бібліотеки квестів" /></div>
    <p className="cv-notice" role="status">{notice}</p>
    {atCapacity && <p className="cv-help-note" role="status">{QUEST_LIMIT_MESSAGE}</p>}
    <div className="cv-library-grid">{templates.map(template => {
      const matching = state.quests.filter(quest => quest.title === template.title && quest.category === template.category);
      const existing = matching.find(quest => !quest.archived) || matching[0];
      const added = existing && !existing.archived;
      const blocked = !added && !existing?.archived && atCapacity;
      return <article className="cv-template" key={template.id}><div className="cv-template-top"><CategoryIcon category={template.category} /><span className="v-xp">+{template.xp} XP</span></div><h3>{template.title}</h3><p>{template.description}</p><div className="cv-template-meta"><span><Clock size={13} />{template.minutes} хв</span><span>{recurrenceLabel(template)}</span></div><button type="button" className={`button ${added || blocked ? 'button-ghost' : 'button-primary'}`} disabled={Boolean(added || blocked)} onClick={() => add(template, existing)}>{added ? <><Check size={16} /> У твоєму плані</> : existing?.archived ? <><ArrowCounterClockwise size={16} /> Повернути</> : blocked ? 'Ліміт 200 квестів' : <><Plus size={16} /> Додати квест</>}</button></article>;
    })}</div>{!templates.length && <div className="v-empty"><BookOpen size={32} weight="light" /><h3>Спробуй інший пошук</h3><p>У бібліотеці є дії для десяти напрямів життя.</p></div>}
  </CollectionDialog>;
}

export function QuestsView({ state, dispatch, stats, onAddQuest }) {
  const [category, setCategory] = useState('all');
  const [scope, setScope] = useState('today');
  const [status, setStatus] = useState('all');
  const [search, setSearch] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState(null);
  const [libraryOpen, setLibraryOpen] = useState(false);
  const today = localDate();
  const completed = state.completions[today] || [];
  const due = selectActiveQuests(state, today);
  const scopeQuests = scope === 'today' ? due : state.quests.filter(quest => scope === 'archived' ? quest.archived : !quest.archived);
  const quests = scopeQuests.filter(quest => (category === 'all' || quest.category === category) && `${quest.title} ${quest.description}`.toLocaleLowerCase('uk-UA').includes(search.toLocaleLowerCase('uk-UA').trim()) && (status === 'all' || (status === 'done' ? completed.includes(quest.id) : !completed.includes(quest.id))));
  const counts = Object.fromEntries(CATEGORIES.map(item => [item.id, scopeQuests.filter(quest => quest.category === item.id).length]));
  function toggle(quest) {
    if (completed.includes(quest.id) && stats.balance < quest.xp) { setNotice('Ці XP уже використані для відзнаки. Виконання цього квесту наразі не можна скасувати.'); return; }
    dispatch({ type: 'TOGGLE_QUEST', id: quest.id });
    setNotice(completed.includes(quest.id) ? 'Виконання скасовано.' : `Крок зроблено! +${quest.xp} XP.`);
  }
  return <div className="v-page cv-page">
    <div className="v-view-header"><div><span className="eyebrow">ТВІЙ МАРШРУТ</span><h1>Квести для кращого тебе</h1><p className="muted">Десять напрямів. Твій розклад. Дії, які змінюють звичайний день.</p></div><div className="cv-header-actions"><button className="button button-ghost" onClick={() => setLibraryOpen(true)}><BookOpen size={18} /> Бібліотека</button><button className="button button-primary" onClick={onAddQuest}><Plus size={18} /> Новий квест</button></div></div>
    <div className="v-quest-summary"><span><strong>{stats.todayCompleted}</strong> із {stats.todayTotal} виконано сьогодні</span><span className="v-xp"><Sparkle size={17} /> {stats.todayXp} XP за сьогодні</span></div>
    <div className="cv-toolbar"><div className="cv-scope" role="group" aria-label="Список квестів">{[{ id: 'today', label: 'Сьогодні' }, { id: 'all', label: 'Усі активні' }, { id: 'archived', label: 'Архів' }].map(item => <button key={item.id} type="button" aria-pressed={scope === item.id} className={scope === item.id ? 'is-active' : ''} onClick={() => { setScope(item.id); setStatus('all'); }}>{item.label}</button>)}</div><label className="cv-search"><MagnifyingGlass size={17} /><input aria-label="Пошук квестів" type="search" placeholder="Знайти свій квест…" value={search} onChange={event => setSearch(event.target.value)} /></label></div>
    <CategoryFilters value={category} onChange={setCategory} label="Напрям квестів" counts={counts} />
    <div className="cv-results-line"><span>{quests.length} у списку</span>{scope !== 'archived' && <select aria-label="Статус квестів" value={status} onChange={event => setStatus(event.target.value)}><option value="all">Усі стани</option><option value="open">Ще попереду</option><option value="done">Виконані сьогодні</option></select>}</div>
    <div className="panel v-panel v-quest-list cv-quest-list">{quests.length ? quests.map(quest => {
      const done = completed.includes(quest.id);
      const scheduledToday = due.some(item => item.id === quest.id);
      const goal = state.goals?.find(item => item.id === quest.goalId);
      const finishedOnce = quest.frequency === 'once' && Object.values(state.completions).some(ids => ids.includes(quest.id));
      return <article key={quest.id} className={`v-quest-row cv-quest-row ${done ? 'is-done' : ''}`}>
        {quest.archived ? <span className="cv-archived-icon"><Archive size={20} /></span> : <button className={`v-check ${done ? 'is-checked' : ''}`} disabled={!scheduledToday} aria-label={`${done ? 'Скасувати виконання' : 'Виконати квест'}: ${quest.title}`} aria-pressed={done} onClick={() => toggle(quest)}>{done && <Check size={15} weight="bold" />}</button>}
        <CategoryIcon category={quest.category} /><div className="v-quest-copy"><div className="v-quest-title">{quest.title}</div><p>{quest.description}</p><div className="v-quest-meta"><span>{CATEGORIES.find(item => item.id === quest.category)?.shortLabel}</span><span><Clock size={13} />{quest.minutes} хв</span><span>{recurrenceLabel(quest)}</span>{quest.timeOfDay && quest.timeOfDay !== 'any' && <span>{slotLabel(quest.timeOfDay)}</span>}<span>+ {ATTRIBUTE_OPTIONS.find(item => item.id === quest.attribute)?.label}</span><TierBadge xp={quest.xp} /></div>{goal && <a className="cv-goal-link" href="#goals"><Target size={13} />{goal.title}</a>}{!quest.archived && !scheduledToday && <span className="cv-schedule-status">{finishedOnce ? 'Разовий квест уже виконано' : 'Поза планом на сьогодні'}</span>}</div>
        <div className="cv-quest-side"><span className="v-xp">+{quest.xp} XP</span><div className="cv-item-actions">{quest.archived ? <button className="icon-button" aria-label={`Повернути квест: ${quest.title}`} title="Повернути з архіву" onClick={() => { dispatch({ type: 'RESTORE_QUEST', id: quest.id }); setNotice('Квест повернуто до активних.'); }}><ArrowCounterClockwise size={18} /></button> : <><button className="icon-button" aria-label={`Редагувати квест: ${quest.title}`} title="Редагувати" onClick={() => setEditing(quest)}><PencilSimple size={17} /></button><button className="icon-button" aria-label={`Архівувати квест: ${quest.title}`} title="Архівувати зі збереженням історії" onClick={() => { dispatch({ type: 'ARCHIVE_QUEST', id: quest.id }); setNotice('Квест в архіві. Увесь отриманий досвід збережено.'); }}><Archive size={17} /></button></>}</div></div>
      </article>;
    }) : <div className="v-empty"><CheckCircle size={36} weight="light" /><h3>{scope === 'archived' ? 'Архів поки порожній' : 'Знайди свій наступний крок'}</h3><p>{scope === 'archived' ? 'Архівовані квести зберігатимуть тут свою історію та XP.' : 'Зміни фільтри, створи квест або обери готову ідею в бібліотеці.'}</p>{scope !== 'archived' && <button className="button button-ghost" onClick={() => setLibraryOpen(true)}>Відкрити бібліотеку <BookOpen size={16} /></button>}</div>}</div>
    <p className="cv-notice" role="status">{notice}</p><p className="v-footnote">«Сьогодні» показує квести за твоїм розкладом. Архів зберігає історію й отриманий досвід.</p>
    {libraryOpen && <QuestLibrary state={state} dispatch={dispatch} onClose={() => setLibraryOpen(false)} onNotice={setNotice} />}
    {editing && <QuestEditor quest={editing} state={state} dispatch={dispatch} onClose={() => setEditing(null)} onNotice={setNotice} />}
  </div>;
}
