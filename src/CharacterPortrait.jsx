import { Camera, Check, Mountains, PencilSimple, Sparkle } from '@phosphor-icons/react';
import { PERSONAL_PRESETS_ENABLED, getPortraitPresentation, getPortraitOptions } from './personal-portraits.js';
import './character.css';

/** Public avatars show the user's upload or a generic icon. */
export function Avatar({ profile, large = false }) {
  const { avatarSource: source, avatarIsPersonal: suppliedPhoto } = getPortraitPresentation(profile);
  return <span className={`avatar cp-avatar ${large ? 'avatar-large' : ''} ${suppliedPhoto ? 'cp-avatar-photo' : ''}`}>
    {source ? <img src={source} alt="Твій аватар" /> : <Mountains size={large ? 46 : 21} weight="light" />}
  </span>;
}

/** The full portrait belongs in the character card, without shrinking it into a badge. */
export function CharacterArt({ profile, onEdit, level }) {
  const { generated, characterSource: source } = getPortraitPresentation(profile);
  const hasImage = Boolean(source);
  return <button type="button" className={`cp-character-art ${generated ? 'cp-character-traveler' : 'cp-character-photo'} ${!hasImage ? 'cp-character-empty' : ''}`} onClick={onEdit} aria-label="Змінити образ персонажа">
    <span className="cp-character-halo" aria-hidden="true" />
    {generated ? <img className="cp-character-figure" src={source} alt="Твій персональний образ мандрівника" /> : source ? <img className="cp-character-photograph" src={source} alt="Твоє фото персонажа" /> : <span className="cp-character-placeholder"><Mountains size={65} weight="thin" /><span>Твій наступний образ</span><small>Додай фото у профілі</small></span>}
    <span className="cp-character-bottom"><span className="cp-level"><span aria-hidden="true" />Рівень {level || 1}</span><span className="cp-character-edit"><PencilSimple size={13} />Змінити образ</span></span>
    {generated && <span className="cp-character-origin"><Sparkle size={11} weight="light" /> З твого фото</span>}
  </button>;
}

export function PortraitPicker({ value, onChange, disabled = false }) {
  const options = getPortraitOptions();
  const selected = options.some(option => option.id === value) ? value : '';
  return <fieldset className="cp-portrait-picker" disabled={disabled}>
    <legend>Твій образ</legend>
    <div className="cp-portrait-options">
      {options.map(option => <button type="button" key={option.id || 'custom'} disabled={disabled} className={`cp-portrait-option ${selected === option.id ? 'is-selected' : ''}`} aria-pressed={selected === option.id} onClick={() => onChange(option.id)}>
        <span className={`cp-portrait-thumbnail ${option.id === 'traveler-v1' ? 'cp-thumb-traveler' : option.image ? 'cp-thumb-photo' : 'cp-thumb-custom'}`}>
          {option.image ? <img src={option.image} alt="" /> : <Camera size={26} weight="light" />}
          {selected === option.id && <span className="cp-portrait-selected" aria-hidden="true"><Check size={12} weight="bold" /></span>}
        </span>
        <strong>{option.label}</strong><small>{option.detail}</small>
      </button>)}
    </div>
    <p>{PERSONAL_PRESETS_ENABLED ? 'Образ мандрівника створено з наданого фото. Можеш повернути оригінал або завантажити інше фото.' : 'Додай власне фото кнопкою вище. Фото зберігається на цьому пристрої.'}</p>
  </fieldset>;
}
