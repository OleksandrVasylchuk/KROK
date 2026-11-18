import { useState } from 'react';
import { ArrowRight, Brain, CalendarCheck, Compass, MoonStars, Sun, Wallet } from '@phosphor-icons/react';
import { localDate, weeklyMeetingDue } from './model.js';
import { suggestedScenario } from './coach-scenarios.js';
import './evolution.css';
import './coach-scenario.css';

/** Shown on Today once seven days have passed since the start or the previous meeting. */
export function WeeklyMeetingCard({ state, disabled = false }) {
  if (!weeklyMeetingDue(state)) return null;
  return <button type="button" className="weekly-meeting-card" disabled={disabled} onClick={() => window.dispatchEvent(new CustomEvent('krok:coach-scenario', { detail: { id: 'weekly' } }))}><CalendarCheck size={26} weight="light" /><span><strong>Час тижневої зустрічі з тренером</strong><small>Підсумуємо тиждень і вирішимо, що полегшити, посилити, додати чи прибрати.</small></span><ArrowRight size={20} /></button>;
}

export default function DayCycle({ state, onMemory, disabled = false }) {
  const [minutes, setMinutes] = useState(15);
  const checkIn = state.checkIns?.[localDate()];
  const suggested = suggestedScenario(state);
  function prepare(text) {
    if (disabled) return;
    window.dispatchEvent(new CustomEvent('krok:coach-prompt', { detail: { text } }));
  }
  // Scenarios ask their questions locally and send one request after the last answer.
  function scenario(id, prefill) {
    if (disabled) return;
    window.dispatchEvent(new CustomEvent('krok:coach-scenario', { detail: { id, prefill } }));
  }
  const mark = id => suggested === id ? <span className="day-cycle-suggested">зараз</span> : null;
  return <section className="day-cycle" aria-label="Мій ритм дня">
    <div className="section-heading"><h2>Підлаштуємо день під тебе</h2><button className="text-button" type="button" onClick={onMemory}><Brain size={17} /> Пам’ять</button></div>
    <div className="day-cycle-time"><label htmlFor="day-cycle-minutes">Скільки часу маєш?</label><select id="day-cycle-minutes" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{[5,10,15,20,30,45,60].map(value => <option key={value} value={value}>{value} хвилин</option>)}</select><span>{checkIn ? `Енергія: ${checkIn.energy}/5` : 'Можна розповісти про самопочуття у розмові'}</span></div>
    <div className="day-cycle-options">
      {suggested === 'intro' && <button className="is-suggested" disabled={disabled} onClick={() => scenario('intro')}><Compass size={21} /><span><strong>Знайомство за 2 хвилини{mark('intro')}</strong><small>Одна ціль і до трьох перших кроків</small></span></button>}
      <button className={suggested === 'morning' ? 'is-suggested' : ''} disabled={disabled} onClick={() => scenario('morning', { time: `${minutes} хвилин` })}><Sun size={21} /><span><strong>Ранок: обрати головне{mark('morning')}</strong><small>Три запитання — і план на день</small></span></button>
      <button className={suggested === 'evening' ? 'is-suggested' : ''} disabled={disabled} onClick={() => scenario('evening')}><MoonStars size={21} /><span><strong>Вечір: підсумок дня{mark('evening')}</strong><small>Відмітки, настрій і зміна на завтра</small></span></button>
      <button className={suggested === 'weekly' ? 'is-suggested' : ''} disabled={disabled} onClick={() => scenario('weekly')}><CalendarCheck size={21} /><span><strong>Тижнева зустріч{mark('weekly')}</strong><small>Підсумок і корекція розпорядку</small></span></button>
      <button disabled={disabled} onClick={() => prepare('Допоможи записати витрату. Я витратив ')}><Wallet size={21} /><span><strong>Записати витрату</strong><small>Назви суму й на що витратив</small></span></button>
    </div>
    <p className="evolution-hint">Ранок, вечір, тижнева зустріч і знайомство — це короткі сценарії: запитання ставить застосунок, а тренер отримує відповіді одним запитом наприкінці. Запропоновані зміни застосуються лише після твого підтвердження. «Записати витрату» готує повідомлення, яке можна змінити перед надсиланням. Доступ до квестів і прогресу вмикається окремо в тренері.</p>
  </section>;
}
