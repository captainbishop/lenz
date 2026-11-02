import { createIdentity } from './peer-crypto.js';
import { readState, updateState } from './chat-store.js';
import { mountProfilePanels } from './profile-panels.js';
import { setupProfile } from './profile-ui.js';
import { renderProfile, setupContacts } from './contact-ui.js';
import { paintAvatar, privateName } from './profile-display.js';
import { saveOffline } from './save-offline.js';
import { mountNearWallet, loadNearConfig, renderNearWallet, openNearSend } from './near-wallet.js';
mountProfilePanels();
const $ = selector => document.querySelector(selector);
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('proof-u-chat-refresh') : null;
let busy = false, statusTimer;
function status(text, error = false, { transient = false } = {}) {
  clearTimeout(statusTimer);
  const node = $('#status'); node.textContent = text; node.className = error ? 'status error' : 'status';
  if (transient && !error) statusTimer = setTimeout(() => { node.textContent = ''; }, 3500);
}
async function action(operation) {
  if (busy) return; busy = true; $('main').setAttribute('aria-busy', 'true');
  document.querySelectorAll('.wallet-feedback').forEach(node => { node.textContent = ''; });
  try { await operation(); channel?.postMessage('changed'); await render(); }
  catch (error) {
    status(error.message, true);
    document.querySelectorAll('dialog[open] .wallet-feedback, dialog[open] #contact-feedback, dialog[open] #profile-feedback').forEach(node => { node.textContent = error.message; });
  } finally { busy = false; $('main').setAttribute('aria-busy', 'false'); }
}
async function render() {
  const state = await readState(), hasIdentity = !!state.identity;
  $('#wallet-onboarding').hidden = hasIdentity; $('#wallet-content').hidden = $('#my-profile').hidden = !hasIdentity;
  await renderProfile(state.identity?.profile); await renderNearWallet(state); if (!hasIdentity) return;
  const people = $('#wallet-people'); people.replaceChildren();
  for (const contact of state.contacts) {
    const row = document.createElement('div'), avatar = document.createElement('span'), button = document.createElement('button');
    row.className = 'person'; avatar.className = 'avatar'; paintAvatar(avatar, contact);
    button.textContent = contact.name; button.type = 'button'; button.onclick = () => openNearSend(contact.id);
    row.append(avatar, button); people.append(row);
  }
}
function start(name, privateProfile = false) { return action(async () => {
  await updateState(async state => {
    if (state.identity) throw new Error('This browser already has a profile. Reload to see it.');
    state.identity = await createIdentity(name); if (privateProfile) state.identity.profile.avatar = 'moon';
  }); status('Profile saved. Your wallet is ready.', false, { transient: true });
}); }
$('#wallet-identity-form').onsubmit = event => { event.preventDefault(); start($('#wallet-name').value); };
$('#wallet-private').onclick = () => start(privateName(), true);
setupProfile({ action, status });
setupContacts({ action, status, select: id => { $('#near-recipient').value = id; } });
$('#prepare-money-offline').onclick = () => action(async () => { await saveOffline(); status('Wallet and conversation files saved for offline use.'); });
channel?.addEventListener('message', () => { if (!busy) render().catch(error => status(error.message, true)); });
mountNearWallet({ action, status });
try { await loadNearConfig(); await render(); status('Your wallet is ready.', false, { transient: true }); } catch (error) { status(error.message, true); }
