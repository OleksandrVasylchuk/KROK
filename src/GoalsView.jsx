import { useState } from 'react';
import { ArrowUpRight, Check, Flag, PencilSimple, Plus, Target, Trash } from '@phosphor-icons/react';
import { CATEGORIES, localDate } from './model.js';
import CollectionDialog, { CategoryIcon, dateLabel } from './CollectionDialog.jsx';

const number = value => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(value);
function GoalForm({ goal, goalCount, dispatch, onClose }) {
  const [target, setTarget] = useState(goal?.target || 12);
  const [error, setError] = useState('');
  return <form className="form-stack" onSubmit={event => {
    event.preventDefault(); const values = new FormData(event.currentTarget);
    if (!goal && goalCount >= 100) { setError('Досягнуто ліміту 100 цілей. Нову ціль не створено, введені дані збережено у формі. Можна відредагувати наявну ціль або видалити непотрібну.'); return; }
    const draft = { title: String(values.get('title')).trim(), category: values.get('category'), target: Number(target), current: Number(values.get('current')), unit: String(values.get('unit')).trim(), deadline: values.get('deadline'), description: values.get('description'), status: 'active' };
    if (!draft.title || !draft.unit || draft.current > draft.target) { setError('Перевір назву, одиницю та прогрес. Прогрес не може перевищувати ціль.'); return; }
    dispatch({ type: goal ? 'UPDATE_GOAL' : 'ADD_GOAL', id: goal?.id, goal: draft }); onClose();
  }}>
    <label className="field">Назва цілі<input name="title" autoFocus required maxLength={100} defaultValue={goal?.title || ''} placeholder="Наприклад, прочитати 12 книжок" /></label>
    <label className="field">Напрям<select name="category" defaultValue={goal?.category || 'growth'}>{CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}</select></label>
    <div className="form-row"><label className="field">Хочу досягти<input type="number" name="target" min="0.01" max="10000000" step="0.01" required value={target} onChange={e => setTarget(e.target.value)} /></label><label className="field">Одиниця<input name="unit" required maxLength={30} defaultValue={goal?.unit || 'книжок'} placeholder="грн, км, занять…" /></label></div>
    <div className="form-row"><label className="field">Уже зроблено<input name="current" type="number" step="0.01" min="0" max={target || 10000000} defaultValue={goal?.current || 0} required /></label><label className="field">Термін · необов’язково<input name="deadline" type="date" min="2000-01-01" max="2200-12-31" defaultValue={goal?.deadline || ''} /></label></div>
    <label className="field">Чому це важливо для тебе?<textarea name="description" rows={3} maxLength={500} defaultValue={goal?.description || ''} placeholder="Твоя причина повернутися до цієї цілі завтра" /></label>
    {error && <p className="form-error" role="alert">{error}</p>}
    <button className="button button-primary submit-button" type="submit">{goal ? 'Зберегти зміни' : 'Створити ціль'} <Check size={18} /></button>
  </form>;
}
function ProgressForm({ goal, dispatch, onClose }) {
  const [mode, setMode] = useState(goal.status === 'completed' ? 'set' : 'add');
  return <form className="form-stack" onSubmit={e => { e.preventDefault(); const value = Number(new FormData(e.currentTarget).get('value')); dispatch(mode === 'add' ? { type: 'LOG_GOAL', id: goal.id, amount: value } : { type: 'SET_GOAL_PROGRESS', id: goal.id, value }); onClose(); }}>
    <p className="life-muted">Зараз {number(goal.current)} із {number(goal.target)} {goal.unit}. Прогрес цілі ти відмічаєш самостійно; квести допомагають тримати ритм.</p>
    <label className="field">Як оновити?<select value={mode} onChange={e => setMode(e.target.value)}><option value="add" disabled={goal.current >= goal.target}>Додати до прогресу</option><option value="set">Вказати загальний результат</option></select></label>
    <label className="field">{mode === 'add' ? 'Додати' : 'Загалом'} · {goal.unit}<input key={mode} name="value" autoFocus type="number" required step="0.01" min={mode === 'add' ? '0.01' : '0'} max={mode === 'add' ? goal.target - goal.current : goal.target} defaultValue={mode === 'add' ? Math.min(1, goal.target - goal.current) : goal.current} /></label>
    <button type="submit" className="button button-primary submit-button">Зберегти прогрес <Check size={18} /></button>
  </form>;
}
export default function GoalsView({ state, dispatch, onAddQuest, setPage }) {
  const [filter, setFilter] = useState('active'); const [modal, setModal] = useState(null);
  const goals = state.goals || []; const active = goals.filter(g => g.status === 'active');
  const filtered = goals.filter(g => filter === 'all' || g.status === filter);
  return <div className="v-page life-page"><div className="v-view-header"><div><span className="eyebrow">ВЕЛИКІ ПЛАНИ. МАЛЕНЬКІ КРОКИ.</span><h1>Є до чого йти.</h1><p>Обери свою вершину. І помічай, як наближаєшся.</p></div><button className="button button-primary" onClick={() => setModal({ type: 'add' })}><Plus size={18} /> Нова ціль</button></div>
    <div className="life-summary"><div><span>У русі</span><strong>{active.length}<small> цілей</small></strong></div><div><span>Досягнуто</span><strong>{goals.length - active.length}<small> перемог</small></strong></div><div><span>Наступний крок</span><p>{active.length ? 'Прогрес важливіший за ідеальний темп.' : 'Дай своїй наступній мрії конкретну форму.'}</p></div></div>
    <div className="cv-chips" role="group" aria-label="Стан цілей">{[['active','У процесі'],['completed','Досягнуті'],['all','Усі цілі']].map(([id,label]) => <button key={id} aria-pressed={filter === id} className={filter === id ? 'is-active' : ''} onClick={() => setFilter(id)}>{label}</button>)}</div>
    <div className="goal-grid">{filtered.map(goal => { const percent = Math.round(goal.current / goal.target * 100); const linked = state.quests.filter(q => q.goalId === goal.id && !q.archived); return <article className="goal-card" key={goal.id}>
      <div className="goal-top"><CategoryIcon category={goal.category} /><span>{CATEGORIES.find(c => c.id === goal.category)?.shortLabel}</span><button className="icon-button" aria-label={`Редагувати ціль: ${goal.title}`} onClick={() => setModal({type:'edit',goal})}><PencilSimple size={18} /></button></div>
      <h2>{goal.title}</h2><p className="goal-description">{goal.description || 'Твоя ціль. Твій власний темп.'}</p>
      <div className="goal-numbers"><strong>{number(goal.current)}<small> / {number(goal.target)} {goal.unit}</small></strong><span>{percent}%</span></div><div className="life-track" role="progressbar" aria-label={goal.title} aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}><span style={{width:`${percent}%`}} /></div>
      <div className="goal-deadline">{goal.status === 'completed' ? <span className="goal-achieved"><Check size={15} /> Ти це зробив!</span> : goal.deadline ? <span className={goal.deadline < localDate() ? 'goal-overdue' : ''}>{goal.deadline < localDate() ? 'Час переглянути термін · ' : 'До '}{dateLabel(goal.deadline)}</span> : <span>У своєму темпі</span>}<span>{linked.length} квестів</span></div>
      <div className="goal-actions"><button className="button button-ghost" onClick={() => setModal({type:'progress',goal})}>{goal.status === 'completed' ? <PencilSimple size={16} /> : <Plus size={16} />}{goal.status === 'completed' ? 'Змінити прогрес' : 'Додати прогрес'}</button><button className="icon-button" aria-label={`Видалити ціль: ${goal.title}`} onClick={() => setModal({type:'delete',goal})}><Trash size={18} /></button></div>
      {linked.length > 0 ? <button className="goal-quest-link text-button" onClick={() => setPage('quests')}><Flag size={15} /> Переглянути квести <ArrowUpRight size={15} /></button> : <button className="goal-quest-link text-button" onClick={() => onAddQuest(goal.id)}><Flag size={15} /> Додати квест до цілі <Plus size={15} /></button>}
    </article>; })}</div>
    {!filtered.length && <div className="life-empty"><Target size={36} weight="light" /><h2>{filter === 'completed' ? 'Перемоги ще попереду.' : 'Почни з того, що має значення.'}</h2><p>Конкретна ціль допомагає побачити наступний крок.</p><button className="button button-ghost" onClick={() => setModal({type:'add'})}>Створити ціль <Plus size={16} /></button></div>}
    {modal && <CollectionDialog title={{add:'Дай мрії форму.',edit:'Налаштуй маршрут.',progress:'Ти наближаєшся.',delete:'Видалити ціль?'}[modal.type]} description={modal.type === 'delete' ? `«${modal.goal.title}». Пов’язані квести та зароблений досвід залишаться.` : modal.type === 'progress' ? modal.goal.title : 'Вимірювана ціль робить маленькі перемоги видимими.'} onClose={() => setModal(null)}>
      {['add','edit'].includes(modal.type) && <GoalForm goal={modal.goal} goalCount={goals.length} dispatch={dispatch} onClose={() => setModal(null)} />}
      {modal.type === 'progress' && <ProgressForm goal={modal.goal} dispatch={dispatch} onClose={() => setModal(null)} />}
      {modal.type === 'delete' && <div className="form-stack"><button className="button button-primary" onClick={() => {dispatch({type:'DELETE_GOAL',id:modal.goal.id});setModal(null);}}>Видалити ціль <Trash size={17} /></button><button className="button button-ghost" onClick={() => setModal(null)}>Залишити ціль</button></div>}
    </CollectionDialog>}
  </div>;
}
