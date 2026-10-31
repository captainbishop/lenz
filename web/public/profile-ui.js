import { readState, updateState } from './chat-store.js';
import { validateProfile } from './peer-crypto.js';
import { AVATARS, privateName, paintAvatar, photoFromFile } from './profile-display.js';
const $ = selector => document.querySelector(selector);
export function setupProfile({ action, status }) {
  let draft = null, session = 0, reading = false;
  const dialog = $('#edit-profile');
  function preview() {
    paintAvatar($('#profile-preview'), draft);
    $('#remove-photo').hidden = !draft.photo;
    for (const button of $('#avatar-options').children) button.setAttribute('aria-pressed', String(!draft.photo && button.dataset.avatar === draft.avatar));
  }
  for (const avatar of AVATARS) {
    const button = document.createElement('button'); button.type = 'button'; button.className = 'avatar-option'; button.dataset.avatar = avatar;
    button.setAttribute('aria-label', `${avatar[0].toUpperCase() + avatar.slice(1)} avatar`); paintAvatar(button, { avatar });
    button.onclick = () => { if (reading) return; draft.avatar = avatar; delete draft.photo; preview(); };
    $('#avatar-options').append(button);
  }
  $('#show-profile').onclick = () => action(async () => {
    const state = await readState(); if (!state.identity) return;
    session++; reading = false; $('#save-profile').disabled = false;
    draft = { ...state.identity.profile, avatar: state.identity.profile.avatar ?? 'moon' };
    $('#profile-name').value = draft.name; $('#profile-photo').value = ''; $('#profile-feedback').textContent = ''; preview(); dialog.showModal();
  });
  dialog.addEventListener('close', () => { session++; draft = null; });
  $('#new-private-name').onclick = () => { $('#profile-name').value = privateName(); };
  $('#remove-photo').onclick = () => { if (reading) return; delete draft.photo; preview(); };
  $('#profile-photo').onchange = async () => {
    const file = $('#profile-photo').files[0]; if (!file) return;
    const opened = ++session; reading = true; $('#save-profile').disabled = true;
    $('#profile-feedback').textContent = 'Preparing your photo on this device…';
    try {
      const photo = await photoFromFile(file);
      if (session !== opened) return;
      draft.photo = photo; preview(); $('#profile-feedback').textContent = 'Photo ready. Save your profile to keep it.';
    } catch (error) { if (session === opened) $('#profile-feedback').textContent = error.message; }
    finally { if (session === opened) { reading = false; $('#save-profile').disabled = false; $('#profile-photo').value = ''; } }
  };
  $('#profile-form').onsubmit = event => {
    event.preventDefault(); if (reading || !draft) return;
    const proposed = { ...draft, name: $('#profile-name').value.trim() };
    action(async () => {
      const profile = await validateProfile(proposed);
      await updateState(state => {
        if (state.identity?.profile.id !== profile.id) throw new Error('Your identity changed in another tab. Reopen your profile.');
        state.identity.profile = profile;
      });
      dialog.close(); status('Profile saved. Share your updated card so your contacts see the change.');
    });
  };
}
