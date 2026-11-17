import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, Bell, BellSlash, Check, Clock, DeviceMobile, ShieldCheck } from '@phosphor-icons/react';
import { DEFAULT_REMINDER_TIME, disableDailyReminder, enableDailyReminder, getReminderStatus, saveReminderTime } from './reminders.js';
import './device-settings.css';

export default function DeviceSettings({ onClose, notify, remaining = 0, onInstall }) {
  const [status, setStatus] = useState(null);
  const [time, setTime] = useState(DEFAULT_REMINDER_TIME);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const alive = useRef(false);
  const locked = useRef(false);
  const request = useRef(0);

  const refresh = useCallback(async (replaceTime = false) => {
    const id = ++request.current;
    const next = await getReminderStatus();
    if (!alive.current || id !== request.current) return;
    setStatus(next);
    if (replaceTime) setTime(next.time);
    return next;
  }, []);

  useEffect(() => {
    alive.current = true;
    refresh(true).catch(() => { if (alive.current) setError('Не вдалося перевірити нагадування. Спробуй ще раз.'); });
    const recheck = () => {
      if (!locked.current && document.visibilityState === 'visible') refresh().catch(() => { if (alive.current) setError('Не вдалося оновити стан нагадування.'); });
    };
    document.addEventListener('visibilitychange', recheck);
    window.addEventListener('focus', recheck);
    return () => { alive.current = false; request.current++; document.removeEventListener('visibilitychange', recheck); window.removeEventListener('focus', recheck); };
  }, [refresh]);

  async function run(operation, success) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await operation();
      if (alive.current) { setStatus(next); setTime(next.time); setMessage(success); }
      notify?.(success);
    } catch (failure) {
      if (alive.current) setError(failure.userMessage || (status?.supported ? 'Не вдалося змінити нагадування. Перевір дозволи Android і спробуй ще раз.' : 'Не вдалося зберегти час у браузері. Перевір доступ до сховища й спробуй ще раз.'));
      try { await refresh(); } catch { /* Preserve the action error instead of reporting a guessed state. */ }
    } finally {
      locked.current = false;
      if (alive.current) setBusy(false);
    }
  }

  const enabled = status?.enabled;
  const denied = status?.permission === 'denied' || status?.channelBlocked;
  return <div className="device-settings">
    <div className={`device-reminder-preview ${enabled ? 'is-enabled' : ''}`}>
      <span className="device-reminder-icon">{enabled ? <Bell size={25} weight="light" /> : <BellSlash size={25} weight="light" />}</span>
      <div><span className="eyebrow">ОДИН МАЛЕНЬКИЙ КРОК</span><h3>{!status ? 'Перевіряємо налаштування…' : enabled ? `Щодня близько ${status.time}` : status.supported ? 'Нагадування вимкнено' : 'Твій ритм. Твій час.'}</h3><p>{remaining > 0 ? `Сьогодні залишилося квестів: ${remaining}.` : 'Повертайся до свого плану у зручний момент.'}</p></div>
      {enabled && <Check className="device-enabled-check" size={17} weight="bold" />}
    </div>

    {status && <>
      {!status.supported && <div className="device-browser-note"><DeviceMobile size={22} weight="light" /><p>Фонові нагадування працюють в Android-застосунку. У браузері можна зберегти бажаний час; сповіщення тут не надсилатимуться.</p></div>}
      {denied && <p className="device-permission-note">Android не дозволяє сповіщення. У налаштуваннях телефона відкрий «Застосунки → КРОК → Сповіщення» й надай дозвіл.</p>}
      {status.supported && status.savedEnabled && !status.scheduled && !denied && <p className="device-permission-note">Android не має активного нагадування. Увімкни його ще раз.</p>}
      <form className="device-reminder-form" onSubmit={event => {
        event.preventDefault();
        run(() => status.supported ? enableDailyReminder(time) : saveReminderTime(time), status.supported ? 'Щоденне нагадування налаштовано' : 'Бажаний час збережено');
      }}>
        <label className="device-time-label" htmlFor="daily-reminder-time"><span><Clock size={18} weight="light" /> Час для себе</span><input id="daily-reminder-time" type="time" step="60" required value={time} disabled={busy} onChange={event => { setTime(event.target.value); setMessage(''); }} /></label>
        <p className="device-time-note">{status.supported ? 'Місцевий час телефона. Android може доставити нагадування пізніше через режим енергозбереження.' : 'Обери час, у який тобі зручно робити щоденний крок.'}</p>
        <div className="device-reminder-actions">
          <button type="submit" className="button button-primary" disabled={busy || !time}>{busy ? 'Зберігаємо…' : status.supported ? enabled ? 'Оновити час' : 'Увімкнути нагадування' : 'Зберегти час'}{!busy && <span className="button-circle"><ArrowRight size={17} /></span>}</button>
          {status.supported && (status.scheduled || status.savedEnabled) && <button type="button" className="button button-ghost" disabled={busy} onClick={() => run(disableDailyReminder, 'Нагадування вимкнено')}>Вимкнути</button>}
        </div>
      </form>
      {status.storageWarning && <p className="device-permission-note">{status.storageWarning}</p>}
      {!status.supported && onInstall && <button type="button" className="device-install-link" onClick={onInstall}><DeviceMobile size={17} /> Додати КРОК на головний екран <ArrowRight size={14} /></button>}
    </>}

    {error && <p className="device-error" role="alert">{error}</p>}
    {message && <p className="device-success" role="status"><Check size={15} />{message}</p>}
    {!status && error && <button type="button" className="button button-ghost" onClick={() => { setError(''); refresh(true).catch(() => { if (alive.current) setError('Не вдалося перевірити нагадування. Спробуй пізніше.'); }); }}>Спробувати ще раз</button>}
    <div className="device-settings-footer"><span><ShieldCheck size={15} weight="light" />{status?.supported ? 'Нагадування зберігається на телефоні' : 'Налаштування зберігаються на пристрої'}</span>{onClose && <button type="button" className="text-button" onClick={onClose}>Готово</button>}</div>
  </div>;
}
