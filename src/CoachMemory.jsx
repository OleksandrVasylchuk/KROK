import { useState } from 'react';
import { CATEGORIES } from './model.js';
import { containsMemorySecret } from './coach-personal.js';
import { PencilSimple, Trash, Check } from '@phosphor-icons/react';
import './evolution.css';

export default function CoachMemory({ state, dispatch, disabled = false }) {
  const memories = state.coachMemory || [];
  const [editing, setEditing] = useState(null);
  const [text, setText] = useState('');
  const [category, setCategory] = useState('growth');
  const [remove, setRemove] = useState(null);
  const [message, setMessage] = useState('');
  function save(event) {
    event.preventDefault();
    if (disabled || !text.trim()) return;
    if (containsMemorySecret(text)) { setMessage('Паролі та секретні ключі не можна зберігати в пам’яті тренера.'); return; }
    const cleanText = text.trim().replace(/[\u0000-\u001f]+/g, ' ');
    if (memories.some(item => item.id !== editing && item.text.toLocaleLowerCase('uk') === cleanText.toLocaleLowerCase('uk'))) { setMessage('Цей факт уже є в пам’яті.'); return; }
    if (!editing && memories.length >= 50) { setMessage('Збережено 50 фактів. Відредагуй або видали зайве.'); return; }
    dispatch({ type: 'UPSERT_COACH_MEMORY', memory: { ...(editing ? { id: editing } : {}), text: cleanText, category } });
    setText(''); setEditing(null); setMessage('Факт збережено.');
  }
  return <section className="coach-memory form-stack" aria-label="Пам’ять тренера">
    <p>Збережи те, що допоможе тренеру враховувати твій ритм: зручний час, уподобання, важливі обмеження. Ти керуєш кожним фактом.</p>
    <label className="evolution-consent"><input type="checkbox" checked={state.profile.coachMemoryConsent === true} disabled={disabled} onChange={e => dispatch({ type: 'UPDATE_PROFILE', profile: { coachMemoryConsent: e.target.checked } })} /><span>Додавати ці факти до моїх запитів тренеру</span></label>
    <p className="evolution-hint">Після ввімкнення факти передаються ШІ разом із новими запитами. Видалення тут прибирає їх із наступних запитів; уже надіслані повідомлення залишаються в історії розмови.</p>
    <label className="evolution-consent"><input type="checkbox" checked={state.profile.coachJournalConsent === true} disabled={disabled} onChange={e => dispatch({ type: 'UPDATE_PROFILE', profile: { coachJournalConsent: e.target.checked } })} /><span>Враховувати настрій, енергію й нотатки за останні 7 днів</span></label>
    <p className="evolution-hint">Це окремий дозвіл передавати записи щоденника для плану та підсумків.</p>
    <form className="form-stack" onSubmit={save}>
      <label className="field">{editing ? 'Редагувати факт' : 'Що варто пам’ятати?'}<textarea required maxLength={300} rows={3} value={text} disabled={disabled} onChange={e => { setText(e.target.value); setMessage(''); }} placeholder="Наприклад: у будні маю 15 хвилин після роботи" /></label>
      <label className="field">Напрям<select value={category} disabled={disabled} onChange={e => setCategory(e.target.value)}>{CATEGORIES.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
      <div className="evolution-actions"><button className="button button-primary" disabled={disabled || !text.trim()}><Check size={17} />{editing ? 'Зберегти зміни' : 'Запам’ятати'}</button>{editing && <button className="button button-ghost" type="button" onClick={() => { setEditing(null); setText(''); }}>Скасувати</button>}</div>
    </form>
    <p className="evolution-hint">{memories.length} / 50 фактів. Можна також сказати тренеру «Запам’ятай…» — він покаже пропозицію для підтвердження.</p>
    <div className="memory-list">{memories.map(item => <article className="memory-item" key={item.id}>
      <div><small>{CATEGORIES.find(c => c.id === item.category)?.label || 'Про мене'}</small><p>{item.text}</p></div>
      <button type="button" className="icon-button" aria-label={`Редагувати факт: ${item.text}`} disabled={disabled} onClick={() => { setEditing(item.id); setText(item.text); setCategory(item.category); setRemove(null); }}><PencilSimple size={18} /></button>
      <button type="button" className="icon-button" aria-label={`Видалити факт: ${item.text}`} disabled={disabled} onClick={() => setRemove(item.id)}><Trash size={18} /></button>
      {remove === item.id && <div className="memory-remove"><span>Прибрати цей факт?</span><button type="button" className="button button-ghost" disabled={disabled} onClick={() => { dispatch({ type: 'DELETE_COACH_MEMORY', id: item.id }); setRemove(null); if (editing === item.id) { setEditing(null); setText(''); } setMessage('Факт видалено.'); }}>Видалити</button><button className="text-button" type="button" onClick={() => setRemove(null)}>Залишити</button></div>}
    </article>)}</div>
    {message && <p role="status">{message}</p>}
  </section>;
}
