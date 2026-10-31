import { createIdentity, openMessage } from './peer-crypto.js';
import { readState, updateState } from './chat-store.js';
import { mountProfilePanels } from './profile-panels.js';
import { setupProfile } from './profile-ui.js';
import { renderProfile, setupContacts } from './contact-ui.js';
import { paintAvatar, privateName } from './profile-display.js';
import { ASSETS, availableNotes, tradeLedger, isTrade } from './trade-model.js';
import { readTradeVault, enableDemoMoney, prepareTrade, agreeToTrade } from './trade-service.js';
import { renderTradeCard } from './trade-ui.js';
import { receivePacket } from './receive-packet.js';
import { saveOffline } from './save-offline.js';
import { mountNearWallet, loadNearConfig, renderNearWallet, openNearSend } from './near-wallet.js';
mountProfilePanels();
const $ = selector => document.querySelector(selector);
const el = (tag, text, cls) => { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; };
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('proof-u-chat-refresh') : null;
let busy = false, lastPacket = null, incoming = null, reviewId = null;
function status(text, error = false) { $('#status').textContent = text; $('#status').className = error ? 'status error' : 'status'; }
async function action(operation) {
  if (busy) return; busy = true; $('main').setAttribute('aria-busy', 'true');
  document.querySelectorAll('.wallet-feedback').forEach(node => { node.textContent = ''; });
  try { await operation(); channel?.postMessage('changed'); await render(); }
  catch (error) {
    status(error.message, true);
    document.querySelectorAll('dialog[open] .wallet-feedback, dialog[open] #contact-feedback, dialog[open] #profile-feedback').forEach(node => { node.textContent = error.message; });
  } finally { busy = false; $('main').setAttribute('aria-busy', 'false'); }
}
function download(packet) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(packet)], { type: 'application/json' }));
  const link = el('a'); link.href = url; link.download = `lenz-payment-${packet.id}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function expose(packet) { lastPacket = packet; $('#wallet-handover').showModal(); }
async function render() {
  const state = await readState(), hasIdentity = !!state.identity;
  $('#wallet-onboarding').hidden = hasIdentity; $('#wallet-content').hidden = $('#my-profile').hidden = !hasIdentity;
  await renderProfile(state.identity?.profile); await renderNearWallet(state); if (!hasIdentity) return;
  const vault = await readTradeVault(state); $('#wallet-enable-demo').hidden = $('#wallet-demo-intro').hidden = !!vault;
  $('#wallet-send').disabled = !vault;
  const balances = $('#wallet-balances'); balances.replaceChildren();
  if (vault) {
    const notes = await availableNotes(vault, state.identity.profile.signingPublic);
    for (const asset of Object.keys(ASSETS)) {
      const total = group => String(group.filter(n => n.asset === asset).reduce((sum, n) => sum + BigInt(n.value), 0n));
      const row = el('div', undefined, 'wallet-total'); row.dataset.asset = asset;
      row.append(el('strong', total(notes.available)), el('p', ASSETS[asset]));
      if (total(notes.held) !== '0') row.append(el('small', `${total(notes.held)} held for an offer`)); balances.append(row);
    }
  }
  const selected = $('#wallet-recipient').value, options = $('#wallet-recipient'), people = $('#wallet-people');
  options.replaceChildren(new Option('Choose a person', '')); people.replaceChildren();
  for (const contact of state.contacts) {
    options.append(new Option(contact.name, contact.id));
    const row = el('div', undefined, 'person'), avatar = el('span', undefined, 'avatar'), button = el('button', contact.name);
    paintAvatar(avatar, contact); button.type = 'button'; button.onclick = () => document.body.dataset.walletMode === 'near' ? openNearSend(contact.id) : openSend(contact.id);
    row.append(avatar, button); people.append(row);
  }
  options.value = selected;
  const activity = $('#wallet-activity'); activity.replaceChildren();
  const money = vault ? { vault, notes: new Map((await tradeLedger(vault)).snapshot().notes.map(n => [n.id, n])) } : null;
  for (const record of [...state.messages].reverse()) {
    const packet = record.packet, outgoing = packet.from === state.identity.profile.id;
    const contact = state.contacts.find(p => p.id === (outgoing ? packet.to : packet.from)); if (!contact) continue;
    const payload = await openMessage(state.identity, contact, packet); if (!isTrade(payload)) continue;
    const entry = el('article', undefined, 'wallet-entry'); entry.append(el('p', `${outgoing ? 'To' : 'From'} ${contact.name}`));
    entry.append(renderTradeCard(payload, packet, state, money, reviewOffer));
    if (outgoing) { const save = el('button', 'Save payment file'); save.type = 'button'; save.onclick = () => download(packet); entry.append(save); }
    activity.append(entry); if (activity.children.length >= 100) break;
  }
  $('#wallet-empty').hidden = !!activity.children.length;
}
function openSend(id = '') {
  $('#wallet-send-form').reset(); $('#wallet-recipient').value = id; $('#wallet-send-dialog .wallet-feedback').textContent = ''; $('#wallet-send-dialog').showModal();
}
function receive() {
  incoming = null; $('#wallet-incoming').value = ''; $('#wallet-incoming-name').textContent = ''; $('#wallet-import').disabled = true;
  $('#wallet-receive-dialog .wallet-feedback').textContent = ''; $('#wallet-receive-dialog').showModal();
}
function start(name, privateProfile = false) { return action(async () => {
  await updateState(async state => {
    if (state.identity) throw new Error('This browser already has a profile. Reload to see it.');
    state.identity = await createIdentity(name); if (privateProfile) state.identity.profile.avatar = 'moon';
  }); status('Profile saved. Your wallet is ready.');
}); }
$('#wallet-identity-form').onsubmit = event => { event.preventDefault(); start($('#wallet-name').value); };
$('#wallet-private').onclick = () => start(privateName(), true);
setupProfile({ action, status }); setupContacts({ action, status, select: id => { $('#wallet-recipient').value = id; } });
$('#wallet-enable-demo').onclick = () => action(async () => { await updateState(enableDemoMoney); status('Demo money is ready.'); });
$('#wallet-send').onclick = () => openSend(); $('#wallet-receive').onclick = $('#wallet-open-file').onclick = receive;
$('#wallet-share-receive').onclick = () => { $('#wallet-receive-dialog').close(); $('#show-card').click(); };
$('#wallet-send-form').onsubmit = event => { event.preventDefault(); action(async () => {
  const id = $('#wallet-recipient').value, fields = { mode: 'payment', give: $('#wallet-amount').value, giveAsset: $('#wallet-asset').value };
  const packet = await updateState(state => prepareTrade(state, id, fields));
  $('#wallet-send-dialog').close(); expose(packet); status('Payment prepared. Save the file and share it with the recipient.');
}); };
$('#wallet-save-payment').onclick = () => { if (lastPacket) download(lastPacket); };
$('#wallet-incoming').onchange = () => action(async () => {
  incoming = null; $('#wallet-import').disabled = true; const file = $('#wallet-incoming').files[0]; if (!file) return;
  if (file.size > 205000) throw new Error('This payment file is too large.');
  incoming = JSON.parse(await file.text()); $('#wallet-incoming-name').textContent = file.name; $('#wallet-import').disabled = false;
});
$('#wallet-import').onclick = () => action(async () => {
  if (!incoming) throw new Error('Choose a payment file first.');
  const result = await updateState(state => receivePacket(state, incoming, true));
  $('#wallet-receive-dialog').close(); incoming = null;
  status(result.duplicate ? 'This payment was already opened. Your balance is unchanged.' : 'Payment checked and saved. Your wallet is up to date.');
});
function reviewOffer(id) { return action(async () => {
  const state = await readState(), record = state.messages.find(r => r.packet.id === id), peer = state.contacts.find(p => p.id === record?.packet.from);
  if (!peer) throw new Error('This offer could not be found.');
  const vault = await readTradeVault(state), payload = await openMessage(state.identity, peer, record.packet);
  const money = { vault, notes: new Map((await tradeLedger(vault)).snapshot().notes.map(n => [n.id, n])) };
  const card = renderTradeCard(payload, record.packet, state, money, () => {}); card.querySelector('.review-offer')?.remove();
  reviewId = id; $('#wallet-review-card').replaceChildren(card); $('#wallet-review-dialog').showModal();
}); }
$('#wallet-agree').onclick = () => action(async () => {
  const packet = await updateState(state => agreeToTrade(state, reviewId)); $('#wallet-review-dialog').close(); expose(packet); status('Trade agreed locally. Share the reply.');
});
$('#prepare-money-offline').onclick = () => action(async () => { await saveOffline(); status('Wallet and conversation files saved for offline use.'); });
channel?.addEventListener('message', () => { if (!busy) render().catch(error => status(error.message, true)); });
mountNearWallet({ action, status });
try { await loadNearConfig(); await render(); status('Your wallet is ready.'); } catch (error) { status(error.message, true); }
