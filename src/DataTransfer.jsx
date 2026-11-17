import { useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Check, WarningCircle } from '@phosphor-icons/react';
import { createInitialState, selectStats } from './model.js';
import { exportBackup, validateBackup } from './persistence.js';

export default function DataTransfer({ state, onRestore, notify, blocked = false }) {
  const [pending, setPending] = useState(null);
  const [isReset, setIsReset] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef(false);
  async function download() {
    if (operation.current) return;
    operation.current = true;
    setBusy(true); setError('');
    const result = await exportBackup(state);
    if (result.status === 'downloaded') notify('Копію даних завантажено');
    if (result.status === 'shared') notify('Копію даних передано');
    if (result.status === 'failed') setError(result.error || 'Не вдалося зберегти копію.');
    setBusy(false);
    operation.current = false;
  }
  async function pick(event) {
    const file = event.target.files?.[0]; event.target.value = '';
    if (!file) return;
    if (operation.current) return;
    operation.current = true; setBusy(true);
    setError(''); setPending(null); setIsReset(false);
    try {
      if (file.size > 8_000_000) throw new Error('Обери JSON-копію КРОК до 8 МБ.');
      setPending(validateBackup(await file.text()));
    }
    catch (problem) { setError(problem.message || 'Не вдалося прочитати копію.'); }
    finally { operation.current = false; setBusy(false); }
  }
  async function restore() {
    if (!pending || operation.current) return;
    operation.current = true;
    setBusy(true); setError('');
    if (await onRestore(pending)) {
      notify(isReset ? 'Починаємо новий шлях' : 'Твій прогрес відновлено');
      setPending(null);
    } else setError('Не вдалося записати копію на пристрій. Поточні дані не замінено.');
    setBusy(false);
    operation.current = false;
  }
  return <section className="data-transfer" aria-label="Перенесення даних"><span className="eyebrow">ТВІЙ ПРОГРЕС З ТОБОЮ</span><p>Перенось прогрес між Android і браузером через файл. Автоматичної синхронізації поки немає.</p><div className="data-actions"><button type="button" disabled={busy} className="button button-ghost" onClick={download}><ArrowDown size={16} /> Зберегти копію</button><label className={`button button-ghost upload-button ${busy ? 'is-disabled' : ''}`}><ArrowUp size={16} /> Відновити<input aria-label="Відновити копію даних" type="file" accept="application/json,.json" onChange={pick} disabled={busy} /></label></div>
    {pending && <div className="restore-confirm"><WarningCircle size={24} weight="light" /><h3>{isReset ? 'Почати з чистого аркуша?' : 'Замінити поточний прогрес?'}</h3><p>{isReset ? 'Збереження буде замінено новим профілем без виконаних квестів.' : `У копії: ${pending.profile.name}, ${selectStats(pending).totalXp} XP, ${pending.quests.length} квестів. Поточні дані буде замінено. За потреби спочатку збережи їхню копію.`}</p><div><button className="button button-primary" disabled={busy} onClick={restore}><Check size={16} /> {isReset ? 'Почати заново' : 'Відновити цю копію'}</button><button className="button button-ghost" disabled={busy} onClick={() => setPending(null)}>Скасувати</button></div></div>}
    {blocked && !pending && <button disabled={busy} className="text-button reset-data" onClick={() => { if (operation.current) return; setPending(createInitialState()); setIsReset(true); }}>Почати заново замість відновлення</button>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
