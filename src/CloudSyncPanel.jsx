import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowsClockwise, CloudArrowUp, CloudCheck, CloudSlash, Warning } from '@phosphor-icons/react';
import { isDemo, readLocalProfile } from './app-persistence.js';
import { isPristine, summarizeState } from './cloud-sync.js';
import { createAccountSync, isAccountScope } from './cloud-sync-runtime.js';
import './cloud-sync.css';

const PUSH_DELAY_MS = 2500;
const REFRESH_MS = 5 * 60_000;
const when = value => { const date = new Date(value); return Number.isFinite(date.getTime()) ? date.toLocaleString('uk-UA', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };

/**
 * Keeps one account's durable state in step with its cloud copy. Only state that
 * is already saved on the device is sent, and only after the per-device opt-in.
 */
export function useCloudSync({ scope, state, savedSnapshot, blocked, adopt, notify }) {
  const available = !isDemo && isAccountScope(scope);
  const engine = useMemo(() => available ? createAccountSync(scope) : null, [available, scope]);
  const [status, setStatus] = useState({ phase: available ? 'loading' : 'local', enabled: false, at: '', message: '' });
  const [conflict, setConflict] = useState(null);
  const live = useRef({});
  live.current = { state, savedSnapshot, blocked, adopt, notify, conflict };
  const busy = useRef(false), again = useRef(false), mounted = useRef(false), enabled = useRef(false), timer = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; clearTimeout(timer.current); }; }, []);

  const applyAdopt = useCallback(async (result, local) => {
    const now = live.current;
    // Records may have changed while the request was in flight; decide again from the newer state.
    if (now.blocked || now.state !== local || now.savedSnapshot !== local) { again.current = true; return; }
    if (!await now.adopt(result.state)) { setStatus(value => ({ ...value, phase: 'error', message: 'Не вдалося записати хмарну копію на цей пристрій. Локальні записи не змінено.' })); return; }
    const meta = await engine.confirmAdopt(result.state, result.revision, result.updatedAt);
    if (!mounted.current) return;
    setConflict(null);
    setStatus({ phase: 'synced', enabled: true, at: meta.syncedAt, message: '' });
    now.notify('Отримано новіші записи з іншого пристрою');
  }, [engine]);

  const settle = useCallback(async (result, local) => {
    if (!mounted.current) return;
    if (result.status === 'disabled') { enabled.current = false; setConflict(null); setStatus({ phase: 'off', enabled: false, at: '', message: result.removed ? 'Хмарну копію видалено. Записи на цьому пристрої збережено.' : '' }); }
    else if (result.status === 'removed') { enabled.current = false; setConflict(null); setStatus({ phase: 'off', enabled: false, at: '', message: result.message }); live.current.notify(result.message); }
    else if (result.status === 'synced') { setConflict(null); setStatus({ phase: 'synced', enabled: true, at: result.at, message: '' }); }
    else if (result.status === 'adopt') await applyAdopt(result, local);
    else if (result.status === 'conflict') { setConflict(result); setStatus(value => ({ ...value, phase: 'conflict', enabled: true, message: '' })); }
    else setStatus(value => ({ ...value, phase: result.status === 'offline' ? 'offline' : 'error', enabled: true, message: result.message }));
  }, [applyAdopt]);

  const run = useCallback(async operation => {
    if (!engine) return;
    if (busy.current) { again.current = true; return; }
    const local = live.current.state;
    // Unsaved or blocked state is never sent; the save effect calls back when it is durable.
    if (live.current.blocked || live.current.savedSnapshot !== local) return;
    busy.current = true;
    setStatus(value => value.enabled ? { ...value, phase: 'syncing' } : value);
    try { await settle(await operation(local), local); }
    catch { if (mounted.current) setStatus(value => ({ ...value, phase: 'error', message: 'Не вдалося синхронізувати записи. Локальні дані збережено; спробуй ще раз.' })); }
    finally {
      busy.current = false;
      if (again.current && mounted.current) { again.current = false; clearTimeout(timer.current); timer.current = setTimeout(() => { if (enabled.current && !live.current.conflict) void run(value => engine.sync(value)); }, PUSH_DELAY_MS); }
    }
  }, [engine, settle]);

  const sync = useCallback(() => { if (enabled.current && !live.current.conflict) void run(value => engine.sync(value)); }, [engine, run]);

  useEffect(() => {
    if (!engine) { setStatus({ phase: 'local', enabled: false, at: '', message: '' }); return undefined; }
    let active = true;
    enabled.current = false; setConflict(null);
    engine.status().then(meta => {
      if (!active) return;
      enabled.current = meta.enabled;
      setStatus({ phase: meta.enabled ? 'syncing' : 'off', enabled: meta.enabled, at: meta.syncedAt, message: '' });
      if (meta.enabled) sync();
    }).catch(() => { if (active) setStatus({ phase: 'error', enabled: false, at: '', message: 'Не вдалося прочитати налаштування синхронізації на цьому пристрої.' }); });
    return () => { active = false; };
  }, [engine, sync]);

  // A durable local save schedules one debounced upload of the whole profile.
  useEffect(() => {
    if (!engine || !enabled.current || blocked || savedSnapshot !== state) return undefined;
    clearTimeout(timer.current);
    timer.current = setTimeout(sync, PUSH_DELAY_MS);
    return () => clearTimeout(timer.current);
  }, [engine, savedSnapshot, state, blocked, sync, status.enabled]);

  useEffect(() => {
    if (!engine) return undefined;
    const visible = () => { if (document.visibilityState === 'visible') sync(); };
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', visible);
    const interval = setInterval(sync, REFRESH_MS);
    return () => { window.removeEventListener('online', sync); document.removeEventListener('visibilitychange', visible); clearInterval(interval); };
  }, [engine, sync]);

  return {
    available, status, conflict,
    enable: async () => { if (!engine) return; const meta = await engine.enable(); enabled.current = meta.enabled; setStatus({ phase: 'syncing', enabled: true, at: meta.syncedAt, message: '' }); await run(value => engine.sync(value)); },
    disable: async () => { if (!engine) return; await engine.disable(); enabled.current = false; setConflict(null); setStatus({ phase: 'off', enabled: false, at: '', message: '' }); },
    syncNow: sync,
    keepLocal: () => run(value => engine.keepLocal(value, live.current.conflict?.remote.revision)),
    takeRemote: () => run(value => engine.takeRemote(value)),
    removeCloudCopy: () => run(() => engine.removeCloudCopy()),
  };
}

function Summary({ value }) {
  return <dl className="cloud-sync-summary">{[['Квести', value.quests], ['Звички', value.habits], ['Цілі', value.goals], ['Виконання', value.completions], ['Операції', value.expenses], ['Дні щоденника', value.journalDays]].map(([label, count]) => <div key={label}><dt>{label}</dt><dd>{count}</dd></div>)}</dl>;
}

export default function CloudSyncPanel({ cloud, state, disabled = false, onExport, onTransfer }) {
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [local, setLocal] = useState(null);
  const [transferError, setTransferError] = useState('');
  const { status, conflict } = cloud;
  const working = busy || status.phase === 'syncing' || status.phase === 'loading';
  async function act(operation) { if (busy || disabled) return; setBusy(true); try { await operation(); } finally { setBusy(false); } }
  async function reviewLocal() {
    setTransferError('');
    const profile = await readLocalProfile();
    if (!profile || isPristine(profile)) { setTransferError('У локальному профілі цього пристрою ще немає власних записів для перенесення.'); return; }
    setLocal(profile);
  }
  const label = { loading: 'Перевіряємо…', off: 'Вимкнено на цьому пристрої', syncing: 'Синхронізуємо…', synced: status.at ? `Синхронізовано · ${when(status.at)}` : 'Синхронізовано', offline: 'Очікує з’єднання', conflict: 'Потрібне твоє рішення', error: 'Не вдалося синхронізувати' }[status.phase] || '';
  const Icon = status.phase === 'synced' ? CloudCheck : status.phase === 'conflict' || status.phase === 'error' ? Warning : status.enabled ? CloudArrowUp : CloudSlash;
  return <section className="cloud-sync" aria-label="Синхронізація між пристроями">
    <div className="cloud-sync-heading"><Icon size={24} weight="light" /><div><h3>Один прогрес на всіх пристроях</h3><p role="status">{label}</p></div></div>
    {disabled && <p className="cloud-sync-note">Спочатку дочекайся збереження записів на цьому пристрої.</p>}
    {conflict ? <div className="cloud-sync-conflict" role="alert">
      <strong>Записи на цьому пристрої та в хмарі відрізняються.</strong>
      <p>КРОК не об’єднує їх автоматично, щоб нічого не загубити. Обери, яку версію залишити. Іншу можна спершу зберегти у файл.</p>
      <div className="cloud-sync-versions"><div><span>Цей пристрій</span><Summary value={conflict.local.summary} /></div><div><span>Хмара{conflict.remote.device ? ` · ${conflict.remote.device}` : ''}{when(conflict.remote.updatedAt) ? ` · ${when(conflict.remote.updatedAt)}` : ''}</span><Summary value={conflict.remote.summary} /></div></div>
      <div className="cloud-sync-actions"><button type="button" className="button button-primary" disabled={working || disabled} onClick={() => act(cloud.keepLocal)}>Залишити записи цього пристрою</button><button type="button" className="button button-ghost" disabled={working || disabled} onClick={() => act(cloud.takeRemote)}>Взяти записи з хмари</button><button type="button" className="cloud-sync-link" disabled={working} onClick={onExport}><ArrowDown size={15} /> Зберегти копію цього пристрою у файл</button></div>
    </div> : <>
      <p>Квести, звички, цілі, витрати, щоденник і розмови з тренером зберігаються у твоєму акаунті та з’являються на інших пристроях, де ти теж увімкнеш синхронізацію. Без інтернету КРОК працює як завжди й надсилає зміни пізніше.</p>
      <p className="cloud-sync-note">Завантажене фото профілю залишається на цьому пристрої. Якщо записи змінено на двох пристроях одночасно, КРОК запитає, яку версію залишити.</p>
      {status.message && <p className="cloud-sync-message" role="alert">{status.message}</p>}
      <div className="cloud-sync-actions">{status.enabled
        ? <><button type="button" className="button button-ghost" disabled={working || disabled} onClick={() => cloud.syncNow()}><ArrowsClockwise size={16} /> Синхронізувати зараз</button><button type="button" className="cloud-sync-link" disabled={working} onClick={() => act(cloud.disable)}>Вимкнути на цьому пристрої</button></>
        : <button type="button" className="button button-primary" disabled={working || disabled || status.phase === 'loading'} onClick={() => act(cloud.enable)}><CloudArrowUp size={17} /> Увімкнути синхронізацію</button>}</div>
    </>}
    <details className="cloud-sync-more"><summary>Перенесення та хмарна копія</summary>
      <p>Локальний профіль цього пристрою зберігається окремо від акаунта. Його записи можна скопіювати в акаунт — тільки після перегляду й підтвердження.</p>
      {!local ? <button type="button" className="button button-ghost" disabled={working || disabled} onClick={() => act(reviewLocal)}>Переглянути записи локального профілю</button> : <div className="cloud-sync-transfer">
        <strong>Скопіювати локальний профіль у цей акаунт?</strong><Summary value={summarizeState(local)} />
        <p>{isPristine(state) ? 'В акаунті ще немає власних записів.' : 'Це замінить поточні записи акаунта на цьому пристрої. Спершу збережи їх у файл, якщо вони потрібні.'} Локальний профіль залишиться без змін{cloud.status.enabled ? ', а нові записи акаунта надішлються в хмару' : ''}.</p>
        <div className="cloud-sync-actions"><button type="button" className="button button-primary" disabled={working || disabled} onClick={() => act(async () => { if (await onTransfer(local)) setLocal(null); else setTransferError('Не вдалося перенести записи. Нічого не змінено.'); })}>Скопіювати в акаунт</button>{!isPristine(state) && <button type="button" className="cloud-sync-link" disabled={working} onClick={onExport}><ArrowDown size={15} /> Зберегти записи акаунта у файл</button>}<button type="button" className="cloud-sync-link" disabled={working} onClick={() => setLocal(null)}>Скасувати</button></div>
      </div>}
      {transferError && <p className="cloud-sync-message" role="alert">{transferError}</p>}
      <p>Хмарну копію можна видалити будь-коли. Записи на цьому пристрої залишаться, синхронізація вимкнеться.</p>
      {!confirmRemove ? <button type="button" className="cloud-sync-link" disabled={working || disabled} onClick={() => setConfirmRemove(true)}>Видалити хмарну копію…</button> : <div className="cloud-sync-actions"><button type="button" className="button button-ghost" disabled={working || disabled} onClick={() => act(async () => { await cloud.removeCloudCopy(); setConfirmRemove(false); })}>Так, видалити з хмари</button><button type="button" className="cloud-sync-link" onClick={() => setConfirmRemove(false)}>Скасувати</button></div>}
    </details>
  </section>;
}
