import { useSyncExternalStore } from 'react';
import { Check, Desktop, Moon, Sun } from '@phosphor-icons/react';
import { readAppearance, subscribeAppearance, setAppearance } from './appearance.js';

export const useAppearance=()=>useSyncExternalStore(subscribeAppearance,readAppearance,readAppearance);
const modes=[{id:'light',label:'Світла',Icon:Sun},{id:'dark',label:'Темна',Icon:Moon},{id:'system',label:'Як на пристрої',Icon:Desktop}];
const palettes=[{id:'warm',title:'Теплий КРОК',description:'Кремовий, хвойний і кораловий.'},{id:'impulse',title:'Імпульс',description:'Графітовий, світлий і лаймовий.'},{id:'clarity',title:'Ясність',description:'Білий, темно-синій і блакитний.'}];

export default function AppearanceSettings() {
  const appearance=useAppearance();
  return <section className="appearance-settings" aria-label="Оформлення КРОК">
    <p className="appearance-intro">Обери зручну для очей тему та колір. Налаштування діє на цьому пристрої.</p>
    <fieldset><legend>Тема</legend><div className="appearance-modes">{modes.map(({id,label,Icon})=><button type="button" key={id} aria-pressed={appearance.mode===id} onClick={()=>setAppearance({mode:id})}><Icon size={24}/><strong>{label}</strong>{appearance.mode===id&&<Check className="appearance-selected" size={17}/>}</button>)}</div></fieldset>
    <fieldset><legend>Кольори</legend><div className="appearance-palettes">{palettes.map(palette=><button type="button" key={palette.id} className={`appearance-palette is-${palette.id}`} aria-pressed={appearance.palette===palette.id} onClick={()=>setAppearance({palette:palette.id})}><span className="appearance-swatches" aria-hidden="true"><i/><i/><i/></span><span><strong>{palette.title}</strong><small>{palette.description}</small></span>{appearance.palette===palette.id&&<Check size={20}/>}</button>)}</div></fieldset>
    <p className="appearance-hint">Це колірні варіанти поточного інтерфейсу. Дизайн-концепції показують можливе майбутнє компонування екранів.</p>
    {appearance.mode==='system'&&<p className="appearance-hint" role="status">Зараз на пристрої {appearance.resolvedMode==='dark'?'темна':'світла'} тема.</p>}
    {!appearance.storageAvailable&&<p className="appearance-warning" role="status">Тему застосовано. Пристрій не дозволив зберегти вибір — після перезапуску його може знадобитися повторити.</p>}
  </section>;
}
