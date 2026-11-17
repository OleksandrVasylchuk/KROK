// Speech is handled by the user's browser / Android recognition service.
// This module never records files or sends audio to the KROK API.
const messages = {
  unsupported: 'Голосове введення недоступне на цьому пристрої. Скористайся мікрофоном клавіатури або напиши повідомлення.',
  permission_denied: 'Дозволь КРОК доступ до мікрофона в налаштуваннях пристрою або браузера й спробуй ще раз.',
  no_speech: 'Не вдалося розпізнати слова. Спробуй ще раз, говорячи ближче до мікрофона.',
  network: 'Сервіс розпізнавання недоступний. Перевір інтернет або введи текст вручну.',
  audio: 'Мікрофон недоступний. Перевір, чи його не використовує інша програма.',
  busy: 'Мікрофон уже зайнятий. Зупини попередній запис і спробуй ще раз.',
  timeout: 'Голосове введення завершено за часом. Спробуй коротшу фразу.',
  language: 'Сервіс пристрою не підтримує українське мовлення. Додай українську мову в його налаштуваннях або введи текст.',
  recognition_failed: 'Не вдалося розпізнати мовлення. Спробуй ще раз або введи текст.',
};
const aliases = { 'not-allowed': 'permission_denied', 'service-not-allowed': 'permission_denied', 'no-speech': 'no_speech', 'audio-capture': 'audio', 'language-not-supported': 'language' };
export class VoiceError extends Error {
  constructor(code) { const known = aliases[code] || code; super(messages[known] || messages.recognition_failed); this.name = 'VoiceError'; this.code = Object.hasOwn(messages, known) ? known : 'recognition_failed'; }
}

async function defaultRuntime() {
  const { Capacitor, registerPlugin } = await import('@capacitor/core');
  if (Capacitor.isNativePlatform()) return { native: true, platform: Capacitor.getPlatform(), plugin: registerPlugin('KrokVoice') };
  return { native: false, platform: 'web', secure: globalThis.isSecureContext === true, Recognition: globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition };
}

/** Only start() requests microphone access. Callbacks receive final text, never raw audio. */
export function createVoiceInput({ onResult = () => {}, onState = () => {}, onError = () => {} } = {}, runtimeSource = defaultRuntime, { timeoutMs = 45000, stopTimeoutMs = 10000 } = {}) {
  let runtimePromise, active = null, disposed = false;
  const runtime = () => runtimePromise ||= Promise.resolve().then(() => typeof runtimeSource === 'function' ? runtimeSource() : runtimeSource);
  const phase = value => { if (!disposed) onState(value); };
  const current = session => active === session && !session.cancelled && !disposed;
  const safeError = error => new VoiceError(error?.code || error?.error || (error?.name === 'NotAllowedError' ? 'permission_denied' : 'recognition_failed'));
  const errorFor = (session, error) => { if (current(session) && error?.code !== 'cancelled' && error?.error !== 'aborted') onError(safeError(error)); };
  async function cleanup(session, abort = false) {
    clearTimeout(session.timer);
    const recognition = session.recognition;
    if (recognition) {
      recognition.onstart = recognition.onresult = recognition.onerror = recognition.onend = null;
      try { if (abort) recognition.abort(); else recognition.stop(); } catch { /* already stopped */ }
    }
    session.finish?.();
    try { await session.listener?.remove(); } catch { /* listener already removed */ }
  }
  async function finish(session, cancelNative = false) {
    if (session.closing) return session.closing;
    if (active !== session) return;
    session.cancelled = true;
    session.closing = (async () => {
      await cleanup(session, true);
      if (cancelNative && session.env?.native) {
        try { await session.env.plugin.cancel(); } catch { /* native activity may already be gone */ }
      }
      if (active === session) { active = null; phase('idle'); }
    })();
    return session.closing;
  }
  const resultFor = (session, text) => {
    if (!current(session)) return;
    const transcript = typeof text === 'string' ? text.trim().slice(0, 6000) : '';
    if (transcript) onResult(transcript);
    else errorFor(session, { code: 'no_speech' });
  };
  async function cancel() {
    const session = active;
    if (!session) return;
    await finish(session, true); // Block new capture until native cancellation has finished.
  }
  async function expire(session) {
    if (!current(session)) return;
    errorFor(session, { code: 'timeout' });
    await cancel();
  }
  async function status() {
    const env = await runtime();
    if (env.native) {
      if (env.platform !== 'android') return { supported: false, platform: env.platform };
      try { const result = await env.plugin.isAvailable(); return { supported: result.available === true, platform: env.platform }; }
      catch { return { supported: false, platform: env.platform }; }
    }
    return { supported: Boolean(env.secure && env.Recognition), platform: 'web' };
  }
  async function start() {
    if (disposed || active) return;
    const session = {};
    active = session;
    phase('starting');
    session.timer = setTimeout(() => { void expire(session); }, timeoutMs);
    try {
      const env = session.env = await runtime();
      if (!current(session)) return;
      if (env.native) {
        if (env.platform !== 'android' || !(await env.plugin.isAvailable()).available) throw new VoiceError('unsupported');
        if (!current(session)) return;
        session.listener = await env.plugin.addListener('state', event => {
          if (current(session) && ['listening', 'stopping'].includes(event.phase)) phase(event.phase);
        });
        if (!current(session)) { await session.listener.remove(); return; }
        const result = await env.plugin.start({ language: 'uk-UA' });
        resultFor(session, result?.text);
      } else {
        if (!env.secure || !env.Recognition) throw new VoiceError('unsupported');
        await new Promise(resolve => {
          session.finish = resolve;
          const recognition = session.recognition = new env.Recognition();
          recognition.lang = 'uk-UA';
          recognition.continuous = false;
          recognition.interimResults = false;
          recognition.maxAlternatives = 1;
          recognition.onstart = () => { if (current(session)) phase('listening'); };
          recognition.onresult = event => {
            if (!current(session) || session.hasResult) return;
            const text = Array.from(event.results || []).filter(item => item.isFinal).map(item => item[0]?.transcript || '').join(' ');
            if (!text.trim()) return;
            session.hasResult = true;
            resultFor(session, text);
            resolve();
          };
          recognition.onerror = event => {
            if (!current(session)) return;
            session.hasError = true;
            errorFor(session, event);
            resolve();
          };
          recognition.onend = () => {
            if (current(session) && !session.hasResult && !session.hasError) errorFor(session, { code: 'no_speech' });
            resolve();
          };
          recognition.start();
        });
      }
    } catch (error) { errorFor(session, error); }
    finally { await finish(session); }
  }
  async function stop() {
    const session = active;
    if (!session || !current(session)) return;
    phase('stopping');
    clearTimeout(session.timer);
    session.timer = setTimeout(() => { void expire(session); }, stopTimeoutMs);
    try {
      if (session.env?.native) await session.env.plugin.stop();
      else if (session.recognition) session.recognition.stop();
      else await cancel();
    } catch (error) { errorFor(session, error); await cancel(); }
  }
  return { status, start, stop, cancel, async dispose() { disposed = true; await cancel(); } };
}
