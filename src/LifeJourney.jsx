import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ArrowClockwise, Check, CheckCircle, Clock, Compass, FloppyDisk, PencilSimple, Sparkle, X } from '@phosphor-icons/react';
import { CATEGORIES } from './catalog.js';
import { CategoryIcon } from './CollectionDialog.jsx';
import { localDate } from './model.js';
import { emptyLifeProfile, normalizeLifeProfile, validateDailyPlan } from './life-profile.js';
import { buildDailyPlanPayload, coachClient } from './coach-client.js';
import './life-journey.css';

const prompts = {
  body: { title: 'Як почувається твоє тіло?', intro: 'Рух, енергія та відчуття сили у звичайний день.', current: 'Як зараз із рухом та енергією?', currentHint: 'Наприклад: працюю сидячи, іноді гуляю, на вечір мало сил.', desired: 'Що хотілося б змінити?', desiredHint: 'Наприклад: рухатися регулярно й легше прокидатися.', obstacle: 'Що зазвичай заважає?', obstacleHint: 'Час, незручний розклад чи щось інше. Медичні подробиці не потрібні.' },
  money: { title: 'Більше ясності у грошах', intro: 'Твої звички й пріоритети. Суми та реквізити можна не вказувати.', current: 'Як зараз стежиш за грошима?', currentHint: 'Наприклад: приблизно пам’ятаю витрати, але нічого не записую.', desired: 'Якої зміни хочеш у фінансових звичках?', desiredHint: 'Бачити витрати, планувати покупки або регулярно відкладати.', obstacle: 'Що ускладнює це зараз?', obstacleHint: 'Наприклад: забуваю записувати дрібні покупки.' },
  social: { title: 'Місце для близьких людей', intro: 'Спілкування у комфортному для тебе темпі.', current: 'Як зараз із близькими та спілкуванням?', currentHint: 'Наприклад: рідко пишу друзям, хоча хочу підтримувати зв’язок.', desired: 'Яких стосунків чи зустрічей хочеться більше?', desiredHint: 'Частіше говорити з близькими, знайомитися чи залишати час для себе.', obstacle: 'Що заважає зробити перший крок?', obstacleHint: 'Можна описати лише те, чим комфортно ділитися, без імен.' },
  growth: { title: 'Що тобі цікаво вивчати?', intro: 'Книжки, знання та навички, які мають сенс саме для тебе.', current: 'Що зараз читаєш або вивчаєш?', currentHint: 'Наприклад: почав англійську, але займаюся нерегулярно.', desired: 'Чого хочеш навчитися?', desiredHint: 'Одна навичка, книжка чи тема, до якої тягне повернутися.', obstacle: 'На чому зазвичай зупиняєшся?', obstacleHint: 'Наприклад: матеріалів забагато, не знаю, з чого почати.' },
  nutrition: { title: 'Зручніший ритм харчування', intro: 'Побутові звички й час на їжу, без оцінювання зовнішності.', current: 'Як зазвичай проходить твій день із їжею?', currentHint: 'Наприклад: пропускаю обід у роботі, потім їм поспіхом.', desired: 'Що зробило б цей ритм комфортнішим?', desiredHint: 'Мати час на обід, прості домашні страви чи список покупок.', obstacle: 'Що ускладнює зміни?', obstacleHint: 'Наприклад: не планую продукти або не маю сил готувати.' },
  sleep: { title: 'Час на відновлення', intro: 'Твій вечір, сон і відпочинок без вимоги ідеального режиму.', current: 'Як зараз проходять вечори та ранок?', currentHint: 'Наприклад: довго сиджу в телефоні, а вранці важко встати.', desired: 'Якої маленької зміни хочеться?', desiredHint: 'Спокійніше завершувати день або мати стабільніший час відпочинку.', obstacle: 'Що найчастіше заважає?', obstacleHint: 'Робота, звички, побут чи несталий графік.' },
  mind: { title: 'Трохи простору для себе', intro: 'Увага, паузи та повсякденний стан. Це не діагностика.', current: 'Як зараз із увагою та відпочинком від справ?', currentHint: 'Наприклад: легко відволікаюся, рідко роблю паузи.', desired: 'Чого хотілося б більше у своєму дні?', desiredHint: 'Спокійних перерв, зосередженості чи часу без сповіщень.', obstacle: 'Що забирає цей простір?', obstacleHint: 'Напиши лише те, чим комфортно ділитися.' },
  career: { title: 'Робота, яка рухається вперед', intro: 'Задачі, професійні інтереси та твій робочий ритм.', current: 'Чим займаєшся і як проходить робочий день?', currentHint: 'Наприклад: багато дрібних задач, а важливі справи відкладаю.', desired: 'Якого професійного кроку хочеш?', desiredHint: 'Завершити проєкт, оновити портфоліо чи розвинути навичку.', obstacle: 'Що гальмує цей крок?', obstacleHint: 'Наприклад: немає чіткого наступного завдання.' },
  home: { title: 'Простір, у якому легше жити', intro: 'Порядок і побут невеликими посильними кроками.', current: 'Що вдома вже зручно, а що забирає сили?', currentHint: 'Наприклад: робочий стіл постійно захаращений.', desired: 'Яку одну зміну хочеш у своєму просторі?', desiredHint: 'Зручніше робоче місце, вільна полиця чи простіший побут.', obstacle: 'Що заважає підтримувати це?', obstacleHint: 'Наприклад: беруся за все одразу й швидко втомлююся.' },
  creativity: { title: 'Щось просто для задоволення', intro: 'Творчість і захоплення без оцінки результату.', current: 'Що любиш створювати або пробувати?', currentHint: 'Малювання, музика, фото, письмо чи будь-яке своє захоплення.', desired: 'До чого хочеться повернутися чи що спробувати?', desiredHint: 'Наприклад: знову малювати маленькі замальовки.', obstacle: 'Що заважає знайти на це час?', obstacleHint: 'Наприклад: здається, що треба одразу зробити щось ідеальне.' },
};

const answered = domain => Boolean(domain && (domain.rating > 0 || domain.current?.trim() || domain.desired?.trim() || domain.obstacle?.trim()));
const dateLabel = value => new Date(`${value}T12:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'long' });

function initialDraft(state) {
  const current = normalizeLifeProfile(state.profile.lifeProfile || emptyLifeProfile());
  if (current.status !== 'not_started' || current.about || current.focus.length || Object.values(current.domains).some(answered)) return current;
  const previous = state.profile.coachPlan;
  if (!previous) return current;
  const minutes = Number.parseInt(previous.dailyTime, 10);
  return { ...current, about: [previous.desiredChange, previous.obstacle, previous.extra].filter(Boolean).join('\n').slice(0, 500), focus: (previous.priorities || []).filter(id => CATEGORIES.some(category => category.id === id)).slice(0, 3), dailyMinutes: Number.isFinite(minutes) ? Math.max(5, Math.min(120, minutes)) : current.dailyMinutes };
}

async function fingerprint(payload) {
  // Navigation/completion metadata does not change the answers used by a plan.
  const { step, status, ...assessment } = payload.assessment;
  const data = new TextEncoder().encode(JSON.stringify({ ...payload, assessment }));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('');
}

export default function LifeJourney({ state, dispatch, onClose, onApplied, notify, disabled = false }) {
  const [draft, setDraft] = useState(() => initialDraft(state));
  const [name, setName] = useState(state.profile.name || '');
  const [timeInput, setTimeInput] = useState(() => String(initialDraft(state).dailyMinutes));
  const [day, setDay] = useState(localDate());
  const [pending, setPending] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [awaitingApply, setAwaitingApply] = useState(null);
  const [questEdits, setQuestEdits] = useState([]);
  const [stalePlan, setStalePlan] = useState(false);
  const stateRef = useRef(state);
  const draftRef = useRef(draft);
  const nameRef = useRef(name);
  const requestRef = useRef(null);
  const applyRef = useRef(false);
  const mounted = useRef(false);
  const titleRef = useRef(null);
  const navRef = useRef(null);
  const savedRef = useRef(JSON.stringify(normalizeLifeProfile(state.profile.lifeProfile)));
  const savedNameRef = useRef(state.profile.name);
  const inputId = useId();
  stateRef.current = state;
  const step = draft.step;
  const category = CATEGORIES[step - 1];
  const prompt = category ? prompts[category.id] : null;
  const area = category ? draft.domains[category.id] : null;
  const count = CATEGORIES.filter(item => answered(draft.domains[item.id])).length;
  const plans = state.dailyPlans || [];
  const acceptedToday = plans.find(plan => plan.date === day && plan.appliedQuestIds?.length);
  const plan = acceptedToday || plans.filter(item => item.date === day).at(-1) || plans.at(-1);
  const selected = questEdits.filter(quest => quest.selected);
  const totalMinutes = selected.reduce((sum, quest) => sum + (Number(quest.minutes) || 0), 0);
  const blocked = disabled || pending || applying;

  useEffect(() => {
    mounted.current = true;
    const updateDay = () => setDay(localDate());
    const timer = setInterval(updateDay, 60000);
    window.addEventListener('focus', updateDay);
    return () => { mounted.current = false; requestRef.current?.abort(); requestRef.current = null; clearInterval(timer); window.removeEventListener('focus', updateDay); };
  }, []);

  useEffect(() => {
    const next = normalizeLifeProfile(state.profile.lifeProfile);
    const signature = JSON.stringify(next);
    if (signature !== savedRef.current) { savedRef.current = signature; draftRef.current = next; setDraft(next); setTimeInput(String(next.dailyMinutes)); }
    if (state.profile.name !== savedNameRef.current) { savedNameRef.current = state.profile.name; nameRef.current = state.profile.name; setName(state.profile.name || ''); }
  }, [state.profile.lifeProfile, state.profile.name]);

  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true });
    const active = navRef.current?.querySelector('[aria-current="step"]');
    if (active && navRef.current.scrollWidth > navRef.current.clientWidth) navRef.current.scrollLeft = active.offsetLeft - navRef.current.offsetLeft - 10;
  }, [step]);

  useEffect(() => {
    setQuestEdits((plan?.quests || []).map(quest => ({ ...quest, selected: true })));
    setStalePlan(false);
  }, [plan?.id]);

  useEffect(() => {
    if (!awaitingApply) return;
    const saved = plans.find(item => item.id === awaitingApply);
    if (saved?.appliedQuestIds?.length) {
      notify?.('Квести додано до твого дня.');
      setNotice('План додано. Твої квести вже чекають у розділі «Сьогодні».');
      onApplied?.();
    } else setError('Не вдалося додати план. Перевір дату, доступний час і кількість квестів та спробуй ще раз.');
    setAwaitingApply(null); setApplying(false); applyRef.current = false;
  }, [state.dailyPlans, awaitingApply]);

  function persist(next = draftRef.current, nextName = nameRef.current) {
    if (disabled) return next;
    const normalized = normalizeLifeProfile(next);
    const savedName = nextName.trim().slice(0, 40) || stateRef.current.profile.name;
    savedRef.current = JSON.stringify(normalized);
    savedNameRef.current = savedName;
    draftRef.current = next;
    setDraft(next);
    dispatch({ type: 'UPDATE_PROFILE', profile: { name: savedName, lifeProfile: normalized } });
    return normalized;
  }

  function change(patch) {
    if (Object.hasOwn(patch, 'dailyMinutes')) setTimeInput(String(patch.dailyMinutes));
    const next = { ...draftRef.current, ...patch, status: draftRef.current.status === 'completed' ? 'completed' : 'in_progress' };
    persist(next);
    setError(''); setNotice('');
    if (plan && !plan.appliedQuestIds?.length && Object.keys(patch).some(key => !['aiConsent', 'step', 'status'].includes(key))) setStalePlan(true);
  }

  function move(nextStep) {
    if (blocked) return;
    persist({ ...draftRef.current, step: Math.max(0, Math.min(11, nextStep)), status: draftRef.current.status === 'completed' ? 'completed' : 'in_progress' });
    setError(''); setNotice('');
  }

  function stopRequest() {
    requestRef.current?.abort(); requestRef.current = null;
    setPending(false);
    setNotice('Очікування скасовано. Запит уже міг надійти до OpenAI; нові квести не додано.');
  }

  function close(skip = false) {
    if (pending) stopRequest();
    persist({ ...draftRef.current, ...(skip ? { status: 'skipped' } : {}) });
    onClose?.();
  }

  function currentState(life = draftRef.current) {
    return { ...stateRef.current, profile: { ...stateRef.current.profile, name: nameRef.current.trim().slice(0, 40) || stateRef.current.profile.name, lifeProfile: normalizeLifeProfile(life) } };
  }

  async function generate() {
    if (blocked || requestRef.current || !draftRef.current.aiConsent || !count) return;
    const date = localDate(); setDay(date);
    if ((stateRef.current.dailyPlans || []).some(item => item.date === date && item.appliedQuestIds?.length)) { setError('На сьогодні план уже додано. Новий можна створити завтра.'); return; }
    const controller = new AbortController(); requestRef.current = controller;
    setPending(true); setError(''); setNotice('');
    const next = { ...draftRef.current, status: 'completed', step: 11 };
    persist(next);
    try {
      const id = `plan-${globalThis.crypto.randomUUID()}`;
      const payload = buildDailyPlanPayload(currentState(next), date);
      const sourceFingerprint = await fingerprint(payload);
      if (controller.signal.aborted) return;
      const response = await coachClient.plan(payload, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || requestRef.current !== controller) return;
      if (localDate() !== date) throw new Error('Почався новий день. Створи план на сьогодні ще раз; цей результат не додано.');
      const currentFingerprint = await fingerprint(buildDailyPlanPayload(currentState(), date));
      if (!mounted.current || controller.signal.aborted || requestRef.current !== controller) return;
      if (sourceFingerprint !== currentFingerprint) throw new Error('Відповіді або прогрес змінилися під час аналізу. Створи оновлений план, щоб він врахував ці зміни.');
      const content = validateDailyPlan(response.plan, { profile: normalizeLifeProfile(draftRef.current) });
      if (!content) throw new Error('Не вдалося перевірити план OpenAI. Спробуй ще раз: неперевірені квести не додаються.');
      dispatch({ type: 'SAVE_DAILY_PLAN', plan: { ...content, id, date, model: response.model, sourceFingerprint, appliedQuestIds: [] } });
      setStalePlan(false);
      setNotice('Аналіз готовий. Переглянь поради та обери квести, які хочеш додати.');
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && requestRef.current === controller) setError(cause.message || 'Не вдалося отримати план. Перевір з’єднання та спробуй ще раз.');
    } finally {
      if (mounted.current && requestRef.current === controller) { requestRef.current = null; setPending(false); }
    }
  }

  async function apply() {
    if (blocked || applyRef.current || !plan || plan.appliedQuestIds?.length) return;
    setError(''); setNotice('');
    const date = localDate(); setDay(date);
    if (plan.date !== date) { setError('Цей план створено для іншого дня. Спочатку створи план на сьогодні.'); return; }
    if ((stateRef.current.dailyPlans || []).some(item => item.date === date && item.appliedQuestIds?.length)) { setError('План на сьогодні вже додано. Змінити його квести можна у розділі «Квести».'); return; }
    const quests = selected.map(({ title, description, category: domain, minutes }) => ({ title: title.trim(), description: description.trim(), category: domain, minutes: Number(minutes) }));
    if (!quests.length) { setError('Обери хоча б один квест для свого дня.'); return; }
    if (!validateDailyPlan({ summary: plan.summary, insights: plan.insights, quests }, { profile: normalizeLifeProfile(draftRef.current) })) { setError('Перевір назви, описи та час квестів. Кожен має тривати 1–60 хв, а разом — не більше твого денного часу.'); return; }
    if ((stateRef.current.quests?.length || 0) + quests.length > 200) { setError('У колекції вже забагато квестів для додавання цього плану. План збережено; поки скористайся наявними квестами.'); return; }
    applyRef.current = true; setApplying(true);
    try {
      // This payload is ONLY hashed locally and must never be sent. Withdrawing
      // permission blocks new transmissions, not accepting an existing plan.
      const comparisonState = currentState();
      comparisonState.profile.lifeProfile.aiConsent = true;
      const sourceFingerprint = await fingerprint(buildDailyPlanPayload(comparisonState, date));
      if (!mounted.current) return;
      if (plan.sourceFingerprint && sourceFingerprint !== plan.sourceFingerprint) { setStalePlan(true); throw new Error('Від часу аналізу відповіді або прогрес змінилися. Створи оновлений план перед додаванням квестів.'); }
      if (localDate() !== date) throw new Error('Почався новий день. Спочатку створи план на сьогодні.');
      dispatch({ type: 'APPLY_DAILY_PLAN', id: plan.id, quests, sourceFingerprint });
      setAwaitingApply(plan.id);
    } catch (cause) {
      if (mounted.current) { setError(cause.message || 'Не вдалося додати план. Спробуй ще раз.'); setApplying(false); }
      applyRef.current = false;
    }
  }

  function finishWithoutAI() {
    persist({ ...draftRef.current, step: 11, status: count ? 'completed' : 'skipped' });
    notify?.('Відповіді збережено на пристрої.');
    if (onClose) onClose(); else setNotice('Відповіді збережено. До аналізу можна повернутися пізніше.');
  }

  return <div className="lj-page">
    <header className="lj-header"><div><span className="eyebrow">ТВІЙ ОСОБИСТИЙ МАРШРУТ</span><h1>Почнемо з тебе</h1><p>Щоб поради пасували твоєму життю, а не абстрактному ідеальному дню.</p></div>{onClose && <button type="button" className="lj-close" onClick={() => close()} aria-label="Зберегти й закрити знайомство"><X size={20} /><span>Повернутися</span></button>}</header>
    <div className="lj-progress"><span>{step === 0 ? 'Знайомство' : step === 11 ? 'Твій маршрут' : `Напрям ${step} із 10`}</span><div role="progressbar" aria-label="Кроки знайомства" aria-valuenow={step} aria-valuemin={0} aria-valuemax={11}><span style={{ width: `${step / 11 * 100}%` }} /></div><span>{count}/10 напрямів</span></div>
    {disabled && <p className="lj-alert" role="alert">Зміни тимчасово недоступні. Спочатку віднови збереження даних застосунку.</p>}
    <div className="lj-layout">
      <nav className="lj-nav" ref={navRef} aria-label="Кроки знайомства">
        <button type="button" disabled={blocked} aria-current={step === 0 ? 'step' : undefined} onClick={() => move(0)}><Compass size={19} /><span>Про тебе</span><small>00</small></button>
        {CATEGORIES.map((item, index) => <button type="button" key={item.id} disabled={blocked} aria-current={step === index + 1 ? 'step' : undefined} onClick={() => move(index + 1)}><CategoryIcon category={item.id} size={18} /><span>{item.shortLabel}</span>{answered(draft.domains[item.id]) ? <Check size={15} /> : <small>{String(index + 1).padStart(2, '0')}</small>}</button>)}
        <button type="button" disabled={blocked} aria-current={step === 11 ? 'step' : undefined} onClick={() => move(11)}><Sparkle size={19} /><span>Мій план</span><small>11</small></button>
      </nav>
      <section className="lj-content" aria-label={step === 0 ? 'Знайомство' : step === 11 ? 'Підсумок і план' : category.label}>
        {step === 0 && <div className="panel lj-panel"><span className="lj-step-icon"><Compass size={32} weight="light" /></span><h2 ref={titleRef} tabIndex={-1}>Твій день. Твій темп.</h2><p className="lj-lead">Можна відповідати коротко, пропускати питання й повертатися пізніше. Чернетка зберігається на цьому пристрої.</p><fieldset disabled={blocked} className="lj-fields">
          <label className="field">Як до тебе звертатися?<input value={name} maxLength={40} autoComplete="given-name" onChange={event => { nameRef.current = event.target.value; setName(event.target.value); persist(draftRef.current, event.target.value); }} /></label>
          <label className="field">Що варто знати про тебе?<textarea rows={4} value={draft.about} maxLength={500} placeholder="Твій звичний день, інтереси й те, що зараз важливо." onChange={event => change({ about: event.target.value })} /><small>Необов’язково. Пиши лише те, чим комфортно ділитися.</small></label>
          <div className="lj-time-field"><label className="field" htmlFor={`${inputId}-time`}>Скільки часу готовий виділяти щодня?<span className="lj-time-input"><input id={`${inputId}-time`} type="number" min={5} max={120} step={1} value={timeInput} onChange={event => { setTimeInput(event.target.value); const value = Number(event.target.value); if (Number.isInteger(value) && value >= 5 && value <= 120) change({ dailyMinutes: value }); }} onBlur={() => setTimeInput(String(draftRef.current.dailyMinutes))} /><span>хвилин</span></span></label><div className="lj-time-options">{[5, 15, 30, 60].map(value => <button type="button" key={value} aria-pressed={draft.dailyMinutes === value} onClick={() => change({ dailyMinutes: value })}>{value} хв</button>)}</div></div>
          <fieldset className="lj-focus"><legend>Що зараз у пріоритеті? <span>До трьох напрямів</span></legend><div>{CATEGORIES.map(item => { const active = draft.focus.includes(item.id); return <button type="button" key={item.id} aria-pressed={active} disabled={!active && draft.focus.length >= 3} onClick={() => change({ focus: active ? draft.focus.filter(id => id !== item.id) : [...draft.focus, item.id] })}><CategoryIcon category={item.id} size={17} />{item.shortLabel}{active && <Check size={14} />}</button>; })}</div></fieldset>
        </fieldset><div className="lj-footer"><button type="button" className="button button-ghost" disabled={blocked} onClick={() => close(true)}>Заповню пізніше</button><button type="button" className="button button-primary" disabled={blocked} onClick={() => move(1)}>Почати знайомство <ArrowRight size={17} /></button></div></div>}
        {category && <div className="panel lj-panel"><span className="lj-step-icon"><CategoryIcon category={category.id} size={31} /></span><span className="eyebrow">{category.label}</span><h2 ref={titleRef} tabIndex={-1}>{prompt.title}</h2><p className="lj-lead">{prompt.intro}</p><fieldset disabled={blocked} className="lj-fields">
          <fieldset className="lj-rating"><legend>Наскільки тебе влаштовує ця сфера зараз?</legend><p>Лише твоя власна оцінка, не діагноз і не змагання.</p><div role="group" aria-label="Самооцінка напряму">{[1, 2, 3, 4, 5].map(value => <button type="button" key={value} aria-label={`${value} із 5`} aria-pressed={area.rating === value} onClick={() => change({ domains: { ...draft.domains, [category.id]: { ...area, rating: area.rating === value ? 0 : value } } })}>{value}</button>)}</div><div className="lj-rating-labels"><span>Хочу змін</span><span>Мене влаштовує</span></div>{area.rating > 0 && <button className="lj-text-button" type="button" onClick={() => change({ domains: { ...draft.domains, [category.id]: { ...area, rating: 0 } } })}>Прибрати оцінку</button>}</fieldset>
          {['current', 'desired', 'obstacle'].map(field => <label key={field} className="field">{prompt[field]}<textarea rows={3} maxLength={400} value={area[field]} placeholder={prompt[`${field}Hint`]} onChange={event => change({ domains: { ...draft.domains, [category.id]: { ...area, [field]: event.target.value } } })} /><small>Необов’язково · до 400 символів</small></label>)}
        </fieldset><div className="lj-footer"><button type="button" className="button button-ghost" disabled={blocked} onClick={() => move(step - 1)}><ArrowLeft size={16} /> Назад</button><div><button type="button" className="lj-text-button" disabled={blocked} onClick={() => move(step + 1)}>Пропустити напрям</button><button type="button" className="button button-primary" disabled={blocked} onClick={() => move(step + 1)}>{step === 10 ? 'До мого плану' : 'Зберегти й далі'} <ArrowRight size={17} /></button></div></div></div>}
        {step === 11 && <>
          <div className="panel lj-panel"><span className="lj-step-icon"><Sparkle size={32} weight="light" /></span><h2 ref={titleRef} tabIndex={-1}>Від знайомства — до дії</h2><p className="lj-lead">{count ? `Ти розповів про ${count} із 10 напрямів. OpenAI проаналізує заповнені сфери окремо й запропонує посильний план на ${draft.dailyMinutes} хвилин.` : 'Достатньо відповісти хоча б в одному напрямі або поставити оцінку. Решту можна доповнити згодом.'}</p>
            <div className="lj-summary-grid">{CATEGORIES.map((item, index) => { const domain = draft.domains[item.id]; const hasAnswer = answered(domain); return <button type="button" key={item.id} disabled={blocked} onClick={() => move(index + 1)} className={hasAnswer ? 'is-answered' : ''}><CategoryIcon category={item.id} size={20} /><span><strong>{item.shortLabel}</strong><small>{hasAnswer ? domain.desired || domain.current || domain.obstacle || `Власна оцінка: ${domain.rating}/5` : 'Можна заповнити пізніше'}</small></span><PencilSimple size={15} /></button>; })}</div>
            <div className="lj-summary-time"><Clock size={18} /><span>На твій день: <strong>{draft.dailyMinutes} хв</strong></span><button type="button" className="lj-text-button" disabled={blocked} onClick={() => move(0)}>Змінити</button></div>
            <label className="lj-consent"><input type="checkbox" checked={draft.aiConsent} disabled={blocked} onChange={event => change({ aiConsent: event.target.checked })} /><span>Дозволяю передавати OpenAI мої відповіді, ім’я й особисту мету, активні цілі, звички та підсумок прогресу для аналізу й подальших персональних порад.</span></label><p className="lj-privacy-note">Фото, записи щоденника та перелік фінансових операцій не додаються. Генерація запускається кнопкою нижче й використовує платний OpenAI API. Згоду можна відкликати тут; для використання відповідей у чаті також потрібна згода на контекст у налаштуваннях тренера.</p>
            {acceptedToday ? <div className="lj-accepted"><CheckCircle size={23} /><div><strong>План на сьогодні вже додано</strong><p>Відповіді можна оновлювати для наступних днів. Наявні квести редагуються у розділі «Квести».</p></div></div> : <div className="lj-generate"><button type="button" className="button button-primary" disabled={blocked || !count || !draft.aiConsent} onClick={generate}><Sparkle size={18} />{pending ? 'OpenAI аналізує відповіді…' : plan?.date === day ? 'Створити новий варіант' : 'Створити план на сьогодні'}</button>{!count && <small>Заповни хоча б один напрям вище.</small>}{count > 0 && !draft.aiConsent && <small>Для аналізу потрібна окрема згода вище.</small>}{plan?.date === day && <small>Новий варіант замінить попередній перегляд. Квести додаються лише після твого вибору.</small>}</div>}
            <div className="lj-summary-footer"><button type="button" className="lj-text-button" disabled={blocked} onClick={() => move(10)}><ArrowLeft size={15} /> До відповідей</button><button type="button" className="lj-text-button" disabled={blocked} onClick={finishWithoutAI}><FloppyDisk size={16} /> Зберегти без нового аналізу</button></div>
          </div>
          {plan && <section className="panel lj-panel lj-plan" aria-label="План від OpenAI"><div className="lj-plan-heading"><div><span className="eyebrow">АНАЛІЗ OPENAI · {dateLabel(plan.date)}</span><h2>{plan.date === day ? 'Твій план на сьогодні' : 'Твій збережений план'}</h2></div><span className="lj-model">{plan.model || 'OpenAI'}</span></div><p className="lj-plan-summary">{plan.summary}</p>
            {plan.date !== day && <p className="lj-plan-note">Це план за {dateLabel(plan.date)}. Новий план на сьогодні можна створити вручну вище.</p>}
            <div className="lj-insights">{plan.insights.map(insight => <article key={insight.category}><h3><CategoryIcon category={insight.category} size={20} />{CATEGORIES.find(item => item.id === insight.category)?.label || insight.category}</h3><p>{insight.observation}</p><div><span>ЩО МОЖНА СПРОБУВАТИ</span><p>{insight.advice}</p></div></article>)}</div>
            <div className="lj-quests-heading"><h3>{plan.appliedQuestIds?.length ? 'Квести твого плану' : 'Обери свої квести'}</h3><p>{plan.appliedQuestIds?.length ? 'План уже додано до дня. Досвід нараховується за виконання.' : 'Можна змінити формулювання й час або залишити тільки одну посильну дію.'}</p></div>
            {plan.appliedQuestIds?.length ? <><div className="lj-applied-list">{plan.quests.map((quest, index) => <div key={index}><CheckCircle size={20} /><span>{quest.title}<small>{quest.minutes} хв · {CATEGORIES.find(item => item.id === quest.category)?.shortLabel}</small></span></div>)}</div>{onApplied && <button type="button" className="button button-primary" onClick={onApplied}>До мого дня <ArrowRight size={17} /></button>}</> : <>
              <fieldset className="lj-quest-editor" disabled={blocked || plan.date !== day || Boolean(acceptedToday)}>{questEdits.map((quest, index) => <article key={`${plan.id}-${index}`} className={quest.selected ? 'is-selected' : ''}><label className="lj-quest-select"><input type="checkbox" checked={quest.selected} onChange={event => setQuestEdits(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, selected: event.target.checked } : item))} /><span>Квест {index + 1} · {CATEGORIES.find(item => item.id === quest.category)?.shortLabel}</span></label><div className="lj-quest-fields"><label className="field">Назва квесту<input maxLength={100} value={quest.title} onChange={event => setQuestEdits(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></label><label className="field">Що зробити<textarea rows={2} maxLength={400} value={quest.description} onChange={event => setQuestEdits(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} /></label><label className="field lj-quest-minutes">Час, хв<input type="number" min={1} max={60} step={1} value={quest.minutes} onChange={event => setQuestEdits(current => current.map((item, itemIndex) => itemIndex === index ? { ...item, minutes: event.target.value } : item))} /></label></div></article>)}</fieldset>
              {stalePlan && <p className="lj-plan-note">Ти змінив відповіді після аналізу. Перед додаванням перевіримо, чи план ще відповідає твоїм даним.</p>}
              {!plan.sourceFingerprint && <p className="lj-plan-note">Цей збережений план не містить позначки використаних відповідей. Перевір його перед додаванням або створи новий варіант.</p>}
              <div className="lj-apply-footer"><div><strong className={totalMinutes > draft.dailyMinutes ? 'is-over-budget' : ''}>{totalMinutes} / {draft.dailyMinutes} хв</strong><span>Обрано квестів: {selected.length}</span></div>{plan.date === day && !acceptedToday && <button type="button" className="button button-primary" disabled={blocked || !selected.length || totalMinutes > draft.dailyMinutes} onClick={apply}>{applying ? 'Додаємо…' : 'Додати обрані квести'} <ArrowRight size={17} /></button>}</div>
            </>}
          </section>}
        </>}
        {pending && <div className="lj-request" role="status"><span className="lj-pulse" /><div><strong>OpenAI готує твій маршрут</strong><p>Зазвичай це займає кілька десятків секунд. Квести не додаються автоматично.</p></div><button type="button" className="button button-ghost" onClick={stopRequest}>Скасувати</button></div>}
        {error && <div className="lj-alert" role="alert"><p>{error}</p>{step === 11 && !pending && !acceptedToday && <button type="button" className="lj-text-button" disabled={blocked || !count || !draft.aiConsent} onClick={generate}><ArrowClockwise size={16} /> Спробувати аналіз ще раз</button>}</div>}
        {notice && <p className="lj-notice" role="status">{notice}</p>}
      </section>
    </div>
  </div>;
}
