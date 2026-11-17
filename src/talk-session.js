/** Explicitly started, bounded turn-taking. Never applies proposed actions. */
export function createTalkSession({ listen, cancelListening, speak, cancelSpeaking, submit, cancelRequest = () => {}, onTranscript = () => {}, onPhase = () => {}, onError = () => {} }, { maxTurns = 10, maxDurationMs = 600000 } = {}) {
  let active = false, generation = 0, phase = 'idle', turns = 0, timer, closing;
  const setPhase = value => { phase = value; onPhase(value); };
  const current = token => active && generation === token;
  function pause(error) {
    if (!active) return;
    setPhase('paused');
    void cancelListening();
    if (error) onError(error);
  }
  function capture(token) {
    if (!current(token)) return;
    setPhase('listening');
    Promise.resolve().then(() => current(token) ? listen() : undefined).then(() => {
      if (current(token) && phase === 'listening') pause(new Error('Не почули слів. Натисни «Продовжити розмову», коли будеш готовий.'));
    }).catch(error => { if (current(token)) pause(error); });
  }
  async function stop() {
    active = false; generation++; clearTimeout(timer); setPhase('idle');
    cancelRequest();
    closing = Promise.allSettled([cancelListening(), cancelSpeaking()]);
    await closing;
  }
  async function start() {
    if (active) return;
    const token = ++generation;
    active = true; turns = 0; setPhase('starting');
    await closing;
    if (!current(token)) return;
    timer = setTimeout(() => { if (current(token)) { void stop(); onError(new Error('Розмову завершено через 10 хвилин. Можеш почати нову, коли захочеш.')); } }, maxDurationMs);
    capture(token);
  }
  async function receive(text) {
    if (!active || phase !== 'listening' || typeof text !== 'string' || !text.trim()) return false;
    const token = generation;
    setPhase('thinking'); onTranscript(text);
    try {
      await cancelListening();
      if (!current(token)) return false;
      const reply = await submit(text);
      if (!current(token)) return false;
      turns++;
      setPhase('speaking');
      const result = await speak(reply.text);
      if (!current(token)) return false;
      if (!result?.completed) { pause(new Error('Озвучення зупинено. Натисни «Продовжити розмову» або завершуй.')); return true; }
      if (turns >= maxTurns) { await stop(); onError(new Error('Завершено 10 реплік. Можеш почати нову розмову.')); }
      else if (reply.actions?.length) setPhase('review');
      else capture(token);
      return true;
    } catch (error) { if (current(token)) pause(error); return false; }
  }
  function resume() { if (active && ['paused','review'].includes(phase)) capture(generation); }
  return { start, stop, receive, resume, fail: pause, isActive: () => active, getPhase: () => phase };
}
