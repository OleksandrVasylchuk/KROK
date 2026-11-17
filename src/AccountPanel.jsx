import { useState, useSyncExternalStore } from 'react';
import { getAuthSnapshot, subscribeAuth, signIn, signUp, signInGoogle, sendPasswordReset, updatePassword, signOut, retryAuth, continueLocally } from './auth-client.js';
import './account.css';
export default function AccountPanel({ disabled = false }) {
  const auth=useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
  const [mode,setMode]=useState('signin');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [busy,setBusy]=useState(false);
  const [notice,setNotice]=useState('');
  const [error,setError]=useState('');
  async function action(callback) {if(busy)return;if(disabled){setError('Спочатку віднови збереження або експортуй прогрес. Перемикання акаунта тимчасово вимкнено.');return;}setBusy(true);setError('');setNotice('');try{await callback();}catch(cause){setError(cause.message||'Не вдалося виконати запит.');}finally{setPassword('');setBusy(false);}}
  function submit(event){event.preventDefault();action(async()=>{
    if(auth.recovery){await updatePassword(password);setNotice('Пароль оновлено.');}
    else if(mode==='signup'){const result=await signUp(email,password);setNotice(result.confirmationRequired?'Перевір пошту: якщо реєстрація доступна, надійде лист для підтвердження. Відкрий його на цьому пристрої.':'Акаунт створено.');}
    else if(mode==='reset'){await sendPasswordReset(email);setNotice('Якщо акаунт із такою поштою існує, надійде лист для відновлення. Відкрий його на цьому пристрої.');}
    else await signIn(email,password);
  });}
  if(auth.phase==='error'&&auth.configured)return <section className="account-panel" aria-label="Акаунт КРОК"><h2>Відновимо підключення</h2><p>Не вдалося перевірити сесію акаунта. Його записи не змінено.</p><button className="button button-primary" disabled={busy} onClick={()=>action(retryAuth)}>Спробувати ще раз</button><button className="account-link" disabled={busy} onClick={continueLocally}>Продовжити з локальним профілем</button>{error&&<p role="alert">{error}</p>}</section>;
  return <section className="account-panel" aria-label="Акаунт КРОК">
    <span className="eyebrow">ТВІЙ ПРОСТІР</span><h2>{auth.recovery?'Новий пароль':auth.user?'Твій акаунт':'Увійти до КРОК'}</h2>
    {!auth.configured?<><p>Google і реєстрація поштою готові до підключення. Спочатку власнику застосунку потрібно налаштувати Supabase.</p><div className="account-setup"><strong>Що потрібно для активації</strong><ol><li>Створити проєкт Supabase.</li><li>Налаштувати Email та Google у розділі Authentication.</li><li>На комп’ютері відкрити SETUP-ACCOUNTS.cmd і додати URL проєкту та публічний publishable key.</li></ol><p>Google client secret вводиться тільки в панелі Supabase. Не надсилай його в чат.</p></div><button type="button" className="button button-ghost" disabled={busy} onClick={()=>action(retryAuth)}>Перевірити підключення</button><p className="account-note">Поки можна працювати локально. Особисті дані залишаються на цьому пристрої.</p></>
    :auth.user&&!auth.recovery?<><p className="account-email">{auth.user.email}</p><p>Цей акаунт має окремий прогрес на цьому пристрої. Попередній локальний профіль збережений окремо; його дані не додаються до акаунта автоматично.</p><p className="account-note">Хмарна синхронізація прогресу ще не ввімкнена. Вхід на іншому пристрої сам по собі не переносить записи.</p><button type="button" className="button button-ghost" disabled={busy} onClick={()=>action(signOut)}>Вийти й відкрити локальний профіль</button></>
    :<>{!auth.recovery&&<><div className="account-tabs" role="group" aria-label="Спосіб входу"><button type="button" aria-pressed={mode==='signin'} disabled={busy} onClick={()=>{setMode('signin');setError('');setNotice('');}}>Вхід</button><button type="button" aria-pressed={mode==='signup'} disabled={busy} onClick={()=>{setMode('signup');setError('');setNotice('');}}>Реєстрація</button></div>{auth.googleEnabled&&<button type="button" className="account-google" disabled={busy} onClick={()=>action(signInGoogle)}><span aria-hidden="true">G</span> Продовжити з Google</button>}<p className="account-divider">або через електронну пошту</p></>}
      <form onSubmit={submit}><fieldset disabled={busy}>
        {!auth.recovery&&<label className="field">Електронна пошта<input type="email" autoComplete="email" required value={email} maxLength={254} onChange={event=>setEmail(event.target.value)}/></label>}
        {(mode!=='reset'||auth.recovery)&&<label className="field">{mode==='signup'||auth.recovery?'Пароль — від 10 символів':'Пароль'}<input type="password" autoComplete={mode==='signup'||auth.recovery?'new-password':'current-password'} required minLength={mode==='signup'||auth.recovery?10:1} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)}/></label>}
        <button type="submit" className="button button-primary">{busy?'Зачекай…':auth.recovery?'Зберегти новий пароль':mode==='signup'?'Створити акаунт':mode==='reset'?'Надіслати лист відновлення':'Увійти'}</button>
      </fieldset></form>
      {!auth.recovery&&<button type="button" className="account-link" disabled={busy} onClick={()=>{setMode(mode==='reset'?'signin':'reset');setError('');setNotice('');}}>{mode==='reset'?'Повернутися до входу':'Забув пароль?'}</button>}
      <p className="account-note">Вхід відкриє окремий профіль цього акаунта. Поточний локальний прогрес збережеться. Реєстрація та сесія обробляються Supabase.</p>
    </>}
    {error&&<p className="account-error" role="alert">{error}</p>}{notice&&<p className="account-notice" role="status">{notice}</p>}{auth.notice&&<p className="account-note">{auth.notice}</p>}
  </section>;
}
