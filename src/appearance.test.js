import test from 'node:test';
import assert from 'node:assert/strict';
import {APPEARANCE_KEY,createAppearanceStore} from './appearance.js';

function fixture(raw=null) {
  const values=new Map(raw?[[APPEARANCE_KEY,raw]]:[]), listeners=new Set(), tabListeners=new Set();
  const media={matches:true,addEventListener:(_type,fn)=>listeners.add(fn),removeEventListener:(_type,fn)=>listeners.delete(fn)};
  const root={dataset:{},style:{}};
  const storage={getItem:key=>values.get(key)??null,setItem:(key,value)=>values.set(key,value)};
  const events={addEventListener:(_type,fn)=>tabListeners.add(fn),removeEventListener:(_type,fn)=>tabListeners.delete(fn)};
  return{values,listeners,tabListeners,media,root,storage,events};
}
test('appearance follows system until explicit choice, persists palette independently and cleans listeners',()=>{
  const env=fixture();const store=createAppearanceStore(env);const stop=store.start();
  assert.equal(env.root.dataset.theme,'dark');assert.equal(env.listeners.size,1);
  const stop2=store.start();assert.equal(env.listeners.size,1);
  env.media.matches=false;env.listeners.forEach(fn=>fn());assert.equal(store.read().resolvedMode,'light');
  store.set({mode:'dark',palette:'clarity'});env.media.matches=true;env.listeners.forEach(fn=>fn());env.media.matches=false;env.listeners.forEach(fn=>fn());assert.equal(store.read().resolvedMode,'dark');
  assert.deepEqual(JSON.parse(env.values.get(APPEARANCE_KEY)),{mode:'dark',palette:'clarity'});
  assert.equal(createAppearanceStore(env).read().palette,'clarity');
  stop();stop();assert.equal(env.listeners.size,1);stop2();assert.equal(env.listeners.size,0);assert.equal(env.tabListeners.size,0);
});
test('malformed preferences and denied storage never reset app data or prevent theme changes',()=>{
  const env=fixture('not-json');env.values.set('krok-state-v1','PERSONAL_STATE');const store=createAppearanceStore(env);
  assert.equal(store.read().mode,'system');assert.equal(store.read().storageAvailable,false);
  env.storage.setItem=()=>{throw new Error('denied');};const result=store.set({mode:'light',palette:'impulse'});
  assert.equal(result.saved,false);assert.equal(env.root.dataset.theme,'light');assert.equal(env.values.get('krok-state-v1'),'PERSONAL_STATE');
  store.set({mode:'invalid',palette:'invalid'});assert.equal(store.read().mode,'light');assert.equal(store.read().palette,'impulse');
});
test('appearance snapshot stays stable for React and accepts only valid cross-tab changes',()=>{
  const env=fixture();const store=createAppearanceStore(env);let calls=0;const stop=store.subscribe(()=>calls++);const original=store.read();
  assert.equal(store.read(),original);env.listeners.forEach(fn=>fn());assert.equal(store.read(),original);
  env.tabListeners.forEach(fn=>fn({key:'krok-state-v1',newValue:'anything'}));assert.equal(calls,0);
  env.tabListeners.forEach(fn=>fn({key:APPEARANCE_KEY,newValue:'{"mode":"light","palette":"clarity"}'}));assert.equal(calls,1);assert.equal(env.root.dataset.palette,'clarity');
  env.tabListeners.forEach(fn=>fn({key:APPEARANCE_KEY,newValue:'{"mode":"invalid","palette":"clarity"}'}));assert.equal(calls,1);stop();assert.equal(env.listeners.size,0);
});
