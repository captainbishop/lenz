import { createIdentity, sealMessage, openMessage, bytes, digest } from './peer-crypto.js';
import {startAccountSync} from './account-sync.js';
import { transferTerms } from './near-protocol.js';
import { readState, updateState } from './chat-store.js';
import { renderProfile, setupContacts } from './contact-ui.js';
import { paintAvatar, privateName } from './profile-display.js';
import { setupProfile } from './profile-ui.js';
import { mountProfilePanels } from './profile-panels.js';
import { requestAutomaticDelivery } from './delivery-mode.js';
import { isTrade } from './trade-model.js';
import { receivePacket } from './receive-packet.js';
import { DELIVERY_RECEIPT, prepareDeliveryReceipt, deliveryAcknowledged } from './delivery-receipts.js';
import { saveOffline } from './save-offline.js';
import { isNearPayment } from './near-payment-service.js';
import { loadChatMoney, mountChatMoney, renderChatMoney, renderNearPaymentCard, chatNearContract } from './near-chat.js';
const $ = selector => document.querySelector(selector);
mountProfilePanels();
startAccountSync();
let active = null, lastPacket = null, busy = false, showThread = true;
const drafts = new Map();
let draftOwner = null;
let draftRevision = 0;
$('#message').addEventListener('input', () => { draftRevision++; });
function selectConversation(id) {
  if (active) drafts.set(active, $('#message').value);
  active = id; $('#message').value = drafts.get(id) ?? ''; showThread = true;
}
const phone = matchMedia('(max-width:760px), (max-width:1000px) and (max-height:500px)'), appNav = $('#chat-app-nav');
function updateNavigation() {
  if (phone.matches) appNav.setAttribute('popover', 'auto');
  else { if (appNav.matches(':popover-open')) appNav.hidePopover(); appNav.removeAttribute('popover'); }
}
updateNavigation(); phone.addEventListener('change', updateNavigation);
appNav.addEventListener('toggle', () => $('#chat-options').setAttribute('aria-expanded', String(appNav.matches(':popover-open'))));
appNav.addEventListener('click', event => {
  if (event.target.closest('button,a') && appNav.matches(':popover-open')) {
    appNav.hidePopover(); $('#chat-options').focus();
  }
}, {capture:true});
const channel = typeof BroadcastChannel === 'function' ? new BroadcastChannel('proof-u-chat-refresh') : null;
function status(text, error = false) { $('#status').textContent = text; $('#status').className = error ? 'status error' : 'status'; }
function element(tag, text, className) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (className) node.className = className; return node; }
function save(value, name) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value)], { type: 'application/json' }));
  const link = element('a'); link.href = url; link.download = name; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function parse(text, limit = 205000) {
  if (new TextEncoder().encode(text).length > limit) throw new Error('This message file is too large.');
  return JSON.parse(text);
}
function chatPayload(payload) {
  if (!payload || payload.kind !== 'chat' || typeof payload.text !== 'string' || !payload.text.trim() || bytes(payload.text).length > 16002) throw new Error('This is not a supported chat message.');
}
async function action(operation) {
  if (busy) return;
  busy = true;
  $('main').setAttribute('aria-busy', 'true');
  try { await operation(); channel?.postMessage('changed'); await render(); }
  catch (error) {
    status(error.message, true);
    if ($('#add-contact').open) { $('#contact-feedback').textContent = error.message; $('#contact-feedback').className = 'error'; }
    if ($('#handover').open) { $('#handover-feedback').textContent = error.message; }
    if ($('#edit-profile').open) { $('#profile-feedback').textContent = error.message; }
  }
  finally { busy = false; $('main').setAttribute('aria-busy', 'false'); }
}
async function render() {
  const state = await readState();
  if (draftOwner !== state.identity?.profile.id) { drafts.clear(); $('#message').value = ''; draftOwner = state.identity?.profile.id; }
  const recovered=state.recoveredChat?await(await import('./chat-restore.js')).readRecoveredHistory(state):null;
  $('#identity-form').hidden = !!state.identity; $('#my-profile').hidden = !state.identity;
  await renderProfile(state.identity?.profile);
  const list = $('#contact-list'); list.replaceChildren();
  $('#people-count').textContent = String(state.contacts.length);
  if (!state.contacts.some(p => p.id === active)) selectConversation(state.contacts[0]?.id ?? null);
  for (const contact of state.contacts) {
    if (!contact.name.toLocaleLowerCase().includes($('#contact-search').value.toLocaleLowerCase())) continue;
    const button = element('button'); button.type = 'button'; button.setAttribute('aria-pressed', String(contact.id === active));
    const avatar = element('span', undefined, 'avatar'); avatar.setAttribute('aria-hidden', 'true'); paintAvatar(avatar, contact);
    const copy = element('span', undefined, 'contact-copy'); copy.append(element('strong', contact.name));
    const latest = state.messages.findLast(record => [record.packet.from, record.packet.to].includes(contact.id));
    let preview = 'Start a conversation';
    if(!latest&&recovered){const earlier=recovered.history.findLast(r=>[r.packet.from,r.packet.to].includes(contact.id));if(earlier)preview=earlier.payload.text;}
    if (latest) {
      const payload = await openMessage(state.identity, contact, latest.packet);
      preview = isNearPayment(payload) ? 'tUSD payment' : isTrade(payload) ? payload.kind === 'trade-payment' ? 'Demo payment card' : 'Demo trade card' : payload.text;
    }
    const earlier=(state.contactRecoveries??[]).some(link=>link.from.id===contact.id);
    copy.append(element('small', earlier?'Earlier ID · '+preview:preview)); button.append(avatar, copy);
    button.onclick = () => action(async () => { selectConversation(contact.id); }); list.append(button);
  }
  $('#people-empty').hidden = !!list.children.length;
  $('#people-empty').textContent = state.contacts.length ? 'No one matches that name.' : 'Your conversations will appear here.';
  const contact = state.contacts.find(p => p.id === active);
  $('main').classList.toggle('has-conversation', !!state.identity && showThread);
  $('#close-people').hidden = !state.identity;
  $('#conversation-name').textContent = contact ? contact.name : 'Your conversations';
  paintAvatar($('#conversation-avatar'), contact ?? {});
  $('#conversation-subtitle').textContent = contact ? `Encrypted between you and ${contact.name}.` : 'Private messages, saved on this device.';
  $('#message').disabled = $('#prepare-message').disabled = !contact;
  const nearMoney = await renderChatMoney(state, contact);
  const messages = $('#messages'); messages.replaceChildren();
  if (!contact) {
    const empty = element('div', undefined, 'empty-conversation'), mark = element('img'); mark.src = '/brand/mark.svg'; mark.alt = '';
    empty.append(mark, element('h3', 'Start a conversation'), element('p', state.identity ? 'Add someone to exchange messages.' : 'Create an account or use this device only.'));
    if (state.identity) { const add = element('button', 'Add someone'); add.type = 'button'; add.onclick = () => $('#show-add-contact').click(); empty.append(add); }
    messages.append(empty); return;
  }
  const history = state.messages.filter(record => [record.packet.from, record.packet.to].includes(contact.id));
  const archived=recovered?.history.filter(r=>[r.packet.from,r.packet.to].includes(contact.id))??[];
  for(const row of archived.slice(-100)){
    const bubble=element('div',row.payload.text,`bubble${row.packet.from===recovered.sourceProfile.id?' outgoing':''}`);
    bubble.append(element('small','From backup'));messages.append(bubble);
  }
  if (!history.length&&!archived.length) messages.append(element('p', 'Your first message starts here.', 'empty'));
  for (const record of history.slice(-100)) {
    const payload = await openMessage(state.identity, contact, record.packet);
    const outgoing = record.packet.from === state.identity.profile.id;
    const paymentBlocked = isNearPayment(payload) && nearMoney?.ledger.blocked.has(await digest(transferTerms(payload.contract, payload.path.at(-1))) + ':0');
    const bubble = element('div', undefined, `bubble${outgoing ? ' outgoing' : ''}${isTrade(payload) || isNearPayment(payload) ? ' financial' : ''}`);
    if (isNearPayment(payload)) bubble.append(await renderNearPaymentCard(payload, record.packet, state, nearMoney));
    else if (isTrade(payload)) {
      const archive = element('article', undefined, 'trade-card');
      archive.append(element('p', 'Archived demo record', 'eyebrow'), element('p', 'This record has no cash value. Demo payments and trades are no longer available.'));
      bubble.append(archive);
    }
    else {
      chatPayload(payload); bubble.textContent = payload.text;
      bubble.append(element('small', outgoing ? await deliveryAcknowledged(state, record) ? 'Receipt received · your contact acknowledged this file' : 'Saved here · delivery not confirmed' : 'Opened here · message checked'));
    }
    if (outgoing && !paymentBlocked) {
      const financial = isNearPayment(payload) || isTrade(payload);
      const download = element('button', isNearPayment(payload) ? 'Save payment file' : isTrade(payload) ? 'Save financial card' : 'Share'); download.type = 'button';
      download.onclick = () => financial ? save(record.packet, `proof-u-message-${record.packet.id}.json`) : action(async () => status(chatShareStatus(await shareChat(record.packet)))); bubble.append(download);
    } else if (!outgoing && !isTrade(payload)) {
      const receipt = element('button', 'Share delivery confirmation'); receipt.type = 'button';
      receipt.onclick = () => action(async () => {
        receipt.disabled = true; receipt.textContent = 'Saving delivery confirmation…';
        try {
          const packet = await updateState(state => prepareDeliveryReceipt(state, record.packet.id));
          const automatic = await expose(packet, 'receipt');
          status(automatic ? 'Delivery confirmation saved to share.' : 'Receipt saved. Share it back so your contact knows you received the file.');
        } finally { receipt.disabled = false; receipt.textContent = 'Share delivery confirmation'; }
      });
      bubble.append(receipt);
    }
    messages.append(bubble);
  }
  messages.scrollTop = messages.scrollHeight;
}
function startIdentity(name, privateProfile = false) { return action(async () => {
  status('Creating your account on this device…');
  await updateState(async state => {
    if (state.identity) throw new Error('This browser already has an identity. Reload to see it.');
    state.identity = await createIdentity(name);
    if (privateProfile) state.identity.profile.avatar = 'moon';
  }); status('Account created. Share your contact card with someone you know.');
}); }
const alias = privateName(); $('#private-default-name').textContent = alias; paintAvatar($('#private-default-avatar'), {});
$('#identity-form').onsubmit = event => { event.preventDefault(); startIdentity($('#name').value); };
$('#continue-private').onclick = () => startIdentity(alias, true);
setupProfile({ action, status });
setupContacts({ action, status, select: selectConversation });
$('#contact-search').oninput = () => action(async () => {});
$('#back-people').onclick = () => { showThread = false; $('main').classList.remove('has-conversation'); $('.people-heading h2').focus(); };
$('#close-people').onclick = () => { showThread = true; $('main').classList.add('has-conversation'); $('#back-people').focus(); };
$('#open-about').onclick = () => $('#about-lenz').showModal();
$('#receive-message').onclick = () => { $('#handover-feedback').textContent = ''; $('#handover').showModal(); };
async function expose(packet, kind = 'message') {
  if (await requestAutomaticDelivery(packet)) return true;
  openHandover(packet, kind);
  return false;
}
function openHandover(packet, kind = 'message') {
  lastPacket = packet; $('#outgoing').value = JSON.stringify(packet); $('#save-message').disabled = false; $('#handover-feedback').textContent = '';
  $('#handover-label').textContent = kind === 'receipt' ? 'Delivery confirmation ready to share' : kind === 'payment' ? 'Payment ready to share' : 'Share a message';
  $('#handover-description').textContent = kind === 'receipt' ? 'Share this encrypted receipt back to your contact. It acknowledges this file only; it does not confirm a payment on NEAR or guarantee its value.' : kind === 'payment' ? 'Save this encrypted payment file and share it with your contact using a nearby sharing app. It is saved in your wallet and this conversation.' : 'Your message is saved. Pass it to your contact using your device’s sharing options.';
  $('#save-message').textContent = kind === 'receipt' ? 'Save delivery confirmation' : kind === 'payment' ? 'Save payment file' : 'Save a copy';
  if (!$('#handover').open) $('#handover').showModal();
}
const chatShareStatus = result => ({automatic:'Message saved for delivery.',shared:'Message shared. Delivery is not confirmed.',cancelled:'Sharing cancelled. Your message is saved. Tap Share to try again.',retry:'Message saved. Tap Share to choose where to send it.',file:'Message saved. Choose how to share it.'})[result];
async function deliverChat(packet) {
  if (await requestAutomaticDelivery(packet)) return 'automatic';
  return shareChat(packet);
}
async function shareChat(packet) {
  const file = new File([JSON.stringify(packet)], `lenz-message-${packet.id}.json`, {type:'application/json'});
  if (typeof navigator.share === 'function' && navigator.canShare?.({files:[file]})) {
    if (draftOwner !== packet.from) throw Error('This message is no longer available in the current account.');
    if (navigator.userActivation && !navigator.userActivation.isActive) return 'retry';
    // Callers provide a committed packet. Keep this call before any await so Share retains its user gesture.
    try { await navigator.share({files:[file],title:'Lenz message'}); return 'shared'; }
    catch (error) { if (error.name === 'AbortError') return 'cancelled'; if (error.name === 'NotAllowedError') return 'retry'; }
  }
  openHandover(packet);
  return 'file';
}
mountChatMoney({ action, status, selected: () => active, expose });
$('#compose').onsubmit = event => { event.preventDefault(); action(async () => {
  const payload = { kind: 'chat', text: $('#message').value }; chatPayload(payload);
  const recipient = active, revision = draftRevision, owner = draftOwner; status('Saving your message…');
  const packet = await updateState(async state => {
    if (state.identity?.profile.id !== owner) throw new Error('Your account changed. Reload before sending.');
    const contact = state.contacts.find(p => p.id === recipient); if (!contact) throw new Error('Choose a contact first.');
    if (state.messages.length >= 1000) throw new Error('This device has reached its 1,000-message storage limit. Save a chat backup before clearing space.');
    const packet = await sealMessage(state.identity, contact, payload);
    state.messages.push({ packet }); return packet;
  });
  // Delivery starts only after encrypted history has been committed.
  if (revision === draftRevision) { drafts.delete(recipient); $('#message').value = ''; }
  else drafts.set(recipient, $('#message').value);
  status(chatShareStatus(await deliverChat(packet)));
}); };
$('#save-message').onclick = () => { if (lastPacket) save(lastPacket, `proof-u-message-${lastPacket.id}.json`); };
$('#incoming-file').onchange = () => action(async () => {
  const file = $('#incoming-file').files[0]; if (!file) return;
  if (file.size > 205000) throw new Error('This message file is too large.');
  $('#incoming').value = await file.text(); status('File loaded. Choose Open message to check it.');
});
$('#open-message').onclick = () => action(async () => {
  const packet = parse($('#incoming').value);
  const received = await updateState(state => receivePacket(state, packet, false, chatNearContract()));
  selectConversation(received.contactId); const duplicate = received.duplicate;
  $('#incoming').value = ''; $('#incoming-file').value = ''; status(received.kind === DELIVERY_RECEIPT ? duplicate ? 'This receipt is already saved.' : 'Receipt received from your contact. Payment confirmation is separate.' : duplicate ? 'This message was already opened. No duplicate was added.' : received.kind === 'lenz-near-payment-v1' ? 'Payment received. You can pass it onward offline. Connect to confirm it.' : 'Message opened. Message check passed.');
  $('#handover').close();
});
$('#prepare-offline').onclick = () => action(async () => {
  await saveOffline();
  status('Conversation files saved. Reload once, then this page can open without its server. Browser storage can still be cleared.');
});
channel?.addEventListener('message', () => { if (!busy) render().catch(error => status(error.message, true)); });
try { await loadChatMoney(); } catch { $('#chat-wallet-note').textContent = 'Test dollars are unavailable. Private messages still work.'; }
try { await render(); status('Private chat is ready.'); }
catch (error) { status(error.message, true); }
