const errors = {
  unsupported: 'Озвучення недоступне на цьому пристрої. Відповідь можна прочитати в чаті.',
  language: 'Додай український голос у налаштуваннях озвучення пристрою. Відповідь залишається в чаті.',
  blocked: 'Браузер не дозволив озвучення. Натисни «Озвучити відповідь» або продовжуй текстом.',
  timeout: 'Озвучення зупинилося за часом. Відповідь залишається в чаті.',
  failed: 'Не вдалося озвучити відповідь. Спробуй ще раз або прочитай її в чаті.',
};
export class VoiceOutputError extends Error {
  constructor(code = 'failed') { super(errors[code] || errors.failed); this.name = 'VoiceOutputError'; this.code = Object.hasOwn(errors, code) ? code : 'failed'; }
}
export function spokenText(text) {
  return typeof text === 'string' ? text.replace(/```[\s\S]*?```/g, ' ').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/[#*_`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 6000) : '';
}
async function defaultRuntime() {
  const { Capacitor, registerPlugin } = await import('@capacitor/core');
  return Capacitor.isNativePlatform() ? { native: true, platform: Capacitor.getPlatform(), plugin: registerPlugin('KrokSpeech') }
    : { native: false, synthesis: globalThis.speechSynthesis, Utterance: globalThis.SpeechSynthesisUtterance };
}

/** Device TTS only; no audio is requested from the KROK or OpenAI API. */
export function createVoiceOutput({ onState = () => {} } = {}, runtimeSource = defaultRuntime, { timeoutMs = 180000 } = {}) {
  let runtimePromise, current = null, disposed = false;
  const runtime = () => runtimePromise ||= Promise.resolve().then(() => typeof runtimeSource === 'function' ? runtimeSource() : runtimeSource);
  const state = value => { if (!disposed) onState(value); };
  async function status() {
    const env = await runtime();
    if (env.native) {
      if (env.platform !== 'android') return { supported: false };
      try { const result = await env.plugin.isAvailable(); return { supported: result.available === true, languageAvailable: result.languageAvailable === true }; }
      catch { return { supported: false }; }
    }
    const voices = env.synthesis?.getVoices?.() || [];
    return { supported: Boolean(env.synthesis && env.Utterance), languageAvailable: voices.length ? voices.some(voice => /^uk(?:[-_]|$)/i.test(voice.lang)) : null };
  }
  async function cancel() {
    const session = current;
    if (!session) return;
    if (session.closing) return session.closing;
    session.cancelled = true;
    session.closing = (async () => {
      clearTimeout(session.timer);
      if (session.utterance) session.utterance.onstart = session.utterance.onend = session.utterance.onerror = null;
      try {
        if (session.env?.native) await session.env.plugin.stop();
        else session.env?.synthesis?.cancel();
      } catch { /* activity or browser may already be closed */ }
      session.resolve?.({ completed: false, cancelled: true });
      if (current === session) { current = null; state('idle'); }
    })();
    return session.closing;
  }
  async function speak(text) {
    if (disposed) return { completed: false, cancelled: true };
    await cancel();
    if (disposed) return { completed: false, cancelled: true };
    const value = spokenText(text);
    if (!value) return { completed: true };
    const session = { cancelled: false };
    current = session; state('starting');
    try {
      const env = session.env = await runtime();
      if (disposed || current !== session || session.cancelled) return { completed: false, cancelled: true };
      return await new Promise((resolve, reject) => {
        session.resolve = resolve;
        const active = () => current === session && !disposed && !session.cancelled;
        const finish = (error, result = { completed: true }) => {
          if (!active()) return;
          clearTimeout(session.timer);
          if (session.utterance) session.utterance.onstart = session.utterance.onend = session.utterance.onerror = null;
          current = null; state('idle');
          if (error) reject(error); else resolve(result);
        };
        session.timer = setTimeout(() => {
          if (!active()) return;
          finish(new VoiceOutputError('timeout'));
          if (env.native) void env.plugin.stop().catch(() => {}); else env.synthesis?.cancel();
        }, timeoutMs);
        if (env.native) {
          if (env.platform !== 'android') { finish(new VoiceOutputError('unsupported')); return; }
          state('speaking');
          env.plugin.speak({ text: value, language: 'uk-UA' }).then(result => finish(null, { completed: result.completed === true, cancelled: result.completed !== true })).catch(error => finish(new VoiceOutputError(error?.code)));
          return;
        }
        if (!env.synthesis || !env.Utterance) { finish(new VoiceOutputError('unsupported')); return; }
        const voices = env.synthesis.getVoices?.() || [];
        const voice = voices.find(item => /^uk(?:[-_]|$)/i.test(item.lang));
        if (voices.length && !voice) { finish(new VoiceOutputError('language')); return; }
        const utterance = session.utterance = new env.Utterance(value);
        utterance.lang = 'uk-UA'; utterance.rate = 1; utterance.pitch = 1;
        if (voice) utterance.voice = voice;
        utterance.onstart = () => { if (active()) state('speaking'); };
        utterance.onend = () => finish();
        utterance.onerror = event => finish(new VoiceOutputError(event.error === 'not-allowed' ? 'blocked' : event.error === 'language-unavailable' || event.error === 'voice-unavailable' ? 'language' : 'failed'));
        try { env.synthesis.speak(utterance); } catch { finish(new VoiceOutputError('failed')); }
      });
    } finally {
      if (current === session) { clearTimeout(session.timer); current = null; state('idle'); }
    }
  }
  return { status, speak, cancel, async dispose() { disposed = true; await cancel(); } };
}
