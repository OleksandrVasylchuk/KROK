import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_PORTRAIT, PERSONAL_PRESETS_ENABLED, getPortraitOptions, getPortraitPresentation } from './personal-portraits.js';
import { createInitialState, loadState, reducer, selectStats } from './model.js';
import { createDemoState } from './demo.js';
import { validateBackup } from './persistence.js';

test('public defaults and synthetic demo never select an owner likeness', () => {
  assert.equal(PERSONAL_PRESETS_ENABLED, false, 'Node and builds without explicit opt-in default to public presentation');
  assert.equal(DEFAULT_PORTRAIT, '');
  for (const state of [createInitialState(), createDemoState()]) {
    assert.equal(state.profile.portrait, '');
    assert.equal(getPortraitPresentation(state.profile).avatarSource, '');
    assert.equal(getPortraitPresentation(state.profile).characterSource, '');
  }
  const legacy = createInitialState();
  delete legacy.profile.portrait;
  assert.equal(loadState({ getItem: () => JSON.stringify(legacy) }).profile.portrait, '');
});

test('old personal selections remain in storage and backup but cannot request portraits in public UI', () => {
  for (const portrait of ['photo-v1', 'traveler-v1']) {
    let state = createInitialState();
    state.profile.portrait = portrait;
    state = reducer(state, { type: 'TOGGLE_QUEST', id: 'daily-move' });
    const restored = loadState({ getItem: () => JSON.stringify(state) });
    const presentation = getPortraitPresentation(restored.profile);
    assert.equal(restored.profile.portrait, portrait);
    assert.equal(selectStats(restored).totalXp, 40);
    assert.equal(presentation.generated, false);
    assert.equal(presentation.avatarSource, '');
    assert.equal(presentation.characterSource, '');
    assert.equal(presentation.avatarIsPersonal, false);
    assert.deepEqual(validateBackup(JSON.stringify(state)), state);
  }
});

test('public rendering preserves uploaded photos even alongside a legacy personal preset', () => {
  const avatar = 'data:image/png;base64,YWJj';
  for (const portrait of ['', 'photo-v1', 'traveler-v1']) {
    const state = createInitialState();
    state.profile = { ...state.profile, avatar, portrait };
    const restored = validateBackup(JSON.stringify(state));
    assert.deepEqual(restored.profile, state.profile);
    const presentation = getPortraitPresentation(restored.profile);
    assert.equal(presentation.avatarSource, avatar);
    assert.equal(presentation.characterSource, avatar);
    assert.equal(presentation.generated, false);
  }
});

test('personal choices and their image sources require a strict explicit private opt-in', () => {
  for (const enabled of [false, undefined, 'true', 1]) {
    const options = getPortraitOptions(enabled);
    assert.deepEqual(options.map(option => option.id), ['']);
    assert.equal(options.some(option => option.image), false);
    assert.equal(getPortraitPresentation({ portrait: 'traveler-v1' }, enabled).characterSource, '');
  }
  assert.equal(getPortraitOptions(true).length, 3);
  const privatePortrait = getPortraitPresentation({ portrait: 'traveler-v1' }, true);
  assert.equal(privatePortrait.generated, true);
  assert.equal(privatePortrait.avatarSource, '/portraits/photo-v1.jpg');
  assert.equal(privatePortrait.characterSource, '/portraits/traveler-v1.png');
});
