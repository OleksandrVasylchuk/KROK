import { useEffect, useRef, useState } from 'react';
import { ArrowRight, CheckCircle, Clock, X } from '@phosphor-icons/react';
import { CATEGORIES, localDate } from './model.js';
import { checkCoachProposal } from './coach-actions.js';
import { CategoryIcon, recurrenceLabel } from './CollectionDialog.jsx';
import './coach-actions.css';

const labels = { create_quest: 'Новий квест', create_habit: 'Нова звичка', create_goal: 'Нова ціль', complete_quest: 'Виконання квесту', set_habit_count: 'Прогрес звички', set_goal_progress: 'Прогрес цілі', create_memory:'Запам’ятати факт', update_memory:'Виправити пам’ять', delete_memory:'Видалити факт із пам’яті', record_expense:'Записати витрату', update_quest:'Змінити квест', set_checkin:'Зберегти підсумок дня' };
const timeOfDay = { any: 'У зручний час', morning: 'Вранці', day: 'Вдень', evening: 'Увечері' };

function ActionCard({ action, state }) {
  const existing = ['complete_quest','update_quest'].includes(action.type) ? state.quests.find(item => item.id === action.id)
    : action.type === 'set_habit_count' ? state.habits.find(item => item.id === action.id)
      : action.type === 'set_goal_progress' ? state.goals?.find(item => item.id === action.id)
        : ['update_memory','delete_memory'].includes(action.type) ? state.coachMemory?.find(item=>item.id===action.id) : null;
  const title = action.title || action.text || existing?.title || existing?.text || (action.type === 'set_checkin' ? `Твій день · ${action.date}` : 'Запис більше недоступний');
  const category = action.type === 'record_expense' ? 'money' : action.category || existing?.category;
  const categoryLabel = CATEGORIES.find(item => item.id === category)?.shortLabel;
  return <article className="coach-action-card"><div className="coach-action-card-top"><span>{labels[action.type] || 'Пропонована дія'}</span>{categoryLabel && <span><CategoryIcon category={category} size={15} />{categoryLabel}</span>}</div><h4>{title}</h4>{action.description && <p>{action.description}</p>}<div className="coach-action-meta">
    {action.type === 'create_quest' && <><span><Clock size={14} />{action.minutes} хв</span><span>{recurrenceLabel(action)}</span>{(action.goalId || action.goalRef) && <span>Пов’язаний із ціллю</span>}</>}
    {action.type === 'create_habit' && <><span>{action.target} {action.unit}</span><span>{timeOfDay[action.timeOfDay]}</span><span>{recurrenceLabel(action)}</span></>}
    {action.type === 'create_goal' && <><span>Ціль: {action.target} {action.unit}</span>{action.deadline && <span>До {action.deadline}</span>}</>}
    {action.type === 'complete_quest' && <span>Позначити виконаним · {action.date}</span>}
    {action.type === 'set_habit_count' && <span>{state.habitLogs?.[action.date]?.[action.id] || 0} → {action.value} / {existing?.target ?? '—'} {existing?.unit || ''}</span>}
    {action.type === 'set_goal_progress' && <span>{existing?.current ?? 0} → {action.value} / {existing?.target ?? '—'} {existing?.unit || ''}</span>}
    {action.type === 'create_memory' && <span>Збережеться на цьому пристрої; передавання ШІ вмикається окремо.</span>}
    {action.type === 'update_memory' && <span>Було: {existing?.text || '—'}</span>}
    {action.type === 'delete_memory' && <span>Факт зникне з пам’яті та наступного контексту пам’яті. Історія розмови збережеться.</span>}
    {action.type === 'record_expense' && <><span>{action.amount.toLocaleString('uk-UA')} ₴ · {action.category}</span><span>{action.date} · {action.account === 'cash' ? 'Готівка' : 'Картка'}</span>{action.note && <span>{action.note}</span>}</>}
    {action.type === 'update_quest' && <><span>Було: {existing?.title} · {existing?.minutes} хв · {existing ? recurrenceLabel(existing) : '—'}</span><span>Стане: {action.minutes} хв · {recurrenceLabel(action)}</span><span>Новий розклад замінить попередній. XP і історія не зміняться.</span></>}
    {action.type === 'set_checkin' && <><span>Настрій: {action.mood}/5 · Енергія: {action.energy}/5</span>{action.note && <span>{action.note}</span>}{state.checkIns?.[action.date] && <span>Замінить попередній підсумок: настрій {state.checkIns[action.date].mood}/5, енергія {state.checkIns[action.date].energy}/5, нотатка «{state.checkIns[action.date].note || 'без нотатки'}».</span>}</>}
  </div></article>;
}

export default function CoachActionPreview({ proposal, state, dispatch, disabled = false }) {
  const [attempt, setAttempt] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const pending = proposal.status === 'pending';
  const check = pending ? checkCoachProposal(state, proposal, { today: localDate() }) : { ok: true };
  const problem = !check.ok ? check.error?.message || 'Пропозиція вже не відповідає поточним даним. Попроси тренера оновити її.' : '';

  useEffect(() => {
    if (!attempt) return;
    if (proposal.status !== 'applied') setError('Не вдалося застосувати зміни. Перевір актуальний стан і спробуй ще раз.');
    setAttempt(false); lock.current = false;
  }, [proposal, attempt]);

  function apply() {
    if (disabled || lock.current || !pending) return;
    const result = checkCoachProposal(state, proposal, { today: localDate() });
    if (!result.ok) { setError(result.error?.message || 'Пропозиція застаріла. Попроси тренера оновити її.'); return; }
    lock.current = true; setError('');
    dispatch({ type: 'APPLY_COACH_PROPOSAL', id: proposal.id });
    setAttempt(true);
  }

  const cards = <div className="coach-action-cards">{proposal.actions.map(action => <ActionCard key={action.ref} action={action} state={state} />)}</div>;
  return <section className={`coach-action-preview is-${proposal.status}`} aria-label="Пропозиція тренера">
    <div className="coach-action-heading"><strong>{proposal.status === 'applied' ? <><CheckCircle size={18} /> Зміни застосовано</> : proposal.status === 'dismissed' ? <><X size={17} /> Пропозицію відхилено</> : 'Переглянь перед додаванням'}</strong><span>{proposal.actions.length} {proposal.actions.length === 1 ? 'дія' : proposal.actions.length < 5 ? 'дії' : 'дій'}</span></div>
    {pending ? <>{cards}<p className="coach-action-note">Усі зміни з цього списку застосуються разом після підтвердження.</p>{(problem || error) && <p className="coach-action-error" role="alert">{problem || error}</p>}<div className="coach-action-buttons"><button type="button" className="button button-primary" disabled={disabled || attempt || Boolean(problem)} onClick={apply}>{attempt ? 'Застосовуємо…' : 'Підтвердити всі зміни'}<ArrowRight size={16} /></button><button type="button" className="coach-action-dismiss" disabled={disabled || attempt} onClick={() => dispatch({ type: 'DISMISS_COACH_PROPOSAL', id: proposal.id })}>Відхилити</button></div></> : <details className="coach-action-history"><summary>Переглянути зміни</summary>{cards}</details>}
  </section>;
}
