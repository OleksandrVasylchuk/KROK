import { useState } from 'react';
import { Brain, Compass, MoonStars, Sun, TrendUp, Wallet } from '@phosphor-icons/react';
import { localDate } from './model.js';
import { suggestedScenario } from './coach-scenarios.js';
import './evolution.css';
import './coach-scenario.css';

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
      <button disabled={disabled} onClick={() => prepare('Підсумуй останні 7 днів за доступними й дозволеними записами. Відокрем факти від припущень: що вдалося, що повторюється, що заважає. Якщо даних немає, скажи про це. Запропонуй одну посильну зміну на наступний тиждень.')}><TrendUp size={21} /><span><strong>Мій тиждень</strong><small>Побачити прогрес і перешкоди</small></span></button>
      <button disabled={disabled} onClick={() => prepare('Допоможи записати витрату. Я витратив ')}><Wallet size={21} /><span><strong>Записати витрату</strong><small>Назви суму й на що витратив</small></span></button>
    </div>
    <p className="evolution-hint">Ранок, вечір і знайомство — це короткі сценарії: запитання ставить застосунок, а тренер отримує відповіді одним запитом наприкінці. Запропоновані зміни застосуються лише після твого підтвердження. «Мій тиждень» і «Записати витрату» готують повідомлення, яке можна змінити перед надсиланням. Доступ до квестів і прогресу вмикається окремо в тренері.</p>
  </section>;
}
