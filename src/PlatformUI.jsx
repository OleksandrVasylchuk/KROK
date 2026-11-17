import { useEffect, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ArrowDown, ArrowRight, CheckCircle, DeviceMobile, DownloadSimple, Globe, WifiSlash } from '@phosphor-icons/react';
import { registerSW } from 'virtual:pwa-register';

export const isNative = Capacitor.isNativePlatform();
const callbacks = new Set();
let installEvent = null;
let updateServiceWorker = null;
let platform = { native: isNative, online: navigator.onLine, installed: isNative || matchMedia('(display-mode: standalone)').matches || navigator.standalone === true, canInstall: false, offlineReady: isNative, updateReady: false, registrationFailed: false };
function emit(change) { platform = { ...platform, ...change }; callbacks.forEach(fn => fn(platform)); }
window.addEventListener('online', () => emit({ online: true }));
window.addEventListener('offline', () => emit({ online: false }));
window.addEventListener('beforeinstallprompt', event => { if (isNative) return; event.preventDefault(); installEvent = event; emit({ canInstall: true }); });
window.addEventListener('appinstalled', () => { installEvent = null; emit({ installed: true, canInstall: false }); });
matchMedia('(display-mode: standalone)').addEventListener('change', event => emit({ installed: event.matches || isNative }));

export function registerWebApp() {
  if (isNative || !import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  updateServiceWorker = registerSW({
    immediate: true,
    onNeedRefresh() { emit({ updateReady: true }); },
    onOfflineReady() { emit({ offlineReady: true, registrationFailed: false }); },
    onRegisteredSW(_url, registration) {
      if (navigator.serviceWorker.controller) emit({ offlineReady: true });
      document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) registration?.update().catch(() => {}); });
    },
    onRegisterError() { emit({ registrationFailed: true }); },
  });
}
export function usePlatform() {
  const [value, setValue] = useState(platform);
  useEffect(() => { callbacks.add(setValue); setValue(platform); return () => callbacks.delete(setValue); }, []);
  return value;
}
export function PlatformStatus() {
  const state = usePlatform();
  return <>
    {!state.online && <div className="platform-status" role="status"><WifiSlash size={17} /><span>{state.offlineReady ? 'Ти офлайн. Квести й прогрес залишаються з тобою.' : 'Немає мережі. Зміни зберігаються на цьому пристрої.'}</span></div>}
    {state.updateReady && <div className="platform-status platform-update"><DownloadSimple size={19} /><span>Є нова версія КРОК. Збережи відкриті форми перед оновленням.</span><button onClick={async () => { try { await updateServiceWorker?.(true); } catch { emit({ registrationFailed: true }); } }}>Оновити</button><button aria-label="Оновити пізніше" onClick={() => emit({ updateReady: false })}>Пізніше</button></div>}
  </>;
}
export function InstallPanel() {
  const state = usePlatform();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  async function install() {
    if (!installEvent || busy) return;
    setBusy(true);
    try {
      const pending = installEvent;
      await pending.prompt();
      const result = await pending.userChoice;
      installEvent = null;
      emit({ canInstall: false });
      setMessage(result.outcome === 'accepted' ? 'Підтверджено. Браузер завершує встановлення.' : 'Можеш встановити пізніше через меню браузера.');
    } catch { setMessage('Не вдалося відкрити встановлення. Спробуй через меню браузера.'); }
    finally { setBusy(false); }
  }
  return <div className="install-panel"><div className="install-brand"><img src="/icons/icon-192.png" width="64" height="64" alt="Значок КРОК" /><div><strong>КРОК</strong><span>Твій простір для щоденного руху.</span></div></div>
    {state.installed ? <div className="installed-note"><CheckCircle size={24} weight="light" /><span>КРОК уже відкритий як застосунок.</span></div> : <><p>Власна іконка на головному екрані, окреме вікно й доступ до твоїх квестів без інтернету.</p>{state.canInstall ? <button className="button button-primary submit-button" disabled={busy} onClick={install}>Встановити КРОК <DownloadSimple size={18} /></button> : <div className="install-steps"><DeviceMobile size={25} weight="light" /><div><strong>На телефоні</strong><p>Відкрий меню браузера та обери «Встановити застосунок» або «Додати на головний екран».</p></div><Globe size={24} weight="light" /><div><strong>На комп’ютері</strong><p>У Chrome чи Edge натисни значок встановлення в адресному рядку або знайди встановлення в меню.</p></div></div>}</>}
    <div className="offline-readiness"><span className={state.offlineReady ? 'is-ready' : ''} /><span>{state.offlineReady ? 'Готовий до роботи офлайн' : state.registrationFailed ? 'Офлайн-режим не завантажився. Спробуй перезавантажити онлайн.' : import.meta.env.DEV ? 'Офлайн-режим доступний у готовій збірці.' : 'Готуємо офлайн-режим. Дочекайся завантаження.'}</span></div>
    {!isNative && !window.isSecureContext && <p className="form-error">Встановлення потребує HTTPS-адреси. На цьому комп’ютері також працює localhost.</p>}
    <p className="install-privacy">Прогрес зберігається на цьому пристрої. Щоб перенести його між Android і браузером, скористайся копією даних у профілі.</p>
    {message && <p className="form-hint" role="status">{message}</p>}
  </div>;
}
