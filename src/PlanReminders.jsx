import { useEffect, useRef, useState } from 'react';
import { Bell, Clock, X } from '@phosphor-icons/react';
import { DEFAULT_PLAN_SETTINGS, buildPlanReminders, planReminders } from './plan-reminders.js';
import { localDate } from './model.js';
import './plan-reminders.css';

export default function PlanReminders({ state, scope, disabled = false }) {
  const [settings,setSettings]=useState(()=>({...DEFAULT_PLAN_SETTINGS,items:{},snoozes:{},skips:{}}));
  const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  const mounted=useRef(false),currentScope=useRef(scope),stateRef=useRef(state);
  currentScope.current=scope; stateRef.current=state;
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;};},[]);
  useEffect(()=>{let active=true;setError('');setNotice('');setStatus(null);planReminders.status(scope,stateRef.current).then(value=>{if(active){setStatus(value);setSettings(value.settings);}}).catch(cause=>{if(active)setError(cause.message);});return()=>{active=false;};},[scope]);
  const preview=(()=>{try{return buildPlanReminders(state,scope,settings);}catch{return null;}})();
  const today=localDate();
  const items=[...(state.quests||[]).filter(item=>!item.archived).map(item=>({...item,kind:'quest'})),...(state.habits||[]).filter(item=>!item.archived).map(item=>({...item,kind:'habit'}))];
  async function act(operation) {
    if(disabled||busy)return; const requestedScope=scope;setBusy(true);setError('');setNotice('');
    try{let result=await operation();if(result.cancelled&&result.saved)result=await planReminders.status(requestedScope,stateRef.current);if(!mounted.current||requestedScope!==currentScope.current)return;if(result.cancelled){setNotice('Операцію скасовано через зміну стану. Повтори, якщо потрібно.');return;}setStatus(result);setSettings(result.settings);setNotice(result.supported?(result.enabled?'Розклад перевірено в Android.':'Нагадування вимкнено.'):'Час збережено. У браузері фонові сповіщення не надсилаються.');}
    catch(cause){if(mounted.current&&requestedScope===currentScope.current)setError(cause.message||'Не вдалося оновити нагадування.');}
    finally{if(mounted.current)setBusy(false);}
  }
  const change=(key,value)=>setSettings(current=>({...current,[key]:value}));
  const changeItem=(key,update)=>setSettings(current=>({...current,items:{...current.items,[key]:{...current.items[key],...update}}}));
  return <section className="plan-reminders" aria-label="Нагадування про справи">
    <div className="plan-reminders-intro"><Bell size={25}/><div><h2>Кожна справа — у свій час</h2><p>Окремі нагадування про квести й звички. Виконані справи забираються з розкладу після збереження в КРОК.</p></div></div>
    <p className="plan-reminders-note">Android планує найближчі 7 календарних днів, до 64 сповіщень. Відкривай КРОК, щоб оновити наступні дні. Час орієнтовний і залежить від налаштувань енергозбереження.</p>
    <p className="plan-reminders-note">У сповіщенні Android є три кнопки: «Зробив», «Через 30 хв» і «Сьогодні пропускаю». Кнопка відкриває КРОК і застосовує відповідь; пропуск не відмічає справу виконаною.</p>
    {status&&!status.supported&&<p className="plan-reminders-note">Тут можна зберегти час і переглянути план. Доставка у фоні доступна в Android-застосунку.</p>}
    {status?.supported&&<p role="status">{status.enabled?`Увімкнено · Android підтвердив ${status.pending} нагадувань`:'Нагадування вимкнено або бракує дозволу'}</p>}
    <fieldset disabled={disabled||busy}><legend>Зручний час</legend><div className="plan-reminders-times">{[['questTime','Квести'],['morning','Ранкові звички'],['day','Денні звички'],['evening','Вечірні звички'],['any','Звички без часу'],['quietStart','Тихі години: з'],['quietEnd','Тихі години: до']].map(([key,label])=><label key={key}>{label}<input type="time" value={settings[key]} onChange={event=>change(key,event.target.value)}/></label>)}</div><p>Однаковий початок і кінець вимикають тихі години. Обраний час справ має бути поза ними.</p></fieldset>
    <details className="plan-reminders-items"><summary>Налаштувати окремі справи ({items.length})</summary><fieldset disabled={disabled||busy}>{items.map(item=>{const key=item.kind+':'+item.id,override=settings.items[key]||{};return <div className="plan-reminder-item" key={key}><label><input type="checkbox" checked={!override.disabled} onChange={event=>changeItem(key,{disabled:!event.target.checked})}/><span>{item.title}<small>{item.kind==='quest'?'Квест':'Звичка'}</small></span></label><label><span className="v-sr-only">Час для {item.title}</span><input type="time" value={override.time||''} disabled={override.disabled} onChange={event=>changeItem(key,{time:event.target.value})}/></label>{override.time&&<button type="button" className="icon-button" aria-label={`Загальний час для ${item.title}`} onClick={()=>changeItem(key,{time:''})}><X size={15}/></button>}</div>;})}</fieldset></details>
    <div className="plan-reminders-actions"><button type="button" className="button button-primary" disabled={disabled||busy||!status} onClick={()=>act(()=>planReminders.enable(state,scope,settings))}>{busy?'Оновлюємо…':status?.supported?'Увімкнути / оновити розклад':'Зберегти час'}</button><button type="button" className="button button-ghost" disabled={disabled||busy} onClick={()=>act(()=>planReminders.disable(scope))}>Вимкнути</button></div>
    {error&&<p className="plan-reminders-error" role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}
    <div className="plan-reminders-preview"><h3>Найближчі нагадування</h3>{preview?<><p>{preview.notifications.length} у плані{preview.omitted?` · ще ${preview.omitted} не вмістилися в ліміт` : ''}. {status?.supported?'Натисни оновлення, щоб застосувати змінений час.':'Це попередній перегляд.'}</p>{preview.notifications.length===0&&<p>На цей період немає незавершених справ із майбутнім часом.</p>}<ol>{preview.notifications.slice(0,12).map(item=><li key={item.id}><Clock size={16}/><div><strong>{item.body}</strong><time dateTime={item.schedule.at.toISOString()}>{item.schedule.at.toLocaleString('uk-UA',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}</time></div>{status?.enabled&&<span className="plan-reminders-row-actions"><button type="button" disabled={disabled||busy} onClick={()=>act(()=>planReminders.snooze(state,scope,item.extra.kind,item.extra.itemId,item.extra.occurrenceDate))}>+30 хв</button>{item.extra.occurrenceDate===today&&<button type="button" disabled={disabled||busy} onClick={()=>act(()=>planReminders.skip(state,scope,item.extra.kind,item.extra.itemId,item.extra.occurrenceDate))}>Пропустити сьогодні</button>}</span>}</li>)}</ol>{preview.notifications.length>12&&<p>Показано перші 12 із {preview.notifications.length}.</p>}</>:<p>Перевір час і тихі години, щоб побачити план.</p>}</div>
  </section>;
}
