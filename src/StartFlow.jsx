import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ArrowLeft, ArrowRight, Compass, ShieldCheck, Sparkle } from '@phosphor-icons/react';
import { localDate, reducer } from './model.js';
import { START_QUESTIONS, buildLocalStartPlan, buildStartRequest, normalizeStartAnswers } from './start-plan.js';
import { coachClient } from './coach-client.js';
import { getAuthSnapshot, subscribeAuth } from './auth-client.js';
import { TierBadge, slotLabel } from './QuestMeta.jsx';
import './routine.css';

const DRAFT_KEY = 'krok-start-draft-v1';
const readDraft = () => { try { return normalizeStartAnswers(JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null')); } catch { return normalizeStartAnswers(null); } };
const steps = count => `${count} ${count % 10 === 1 && count % 100 !== 11 ? 'крок' : [2, 3, 4].includes(count % 10) && ![12, 13, 14].includes(count % 100) ? 'кроки' : 'кроків'}`;
const answered = (question, value) => Array.isArray(value) ? value.length > 0 : typeof value === 'string' ? Boolean(value.trim()) : Boolean(value);

/**
 * First screen for a new profile: a few questions, then routine variants to choose from.
 * Nothing is written to the profile until one variant is chosen.
 */
export default function StartFlow({ state, dispatch, notify, onAccount, onDemo, disabled = false }) {
  const auth = useSyncExternalStore(subscribeAuth, getAuthSnapshot, getAuthSnapshot);
  const [answers, setAnswers] = useState(readDraft);
  const [step, setStep] = useState(-1);
  const [plan, setPlan] = useState(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const request = useRef(null);
  const heading = useRef(null);
  const question = START_QUESTIONS[step];
  // The hosted model needs a signed-in account; without one the ready-made plan is offered straight away.
  const aiReachable = !auth.configured || Boolean(auth.user);

  useEffect(() => { try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(answers)); } catch { /* The draft is a convenience only. */ } }, [answers]);
  useEffect(() => () => request.current?.abort(), []);
  useEffect(() => { heading.current?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' }); }, [step, plan]);

  // Text is kept as typed here; every consumer normalises the answers itself.
  const set = (id, value) => { setAnswers(current => ({ ...current, [id]: value })); setError(''); };
  function toggle(item, value) {
    const current = answers[item.id];
    if (current.includes(value)) set(item.id, current.filter(entry => entry !== value));
    else if (current.length < item.limit) set(item.id, [...current, value]);
    else setError(`Можна обрати не більше ${item.limit}. Зніми один варіант, щоб додати інший.`);
  }
  function next() {
    if (question?.required && !answered(question, answers[question.id])) { setError('Дай відповідь, щоб рухатися далі.'); return; }
    setError(''); setStep(step + 1);
  }
  function useLocal(message = '') {
    const local = buildLocalStartPlan(answers);
    if (!local) { setError('Не вдалося скласти план із цих відповідей. Перевір їх і спробуй ще раз.'); return; }
    setNote(message); setPlan({ ...local, source: 'local' });
  }
  async function askCoach() {
    if (pending || disabled) return;
    const controller = new AbortController();
    request.current = controller; setPending(true); setError(''); setNote('');
    try {
      const reply = await coachClient.startPlan(buildStartRequest(answers, { date: localDate(), tone: state.profile.coachTone, habits: state.habits }), { signal: controller.signal });
      if (!controller.signal.aborted) setPlan({ ...reply.plan, source: 'ai' });
    } catch (cause) {
      if (controller.signal.aborted) return;
      // The start must never dead-end on the model: fall back to the ready-made plan and say so.
      useLocal(`${cause?.message || 'ШІ-тренер зараз недоступний.'} Нижче — готові варіанти КРОК без ШІ; їх можна уточнити з тренером пізніше.`);
    } finally { if (request.current === controller) { request.current = null; setPending(false); } }
  }
  function choose(variant) {
    if (disabled) return;
    const { id, title, note: text, items } = variant;
    const action = { type: 'APPLY_START_PLAN', answers, source: plan.source, variant: { id, title, note: text, items } };
    if (reducer(state, action) === state) { setError('Не вдалося зберегти цей розпорядок. Онови сторінку й спробуй ще раз; відповіді збережено.'); return; }
    dispatch(action);
    try { sessionStorage.removeItem(DRAFT_KEY); } catch { /* Nothing to clean. */ }
    notify('Розпорядок складено. Почни з першого кроку.');
  }

  const aside = <div className="start-aside">
    <button type="button" className="start-link" onClick={onAccount}><ShieldCheck size={16} /> Уже маю акаунт КРОК — увійти й отримати свої записи</button>
    <button type="button" className="start-link" onClick={onDemo}><Compass size={16} /> Подивитися приклад заповненого профілю</button>
  </div>;

  if (plan) return <section className="start-flow" aria-label="Варіанти розпорядку">
    <span className="eyebrow">ТВІЙ РОЗПОРЯДОК</span>
    <h1 ref={heading} tabIndex={-1}>Обери свій темп.</h1>
    <p className="start-lead">{plan.summary}</p>
    <span className="start-source">{plan.source === 'ai' ? 'Склав ШІ-тренер за твоїми відповідями' : 'Готові варіанти КРОК — без ШІ'}</span>
    {note && <p className="start-note" role="status">{note}</p>}
    {error && <p className="start-error" role="alert">{error}</p>}
    <div className="start-variants">{plan.variants.map(variant => {
      const minutes = variant.items.reduce((total, item) => total + (item.tier === 'legendary' ? 0 : item.minutes), 0);
      return <article className="start-variant" key={variant.id} aria-label={variant.title}>
        <div className="start-variant-top"><h3>{variant.title}</h3><span>{steps(variant.items.length)} · ≈ {minutes} хв на день</span></div>
        {variant.note && <p>{variant.note}</p>}
        <ul>{variant.items.map(item => <li key={item.title}><div><strong>{item.title}</strong>{item.description && <small>{item.description}</small>}</div><span><TierBadge tier={item.tier} always />{slotLabel(item.timeOfDay)}{item.tier === 'legendary' ? '' : ` · ${item.minutes} хв`}</span></li>)}</ul>
        <button type="button" className="button button-primary" disabled={disabled} onClick={() => choose(variant)}>Обрати «{variant.title}» <ArrowRight size={17} /></button>
      </article>;
    })}</div>
    <p className="start-note">Обраний варіант стане твоїм розпорядком дня. До нього можна додавати свої квести, а на тижневій зустрічі з тренером — полегшити, посилити чи змінити.</p>
    <div className="start-actions"><button type="button" className="start-link" onClick={() => { setPlan(null); setNote(''); setError(''); setStep(0); }}><ArrowLeft size={16} /> Змінити відповіді</button></div>
  </section>;

  if (step < 0) return <section className="start-flow" aria-label="Початок">
    <span className="eyebrow">ПОЧАТОК</span>
    <h1 ref={heading} tabIndex={-1}>Спершу — кілька запитань.</h1>
    <p className="start-lead">КРОК складе розпорядок дня саме під тебе: що робити вранці, вдень і ввечері, щоб рухатися до своєї мети. Це {START_QUESTIONS.length} коротких запитань, приблизно три хвилини. Нічого не зміниться, доки ти сам не обереш варіант.</p>
    <div className="start-actions"><button type="button" className="button button-primary" disabled={disabled} onClick={() => setStep(0)}>Почати <ArrowRight size={17} /></button></div>
    {disabled && <p className="start-error" role="alert">Спочатку віднови збереження даних — тоді розпорядок можна буде записати.</p>}
    {aside}
  </section>;

  if (!question) return <section className="start-flow" aria-label="Складання плану">
    <span className="eyebrow">МАЙЖЕ ГОТОВО</span>
    <h1 ref={heading} tabIndex={-1}>Складемо розпорядок.</h1>
    <p className="start-lead">Ти отримаєш два-три варіанти: легший, збалансований і насичений. Обереш той, що посильний зараз.</p>
    <div className="start-card">
      <h2><Sparkle size={20} /> Хто складе план?</h2>
      {aiReachable ? <p>ШІ-тренер врахує твої слова про мету й перешкоди. Для цього відповіді з анкети один раз буде надіслано моделі через сервер КРОК. Якщо ШІ недоступний, КРОК запропонує готові варіанти.</p>
        : <p>ШІ-тренер доступний після входу в акаунт. Зараз КРОК складе розпорядок із готових варіантів за твоїми відповідями — без передавання даних; уточнити його з тренером можна буде пізніше.</p>}
      <div className="start-actions">
        <button type="button" className="start-link" disabled={pending} onClick={() => setStep(START_QUESTIONS.length - 1)}><ArrowLeft size={16} /> Назад</button>
        {aiReachable && <button type="button" className="button button-ghost" disabled={pending || disabled} onClick={() => useLocal()}>Скласти без ШІ</button>}
        {aiReachable ? <button type="button" className="button button-primary" disabled={pending || disabled} onClick={askCoach}>{pending ? 'Тренер складає план…' : 'Надіслати відповіді ШІ й скласти план'}</button>
          : <button type="button" className="button button-primary" disabled={disabled} onClick={() => useLocal()}>Скласти розпорядок <ArrowRight size={17} /></button>}
      </div>
      {pending && <button type="button" className="start-link" onClick={() => { request.current?.abort(); request.current = null; setPending(false); }}>Скасувати очікування</button>}
      {error && <p className="start-error" role="alert">{error}</p>}
    </div>
    {aside}
  </section>;

  const value = answers[question.id];
  return <section className="start-flow" aria-label="Запитання для твого розпорядку">
    <span className="eyebrow">ПОЧАТОК</span>
    <div className="start-progress"><span><i style={{ transform: `scaleX(${(step + 1) / START_QUESTIONS.length})` }} /></span><span>Питання {step + 1} з {START_QUESTIONS.length}</span></div>
    <form className="start-card" onSubmit={event => { event.preventDefault(); next(); }}>
      <h2 ref={heading} tabIndex={-1} id="start-question">{question.title}</h2>
      <p>{question.hint}</p>
      {question.type === 'text' && <input type="text" aria-labelledby="start-question" value={value} maxLength={question.max} placeholder={question.placeholder} autoComplete={question.id === 'name' ? 'given-name' : 'off'} onChange={event => set(question.id, event.target.value)} />}
      {question.type === 'longtext' && <textarea aria-labelledby="start-question" value={value} maxLength={question.max} placeholder={question.placeholder} rows={3} onChange={event => set(question.id, event.target.value)} />}
      {question.type === 'choice' && <div className="start-options" role="group" aria-labelledby="start-question">{question.options.map(([id, label]) => <button type="button" key={id} aria-pressed={value === id} onClick={() => set(question.id, id)}>{label}</button>)}</div>}
      {question.type === 'multi' && <div className="start-options" role="group" aria-labelledby="start-question">{question.options.map(([id, label]) => <button type="button" key={id} aria-pressed={value.includes(id)} onClick={() => toggle(question, id)}>{label}</button>)}</div>}
      {error && <p className="start-error" role="alert">{error}</p>}
      <div className="start-actions">
        <button type="button" className="start-link" onClick={() => { setError(''); setStep(step - 1); }}><ArrowLeft size={16} /> Назад</button>
        {!question.required && !answered(question, value) && <button type="button" className="start-link" onClick={() => { setError(''); setStep(step + 1); }}>Пропустити</button>}
        <button type="submit" className="button button-primary">Далі <ArrowRight size={17} /></button>
      </div>
    </form>
  </section>;
}
