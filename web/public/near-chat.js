import { readState, updateState } from './chat-store.js';
import { compressed, displayUnits, nearLedger, readNearVault, transferTerms } from './near-protocol.js';
import { digest } from './peer-crypto.js';
import { prepareNearPayment } from './near-payment-service.js';
import { confirmNearPayment, refreshNearPayments } from './near-payment-status.js';
import { walletError } from './wallet-feedback.js';
const $ = s => document.querySelector(s);
const el = (tag, text, cls) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (cls) n.className = cls; return n; };
let config = null;
let paymentAction;
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
  let recipient = null;
  const connection = () => { $('#chat-connection').textContent = navigator.onLine ? 'Prepare messages and payments here, then share their encrypted files. Swaps and final confirmation need a connection.' : 'You’re offline. Keep messaging and paying by file. Received money can be passed onward; final confirmation waits for a connection.'; };
  const updateConnection = () => { connection(); paymentConnection(); };
  addEventListener('online', updateConnection); addEventListener('offline', updateConnection); updateConnection();
  $('#pay-tusd').onclick = () => action(async () => {
    const state = await readState(), contact = state.contacts.find(c => c.id === selected());
    if (!contact || !chatNearContract()) return;
    recipient = contact.id;
    $('#chat-pay-form').reset(); $('#chat-pay-title').textContent = `Pay ${contact.name}`;
    $('#chat-pay-feedback').textContent = ''; $('#chat-pay-dialog').showModal();
  });
  $('#chat-pay-close').onclick = () => $('#chat-pay-dialog').close();
  $('#chat-pay-form').onsubmit = event => { event.preventDefault(); action(async () => {
    const button = $('#chat-pay-submit'); button.disabled = true; button.textContent = 'Saving payment…';
    try {
      const packet = await updateState(state => prepareNearPayment(state, chatNearContract(), recipient, $('#chat-pay-amount').value));
      $('#chat-pay-dialog').close(); expose(packet, 'payment');
      status('Payment saved. Share the encrypted file. Your contact can pass the money onward offline.');
    } catch (error) { const message = walletError(error); $('#chat-pay-feedback').textContent = message; throw Error(message); }
    finally { button.disabled = false; button.textContent = 'Save payment to share'; }
  }); };
}
export async function renderChatMoney(state, contact) {
  $('#chat-wallet').hidden = !state.identity;
  $('#pay-tusd').disabled = !state.identity || !contact || !chatNearContract();
  if (!state.identity || !chatNearContract()) { $('#chat-balance').textContent = 'Open wallet'; return null; }
  const vault = await readNearVault(state, config.contract), ledger = await nearLedger(vault);
  const owner = compressed(state.identity.profile.signingPublic);
  const total = ledger.available.filter(n => n.owner === owner).reduce((sum, n) => sum + BigInt(n.amount), 0n);
  $('#chat-balance').textContent = `${displayUnits(total)} tUSD`;
  return { vault, ledger };
}
export async function renderNearPaymentCard(payload, packet, state, money) {
  const outgoing = packet.from === state.identity.profile.id, card = el('article', undefined, 'trade-card near-chat-card');
  card.append(el('p', 'tUSD · NEAR TESTNET', 'eyebrow'), el('h3', outgoing ? 'Payment ready to share' : 'Payment received'));
  card.append(el('p', `${displayUnits(payload.path.at(-1).amount)} tUSD`, 'payment-amount'));
  const id = await digest(transferTerms(payload.contract, payload.path.at(-1))), noteId = `${id}:0`;
  let detail = outgoing ? 'Saved here · delivery not confirmed' : 'Received on this device · awaiting online confirmation';
  if (money?.ledger.blocked.has(noteId)) detail = 'Payment could not be confirmed · excluded from your balance';
  else if (!outgoing && money?.ledger.reserved.has(noteId)) detail = 'Set aside for a saved swap · check the wallet for its status';
  else if (!outgoing && money?.ledger.consumed.has(noteId)) detail = 'Used in a later payment or saved swap · check the wallet for its status';
  else if (money?.vault.receipts[id]?.finality === 'FINAL') detail = outgoing ? 'Confirmed on NEAR · file delivery not confirmed' : 'Payment confirmed on NEAR';
  else if (!outgoing && money?.vault.confirmations?.[noteId]) detail = 'Confirmation pending · check for an update';
  card.append(el('p', detail, 'trade-state'));
  card.append(el('small', 'The file is encrypted. Settlement amounts and accounts are public on the test network.'));
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
