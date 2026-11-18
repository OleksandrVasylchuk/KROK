import { useEffect, useRef, useState } from 'react';
import { ArrowClockwise, ArrowUpRight, CaretDown, Microphone, PaperPlaneTilt, SlidersHorizontal, Sparkle, SpeakerHigh, Stop, Target, X } from '@phosphor-icons/react';
import { CATEGORIES, coachReply, localDate } from './model.js';
import { buildCoachActionPayload, coachClient, COACH_MESSAGE_LIMIT } from './coach-client.js';
import { coachStateFingerprint, checkCoachProposal } from './coach-actions.js';
import { createVoiceInput } from './voice-input.js';
import { createVoiceOutput } from './voice-output.js';
import { createTalkSession } from './talk-session.js';
import CoachActionPreview from './CoachActionPreview.jsx';
import { COACH_SCENARIOS, buildScenarioMessage, scenarioAnswer, scenarioProfilePatch } from './coach-scenarios.js';
import './coach.css';
import './coach-scenario.css';
import './coach-profile.css';
import './home-coach.css';
import './coach-talk.css';
import JourneyEntry from './JourneyEntry.jsx';

const tones = [
  { id: 'supportive', title: 'Підтримка', description: 'Спокійно й дбайливо' },
  { id: 'buddy', title: 'По-братськи', description: 'Дружньо й чесно' },
  { id: 'direct', title: 'Прямо до справи', description: 'Коротко й конкретно' },
];
const suggestions = [{ label: 'Створи квест', text: 'Допоможи створити квест: ' }, { label: 'Хочу нову звичку', text: 'Хочу додати нову звичку: ' }, { label: 'Підсумуй мій день', text: 'Підсумуй мій день за моїми записами та підкажи наступний посильний крок.' }];
const coachQuestions = [
  { title: 'Які сфери життя хочеш покращити спочатку?', hint: 'Обери до трьох. Усі напрями можна буде змінити пізніше.' },
  { title: 'Якої зміни тобі найбільше хочеться?', hint: 'Напиши своїми словами: навіть маленька мрія — хороший початок.', field: 'desiredChange', placeholder: 'Наприклад, мати більше сил і регулярніше відкладати гроші' },
  { title: 'Що зараз найчастіше заважає?', hint: 'Можна пропустити. Не потрібно ділитися тим, чим не хочеш.', field: 'obstacle', placeholder: 'Наприклад, мало вільного часу або важко почати' },
  { title: 'Скільки часу реально виділяти на кроки?', hint: 'Обери комфортний орієнтир, не обіцянку на кожен день.', field: 'dailyTime' },
  { title: 'Що ще тренеру варто знати про твій ритм чи побажання?', hint: 'Необов’язково. Не додавай паролі, платіжні дані чи інші секрети.', field: 'extra', placeholder: 'Наприклад, поради мають бути короткими й без тиску' },
];
const emptyCoachPlan = () => ({ priorities: [], desiredChange: '', obstacle: '', dailyTime: '', extra: '', step: 0 });
const timeOptions = [
  ['5', 'До 5 хвилин'],
  ['10-15', '10–15 хвилин'],
  ['20-30', '20–30 хвилин'],
  ['varies', 'Залежить від дня'],
];

function CoachProfileSetup({ profile, dispatch }) {
  const plan = profile.coachPlan || emptyCoachPlan();
  const hasPlan = plan.priorities.length || plan.desiredChange || plan.obstacle || plan.dailyTime || plan.extra;
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(plan.step < coachQuestions.length ? plan.step : 0);
  const [draft, setDraft] = useState(() => ({ ...emptyCoachPlan(), ...plan, priorities: [...plan.priorities] }));
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const question = coachQuestions[step];

  function next(event) {
    event.preventDefault();
    if (step === 0 && !draft.priorities.length) { setError('Обери хоча б один важливий напрям.'); return; }
    if (step === 1 && !draft.desiredChange.trim()) { setError('Напиши, до якої зміни хочеш рухатися.'); return; }
    if (step === 3 && !draft.dailyTime) { setError('Обери комфортний для себе час.'); return; }
    setError('');
    if (step < coachQuestions.length - 1) {
      const nextStep = step + 1;
      dispatch({ type: 'UPDATE_PROFILE', profile: { coachPlan: { ...draft, step: nextStep } } });
      setStep(nextStep);
      return;
    }
    dispatch({ type: 'UPDATE_PROFILE', profile: { coachPlan: { ...draft, step: coachQuestions.length } } });
    setSaved(true);
    setOpen(false);
  }

  function edit() {
    setDraft({ ...emptyCoachPlan(), ...plan, priorities: [...plan.priorities] });
    setStep(plan.step < coachQuestions.length ? plan.step : 0);
    setError('');
    setSaved(false);
    setOpen(true);
  }

  return <section className="coach-profile-setup" aria-label="Знайомство з тренером">
    {!open ? <div className="coach-profile-summary">
      <div><span className="eyebrow">{saved ? 'МАРШРУТ ЗБЕРЕЖЕНО НА ЦЬОМУ ПРИСТРОЇ' : 'ТВОЇ ОРІЄНТИРИ'}</span><strong>{plan.priorities.map(id => CATEGORIES.find(category => category.id === id)?.shortLabel).filter(Boolean).join(' · ') || 'Персональний маршрут'}</strong>
        {plan.desiredChange && <p>{plan.desiredChange}</p>}</div>
      <div className="coach-profile-summary-actions"><button type="button" className="coach-profile-edit" onClick={edit}>{plan.step < coachQuestions.length ? 'Продовжити знайомство' : 'Змінити відповіді'}</button>{hasPlan && <button type="button" className="coach-profile-edit" onClick={() => { const empty = emptyCoachPlan(); dispatch({ type: 'UPDATE_PROFILE', profile: { coachPlan: empty } }); setDraft(empty); setStep(0); setSaved(false); }}>Очистити</button>}</div>
    </div> : <form className="coach-profile-form" onSubmit={next}>
      <div className="coach-profile-top"><span className="eyebrow">ЗНАЙОМСТВО · {step + 1} З {coachQuestions.length}</span><button type="button" className="coach-profile-edit" onClick={() => setOpen(false)}>Згорнути</button></div>
      <h2>{question.title}</h2><p>{question.hint}</p>
      {step === 0 && <div className="coach-priority-options">{CATEGORIES.map(category => {
        const selected = draft.priorities.includes(category.id);
        return <button type="button" key={category.id} aria-pressed={selected} onClick={() => setDraft(value => {
          const priorities = selected ? value.priorities.filter(id => id !== category.id) : value.priorities.length < 3 ? [...value.priorities, category.id] : value.priorities;
          return { ...value, priorities };
        })}>{category.shortLabel}</button>;
      })}</div>}
      {question.field && ['desiredChange', 'obstacle', 'extra'].includes(question.field) && <label className="coach-profile-answer"><span className="v-sr-only">{question.title}</span><textarea value={draft[question.field]} maxLength={300} rows={3} placeholder={question.placeholder} onChange={event => setDraft(value => ({ ...value, [question.field]: event.target.value }))} /></label>}
      {step === 3 && <div className="coach-time-options">{timeOptions.map(([value, label]) => <button type="button" key={value} aria-pressed={draft.dailyTime === value} onClick={() => setDraft(current => ({ ...current, dailyTime: value }))}>{label}</button>)}</div>}
      {error && <p className="coach-profile-error" role="alert">{error}</p>}
      <div className="coach-profile-actions">{step > 0 && <button type="button" className="coach-profile-edit" onClick={() => { setStep(value => value - 1); setError(''); }}>Назад</button>}<button type="submit" className="coach-profile-next">{step === coachQuestions.length - 1 ? 'Зберегти відповіді' : 'Далі'}</button></div>
      <p className="coach-profile-storage">Відповіді зберігаються на цьому пристрої. OpenAI їх не отримує, доки ти окремо не дозволиш передавання контексту.</p>
    </form>}
  </section>;
}

export default function CoachView({ state, dispatch, onJourney, disabled = false, entry = 'page' }) {
  const isHome = entry === 'home';
  const [homeOpen, setHomeOpen] = useState(false);
  const conversationVisible = !isHome || homeOpen;
  const [draft, setDraft] = useState('');
  const [status, setStatus] = useState({ phase: 'loading' });
  const [statusRevision, setStatusRevision] = useState(0);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(null);
  const [voiceSupport, setVoiceSupport] = useState('loading');
  const [voicePhase, setVoicePhase] = useState('idle');
  const [voiceError, setVoiceError] = useState('');
  const [voiceNotice, setVoiceNotice] = useState('');
  const [speechSupport, setSpeechSupport] = useState({ supported: false, loading: true });
  const [speechPhase, setSpeechPhase] = useState('idle');
  const [speechError, setSpeechError] = useState('');
  const [talkConsent, setTalkConsent] = useState(false);
  const [talkPhase, setTalkPhase] = useState('idle');
  const [scenario, setScenario] = useState(null);
  const [scenarioError, setScenarioError] = useState('');
  const scenarioRef = useRef(null);
  const messagesRef = useRef(null);
  const composerRef = useRef(null);
  const homeButtonRef = useRef(null);
  const homeOpenModeRef = useRef(null);
  const draftRef = useRef('');
  const requestRef = useRef(null);
  const voiceRef = useRef(null);
  const speechRef = useRef(null);
  const talkRef = useRef(null);
  const submitTalkRef = useRef(null);
  const voiceStartRef = useRef(false);
  const acceptVoiceRef = useRef(false);
  const sendRef = useRef(false);
  const mounted = useRef(false);
  const stateRef = useRef(state);
  const disabledRef = useRef(disabled);
  stateRef.current = state;
  disabledRef.current = disabled;
  const messages = state.messages || [];
  const proposals = state.coachProposals || [];
  const mode = state.profile.coachMode === 'local' ? 'local' : 'openai';
  const isOpenAI = mode === 'openai';
  const consent = state.profile.coachContextConsent === true;
  const actionConsent = state.profile.coachActionsConsent === true;
  const tone = state.profile.coachTone || 'supportive';
  const lastRemote = messages.filter(message => message.source === 'openai').at(-1);
  const unanswered = lastRemote?.role === 'user';
  const available = !isOpenAI || status.phase === 'ready';
  const voiceBusy = voicePhase !== 'idle';
  const speechBusy = speechPhase !== 'idle';
  const talkActive = talkPhase !== 'idle';
  const controlsDisabled = disabled || pending || voiceBusy || speechBusy || (talkActive && !['paused', 'review'].includes(talkPhase));
  const proposalById = new Map(proposals.map(proposal => [proposal.id, proposal]));
  const messageIds = new Set(messages.map(message => message.id));
  const orphanProposals = proposals.filter(proposal => !messageIds.has(proposal.id));

  function updateDraft(value) {
    draftRef.current = value;
    setDraft(value);
  }

  useEffect(() => {
    mounted.current = true;
    let active = true;
    const service = createVoiceInput({
      onResult: text => {
        if (!active || !mounted.current || !acceptVoiceRef.current || disabledRef.current) return;
        acceptVoiceRef.current = false;
        if (talkRef.current?.isActive()) { void talkRef.current.receive(text); return; }
        const current = draftRef.current;
        const separator = current && !/\s$/.test(current) ? ' ' : '';
        const combined = current + separator + text;
        updateDraft(combined.slice(0, COACH_MESSAGE_LIMIT));
        setVoiceNotice(combined.length > COACH_MESSAGE_LIMIT ? 'Додано стільки тексту, скільки вмістилося в повідомлення. Перевір його перед надсиланням.' : 'Текст додано. Перевір його й натисни «Надіслати», коли будеш готовий.');
        composerRef.current?.focus({ preventScroll: true });
      },
      onState: phase => { if (active && mounted.current) setVoicePhase(phase); },
      onError: cause => {
        if (!active || !mounted.current) return;
        acceptVoiceRef.current = false;
        setVoiceError(cause.message || 'Не вдалося розпізнати мовлення. Спробуй ще раз або введи текст.');
        if (talkRef.current?.isActive()) talkRef.current.fail(cause);
      },
    });
    voiceRef.current = service;
    const output = createVoiceOutput({ onState: phase => { if (active && mounted.current) setSpeechPhase(phase); } });
    speechRef.current = output;
    output.status().then(result => { if (active && mounted.current) setSpeechSupport({ ...result, loading: false }); }).catch(() => { if (active && mounted.current) setSpeechSupport({ supported: false, loading: false }); });
    const conversation = createTalkSession({
      listen: async () => { await output.cancel(); if (!conversation.isActive() || disabledRef.current) return; acceptVoiceRef.current = true; await service.start(); },
      cancelListening: async () => { acceptVoiceRef.current = false; await service.cancel(); },
      speak: text => output.speak(text), cancelSpeaking: () => output.cancel(),
      submit: text => submitTalkRef.current(text),
      cancelRequest: () => { requestRef.current?.abort(); requestRef.current = null; if (active && mounted.current) setPending(false); },
      onTranscript: text => { if (active && mounted.current) updateDraft(text.slice(0, COACH_MESSAGE_LIMIT)); },
      onPhase: phase => { if (active && mounted.current) setTalkPhase(phase); },
      onError: cause => { if (active && mounted.current) setSpeechError(cause.message || 'Розмову призупинено. Можеш продовжити текстом.'); },
    });
    talkRef.current = conversation;
    service.status().then(result => { if (active && mounted.current) setVoiceSupport(result.supported ? 'supported' : 'unsupported'); }).catch(() => { if (active && mounted.current) setVoiceSupport('unsupported'); });
    return () => {
      active = false; mounted.current = false; acceptVoiceRef.current = false;
      requestRef.current?.abort(); requestRef.current = null;
      voiceRef.current = null;
      talkRef.current = null; speechRef.current = null;
      void conversation.stop();
      output.dispose().catch(() => {});
      service.dispose().catch(() => {});
    };
  }, []);

  useEffect(() => {
    if (!conversationVisible || !isOpenAI || disabled) return undefined;
    const controller = new AbortController();
    setStatus({ phase: 'loading' });
    coachClient.status({ signal: controller.signal }).then(result => {
      if (!controller.signal.aborted) setStatus({ phase: result.configured ? 'ready' : 'setup', model: result.model });
    }).catch(cause => {
      if (!controller.signal.aborted) setStatus({ phase: 'error', message: cause.message });
    });
    return () => controller.abort();
  }, [conversationVisible, isOpenAI, statusRevision, disabled]);

  useEffect(() => {
    if (!disabled) return;
    acceptVoiceRef.current = false;
    voiceRef.current?.cancel().catch(() => {});
    talkRef.current?.stop().catch(() => {});
    speechRef.current?.cancel().catch(() => {});
    requestRef.current?.abort(); requestRef.current = null;
    setPending(false);
  }, [disabled]);

  useEffect(() => {
    let disposed = false, nativeListener;
    const stopAudio = () => {
      acceptVoiceRef.current = false;
      void talkRef.current?.stop(); void speechRef.current?.cancel(); void voiceRef.current?.cancel();
    };
    const suspend = () => { if (document.visibilityState === 'hidden') stopAudio(); };
    document.addEventListener('visibilitychange', suspend);
    window.addEventListener('pagehide', stopAudio);
    window.addEventListener('krok:pause-coach', stopAudio);
    import('@capacitor/core').then(async ({ Capacitor }) => {
      if (!Capacitor.isNativePlatform() || disposed) return;
      const { App } = await import('@capacitor/app');
      const handle = await App.addListener('appStateChange', event => { if (!event.isActive) stopAudio(); });
      if (disposed) await handle.remove(); else nativeListener = handle;
    }).catch(() => {});
    return () => { disposed = true; document.removeEventListener('visibilitychange', suspend); window.removeEventListener('pagehide', stopAudio); window.removeEventListener('krok:pause-coach', stopAudio); nativeListener?.remove(); };
  }, []);

  useEffect(() => {
    const receivePrompt = async event => {
      const text = typeof event.detail?.text === 'string' ? event.detail.text.trim().slice(0, COACH_MESSAGE_LIMIT) : '';
      if (!text || disabledRef.current) return;
      acceptVoiceRef.current = false;
      await talkRef.current?.stop(); await voiceRef.current?.cancel(); await speechRef.current?.cancel();
      if (!mounted.current || disabledRef.current) return;
      const current = draftRef.current;
      updateDraft((current ? current + (/\s$/.test(current) ? '' : '\n') + text : text).slice(0, COACH_MESSAGE_LIMIT));
      homeOpenModeRef.current = 'text';
      if (isHome) setHomeOpen(true);
      requestAnimationFrame(() => {
        const composer = composerRef.current;
        (composer?.closest('.home-coach-open') || composer)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
        composer?.focus({ preventScroll: true });
      });
    };
    window.addEventListener('krok:coach-prompt', receivePrompt);
    return () => window.removeEventListener('krok:coach-prompt', receivePrompt);
  }, [isHome]);

  function changeScenario(next) {
    scenarioRef.current = next;
    setScenario(next);
    setScenarioError('');
  }

  // A scripted scenario asks its questions locally and spends one request at the end.
  async function startScenario(id, prefill = {}) {
    const definition = COACH_SCENARIOS[id];
    if (!definition || disabledRef.current || requestRef.current) return;
    if (!isOpenAI) {
      setError('Цей сценарій працює з ШІ-тренером. Обери режим OpenAI в налаштуваннях тренера.');
      if (isHome) setHomeOpen(true);
      return;
    }
    acceptVoiceRef.current = false;
    await talkRef.current?.stop(); await voiceRef.current?.cancel(); await speechRef.current?.cancel();
    if (!mounted.current || disabledRef.current) return;
    const answers = definition.questions.map(question => scenarioAnswer(prefill?.[question.id]));
    const savedDraft = scenarioRef.current ? scenarioRef.current.savedDraft : draftRef.current;
    changeScenario({ id, step: 0, answers, savedDraft });
    updateDraft(answers[0]);
    setError(null); setVoiceNotice(''); setVoiceError('');
    homeOpenModeRef.current = 'text';
    if (isHome) setHomeOpen(true);
    requestAnimationFrame(() => {
      const composer = composerRef.current;
      (composer?.closest('.home-coach-open') || composer)?.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
      composer?.focus({ preventScroll: true });
    });
  }
  const startScenarioRef = useRef(startScenario);
  startScenarioRef.current = startScenario;

  useEffect(() => {
    const receiveScenario = event => { void startScenarioRef.current(event.detail?.id, event.detail?.prefill); };
    window.addEventListener('krok:coach-scenario', receiveScenario);
    return () => window.removeEventListener('krok:coach-scenario', receiveScenario);
  }, []);

  function cancelScenario() {
    const current = scenarioRef.current;
    if (!current) return;
    if (talkRef.current?.isActive()) void talkRef.current.stop();
    changeScenario(null);
    updateDraft(current.savedDraft || '');
    setVoiceNotice('Сценарій скасовано. Нічого не надіслано й не змінено.');
  }

  function scenarioBack() {
    const current = scenarioRef.current;
    if (!current || current.step === 0) return;
    const answers = [...current.answers]; answers[current.step] = scenarioAnswer(draftRef.current);
    changeScenario({ ...current, step: current.step - 1, answers });
    updateDraft(answers[current.step - 1] || '');
  }

  /** Stores one answer. Returns the next local question, or the composed message after the last one. */
  function scenarioStep(raw, { skip = false } = {}) {
    const current = scenarioRef.current, definition = COACH_SCENARIOS[current.id], question = definition.questions[current.step];
    const answer = skip ? '' : scenarioAnswer(raw);
    if (!answer && question.required) return { error: 'Дай коротку відповідь на це запитання або скасуй сценарій.' };
    const answers = [...current.answers]; answers[current.step] = answer;
    if (current.step < definition.questions.length - 1) {
      changeScenario({ ...current, step: current.step + 1, answers });
      return { question: definition.questions[current.step + 1], answers };
    }
    return { message: buildScenarioMessage(current.id, answers), answers, current };
  }

  function completeScenario(result) {
    const patch = scenarioProfilePatch(result.current.id, result.answers, stateRef.current.profile);
    if (patch) dispatch({ type: 'UPDATE_PROFILE', profile: patch });
    changeScenario(null);
    updateDraft(result.current.savedDraft || '');
  }

  function advanceScenario(options) {
    const current = scenarioRef.current;
    if (!current || disabledRef.current || requestRef.current || sendRef.current || voiceBusy || talkRef.current?.isActive()) return;
    const last = current.step === COACH_SCENARIOS[current.id].questions.length - 1;
    if (last && !isOpenAI) { setScenarioError('Сценарій потребує режиму OpenAI. Обери його в налаштуваннях тренера або скасуй сценарій.'); return; }
    if (last && !available) { setScenarioError('Тренер зараз недоступний. Відповіді збережено тут — перевір налаштування та спробуй ще раз.'); return; }
    const result = scenarioStep(draftRef.current, options);
    if (result.error) { setScenarioError(result.error); return; }
    if (result.question) { updateDraft(result.answers[current.step + 1] || ''); composerRef.current?.focus({ preventScroll: true }); return; }
    completeScenario(result);
    void send(result.message);
  }

  useEffect(() => {
    const pane = messagesRef.current;
    if (pane) pane.scrollTop = pane.scrollHeight;
  }, [messages.length, proposals.length, pending, conversationVisible]);

  useEffect(() => {
    if (isHome && homeOpen && homeOpenModeRef.current === 'text') composerRef.current?.focus({ preventScroll: true });
  }, [isHome, homeOpen]);

  async function startVoice() {
    if (disabledRef.current || pending || voiceBusy || voiceStartRef.current || talkRef.current?.isActive() || voiceSupport === 'unsupported') return;
    const service = voiceRef.current;
    if (!service) { setVoiceError('Мікрофон ще готується. Спробуй ще раз або введи текст.'); return; }
    voiceStartRef.current = true;
    acceptVoiceRef.current = true; setVoiceError(''); setVoiceNotice('');
    try { await speechRef.current?.cancel(); if (mounted.current && acceptVoiceRef.current && !disabledRef.current) await service.start(); }
    catch (cause) {
      if (mounted.current) { acceptVoiceRef.current = false; setVoiceError(cause.message || 'Не вдалося увімкнути голосове введення.'); }
    } finally { voiceStartRef.current = false; }
  }

  function openHomeConversation(withVoice) {
    if (disabledRef.current) return;
    homeOpenModeRef.current = withVoice ? 'voice' : 'text';
    setHomeOpen(true);
    // Start in this explicit click handler, never in a route or mount effect.
    if (withVoice) void startVoice();
  }

  function collapseHomeConversation() {
    acceptVoiceRef.current = false;
    voiceRef.current?.cancel().catch(() => {});
    talkRef.current?.stop().catch(() => {});
    speechRef.current?.cancel().catch(() => {});
    if (requestRef.current) cancelRequest();
    setHomeOpen(false);
    requestAnimationFrame(() => homeButtonRef.current?.focus({ preventScroll: true }));
  }

  useEffect(() => {
    if (!isHome || !homeOpen) return undefined;
    const close = event => { event.preventDefault(); collapseHomeConversation(); };
    const escape = event => {
      if (event.key === 'Escape' && !document.querySelector('dialog[open]')) close(event);
    };
    window.addEventListener('krok:close-home-coach', close);
    window.addEventListener('keydown', escape);
    return () => { window.removeEventListener('krok:close-home-coach', close); window.removeEventListener('keydown', escape); };
  }, [isHome, homeOpen]);

  async function cancelVoice() {
    acceptVoiceRef.current = false;
    if (talkRef.current?.isActive()) await talkRef.current.stop();
    try { await voiceRef.current?.cancel(); }
    catch (cause) { if (mounted.current) setVoiceError(cause.message || 'Не вдалося завершити голосове введення.'); }
    if (mounted.current) setVoiceNotice('Голосове введення скасовано. Твоя чернетка залишилася.');
  }

  async function finishVoice() {
    if (voicePhase !== 'listening') return;
    try { await voiceRef.current?.stop(); }
    catch (cause) { if (mounted.current) setVoiceError(cause.message || 'Не вдалося розпізнати мовлення.'); }
  }

  async function requestReply(history, { conversation = false } = {}) {
    if (disabledRef.current || requestRef.current || !available) return;
    const controller = new AbortController();
    requestRef.current = controller;
    setPending(true); setError(null);
    const requestDate = localDate();
    const sourceFingerprint = coachStateFingerprint(stateRef.current, requestDate);
    try {
      const payload = buildCoachActionPayload(stateRef.current, history, requestDate);
      const reply = await coachClient.act(payload, { signal: controller.signal });
      if (!mounted.current || controller.signal.aborted || requestRef.current !== controller || disabledRef.current) return;
      if (reply.actions.length && (localDate() !== requestDate || sourceFingerprint !== coachStateFingerprint(stateRef.current, requestDate))) {
        throw new Error('Твої записи змінилися, поки тренер відповідав. Спробуй ще раз, щоб пропозиція врахувала актуальні дані.');
      }
      const id = 'coach-' + crypto.randomUUID();
      if (reply.actions.length) {
        const proposal = { id, date: requestDate, text: reply.text, actions: reply.actions, model: reply.model, sourceFingerprint, status: 'pending', appliedIds: [] };
        const check = checkCoachProposal(stateRef.current, proposal, { today: requestDate });
        if (!check.ok) throw new Error(check.error?.message || 'Не вдалося перевірити запропоновані зміни. Спробуй ще раз.');
        dispatch({ type: 'SAVE_COACH_PROPOSAL', proposal });
      }
      dispatch({ type: 'ADD_MESSAGE', message: { id, role: 'assistant', text: reply.text, source: 'openai' } });
      setStatus({ phase: 'ready', model: reply.model || status.model });
      return reply;
    } catch (cause) {
      if (mounted.current && !controller.signal.aborted && requestRef.current === controller) {
        setError(cause.message || 'Не вдалося отримати відповідь. Спробуй ще раз.');
        if (cause.code === 'not_configured') setStatus({ phase: 'setup' });
      }
      if (conversation) throw cause;
    } finally {
      if (mounted.current && requestRef.current === controller) { requestRef.current = null; setPending(false); }
    }
  }

  function cancelRequest() {
    if (talkRef.current?.isActive()) void talkRef.current.stop();
    requestRef.current?.abort(); requestRef.current = null; setPending(false);
    setError('Очікування скасовано. Повідомлення збережено; нові зміни не додано.');
  }

  async function send(prepared) {
    const composed = typeof prepared === 'string';
    if (!composed && scenarioRef.current) { advanceScenario(); return; }
    if (disabledRef.current || requestRef.current || sendRef.current || !available || voiceBusy || talkRef.current?.isActive() || !(composed ? prepared : draftRef.current).trim()) return;
    sendRef.current = true;
    try {
      acceptVoiceRef.current = false;
      await voiceRef.current?.cancel();
      await speechRef.current?.cancel();
      if (!mounted.current || disabledRef.current) return;
      const text = (composed ? prepared : draftRef.current).trim().slice(0, COACH_MESSAGE_LIMIT);
      if (!text) return;
      const message = { role: 'user', text, source: mode };
      dispatch({ type: 'ADD_MESSAGE', message });
      if (!composed) updateDraft('');
      setError(null); setVoiceNotice(''); setVoiceError('');
      if (isOpenAI) requestReply([...stateRef.current.messages, message]);
      else dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: coachReply(text, stateRef.current), source: 'local' } });
    } catch (cause) {
      if (mounted.current) setVoiceError(cause.message || 'Не вдалося завершити голосове введення. Чернетку збережено.');
    } finally { sendRef.current = false; }
  }

  submitTalkRef.current = async text => {
    if (disabledRef.current || !available || requestRef.current || !talkRef.current?.isActive()) throw new Error('Розмову призупинено. Перевір з’єднання й спробуй ще раз.');
    if (scenarioRef.current) {
      // Scripted questions are spoken locally; only the last answer triggers the single request.
      const result = scenarioStep(text);
      updateDraft('');
      if (result.error) return { text: result.error, actions: [] };
      if (result.question) return { text: result.question.text, actions: [] };
      completeScenario(result);
      text = result.message;
    }
    const message = { role: 'user', text: text.trim().slice(0, COACH_MESSAGE_LIMIT), source: mode };
    dispatch({ type: 'ADD_MESSAGE', message });
    updateDraft(''); setError(null); setVoiceError(''); setSpeechError('');
    if (isOpenAI) {
      const reply = await requestReply([...stateRef.current.messages, message], { conversation: true });
      if (!reply) throw new Error('Розмову завершено. Повідомлення лишилося в чаті.');
      return reply;
    }
    const textReply = coachReply(message.text, stateRef.current);
    dispatch({ type: 'ADD_MESSAGE', message: { role: 'assistant', text: textReply, source: 'local' } });
    return { text: textReply, actions: [] };
  };

  async function startConversation() {
    if (!talkConsent || controlsDisabled || !available || draftRef.current.trim() || voiceSupport !== 'supported' || !speechSupport.supported || speechSupport.languageAvailable === false) return;
    setVoiceError(''); setSpeechError(''); setVoiceNotice('');
    const current = scenarioRef.current;
    if (current) {
      // Speak the current scripted question before the first listening turn.
      try { await speechRef.current?.speak(COACH_SCENARIOS[current.id].questions[current.step].text); } catch { /* The question stays visible on screen. */ }
      if (!mounted.current || disabledRef.current || scenarioRef.current !== current) return;
    }
    await talkRef.current?.start();
  }

  async function readAnswer(text) {
    if (disabled || pending || voiceBusy || voiceStartRef.current || talkActive) return;
    setSpeechError('');
    try { await speechRef.current?.speak(text); }
    catch (cause) { if (mounted.current) setSpeechError(cause.message || 'Не вдалося озвучити відповідь.'); }
  }

  function useSuggestion(text) {
    if (controlsDisabled) return;
    const current = draftRef.current;
    updateDraft((current ? current + (/\s$/.test(current) ? '' : '\n') + text : text).slice(0, COACH_MESSAGE_LIMIT));
    composerRef.current?.focus();
  }

  const statusLabel = !isOpenAI ? 'Локальна демоверсія · готові сценарії'
    : status.phase === 'ready' ? 'OpenAI · голос і текст'
      : status.phase === 'loading' ? 'Перевіряємо налаштування…'
        : status.phase === 'setup' ? 'OpenAI · потрібне налаштування' : 'OpenAI · немає з’єднання';

  const scenarioDefinition = scenario ? COACH_SCENARIOS[scenario.id] : null;
  const scenarioQuestion = scenarioDefinition?.questions[scenario.step];
  const scenarioLast = scenarioDefinition ? scenario.step === scenarioDefinition.questions.length - 1 : false;

  const composition = <>
        {scenarioDefinition && <section className="coach-scenario" aria-label={scenarioDefinition.title}>
          <div className="coach-scenario-top"><span className="eyebrow">{scenarioDefinition.title} · {scenario.step + 1} з {scenarioDefinition.questions.length}</span><button type="button" className="coach-scenario-link" onClick={cancelScenario}>Скасувати</button></div>
          <h3 id="coach-scenario-question">{scenarioQuestion.text}</h3>
          <p>{scenarioQuestion.hint}</p>
          {scenarioQuestion.options && <div className="coach-scenario-options">{scenarioQuestion.options.map(option => <button type="button" key={option} aria-pressed={draft === option} disabled={controlsDisabled} onClick={() => updateDraft(option)}>{option}</button>)}</div>}
          <div className="coach-scenario-actions">
            {scenario.step > 0 && <button type="button" className="coach-scenario-link" disabled={controlsDisabled} onClick={scenarioBack}>Назад</button>}
            {speechSupport.supported && <button type="button" className="coach-scenario-link" disabled={controlsDisabled || talkActive} onClick={() => readAnswer(scenarioQuestion.text)}><SpeakerHigh size={15} /> Озвучити</button>}
            {!scenarioQuestion.required && <button type="button" className="coach-scenario-link" disabled={controlsDisabled || talkActive} onClick={() => advanceScenario({ skip: true })}>Пропустити</button>}
            <button type="button" className="button button-primary coach-scenario-next" disabled={controlsDisabled || talkActive || (scenarioQuestion.required && !draft.trim())} onClick={() => advanceScenario()}>{scenarioLast ? scenarioDefinition.sendLabel : 'Далі'}</button>
          </div>
          {scenarioError && <p className="coach-voice-error" role="alert">{scenarioError}</p>}
          <p className="coach-scenario-note">{scenarioLast ? 'Після цієї відповіді тренер отримає твої слова одним запитом і запропонує зміни. Вони застосуються лише після твого підтвердження.' : 'Відповідь можна написати або надиктувати нижче. Запитання ставить сам застосунок — запит до ШІ буде один, наприкінці.'}</p>
        </section>}
        <form className="v-chat-composer" onSubmit={event => { event.preventDefault(); send(); }}>
          <label className="v-sr-only" htmlFor="coach-message">{scenarioQuestion ? scenarioQuestion.text : 'Повідомлення тренеру'}</label>
          <textarea id="coach-message" ref={composerRef} value={draft} onChange={event => updateDraft(event.target.value)} maxLength={COACH_MESSAGE_LIMIT} placeholder={scenarioQuestion ? scenarioQuestion.placeholder : 'Напиши або натисни мікрофон…'} rows={2} autoComplete="off" disabled={disabled || pending || talkActive} onKeyDown={event => { if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); send(); } }} />
          <div className="coach-composer-buttons"><button className={'coach-mic ' + (voiceBusy ? 'is-listening' : '')} type="button" disabled={disabled || pending || talkActive || voiceSupport !== 'supported' || voicePhase === 'stopping'} aria-label={voicePhase === 'listening' ? 'Завершити диктування' : voicePhase === 'starting' ? 'Скасувати запуск мікрофона' : voiceSupport === 'unsupported' ? 'Голосове введення недоступне' : 'Надиктувати повідомлення'} aria-pressed={voiceBusy} onClick={voicePhase === 'listening' ? finishVoice : voicePhase === 'starting' ? cancelVoice : startVoice}>{voiceBusy ? <Stop size={19} weight="fill" /> : <Microphone size={21} />}</button><button className="v-send" type="submit" disabled={!draft.trim() || controlsDisabled || talkActive || !available} aria-label="Надіслати повідомлення"><PaperPlaneTilt size={21} /></button></div>
        </form>
        <div className="coach-voice-status" aria-live="polite">
          {voiceSupport === 'loading' && <p>Перевіряємо голосове введення…</p>}
          {voiceSupport === 'unsupported' && <p>Голосове введення недоступне в цьому браузері або на пристрої. Можна вводити текст.</p>}
          {voiceBusy && <div className="coach-voice-active"><span className="coach-pulse" /><span>{voicePhase === 'starting' ? 'Готуємо мікрофон…' : voicePhase === 'stopping' ? 'Розпізнаємо мовлення…' : 'Слухаю. Говори у своєму темпі.'}</span><button type="button" aria-label="Скасувати диктування" onClick={cancelVoice}><X size={17} /> Скасувати</button></div>}
          {voiceError && <p className="coach-voice-error" role="alert">{voiceError}</p>}
          {!voiceBusy && voiceNotice && <p>{voiceNotice}</p>}
        </div>
        <p className="v-chat-note">Мовлення розпізнає сервіс пристрою або браузера. Перед надсиланням можна виправити текст. {isOpenAI ? 'Натискання «Надіслати» передає повідомлення й недавню OpenAI-історію через сервер КРОК та використовує платний API.' : 'У локальній демоверсії повідомлення не передаються OpenAI.'}</p>
        <section className="coach-talk" aria-label="Голосова розмова">
          <div className="coach-talk-title"><SpeakerHigh size={20} /><strong>Розмова з відповідями голосом</strong></div>
          {talkActive ? <><p role="status">{{ starting: 'Готуємо розмову…', listening: 'Слухаю. Після паузи слова надішлються тренеру.', thinking: 'Тренер готує відповідь…', speaking: 'Тренер відповідає. Мікрофон вимкнений.', review: 'Переглянь запропоновані зміни нижче. Рішення за тобою.', paused: 'Розмову призупинено.' }[talkPhase]}</p><div className="coach-talk-actions">{['paused', 'review'].includes(talkPhase) && <button type="button" className="button button-primary" disabled={disabled || pending || voiceBusy || speechBusy} onClick={() => { setVoiceError(''); setSpeechError(''); talkRef.current?.resume(); }}>Продовжити розмову</button>}<button type="button" className="button button-ghost" onClick={() => { void talkRef.current?.stop(); setVoiceNotice('Розмову завершено. Мікрофон і озвучення вимкнено.'); }}><Stop size={16} /> Завершити розмову</button></div></> : <><p>Говори по черзі з тренером. Відповідь озвучить сервіс пристрою; якість голосу залежить від установлених мов.</p><label className="coach-talk-consent"><input type="checkbox" checked={talkConsent} disabled={controlsDisabled} onChange={event => setTalkConsent(event.target.checked)} /><span>Під час розмови надсилати мої розпізнані слова автоматично. {isOpenAI ? 'Кожна репліка використовує API.' : 'Обрано локальні демовідповіді.'}</span></label><button type="button" className="button button-primary" disabled={!talkConsent || controlsDisabled || !available || Boolean(draft.trim()) || voiceSupport !== 'supported' || !speechSupport.supported || speechSupport.languageAvailable === false} onClick={startConversation}><Microphone size={18} /> Почати голосову розмову</button>{draft.trim() && <p>Спочатку надішли або прибери чернетку. Вона не потрапить у розмову автоматично.</p>}</>}
          {!speechSupport.loading && !speechSupport.supported && <p>Озвучення тут недоступне. Можна диктувати повідомлення й читати відповіді.</p>}
          {speechSupport.languageAvailable === false && <p>Потрібен український голос у налаштуваннях озвучення пристрою.</p>}
          {speechError && <p className="coach-voice-error" role="alert">{speechError}</p>}
          {speechBusy && !talkActive && <button type="button" className="coach-read-answer" onClick={() => { void speechRef.current?.cancel(); }}><Stop size={15} /> Зупинити озвучення</button>}
        </section>
  </>;

  if (isHome && !homeOpen) return <section className="home-coach-entry" aria-label="Тренер на головній">
    <div className="home-coach-intro"><span className="eyebrow"><Sparkle size={15} /> ТВІЙ ТРЕНЕР ПОРУЧ</span><h2>Почни з розмови.</h2><p>Розкажи, що хочеш змінити. Разом перетворимо це на посильні квести, звички й цілі.</p></div>
    <div className="home-coach-actions"><button ref={homeButtonRef} type="button" className="button button-primary home-coach-speak" disabled={disabled || voiceBusy || pending || voiceSupport === 'unsupported'} onClick={() => openHomeConversation(true)}><Microphone size={23} /> Говорити з тренером</button><button type="button" className="home-coach-write" disabled={disabled} onClick={() => openHomeConversation(false)}>Написати тренеру <ArrowUpRight size={16} /></button>{isOpenAI && !(state.goals || []).some(goal => goal.status === 'active') && <button type="button" className="home-coach-write home-coach-intro-start" disabled={disabled} onClick={() => { void startScenario('intro'); }}>Знайомство за 2 хвилини <ArrowUpRight size={16} /></button>}</div>
    <p className="home-coach-hint">{disabled ? 'Спочатку віднови збереження даних, щоб продовжити розмову.' : voiceSupport === 'unsupported' ? 'Голос недоступний у цьому браузері або на пристрої. Можеш написати тренеру.' : 'Голос стане текстом. Перевір його перед надсиланням.'}</p>
    {draft.trim() && <p className="home-coach-draft">Твоя чернетка залишилася в розмові.</p>}
  </section>;

  return <div className={`v-page coach-page coach-workspace ${isHome ? 'home-coach-open' : ''}`}>
    {isHome ? <div className="home-coach-heading"><div><span className="eyebrow">ВІД ДУМОК ДО ДІЙ</span><h2>Твій тренер. Тут і зараз.</h2></div><button type="button" className="icon-button" aria-label="Згорнути розмову" onClick={collapseHomeConversation}><X size={20} /></button></div> : <div className="v-view-header"><div><span className="eyebrow">ВІД ДУМОК ДО ДІЙ</span><h1>Скажи. Обговоримо. Зроби.</h1><p className="muted">Напиши або надиктуй — тренер допоможе з наступним кроком.</p></div></div>}
    <div className="v-coach-layout">
      <section className="panel v-panel v-chat" aria-label="Розмова з тренером">
        <div className="v-chat-header"><span className="v-coach-avatar"><Sparkle size={23} weight="light" /></span><div><strong>Твій КРОК</strong><span>{statusLabel}</span></div></div>
        {isHome && composition}
        {disabled && <p className="coach-disabled" role="alert">Спочатку віднови збереження даних. Чернетку можна скопіювати; надсилання й зміни тимчасово вимкнено.</p>}
        {isOpenAI && ['setup', 'error'].includes(status.phase) && <div className="coach-connection" role="status">{status.phase === 'setup' ? <><strong>Підключи OpenAI на комп’ютері</strong><p>Запусти <code>SETUP-AI.cmd</code> у папці КРОК. API-ключ зберігається на комп’ютері й не потрапляє в телефон.</p></> : <><strong>Сервер поки недоступний</strong><p>{status.message}</p></>}<button type="button" className="coach-refresh" disabled={controlsDisabled} onClick={() => setStatusRevision(value => value + 1)}><ArrowClockwise size={15} /> Перевірити налаштування</button></div>}
        <div className="v-chat-messages" ref={messagesRef} role="log" aria-label="Історія розмови" aria-live="polite" aria-relevant="additions" aria-busy={pending}>
          {!messages.length && <div className="coach-welcome"><span className="eyebrow">ЩО У ТЕБЕ НА ДУМЦІ?</span><h2>Почни своїми словами.</h2><p>{isOpenAI ? 'Розкажи, що хочеш змінити і скільки маєш часу. Нові квести, звички та цілі спочатку покажу для твого підтвердження.' : 'Це локальна демоверсія з готовими порадами. Для створення квестів і звичок у розмові обери OpenAI в налаштуваннях.'}</p></div>}
          {messages.map(message => <div key={message.id} className="coach-turn"><div className={'v-message v-message-' + message.role}><span className="v-message-author">{message.role === 'user' ? 'ТИ' : 'КРОК'} <span>· {message.source === 'openai' ? 'OpenAI' : 'Локальна демо'}</span></span><p>{message.text}</p>{message.role === 'assistant' && speechSupport.supported && <button type="button" className="coach-read-answer" disabled={disabled || pending || voiceBusy || talkActive} onClick={() => readAnswer(message.text)}><SpeakerHigh size={16} /> Озвучити відповідь</button>}</div>{proposalById.has(message.id) && <CoachActionPreview proposal={proposalById.get(message.id)} state={state} dispatch={dispatch} disabled={controlsDisabled} />}</div>)}
          {orphanProposals.map(proposal => <CoachActionPreview key={proposal.id} {...{ proposal, state, dispatch }} disabled={controlsDisabled} />)}
          {pending && <div className="coach-pending" role="status"><span className="coach-pulse" /><span>OpenAI готує відповідь…</span><button type="button" onClick={cancelRequest}>Скасувати</button></div>}
        </div>
        {isOpenAI && <div className="v-suggestions coach-shortcuts">{suggestions.map(suggestion => <button type="button" key={suggestion.label} disabled={controlsDisabled} onClick={() => useSuggestion(suggestion.text)}>{suggestion.label}<ArrowUpRight size={14} /></button>)}</div>}
        {isOpenAI && <div className="coach-record-consent"><label><input type="checkbox" checked={actionConsent} disabled={controlsDisabled} onChange={event => dispatch({ type: 'UPDATE_PROFILE', profile: { coachActionsConsent: event.target.checked } })} /><span>Дозволити доступ до моїх квестів, звичок і цілей</span></label><p>Вибрані записи та підсумок прогресу за 7 днів передаються OpenAI. Запропоновані зміни застосуються лише після твого підтвердження.</p></div>}
        {isOpenAI && !pending && (error || unanswered) && <div className="coach-error" role={error ? 'alert' : 'status'}><p>{error || 'Для останнього повідомлення ще немає відповіді.'}</p><button type="button" className="button button-ghost" disabled={!available || controlsDisabled} onClick={() => requestReply(messages)}><ArrowClockwise size={16} /> Спробувати ще раз</button><span>Повтор надішле збережене повідомлення OpenAI ще раз.</span></div>}
        {!isHome && composition}
        <details className="coach-settings"><summary><SlidersHorizontal size={18} /><span>Налаштування тренера</span><CaretDown size={16} /></summary>
          <fieldset className="coach-mode" disabled={controlsDisabled}><legend>Режим тренера</legend><div><button type="button" aria-pressed={isOpenAI} onClick={() => { dispatch({ type: 'UPDATE_PROFILE', profile: { coachMode: 'openai' } }); setError(null); }}>OpenAI<span>Розмова та пропозиції дій</span></button><button type="button" aria-pressed={!isOpenAI} onClick={() => { dispatch({ type: 'UPDATE_PROFILE', profile: { coachMode: 'local' } }); setError(null); }}>Локальна демо<span>Готові сценарії</span></button></div></fieldset>
          <fieldset className="v-tone-picker" disabled={controlsDisabled}><legend>Як говорити з тобою</legend><div>{tones.map(item => <button type="button" key={item.id} aria-pressed={tone === item.id} className={tone === item.id ? 'is-selected' : ''} onClick={() => dispatch({ type: 'UPDATE_PROFILE', profile: { coachTone: item.id } })}><strong>{item.title}</strong><span>{item.description}</span></button>)}</div></fieldset>
          {isOpenAI && <div className="coach-privacy"><label><input type="checkbox" checked={consent} disabled={controlsDisabled} onChange={event => dispatch({ type: 'UPDATE_PROFILE', profile: { coachContextConsent: event.target.checked } })} /><span>Додати профіль для персональних порад</span></label><p>Ім’я, цілі, звички й підсумок прогресу. Відповіді за сферами життя додаються лише з окремою згодою у «Моєму маршруті». Фото, фінансові операції й щоденник не передаються автоматично.</p></div>}
          {isOpenAI && <div className="coach-connection"><p>{status.phase === 'ready' ? 'Ключ налаштовано на сервері. Доступність OpenAI перевіряється при надсиланні.' : 'Для OpenAI потрібен запущений сервер КРОК.'}{status.model && <span className="coach-model">Модель: {status.model}</span>}</p><button type="button" className="coach-refresh" disabled={controlsDisabled || status.phase === 'loading'} onClick={() => setStatusRevision(value => value + 1)}><ArrowClockwise size={15} /> Перевірити налаштування</button></div>}
        </details>
      </section>
      {!isHome && <aside className="v-coach-aside">
        <div className="panel v-panel"><span className="eyebrow">ТВОЯ ВЕЛИКА МЕТА</span><Target size={30} weight="light" /><h3>{state.profile.goal || 'Ставати трохи кращим щодня'}</h3><p>Повертайся до цієї думки, коли наступний крок здаватиметься складним.</p></div>
        <details className="coach-route-details"><summary>Мій маршрут і знайомство <CaretDown size={16} /></summary>{onJourney && <JourneyEntry state={state} onOpen={onJourney} compact />}<fieldset disabled={controlsDisabled}><CoachProfileSetup profile={state.profile} dispatch={dispatch} /></fieldset></details>
      </aside>}
    </div>
  </div>;
}
