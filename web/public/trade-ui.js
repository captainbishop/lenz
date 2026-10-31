import { readState, updateState } from './chat-store.js';
import { openMessage } from './peer-crypto.js';
import { ASSETS, availableNotes, tradeLedger, terms, isTrade } from './trade-model.js';
import { readTradeVault, enableDemoMoney, prepareTrade, agreeToTrade } from './trade-service.js';
const $ = selector => document.querySelector(selector);
const el = (tag, text, className) => { const n = document.createElement(tag); if (text !== undefined) n.textContent = text; if (className) n.className = className; return n; };
const unit = (value, asset) => `${value} ${ASSETS[asset]}`;
let peerId = null, reviewPacket = null;
export async function renderMoney(state, contact) {
  const vault = await readTradeVault(state);
  $('#demo-money').hidden = !state.identity;
  $('#enable-demo').hidden = !!vault; $('#money-balances').hidden = !vault;
  $('#offer-trade').disabled = $('#send-money').disabled = !vault || !contact;
  if (!vault) return null;
  const own = await availableNotes(vault, state.identity.profile.signingPublic), list = $('#money-balances'); list.replaceChildren();
  for (const asset of Object.keys(ASSETS)) {
    const total = group => String(group.filter(n => n.asset === asset).reduce((sum, n) => sum + BigInt(n.value), 0n));
    const row = el('div', undefined, 'balance-row'); row.dataset.asset = asset;
    row.append(el('strong', total(own.available)), el('span', ASSETS[asset]));
    if (total(own.held) !== '0') row.append(el('small', `${total(own.held)} held for an offer`));
    list.append(row);
  }
  return { vault, notes: new Map((await tradeLedger(vault)).snapshot().notes.map(n => [n.id, n])) };
}
export function renderTradeCard(payload, packet, state, money, onReview) {
  if (!isTrade(payload) || !money) throw new Error('This financial card needs its saved demo workspace.');
  const detail = terms(payload.agreement, money.notes), owner = state.identity.profile.signingPublic;
  const outgoing = packet.from === state.identity.profile.id;
  const agreed = money.vault.agreements.some(a => a.id === payload.agreement.id);
  const card = el('article', undefined, 'trade-card'); card.dataset.agreement = payload.agreement.id;
  if (payload.kind === 'trade-agreed') {
    const peer = state.contacts.find(p => p.id === packet.from);
    card.classList.add('trade-receipt');
    card.append(el('p', outgoing ? 'You agreed to the trade.' : `${peer?.name ?? 'Your contact'} agreed to the trade.`));
    card.append(el('small', 'Agreement saved on this device.'));
    return card;
  }
  const swap = payload.agreement.body.kind === 'swap';
  card.append(el('p', 'DEMO MONEY', 'eyebrow'), el('h3', swap ? 'A trade between you' : outgoing ? 'Payment prepared' : 'Payment received'));
  if (swap) {
    const initiator = detail.from === owner;
    const give = initiator ? unit(detail.give, detail.giveAsset) : unit(detail.get, detail.getAsset);
    const get = initiator ? unit(detail.get, detail.getAsset) : unit(detail.give, detail.giveAsset);
    const rows = el('dl', undefined, 'trade-amounts');
    rows.append(el('dt', 'You give'), el('dd', give), el('dt', 'You get'), el('dd', get)); card.append(rows);
    card.append(el('p', agreed ? 'Agreed locally' : outgoing ? 'Waiting for agreement' : 'Ready for your review', 'trade-state'));
    if (!outgoing && payload.kind === 'trade-offer' && !agreed) {
      const button = el('button', 'Review offer'); button.type = 'button'; button.className = 'review-offer'; button.onclick = () => onReview(packet.id); card.append(button);
    }
  } else {
    card.append(el('p', unit(detail.give, detail.giveAsset), 'payment-amount'));
    card.append(el('p', outgoing ? 'Saved here · share it with your contact' : 'Received locally · ready to pass on', 'trade-state'));
  }
  card.append(el('small', 'Demo assets · no real funds or chain settlement'));
  return card;
}
export function setupTrades({ action, status, selected, expose }) {
  $('#enable-demo').onclick = () => action(async () => {
    await updateState(enableDemoMoney); status('Demo money is ready: 100 demo dollars and 50 demo coins.');
  });
  async function openForm(mode) {
    const state = await readState(), contact = state.contacts.find(p => p.id === selected());
    if (!contact || !state.tradeBox) return;
    peerId = contact.id; reviewPacket = null;
    $('#trade-form').hidden = false; $('#trade-review').hidden = true;
    $('#trade-mode').value = mode; $('#trade-title').textContent = mode === 'swap' ? `Trade with ${contact.name}` : `Pay ${contact.name}`;
    $('#trade-exchange-fields').hidden = mode !== 'swap'; $('#trade-get').required = mode === 'swap';
    $('#trade-give').value = ''; $('#trade-get').value = '';
    $('#trade-give-asset').value = 'DEMO-USD'; $('#trade-get-asset').value = 'DEMO-COIN';
    $('#trade-submit').textContent = mode === 'swap' ? 'Prepare offer' : 'Prepare payment';
    $('#trade-feedback').textContent = ''; $('#trade-dialog').showModal();
  }
  $('#offer-trade').onclick = () => action(() => openForm('swap'));
  $('#send-money').onclick = () => action(() => openForm('payment'));
  $('#trade-form').onsubmit = event => { event.preventDefault(); action(async () => {
    const fields = { mode: $('#trade-mode').value, give: $('#trade-give').value, giveAsset: $('#trade-give-asset').value,
      get: $('#trade-get').value, getAsset: $('#trade-get-asset').value };
    const packet = await updateState(state => prepareTrade(state, peerId, fields));
    $('#trade-dialog').close(); expose(packet);
    status(fields.mode === 'swap' ? 'Offer saved. Share it with your contact to agree.' : 'Payment saved. Share it with your contact.');
  }); };
  const review = packetId => action(async () => {
    const state = await readState(), record = state.messages.find(r => r.packet.id === packetId);
    const contact = state.contacts.find(p => p.id === record?.packet.from);
    if (!contact) throw new Error('Choose an incoming offer.');
    const payload = await openMessage(state.identity, contact, record.packet), money = await renderMoney(state, contact);
    reviewPacket = packetId; $('#trade-title').textContent = `Review with ${contact.name}`;
    $('#trade-form').hidden = true; $('#trade-review').hidden = false;
    const card = renderTradeCard(payload, record.packet, state, money, () => {});
    card.querySelector('.review-offer')?.remove(); $('#trade-review-card').replaceChildren(card);
    $('#trade-feedback').textContent = ''; $('#trade-dialog').showModal();
  });
  $('#agree-trade').onclick = () => action(async () => {
    const packet = await updateState(state => agreeToTrade(state, reviewPacket));
    $('#trade-dialog').close(); expose(packet); status('Trade agreed locally. Share the reply so your contact can use their received value.');
  });
  return review;
}
