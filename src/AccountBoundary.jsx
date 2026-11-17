import { useEffect, useState, useSyncExternalStore } from 'react';
import App from './App.jsx';
import { getAuthSnapshot, initializeAuth, subscribeAuth } from './auth-client.js';
import { activeStorageKey, flushPersistence, initializePersistence, isDemo, selectPersistenceScope } from './app-persistence.js';
import { accountStorageKey } from './auth-core.js';
import { planReminders } from './plan-reminders.js';
import { createInitialState } from './model.js';
import AccountPanel from './AccountPanel.jsx';
export const useAuthSnapshot = () => useSyncExternalStore(subscribeAuth,getAuthSnapshot,getAuthSnapshot);
export default function AccountBoundary() {
  const auth=useAuthSnapshot();
  const [boot,setBoot]=useState(null);
  const [transitionError,setTransitionError]=useState('');
  const [attempt,setAttempt]=useState(0);
  useEffect(()=>{initializeAuth();},[]);
  const scope=isDemo?'local':auth.scope;
  const ready=!['idle','loading'].includes(auth.phase)&&!(auth.phase==='error'&&auth.configured);
  useEffect(()=>{
    if(!ready)return undefined;
    let active=true;
    // App is already unmounted by the render below before changing IO scope.
    setTransitionError('');
    (async()=>{
      await flushPersistence();if(!active)return;
      if(!isDemo&&activeStorageKey!==accountStorageKey(scope)){
        try{await planReminders.clearOwnedSchedules();}catch{if(active)setTransitionError('Не вдалося вимкнути нагадування попереднього профілю. Перемикання зупинено. Спробуй ще раз.');return;}
      }
      if(!active)return;selectPersistenceScope(scope);const value=await initializePersistence();if(active)setBoot({scope,...value});
    })().catch(()=>{if(active)setBoot({scope,state:createInitialState(),warning:'Не вдалося відкрити прогрес цього акаунта. Попередні записи збережено, запис вимкнено.'});});
    return()=>{active=false;};
  },[scope,ready,attempt]);
  if(auth.phase==='error'&&auth.configured)return <main className="auth-recovery-page"><AccountPanel/></main>;
  if(transitionError)return <main className="auth-recovery-page"><p role="alert">{transitionError}</p><button className="button button-primary" onClick={()=>setAttempt(value=>value+1)}>Спробувати ще раз</button></main>;
  if(!ready||boot?.scope!==scope)return <div className="boot-screen" role="status"><img src="/icons/icon-192.png" alt=""/><span>Відкриваємо твій простір…</span></div>;
  if(auth.recovery)return <main className="auth-recovery-page"><AccountPanel/></main>;
  return <App key={scope} initialState={boot.state} initialWarning={boot.warning}/>;
}
