import { createStore, amount, displayAmount, balance, sendPayment, receivePayment } from './wallet.js';
import { proveInWorker } from './proof-worker.js';
const $ = selector => document.querySelector(selector);
const STORAGE = 'proof-u-web-demo-v1';
let store, busy = false;
function status(text, kind = '') { $('#status').textContent = text; $('#status').className = `status ${kind}`; }
function setBusy(value) {
  busy = value;
  for (const selector of ['#send', '#receive', '#person', '#create-payment']) $(selector).disabled = value;
  $('#create-payment').textContent = value ? 'Creating proof…' : 'Create payment ↗';
  for (const button of document.querySelectorAll('[data-open-payment]')) button.disabled = value;
}
async function transaction(operation) {
  if (!navigator.locks) throw new Error('This browser needs Web Locks support for the demo. Try a current Chrome, Edge, Firefox or Safari.');
  return navigator.locks.request(STORAGE, async () => {
    const current = JSON.parse(localStorage.getItem(STORAGE)) ?? createStore();
    const result = await operation(current);
    localStorage.setItem(STORAGE, JSON.stringify(current));
    store = current; return result;
  });
}
function element(tag, className, text) { const node = document.createElement(tag); node.className = className; if (text !== undefined) node.textContent = text; return node; }
function download(item) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(item.packet)], { type: 'application/json' }));
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = `proof-u-payment-${item.id.slice(0, 8)}.json`; anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function render() {
  const wallet = store.wallets.find(w => w.id === store.active);
  $('#person').replaceChildren(...store.wallets.map(w => new Option(w.name, w.id)));
  $('#person').value = wallet.id;
  $('#balance-label').textContent = `${wallet.name}'s demo balance`;
  $('#balance').textContent = displayAmount(balance(wallet));
  $('#recipient').replaceChildren(...store.wallets.filter(w => w.id !== wallet.id).map(w => new Option(w.name, w.id)));
  const activity = $('#activity'); activity.replaceChildren();
  if (!wallet.history.length) activity.append(element('div', 'empty', 'Your first handover starts here. Send or receive a demo payment.'));
  for (const entry of wallet.history.slice(0, 12)) {
    const row = element('div', 'activity-row'); row.append(element('span', 'activity-icon', entry.type === 'sent' ? '↗' : '↙'));
    const text = element('div', 'activity-text'); text.append(element('strong', '', `${entry.type === 'sent' ? 'Sent to' : 'Received from'} ${entry.person}`));
    text.append(element('small', '', new Date(entry.time).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })));
    const value = element('div', 'activity-value', `${entry.type === 'sent' ? '−' : '+'}${displayAmount(entry.amount)}`);
    value.append(element('small', '', entry.type === 'sent' ? 'Prepared locally' : 'Proof verified locally'));
    row.append(text, value);
    const item = store.outbox.find(p => p.id === entry.handoff);
    if (entry.type === 'sent' && item) { const button = element('button', 'download', 'Save file'); button.onclick = () => download(item); row.append(button); }
    activity.append(row);
  }
  const incoming = $('#incoming'); incoming.replaceChildren();
  const payments = store.outbox.filter(p => p.recipient === wallet.id);
  if (!payments.length) incoming.append(element('div', 'empty', 'No incoming demo payments yet.'));
  for (const item of payments) {
    const row = element('div', 'incoming-item'); row.append(element('span', '', `${displayAmount(item.amount)} from ${item.sender}`));
    const button = element('button', '', item.received ? 'Open again' : 'Open payment'); button.dataset.openPayment = item.id;
    button.onclick = () => receive(item.packet); row.append(button); incoming.append(row);
  }
  setBusy(busy);
}
async function receive(packet) {
  if (busy) return;
  setBusy(true); $('#receive-error').textContent = ''; status('Checking the payment proof on this device…', 'busy');
  try {
    const result = await transaction(s => receivePayment(s, s.active, packet));
    render(); $('#receive-dialog').close();
    status(result.duplicate ? 'This payment was already received. Your balance has not changed.' : `${displayAmount(result.amount)} demo units received. The proof is verified locally; no chain settlement occurred.`);
  } catch (error) { $('#receive-error').textContent = error.message; status('The payment was not accepted. Your balance has not changed.', 'error'); }
  finally { setBusy(false); }
}
function prove(input) {
  return proveInWorker(input, stage => {
    $('#create-payment').textContent = stage;
    status(stage + ' All work stays on this device.', 'busy');
  });
}
$('#send').onclick = () => { $('#send-error').textContent = ''; $('#send-dialog').showModal(); $('#amount').focus(); };
$('#receive').onclick = () => { $('#receive-error').textContent = ''; render(); $('#receive-dialog').showModal(); };
$('#how').onclick = () => $('#about-dialog').showModal();
document.querySelectorAll('[data-close]').forEach(button => button.onclick = () => button.closest('dialog').close());
$('#person').onchange = async event => {
  const active = event.target.value;
  try { await transaction(s => { s.active = active; }); render(); status(`Viewing ${store.wallets.find(w => w.id === active).name}'s demo wallet.`); }
  catch (error) { status(error.message, 'error'); }
};
$('#send-form').onsubmit = async event => {
  event.preventDefault(); if (busy) return;
  $('#send-error').textContent = '';
  try {
    const value = amount($('#amount').value.trim()); const recipient = $('#recipient').value;
    setBusy(true); status('Creating a real proof locally. This can take tens of seconds; keep the tab open…', 'busy');
    const item = await transaction(s => sendPayment(s, s.active, recipient, value, prove));
    render(); $('#send-dialog').close(); $('#amount').value = '';
    status(`Payment prepared. Switch to ${store.wallets.find(w => w.id === item.recipient).name} and choose Receive. You can also save its encrypted file below.`);
  } catch (error) { $('#send-error').textContent = error.message; status('No payment was sent. ' + error.message, 'error'); }
  finally { setBusy(false); }
};
$('#payment-file').onchange = async event => {
  const file = event.target.files[0]; if (!file) return;
  try { if (file.size > 140000) throw new Error('This payment file is too large.'); await receive(JSON.parse(await file.text())); }
  catch (error) { $('#receive-error').textContent = 'Could not read the payment file. ' + error.message; }
  event.target.value = '';
};
function connection() { $('#connection').textContent = navigator.onLine ? '● Browser is online' : '○ Browser is offline'; }
addEventListener('online', connection); addEventListener('offline', connection); connection();
addEventListener('storage', event => { if (event.key === STORAGE && !busy) { store = JSON.parse(event.newValue); if (store) render(); } });
async function setupOffline() {
  if (!('serviceWorker' in navigator)) throw new Error('Offline caching is unavailable in this browser.');
  const registration = await navigator.serviceWorker.register('./sw.js');
  const service = registration.installing ?? registration.waiting ?? registration.active;
  if (!service) throw new Error('The offline worker could not start.');
  if (service.state !== 'activated') await new Promise((resolve, reject) => {
    const changed = () => {
      if (service.state === 'activated' || service.state === 'redundant') {
        service.removeEventListener('statechange', changed);
        service.state === 'activated' ? resolve() : reject(new Error('The offline worker update failed.'));
      }
    };
    service.addEventListener('statechange', changed); changed();
  });
  return service;
}
$('#prepare').onclick = async () => {
  $('#prepare').disabled = true; $('#cache-status').textContent = 'Preparing offline resources…';
  try {
    const service = await setupOffline();
    service.postMessage({ type: 'prepare' });
  } catch (error) { $('#cache-status').textContent = error.message; $('#prepare').disabled = false; }
};
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('message', ({ data }) => {
  if (data.type === 'progress') $('#cache-status').textContent = `Saving offline resources: ${data.done} of ${data.total}`;
  if (data.type === 'ready') { $('#cache-status').textContent = 'Offline resources checked and saved. Browser storage can still be cleared or evicted.'; $('#prepare').textContent = 'Refresh offline resources'; $('#prepare').disabled = false; }
  if (data.type === 'cached') { $('#cache-status').textContent = data.complete ? 'Offline resources are saved in this browser. Storage can still be cleared or evicted.' : 'Some offline resources are missing. Prepare the demo before disconnecting.'; $('#prepare').textContent = data.complete ? 'Refresh offline resources' : 'Prepare offline demo'; }
  if (data.type === 'error') { $('#cache-status').textContent = `Preparation failed: ${data.message}`; $('#prepare').disabled = false; }
});
if ('serviceWorker' in navigator) navigator.serviceWorker.getRegistration().then(registration => registration?.active?.postMessage({ type: 'status' })).catch(() => {});
try { await transaction(() => {}); setBusy(false); render(); status('Demo workspace ready. Start with Amina, or choose How it works.'); }
catch (error) { status('Could not open this demo: ' + error.message, 'error'); }
