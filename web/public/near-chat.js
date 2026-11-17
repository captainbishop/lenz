import { readState, updateState } from './chat-store.js';
import { compressed, displayUnits, nearLedger, readNearVault, transferTerms } from './near-protocol.js';
import { digest } from './peer-crypto.js';
import { prepareNearPayment } from './near-payment-service.js';
import { confirmNearPayment, refreshNearPayments } from './near-payment-status.js';
import { deliveryMode, internetConnection, bluetoothConnection, prepareChatDelivery } from './delivery-mode.js';
import { walletError } from './wallet-feedback.js';
import { deliveryAcknowledged } from './delivery-receipts.js';
import {isRecoveredChat,isRecoveredContact} from './chat-access.js';
const $ = s => document.querySelector(s);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
let config = null;
let paymentAction, updateChatDelivery = () => {};
const paymentFeedback = new Map();
function paymentConnection() {
  document.querySelectorAll('[data-near-online]').forEach(button => { button.disabled = !navigator.onLine || button.dataset.nearBusy === 'true'; });
}
export const chatNearContract = () => config?.ready ? config.contract : null;
export async function loadChatMoney() {
  const response = await fetch('/near-config.json'); if (!response.ok) throw Error('Test wallet unavailable');
  const c = await response.json();
  if (c.network !== 'testnet' || typeof c.contract !== 'string' || c.contract.length > 64 || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(c.contract)) throw Error('Invalid test wallet');
  config = c;
}
export function mountChatMoney({ action, status, selected, expose }) {
  paymentAction = action;
  let recipient = null, paymentOwner = null;
  const connection = () => {
    const mode = deliveryMode(selected()), payMode = deliveryMode($('#chat-pay-dialog').open ? recipient : selected());
    $('#prepare-message').textContent = 'Send';
    if (!$('#chat-pay-submit').disabled) $('#chat-pay-submit').textContent = 'Send payment';
    $('#chat-pay-delivery').textContent = payMode === 'nearby'||payMode==='bluetooth' ? 'Sends nearby. Payment confirmation happens separately.' : 'Saved payments wait for a connection. Your contact can pass them onward offline.';
    const connection=internetConnection();
    const radio=bluetoothConnection();
    $('#chat-connection').textContent = mode === 'nearby' ? 'Nearby · connected to ' + $('#conversation-name').textContent + ' · keep Lenz open' : mode==='bluetooth'?radio.peers?'Nearby · '+radio.peers+' device'+(radio.peers===1?'':'s')+' · keep Lenz open':'Nearby · looking for devices':mode === 'automatic' ? !navigator.onLine ? 'Offline · messages will send when connected' : connection==='online'?'Online · encrypted chat':connection==='unavailable'?'Chat connection unavailable · retrying':connection==='connecting'?'Connecting to chat…':'Automatic delivery · keep Lenz open' : radio.supported?'Nearby is off · messages stay queued':'Messages stay queued until a connection returns';
    const privacy=$('#chat-delivery-note');if(privacy)privacy.textContent=mode==='nearby'||mode==='bluetooth'?'Nearby devices carry encrypted messages. Presence, routing IDs, sizes and timing remain visible.':mode==='automatic'?'Keep Lenz open. Relays carry encrypted messages and can see your IP address and timing.':'Use Nearby on the native app or enable internet delivery.';
  };
  updateChatDelivery = connection;
  const updateConnection = () => { connection(); paymentConnection(); };
  addEventListener('lenz-delivery-mode', updateConnection);
  addEventListener('online', updateConnection); addEventListener('offline', updateConnection); updateConnection();
  $('#pay-tusd').onclick = () => action(async () => {
    const state = await readState(), contact = state.contacts.find(c => c.id === selected());
    if (!contact || !chatNearContract()) return;
    recipient = contact.id;paymentOwner=state.identity.profile.id;
    $('#chat-pay-form').reset(); $('#chat-pay-title').textContent = `Pay ${contact.name}`;
    $('#chat-pay-feedback').textContent = ''; $('#chat-pay-dialog').showModal(); connection();
  });
  $('#chat-pay-close').onclick = () => $('#chat-pay-dialog').close();
  $('#chat-pay-form').onsubmit = event => { event.preventDefault(); action(async () => {
    const button = $('#chat-pay-submit'); button.disabled = true; button.textContent = 'Saving payment…';
    try {
      const owner=paymentOwner,amount=$('#chat-pay-amount').value;await prepareChatDelivery(owner);
      const packet = await updateState(async state => {
        if(state.identity?.profile.id!==owner)throw Error('Your account changed. Reload before sending.');
        const packet=await prepareNearPayment(state, chatNearContract(), recipient, amount);
        state.messages.find(record=>record.packet.id===packet.id).deliveryRequested=true;return packet;
      });
      $('#chat-pay-dialog').close(); const automatic = await expose(packet, 'payment');
      status(automatic ? 'Payment saved for delivery. Confirmation happens separately.' : 'Payment stays saved for delivery. Confirmation happens separately.');
    } catch (error) { const message = error.message?.startsWith('Your account changed.')?'Your account changed. Open the payment again.':walletError(error); $('#chat-pay-feedback').textContent = message; throw Error(message); }
    finally { button.disabled = false; connection(); }
  }); };
}
export async function renderChatMoney(state, contact) {
  updateChatDelivery();
  $('#chat-wallet').hidden = !state.identity;
  $('#pay-tusd').disabled = !state.identity || !contact || !chatNearContract() || isRecoveredChat(state.identity) || isRecoveredContact(state,contact?.id);
  if(isRecoveredChat(state.identity)){$('#chat-balance').textContent='Funds not restored';$('#chat-wallet-note').textContent='Your recovered account is open for chat.';return null;}
  if (!state.identity || !chatNearContract()) { $('#chat-balance').textContent = 'Open wallet'; return null; }
  const vault = await readNearVault(state, config.contract), ledger = await nearLedger(vault);
  const owner = compressed(state.identity.profile.signingPublic);
  const total = ledger.available.filter(n => n.owner === owner).reduce((sum, n) => sum + BigInt(n.amount), 0n);
  $('#chat-balance').textContent = `${displayUnits(total)} tUSD`;
  return { vault, ledger };
}
export async function renderNearPaymentCard(payload, packet, state, money) {
  const outgoing = packet.from === state.identity.profile.id, card = el('article', undefined, 'trade-card near-chat-card');
  const acknowledged = outgoing && await deliveryAcknowledged(state, state.messages.find(r => r.packet.id === packet.id));
  const id = await digest(transferTerms(payload.contract, payload.path.at(-1))), noteId = `${id}:0`;
  card.append(el('p', 'tUSD · NEAR TESTNET', 'eyebrow'), el('h3', money?.ledger.blocked.has(noteId) ? 'Payment could not be confirmed' : outgoing ? acknowledged ? 'Payment received' : 'Payment waiting to send' : 'Payment received'));
  card.append(el('p', `${displayUnits(payload.path.at(-1).amount)} tUSD`, 'payment-amount'));
  let detail = outgoing ? acknowledged ? 'Contact acknowledged receipt · awaiting online confirmation' : 'Saved for delivery · confirmation is separate' : 'Received on this device · awaiting online confirmation';
  if (money?.ledger.blocked.has(noteId)) detail = 'Payment could not be confirmed · excluded from your balance';
  else if (!outgoing && money?.ledger.reserved.has(noteId)) detail = 'Set aside for a saved swap · check the wallet for its status';
  else if (!outgoing && money?.ledger.consumed.has(noteId)) detail = 'Used in a later payment or saved swap · check the wallet for its status';
  else if (money?.vault.receipts[id]?.finality === 'FINAL') detail = outgoing ? acknowledged ? 'Confirmed on NEAR · receipt received' : 'Confirmed on NEAR · recipient arrival not confirmed' : 'Payment confirmed on NEAR';
  else if (!outgoing && money?.vault.confirmations?.[noteId]) detail = 'Confirmation pending · check for an update';
  card.append(el('p', detail, 'trade-state'));
  if (acknowledged) card.append(el('p', 'Receipt received · your contact acknowledged the payment. Confirmation on NEAR is separate.', 'delivery-state'));
  card.append(el('small', 'Payment instructions are encrypted. Settlement amounts and accounts are public on the test network.'));
  if (paymentAction && money?.ledger.notes?.has(noteId)) {
    const controls = el('div', undefined, 'near-payment-actions');
    const feedback = el('p', paymentFeedback.get(packet.id) ?? '', 'near-payment-feedback'); feedback.setAttribute('role', 'status');
    const addAction = (label, operation) => {
      const button = el('button', label, 'secondary'); button.type = 'button'; button.dataset.nearOnline = '';
      button.disabled = !navigator.onLine;
      button.onclick = () => paymentAction(async () => {
        controls.querySelectorAll('button').forEach(b => { b.disabled = true; b.dataset.nearBusy = 'true'; });
        feedback.textContent = label === 'Check status' ? 'Checking payment…' : 'Confirming payment…';
        try { paymentFeedback.set(packet.id, await operation()); }
        catch (error) { paymentFeedback.set(packet.id, walletError(error)); }
        finally { controls.querySelectorAll('button').forEach(b => { b.dataset.nearBusy = 'false'; }); paymentConnection(); }
      });
      controls.append(button);
    };
    addAction('Check status', async () => { await refreshNearPayments(payload.contract); return 'Status checked on NEAR.'; });
    if (!outgoing && !money.ledger.blocked.has(noteId) && !money.ledger.consumed.has(noteId) && !money.ledger.reserved.has(noteId) && !money.vault.receipts[id]) {
      const retry = !!money.vault.confirmations?.[noteId];
      addAction(retry ? 'Retry confirmation' : 'Confirm payment', async () => {
        const result = await confirmNearPayment(payload.contract, noteId, { retry });
        return result.status === 'confirmed' ? 'Payment confirmed.' : result.status === 'pending' ? 'Confirmation is still pending. Check again, or choose Retry confirmation to resend the same signed payment.' : 'This money was used in another payment. It is excluded from your balance.';
      });
    }
    card.append(controls, feedback);
  }
  const wallet = el('a', 'Open in wallet'); wallet.href = '/money.html'; card.append(wallet);
  return card;
}
