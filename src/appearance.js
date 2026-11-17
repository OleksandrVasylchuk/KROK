export const APPEARANCE_KEY = 'krok-appearance-v1';
const modes = new Set(['light','dark','system']);
const palettes = new Set(['warm','impulse','clarity']);
const defaults = { mode:'system', palette:'impulse' };

export function createAppearanceStore({ storage, media, root, events } = {}) {
  let stored = defaults, storageAvailable = true, references = 0;
  const listeners = new Set();
  try {
    const raw = storage?.getItem(APPEARANCE_KEY);
    if (raw) { const value=JSON.parse(raw); stored={mode:modes.has(value?.mode)?value.mode:defaults.mode,palette:palettes.has(value?.palette)?value.palette:defaults.palette}; }
  } catch { storageAvailable=false; }
  const resolved = mode => mode === 'system' ? (media?.matches ? 'dark' : 'light') : mode;
  let snapshot = { ...stored, resolvedMode:resolved(stored.mode), storageAvailable };
  const render = () => { if(root?.dataset) { root.dataset.theme=snapshot.resolvedMode;root.dataset.palette=snapshot.palette;root.style.colorScheme=snapshot.resolvedMode; } };
  const publish = value => {
    const next={...value,resolvedMode:resolved(value.mode)};
    if(Object.keys(next).every(key=>next[key]===snapshot[key])) return;
    snapshot=next;render();listeners.forEach(listener=>listener());
  };
  const systemChanged=()=>publish({...snapshot});
  const storageChanged=event=>{
    if(event.key!==APPEARANCE_KEY) return;
    try { const value=event.newValue ? JSON.parse(event.newValue) : defaults;if(!modes.has(value?.mode)||!palettes.has(value?.palette))return;publish({...value,storageAvailable:true}); }catch { /* Ignore another tab's malformed preference; user data is unaffected. */ }
  };
  function start() {
    references++;render();
    if(references===1) { if(media?.addEventListener)media.addEventListener('change',systemChanged);else media?.addListener?.(systemChanged);events?.addEventListener?.('storage',storageChanged); }
    let stopped=false;
    return ()=>{if(stopped)return;stopped=true;references--;if(references===0){if(media?.removeEventListener)media.removeEventListener('change',systemChanged);else media?.removeListener?.(systemChanged);events?.removeEventListener?.('storage',storageChanged);}};
  }
  return {
    read:()=>snapshot,
    start,
    subscribe(listener){listeners.add(listener);const stop=start();return()=>{listeners.delete(listener);stop();};},
    set(patch={}) {
      const value={mode:modes.has(patch.mode)?patch.mode:snapshot.mode,palette:palettes.has(patch.palette)?patch.palette:snapshot.palette};
      let saved=true;
      try { if(!storage)throw new Error('No preference storage');storage.setItem(APPEARANCE_KEY,JSON.stringify(value)); }catch { saved=false; }
      publish({...value,storageAvailable:saved});render();
      return {saved,settings:snapshot};
    },
  };
}

let singleton;
function store() {
  if(!singleton){let storage;try{storage=globalThis.localStorage;}catch{/* Device appearance remains usable without persistence. */}
    singleton=createAppearanceStore({storage,media:globalThis.matchMedia?.('(prefers-color-scheme: dark)'),root:globalThis.document?.documentElement,events:globalThis.window});
    // A palette link is an explicit choice; retain the saved light/dark preference
    // and all unrelated query parameters (including authentication callbacks).
    try {
      const address=new URL(globalThis.location.href);
      const palette=address.searchParams.get('krokPalette');
      if(palettes.has(palette)) {
        singleton.set({palette});
        address.searchParams.delete('krokPalette');
        globalThis.history.replaceState(globalThis.history.state,'',address.pathname+address.search+address.hash);
      }
    }catch{/* Appearance remains usable without a browser URL/history API. */}
  }
  return singleton;
}
export const readAppearance=()=>store().read();
export const applyAppearance=()=>store().start();
export const subscribeAppearance=listener=>store().subscribe(listener);
export const setAppearance=patch=>store().set(patch);
export const toggleAppearanceMode=()=>setAppearance({mode:readAppearance().resolvedMode==='dark'?'light':'dark'});
