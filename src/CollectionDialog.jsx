import { useEffect, useId, useRef } from 'react';
import { Barbell, BookOpen, Brain, Briefcase, ChatsCircle, Coins, ForkKnife, House, MoonStars, Palette, X } from '@phosphor-icons/react';
import { CATEGORIES } from './model.js';

export const ATTRIBUTE_OPTIONS = [{ id: 'strength', label: 'Сила' }, { id: 'endurance', label: 'Витривалість' }, { id: 'intelligence', label: 'Інтелект' }, { id: 'discipline', label: 'Дисципліна' }, { id: 'charisma', label: 'Харизма' }];
export const WEEKDAYS = [{ id: 1, label: 'Пн', full: 'Понеділок' }, { id: 2, label: 'Вт', full: 'Вівторок' }, { id: 3, label: 'Ср', full: 'Середа' }, { id: 4, label: 'Чт', full: 'Четвер' }, { id: 5, label: 'Пт', full: 'П’ятниця' }, { id: 6, label: 'Сб', full: 'Субота' }, { id: 0, label: 'Нд', full: 'Неділя' }];
export const DOMAIN_ICONS = { body: Barbell, money: Coins, social: ChatsCircle, growth: BookOpen, nutrition: ForkKnife, sleep: MoonStars, mind: Brain, career: Briefcase, home: House, creativity: Palette };

export function dateLabel(value) {
  return value ? new Date(`${value}T12:00:00`).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : 'Дата не обрана';
}

export function recurrenceLabel(item) {
  if (item.frequency === 'once') return `Один раз · ${dateLabel(item.scheduledDate)}`;
  if (item.frequency === 'weekdays') return WEEKDAYS.filter(day => item.weekdays?.includes(day.id)).map(day => day.label).join(', ') || 'Обрані дні';
  return 'Щодня';
}

export function CategoryIcon({ category, size = 20 }) {
  const Icon = DOMAIN_ICONS[category] || BookOpen;
  return <span className={`v-domain-mark v-domain-${category}`}><Icon size={size} weight="light" /></span>;
}

export function CategoryFilters({ value, onChange, label = 'Напрям', counts }) {
  return <div className="cv-chips" role="group" aria-label={label}>
    <button type="button" className={value === 'all' ? 'is-active' : ''} aria-pressed={value === 'all'} onClick={() => onChange('all')}>Усі напрями</button>
    {CATEGORIES.map(category => <button type="button" key={category.id} className={value === category.id ? 'is-active' : ''} aria-pressed={value === category.id} onClick={() => onChange(category.id)}>{category.shortLabel || category.label}{counts && <span>{counts[category.id] || 0}</span>}</button>)}
  </div>;
}

export function ScheduleFields({ values, onChange, allowOnce = true }) {
  return <div className="cv-schedule-fields">
    <label className="field">Повторення<select aria-label="Повторення" value={values.frequency || 'daily'} onChange={event => onChange({ ...values, frequency: event.target.value, weekdays: values.weekdays?.length ? values.weekdays : [1, 2, 3, 4, 5] })}><option value="daily">Щодня</option><option value="weekdays">У певні дні тижня</option>{allowOnce && <option value="once">Один раз</option>}</select></label>
    {values.frequency === 'weekdays' && <fieldset className="cv-weekday-field"><legend>У які дні?</legend><div>{WEEKDAYS.map(day => <button type="button" key={day.id} aria-label={day.full} aria-pressed={values.weekdays?.includes(day.id) || false} className={values.weekdays?.includes(day.id) ? 'is-selected' : ''} onClick={() => onChange({ ...values, weekdays: values.weekdays?.includes(day.id) ? values.weekdays.filter(id => id !== day.id) : [...(values.weekdays || []), day.id] })}>{day.label}</button>)}</div></fieldset>}
    {values.frequency === 'once' && <label className="field">Дата виконання<input aria-label="Дата виконання" type="date" required value={values.scheduledDate || ''} onChange={event => onChange({ ...values, scheduledDate: event.target.value })} /></label>}
  </div>;
}

export default function CollectionDialog({ title, description, subtitle, onClose, wide = false, children }) {
  const details = description || subtitle;
  const ref = useRef(null);
  // Capture the opener during render, before a child with autoFocus takes focus.
  const openerRef = useRef(typeof document === 'undefined' ? null : document.activeElement);
  const titleId = useId();
  const descriptionId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog.open) dialog.showModal();
    return () => {
      dialog.close();
      const previous = openerRef.current;
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);
  return <dialog ref={ref} className={`modal cv-dialog ${wide ? 'cv-dialog-wide' : ''}`} aria-labelledby={titleId} aria-describedby={details ? descriptionId : undefined} onCancel={event => { event.preventDefault(); onClose(); }} onClick={event => {
    if (event.target !== ref.current) return;
    const rect = ref.current.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose();
  }}><div className="modal-content"><button className="icon-button modal-close" type="button" aria-label="Закрити вікно" onClick={onClose}><X size={20} /></button><span className="eyebrow">ТВІЙ ВЛАСНИЙ РИТМ</span><h2 id={titleId}>{title}</h2>{details && <p id={descriptionId} className="modal-subtitle">{details}</p>}{children}</div></dialog>;
}
