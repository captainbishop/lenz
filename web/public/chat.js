import { createIdentity, sealMessage, openMessage, bytes } from './peer-crypto.js';
import {startAccountSync} from './account-sync.js';
import { readState, updateState } from './chat-store.js';
import { renderProfile, setupContacts } from './contact-ui.js';
import { paintAvatar, privateName } from './profile-display.js';
import { setupProfile } from './profile-ui.js';
import { mountProfilePanels } from './profile-panels.js';
import { requestAutomaticDelivery, prepareChatDelivery } from './delivery-mode.js';
import { isTrade } from './trade-model.js';
import { deliveryAcknowledged } from './delivery-receipts.js';
import {startOfflineAccess} from './offline-access.js';
import { isNearPayment } from './near-payment-service.js';
import { loadChatMoney, mountChatMoney, renderChatMoney, renderNearPaymentCard } from './near-chat.js';
import {isContactControl,contactRequestStatus} from './contact-requests.js';
import {pendingContactRequests,contactRequestState,renderContactRequests,renderRequestReview} from './contact-request-ui.js';
const $ = selector => document.querySelector(selector);
mountProfilePanels();
startAccountSync();
let active = null, busy = false, showThread = true;
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
  const requests=pendingContactRequests(state);
  if (!state.contacts.some(p => p.id === active)&&!requests.some(r=>r.peerId===active)) {
    const fallback = state.contacts[0]?.id ?? null;
    if (active !== fallback) selectConversation(fallback);
  }
  for (const contact of state.contacts) {
    if (!contact.name.toLocaleLowerCase().includes($('#contact-search').value.toLocaleLowerCase())) continue;
    const button = element('button'); button.type = 'button'; button.setAttribute('aria-pressed', String(contact.id === active));
    const avatar = element('span', undefined, 'avatar'); avatar.setAttribute('aria-hidden', 'true'); paintAvatar(avatar, contact);
    const copy = element('span', undefined, 'contact-copy'); copy.append(element('strong', contact.name));
    const history=state.messages.filter(record => [record.packet.from, record.packet.to].includes(contact.id));
    let latest,payload;
    for(const record of history.toReversed()){
      const opened=await openMessage(state.identity,contact,record.packet);if(!isContactControl(opened)){latest=record;payload=opened;break;}
    }
    let preview = 'Start a conversation';
    if(!latest&&recovered){const earlier=recovered.history.findLast(r=>[r.packet.from,r.packet.to].includes(contact.id)&&!isContactControl(r.payload));if(earlier)preview=earlier.payload.text;}
    if (latest) {
      preview = isNearPayment(payload) ? 'tUSD payment' : isTrade(payload) ? payload.kind === 'trade-payment' ? 'Demo payment card' : 'Demo trade card' : payload.text;
    }
    const request=contactRequestState(state,contact.id);
    if(!latest&&request?.direction==='outgoing')preview=request.status==='pending'?'Request pending':request.status==='declined'?'Request declined':'Start a conversation';
    if(contactRequestStatus(state,contact.id)==='declined')preview='Request declined';
    const earlier=(state.contactRecoveries??[]).some(link=>link.from.id===contact.id);
    copy.append(element('small', earlier?'Earlier ID · '+preview:preview)); button.append(avatar, copy);
    button.onclick = () => action(async () => { selectConversation(contact.id); }); list.append(button);
  }
  renderContactRequests(state,active,id=>action(async()=>{selectConversation(id);}));
  $('#people-empty').hidden = !!list.children.length||!!$('#request-list').children.length;
  $('#people-empty').textContent = state.contacts.length ? 'No one matches that name.' : 'Your conversations will appear here.';
  const contact = state.contacts.find(p => p.id === active)??requests.find(r=>r.peerId===active)?.profile;
  const request=contactRequestState(state,active),requestStatus=contactRequestStatus(state,active),pendingIncoming=request?.direction==='incoming'&&request.status==='pending',declined=requestStatus==='declined';
  $('main').classList.toggle('has-conversation', !!state.identity && showThread);
  $('#close-people').hidden = !state.identity;
  $('#conversation-name').textContent = contact ? contact.name : 'Your conversations';
  paintAvatar($('#conversation-avatar'), contact ?? {});
  $('#conversation-subtitle').textContent = contact ? declined?'Request declined':pendingIncoming?'Message request · accept to reply':request?.direction==='outgoing'&&request.status==='pending'?'Request pending · waiting for acceptance':`Encrypted between you and ${contact.name}.` : 'Private messages, saved on this device.';
  $('#message').disabled = $('#prepare-message').disabled = !contact||pendingIncoming||declined;
  const nearMoney = await renderChatMoney(state, requestStatus==='pending'||declined?null:contact);
  renderRequestReview(state,request,{action,status,select:selectConversation});
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
    if(isContactControl(row.payload))continue;
    const bubble=element('div',row.payload.text,`bubble${row.packet.from===recovered.sourceProfile.id?' outgoing':''}`);
    bubble.append(element('small','From backup'));messages.append(bubble);
  }
  if (!history.length&&!archived.length) messages.append(element('p', 'Your first message starts here.', 'empty'));
  for (const record of history.slice(-100)) {
    const payload = await openMessage(state.identity, contact, record.packet);
    if(isContactControl(payload))continue;
    const outgoing = record.packet.from === state.identity.profile.id;
    const bubble = element('div', undefined, `bubble${outgoing ? ' outgoing' : ''}${isTrade(payload) || isNearPayment(payload) ? ' financial' : ''}`);
    if (isNearPayment(payload)) bubble.append(await renderNearPaymentCard(payload, record.packet, state, nearMoney));
    else if (isTrade(payload)) {
      const archive = element('article', undefined, 'trade-card');
      archive.append(element('p', 'Archived demo record', 'eyebrow'), element('p', 'This record has no cash value. Demo payments and trades are no longer available.'));
      bubble.append(archive);
    }
    else {
      chatPayload(payload); bubble.textContent = payload.text;
      const queue=state.nostr?.outbox.find(entry=>entry.packetId===record.packet.id);
      const waiting=state.nostr?.enabled&&!state.nostr.excluded?.includes(record.packet.id)&&queue?.expiresAt>Date.now();
      bubble.append(element('small', outgoing ? await deliveryAcknowledged(state, record) ? 'Received · your contact acknowledged this message' : queue?.storedBy.length?'Sent · waiting for your contact':record.deliveryRequested||waiting?'Waiting to send · saved on this device':'Saved here · delivery not confirmed' : 'Received · message checked'));
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
async function expose(packet) {
  if(!await requestAutomaticDelivery(packet))throw Error('Your account changed. The original item stays saved.');
  return true;
}
mountChatMoney({ action, status, selected: () => active, expose });
$('#compose').onsubmit = event => { event.preventDefault(); action(async () => {
  const payload = { kind: 'chat', text: $('#message').value }; chatPayload(payload);
  const recipient = active, revision = draftRevision, owner = draftOwner; status('Saving your message…');
  await prepareChatDelivery(owner);
  const packet = await updateState(async state => {
    if (state.identity?.profile.id !== owner) throw new Error('Your account changed. Reload before sending.');
    const contact = state.contacts.find(p => p.id === recipient); if (!contact) throw new Error('Choose a contact first.');
    if(contactRequestStatus(state,recipient)==='declined')throw Error('This message request was declined.');
    if (state.messages.length >= 1000) throw new Error('This device has reached its 1,000-message storage limit. Save a chat backup before clearing space.');
    const packet = await sealMessage(state.identity, contact, payload);
    state.messages.push({ packet, deliveryRequested:true }); return packet;
  });
  // Delivery starts only after encrypted history has been committed.
  if (revision === draftRevision) { drafts.delete(recipient); $('#message').value = ''; }
  else drafts.set(recipient, $('#message').value);
  await expose(packet);status('Message saved for delivery.');
}); };
startOfflineAccess($('#chat-cache-status'));
channel?.addEventListener('message', () => { if (!busy) render().catch(error => status(error.message, true)); });
try { await loadChatMoney(); } catch { $('#chat-wallet-note').textContent = 'Test dollars are unavailable. Private messages still work.'; }
try { await render(); status('Private chat is ready.'); }
catch (error) { status(error.message, true); }
