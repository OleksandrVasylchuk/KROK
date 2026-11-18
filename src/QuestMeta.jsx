import { DAY_SLOTS, QUEST_TIERS, questTier, tierXp } from './catalog.js';
import './routine.css';

export const slotLabel = id => DAY_SLOTS.find(item => item.id === id)?.label || DAY_SLOTS.at(-1).label;
export const tierLabel = xp => QUEST_TIERS.find(item => item.id === questTier(xp)).label;

/** A quest's level is derived from its reward, so the badge can never disagree with earned XP. */
export function TierBadge({ xp, tier = questTier(xp), always = false }) {
  if (tier === 'common' && !always) return null;
  return <span className={`tier-badge tier-${tier}`}>{QUEST_TIERS.find(item => item.id === tier).label}</span>;
}

/** Choosing a level sets the reward. An unchanged level keeps the quest's existing XP. */
export function TierPicker({ xp, onChange, disabled = false }) {
  const current = questTier(xp);
  return <fieldset className="tier-picker" disabled={disabled}><legend>Рівень квесту</legend><div>{QUEST_TIERS.map(tier => <button type="button" key={tier.id} aria-pressed={current === tier.id} onClick={() => { if (current !== tier.id) onChange(tierXp(tier.id)); }}><strong>{tier.label}</strong><span>{tier.hint}</span><small>+{current === tier.id ? xp : tier.xp} XP</small></button>)}</div></fieldset>;
}

export function SlotSelect({ value, onChange, name }) {
  return <label className="field">Частина дня<select aria-label="Частина дня" name={name} value={value} onChange={event => onChange(event.target.value)}>{DAY_SLOTS.map(slot => <option key={slot.id} value={slot.id}>{slot.label}</option>)}</select></label>;
}

/** Quests in the order of a day: morning, day, evening, then the ones without a fixed time. */
export function groupBySlot(quests) {
  return DAY_SLOTS.map(slot => ({ ...slot, quests: quests.filter(quest => (quest.timeOfDay || 'any') === slot.id) })).filter(group => group.quests.length);
}
