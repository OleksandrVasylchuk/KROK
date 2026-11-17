import { useState } from 'react';
import { Brain, MoonStars, Sun, TrendUp, Wallet } from '@phosphor-icons/react';
import { localDate } from './model.js';
import './evolution.css';

export default function DayCycle({ state, onMemory, disabled = false }) {
  const [minutes, setMinutes] = useState(15);
  const checkIn = state.checkIns?.[localDate()];
  function prepare(text) {
    if (disabled) return;
    window.dispatchEvent(new CustomEvent('krok:coach-prompt', { detail: { text } }));
  }
  return <section className="day-cycle" aria-label="Мій ритм дня">
    <div className="section-heading"><h2>Підлаштуємо день під тебе</h2><button className="text-button" type="button" onClick={onMemory}><Brain size={17} /> Пам’ять</button></div>
    <div className="day-cycle-time"><label htmlFor="day-cycle-minutes">Скільки часу маєш?</label><select id="day-cycle-minutes" value={minutes} onChange={e => setMinutes(Number(e.target.value))}>{[5,10,15,20,30,45,60].map(value => <option key={value} value={value}>{value} хвилин</option>)}</select><span>{checkIn ? `Енергія: ${checkIn.energy}/5` : 'Можна розповісти про самопочуття у розмові'}</span></div>
    <div className="day-cycle-options">
      <button disabled={disabled} onClick={() => prepare(`Допоможи скласти посильний план на сьогодні у межах ${minutes} хвилин. Спочатку врахуй, що вже є у моєму плані, мої дозволені спогади та самопочуття, якщо я їх надав. Якщо бракує важливої інформації, постав одне коротке питання. Запропонуй до трьох конкретних справ. Не дублюй наявні квести й не підвищуй фізичне навантаження автоматично.`)}><Sun size={21} /><span><strong>План на сьогодні</strong><small>Кілька посильних кроків</small></span></button>
      <button disabled={disabled} onClick={() => prepare('Хочу підбити підсумок дня. Запитай коротко, що вдалося, що завадило і як я почуваюся. Після моєї відповіді запропонуй потрібні відмітки виконання та запис настрою/енергії для підтвердження. Не позначай справи зробленими без моїх слів. Потім допоможи спростити план на завтра.')}><MoonStars size={21} /><span><strong>Підсумок дня</strong><small>Розкажи, як усе минуло</small></span></button>
      <button disabled={disabled} onClick={() => prepare('Підсумуй останні 7 днів за доступними й дозволеними записами. Відокрем факти від припущень: що вдалося, що повторюється, що заважає. Якщо даних немає, скажи про це. Запропонуй одну посильну зміну на наступний тиждень.')}><TrendUp size={21} /><span><strong>Мій тиждень</strong><small>Побачити прогрес і перешкоди</small></span></button>
      <button disabled={disabled} onClick={() => prepare('Допоможи записати витрату. Я витратив ')}><Wallet size={21} /><span><strong>Записати витрату</strong><small>Назви суму й на що витратив</small></span></button>
    </div>
    <p className="evolution-hint">Кнопка готує повідомлення у розмові. Перед надсиланням можеш його змінити. Доступ до квестів і прогресу вмикається окремо в тренері.</p>
  </section>;
}
