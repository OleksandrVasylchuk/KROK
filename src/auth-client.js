import { createAuthController, validateAuthConfig } from './auth-core.js';
let snapshot = { phase: 'idle', configured: false, user: null, scope: 'local', recovery: false, googleEnabled: false };
const listeners = new Set();
let initialization, controller, client, config;
const publish = next => { snapshot={...snapshot,...next}; listeners.forEach(listener=>listener()); };
export const getAuthSnapshot = () => snapshot;
export const subscribeAuth = listener => { listeners.add(listener); return ()=>listeners.delete(listener); };
export async function initializeAuth() {
  if (initialization) return initialization;
  initialization=(async()=>{
    publish({phase:'loading'});
    try {
      const {Capacitor,CapacitorHttp}=await import('@capacitor/core');
      const native=Capacitor.isNativePlatform();
      let storage;
      if(native){const {Preferences}=await import('@capacitor/preferences');storage={getItem:async key=>(await Preferences.get({key})).value,setItem:(key,value)=>Preferences.set({key,value}),removeItem:key=>Preferences.remove({key})};}
      else storage=globalThis.localStorage;
      const override=import.meta.env?.VITE_COACH_API_BASE_URL || '';
      let base=native?'http://10.0.2.2:5177':'';
      if(override){const url=new URL(override);if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!['','/'].includes(url.pathname))throw new Error();base=url.origin;}
      let rawConfig;
      try{
        if(native){const response=await CapacitorHttp.get({url:`${base}/api/auth/config`,headers:{Accept:'application/json'},connectTimeout:4000,readTimeout:4000});if(response.status!==200)throw new Error();rawConfig=typeof response.data==='string'?JSON.parse(response.data):response.data;}
        else{const response=await fetch(`${base}/api/auth/config`,{signal:AbortSignal.timeout(4000),cache:'no-store'});if(!response.ok)throw new Error();rawConfig=await response.json();}
        await storage.setItem('krok-auth-public-v1',JSON.stringify(validateAuthConfig(rawConfig)));
      }catch{const saved=await storage.getItem('krok-auth-public-v1');if(!saved)throw new Error();rawConfig=JSON.parse(saved);}
      config=validateAuthConfig(rawConfig);
      if(!config.configured){publish({phase:'unconfigured',configured:false});return snapshot;}
      const {createClient}=await import('@supabase/supabase-js');
      const project=new URL(config.supabaseUrl).hostname;
      client=createClient(config.supabaseUrl,config.publishableKey,{auth:{flowType:'pkce',detectSessionInUrl:false,persistSession:true,autoRefreshToken:true,storage,storageKey:`krok-auth-${project}`}});
      const runtime={native,origin:globalThis.location?.origin,url:globalThis.location?.href,
        clearCallback:()=>{const url=new URL(location.href);url.searchParams.delete('code');url.searchParams.delete('auth');url.searchParams.delete('error');url.searchParams.delete('error_code');url.searchParams.delete('error_description');history.replaceState(null,'',url);},
        openBrowser:async url=>{if(native){const {Browser}=await import('@capacitor/browser');await Browser.open({url});}else location.assign(url);},
        closeBrowser:async()=>{try{const {Browser}=await import('@capacitor/browser');await Browser.close();}catch{/* Android custom tab may already be closed. */}},
      };
      controller=createAuthController({client,config,runtime,onChange:publish});
      if(native){const {App}=await import('@capacitor/app');await App.addListener('appUrlOpen',event=>{controller.callback(event.url).catch(()=>publish({notice:'Не вдалося завершити вхід. Спробуй ще раз.'}));});const launch=await App.getLaunchUrl();if(launch?.url)runtime.url=launch.url;await App.addListener('appStateChange',({isActive})=>{if(isActive)client.auth.startAutoRefresh();else client.auth.stopAutoRefresh();});}
      await controller.initialize();
    }catch{controller?.dispose();controller=null;client=null;publish({phase:'error',configured:config?.configured===true,user:null,scope:'local',notice:'Сервіс акаунтів поки недоступний. Спробуй ще раз або явно відкрий локальний профіль.'});}
    return snapshot;
  })();
  return initialization;
}
export async function retryAuth() { if(controller)return snapshot;initialization=null;return initializeAuth(); }
export function continueLocally(){publish({phase:'ready',user:null,scope:'local',notice:'Відкрито локальний профіль. Для входу в акаунт повтори підключення.'});}
async function ready(){await initializeAuth();if(!controller&&config?.configured)await retryAuth();if(!controller)throw new Error('Сервіс акаунтів недоступний або ще не налаштований.');return controller;}
export const signIn=(email,password)=>ready().then(auth=>auth.signIn(email,password));
export const signUp=(email,password)=>ready().then(auth=>auth.signUp(email,password));
export const signInGoogle=()=>ready().then(auth=>auth.google());
export const sendPasswordReset=email=>ready().then(auth=>auth.reset(email));
export const updatePassword=password=>ready().then(auth=>auth.updatePassword(password));
export const signOut=()=>ready().then(auth=>auth.signOut());
// No boot/network side effect in tests or local mode; initialized by AccountBoundary.
export const getAccessToken=async()=>controller?controller.token():null;
export const getAuthClient=()=>client;
