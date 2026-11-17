// Personal likeness presets are for an explicitly opted-in private build only.
// Public builds ship no owner portrait assets. Stored profile choices stay intact.
export const PERSONAL_PRESETS_ENABLED = import.meta.env?.VITE_PERSONAL_PRESETS === 'true';
export const DEFAULT_PORTRAIT = PERSONAL_PRESETS_ENABLED ? 'traveler-v1' : '';

const PHOTO = '/portraits/photo-v1.jpg';
const TRAVELER = '/portraits/traveler-v1.png';
const personalIds = new Set(['photo-v1', 'traveler-v1']);

export function getPortraitPresentation(profile = {}, personalPresets = PERSONAL_PRESETS_ENABLED) {
  const preset = personalPresets === true && personalIds.has(profile.portrait) ? profile.portrait : '';
  const avatar = typeof profile.avatar === 'string' ? profile.avatar : '';
  const generated = preset === 'traveler-v1';
  return {
    preset,
    avatarSource: preset ? PHOTO : avatar,
    avatarIsPersonal: Boolean(preset),
    characterSource: generated ? TRAVELER : preset === 'photo-v1' ? PHOTO : avatar,
    generated,
  };
}

export function getPortraitOptions(personalPresets = PERSONAL_PRESETS_ENABLED) {
  return [
    ...(personalPresets === true ? [
      { id: 'traveler-v1', label: 'Персонаж', detail: 'Мандрівник', image: TRAVELER },
      { id: 'photo-v1', label: 'Оригінал', detail: 'Твоє фото', image: PHOTO },
    ] : []),
    { id: '', label: 'Власне фото', detail: 'Фото з твого пристрою' },
  ];
}
