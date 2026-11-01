import { walletError } from './wallet-feedback.js';
import { updateState } from './chat-store.js';
import { mountRheaWallet, loadRheaConfig, renderRheaWallet } from './rhea-wallet.js';
import { prepareNearPayment } from './near-payment-service.js';
import { confirmNearPayment, refreshNearPayments } from './near-payment-status.js';
import { receivePacket } from './receive-packet.js';
import { compressed, fundingRequest, readNearVault, saveNearVault, nearLedger, displayUnits } from './near-protocol.js';

const $ = selector => document.querySelector(selector);
const el = (tag, text, cls) => { const n = document.createElement(tag); if(text !== undefined) n.textContent = text; if(cls) n.className = cls; return n; };
let config = { contract: null, ready: false }, currentPacket = null, selectedFile = null, run;
async function api(route, data) {
  const response = await fetch('/api/testnet/' + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data), signal: AbortSignal.timeout(90000) });
  const result = await response.json(); if (!response.ok) throw new Error(result.error ?? 'NEAR could not be reached. Your signed payment is still saved.'); return result;
}
function download(packet, name = 'payment') {
  const url = URL.createObjectURL(new Blob([JSON.stringify(packet)], { type: 'application/json' }));
  const link = el('a'); link.href = url; link.download = `lenz-${name}-${packet.id}.json`; link.click(); setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function notice(text) { $('#near-feedback').textContent = text; }
function paymentConnection() {
  document.querySelectorAll('[data-near-online]').forEach(button => { button.disabled = !navigator.onLine || button.dataset.nearBusy === 'true' || !config.ready; });
}
function linkReceipt(hash) {
  const a = el('a','View confirmation ↗'); a.href = 'https://testnet.nearblocks.io/txns/' + encodeURIComponent(hash); a.target='_blank'; a.rel='noopener noreferrer'; return a;
}
export function mountNearWallet({ action, status }) {
  run = operation => action(async()=> { try { await operation(); status('Your wallet is ready.'); } catch(error) { const message=walletError(error); notice(message); throw new Error(message); } });
  document.body.dataset.walletMode = 'near';
  const toggle = el('button','Earlier prototype','secondary wallet-mode'); toggle.id='wallet-mode'; toggle.type='button';
  toggle.onclick=()=> { const near=document.body.dataset.walletMode==='near'; document.body.dataset.walletMode=near?'legacy':'near'; toggle.textContent=near?'Back to tUSD wallet':'Earlier prototype'; };
  $('.wallet-heading').after(toggle);
  const section = el('section',undefined,'near-wallet'); section.id='near-wallet';
  section.innerHTML = `<div class="near-balance"><div class="balance-top"><span>OFFLINE WALLET</span><span class="near-network">NEAR · TESTNET</span></div><div class="near-amount"><strong id="near-total">0</strong><span>tUSD</span></div><p id="near-balance-caption">Fund your first offline payment.</p><div class="near-actions"><button id="near-send" type="button">↗ Send</button><button id="near-receive" type="button">↙ Receive</button><button id="near-fund" type="button">Add tUSD</button></div><p class="near-token-note">Lenz Test Dollar · a test token with no cash value</p></div>
  <div class="near-journey"><div class="section-heading"><h2>Send without internet</h2><button id="near-explain" type="button" class="secondary" aria-expanded="false" aria-controls="near-explanation">How it works</button></div><ol><li><span>01</span><strong>Add money</strong><small>Start with test dollars</small></li><li><span>02</span><strong>Go offline</strong><small>Send it. Receive it. Send it again.</small></li><li><span>03</span><strong>Confirm online</strong><small>Check that your payment went through</small></li></ol><p id="near-explanation" hidden>You can send a payment while offline, and the recipient can pass it on. Share it using a nearby sharing app. Payments remain pending until checked online; if the same money was sent twice, only one payment can be confirmed.</p><p id="near-connection" class="quiet" role="status">Checking testnet configuration…</p><p id="near-feedback" class="status" role="status"></p></div>`;
  $('#wallet-content').prepend(section);
  mountRheaWallet({action});
  const activity=el('section',undefined,'near-activity');activity.innerHTML='<div class="section-heading"><h2>Payments</h2><button id="near-refresh" class="secondary" type="button">Refresh payments</button></div><p id="near-empty" class="quiet">Your payments will appear here.</p><div id="near-payments"></div>';
  $('.wallet-lower').prepend(activity);
  const panels=el('div');panels.innerHTML=`
  <dialog id="near-send-dialog" aria-labelledby="near-send-title"><div class="dialog-top"><h2 id="near-send-title">Send tUSD</h2><button class="secondary" type="button" data-close="near-send-dialog">Close</button></div><form id="near-send-form"><label for="near-recipient">To</label><select id="near-recipient" required></select><label for="near-send-amount">Amount in tUSD</label><input id="near-send-amount" inputmode="decimal" placeholder="0.00" required><p class="quiet">Save and share the encrypted file. The recipient can pass it onward before either device reconnects. NEAR settlement confirms which spend succeeds.</p><button type="submit">Prepare payment</button></form><p class="wallet-feedback error" role="status"></p></dialog>
  <dialog id="near-fund-dialog" aria-labelledby="near-fund-title"><div class="dialog-top"><h2 id="near-fund-title">Add test dollars</h2><button class="secondary" type="button" data-close="near-fund-dialog">Close</button></div><p>Add free test dollars to try sending and receiving. They have no cash value.</p><form id="near-fund-form"><label for="near-fund-amount">Amount in tUSD · up to 100</label><input id="near-fund-amount" inputmode="decimal" value="100" required><p class="quiet">Available once per Lenz profile. Online payment records and amounts are public in this test version. Messages stay private between contacts.</p><button type="submit">Add test dollars</button></form><p class="wallet-feedback error" role="status"></p></dialog>
  <dialog id="near-receive-dialog" aria-labelledby="near-receive-title"><div class="dialog-top"><h2 id="near-receive-title">Receive tUSD</h2><button class="secondary" type="button" data-close="near-receive-dialog">Close</button></div><button id="near-share-card" type="button">Show my contact card</button><label for="near-payment-file">Open an encrypted payment file</label><input type="file" id="near-payment-file" accept=".json,application/json"><button type="button" id="near-import" disabled>Check payment</button><p class="wallet-feedback error" role="status"></p></dialog>
  <dialog id="near-handover" aria-labelledby="near-handover-title"><div class="dialog-top"><h2 id="near-handover-title">Ready to share</h2><button type="button" class="secondary" data-close="near-handover">Close</button></div><p>Save this encrypted payment and share it with your recipient. It is already saved in your payment history.</p><button id="near-download" type="button">Save payment file</button></dialog>`;
  document.body.append(panels);
  panels.querySelectorAll('[data-close]').forEach(button=>button.onclick=()=>$('#'+button.dataset.close).close());
  $('#near-explain').onclick=()=> { const b=$('#near-explain'), open=b.getAttribute('aria-expanded')==='true'; b.setAttribute('aria-expanded',String(!open));$('#near-explanation').hidden=open; };
  $('#near-send').onclick=()=>openNearSend();
  $('#near-fund').onclick=()=>$('#near-fund-dialog').showModal();
  $('#near-receive').onclick=()=> {selectedFile=null;$('#near-payment-file').value='';$('#near-import').disabled=true;$('#near-receive-dialog').showModal();};
  $('#near-share-card').onclick=()=> {$('#near-receive-dialog').close();$('#show-card').click();};
  $('#near-download').onclick=()=>download(currentPacket);
  $('#near-fund-form').onsubmit=event=> {event.preventDefault();run(async()=> {
    notice('Adding test money…');
    const request=await updateState(async state=> {const vault=await readNearVault(state,config.contract);vault.funding ??= await fundingRequest(state.identity,config.contract,$('#near-fund-amount').value);await saveNearVault(state,vault);return vault.funding;});
    const result=await api('fund',{...request,contract:config.contract});
    if(result.root.id!==request.id || result.root.amount!==request.amount || result.root.owner!==request.owner || result.finality!=='FINAL') throw new Error('The returned funding receipt does not match your request.');
    await updateState(async state=> {const vault=await readNearVault(state,config.contract);if(!vault.roots.some(r=>r.id===result.root.id))vault.roots.push(result.root);vault.receipts[result.root.id]=result;await saveNearVault(state,vault);});
    $('#near-fund-dialog').close();notice('Test money added. You can now send it offline.');
  });};
  $('#near-send-form').onsubmit=event=> {event.preventDefault();run(async()=> {
    const packet=await updateState(state=>prepareNearPayment(state,config.contract,$('#near-recipient').value,$('#near-send-amount').value));
    currentPacket=packet;$('#near-send-dialog').close();$('#near-handover').showModal();notice('Payment saved. Share the file with your recipient.');
  });};
  $('#near-payment-file').onchange=()=>run(async()=> {const file=$('#near-payment-file').files[0];if(!file)return;if(file.size>205000)throw new Error('This payment file is too large.');selectedFile=JSON.parse(await file.text());$('#near-import').disabled=false;});
  $('#near-import').onclick=()=>run(async()=> {
    const {duplicate}=await updateState(state=>receivePacket(state,selectedFile,true,config.contract));
    $('#near-receive-dialog').close();notice(duplicate?'You already received this payment.':'Payment saved. Connect to confirm it.');
  });
  $('#near-refresh').onclick=()=>run(async()=> {
    notice('Refreshing your payments…');
    try {
      const {checked}=await refreshNearPayments(config.contract);
      notice(checked?'Payments updated. Any money that could not be confirmed is excluded from your available balance.':'No payments to check yet.');
    } catch(error) { notice(walletError(error)); }
  });
  $('#near-refresh').dataset.nearOnline='';
  addEventListener('online',paymentConnection);addEventListener('offline',paymentConnection);
}
export function openNearSend(id='') { if(!config.contract){notice('The NEAR contract is not connected yet.');return;}$('#near-send-form').reset();$('#near-recipient').value=id;$('#near-send-dialog').showModal(); }
export async function loadNearConfig() {
  const response=await fetch('/near-config.json'); if(!response.ok)throw new Error('Testnet configuration is unavailable.');config=await response.json();
  await loadRheaConfig();
}
export async function renderNearWallet(state) {
  const enabled=!!config.contract && config.ready;
  $('#near-connection').textContent=enabled?(navigator.onLine?'You can send and receive test money, even while offline.':'You’re offline. Payments stay on this device until you share them.'):'Test money is not available right now.';
  $('#near-fund').disabled=!enabled;$('#near-send').disabled=!enabled;$('#near-refresh').disabled=!enabled||!navigator.onLine;
  $('#near-recipient').replaceChildren(new Option('Choose a person',''));for(const c of state.contacts)$('#near-recipient').append(new Option(c.name,c.id));
  if(!state.identity || !enabled)return;
  const vault=await readNearVault(state,config.contract), ledger=await nearLedger(vault), owner=compressed(state.identity.profile.signingPublic);
  await renderRheaWallet(vault,state.identity);
  const owned=ledger.available.filter(n=>n.owner===owner), total=owned.reduce((n,v)=>n+BigInt(v.amount),0n);
  $('#near-total').textContent=displayUnits(total);$('#near-fund').disabled=!!vault.roots.find(n=>n.owner===owner && vault.receipts[n.id]);
  $('#near-balance-caption').textContent=total?'Saved on this device · check payment status below.':'Add test dollars or receive a payment.';
  const list=$('#near-payments');list.replaceChildren();
  for(const note of ledger.notes.values()) if(note.owner===owner&&ledger.blocked.has(note.id)&&!ledger.consumed.has(note.id)) {
    const row=el('article',undefined,'near-payment');row.append(el('strong',displayUnits(note.amount)+' tUSD'),el('span','Payment could not be confirmed','near-state'),el('small','This money was used in another payment, so it is not included in your balance.'));list.append(row);
  }
  for(const note of owned) {
    const row=el('article',undefined,'near-payment'), id=note.id.startsWith('root:')?note.id:note.id.split(':')[0], receipt=vault.receipts[id], retry=!!vault.confirmations?.[note.id];
    row.append(el('strong',displayUnits(note.amount)+' tUSD'),el('span',receipt?'Confirmed':retry?'Confirmation pending':'Awaiting confirmation','near-state'));
    if(receipt?.txHash)row.append(linkReceipt(receipt.txHash));
    else if(receipt?.blockHeight){const a=el('a','View confirmation ↗');a.href='https://testnet.nearblocks.io/blocks/'+receipt.blockHeight;a.target='_blank';a.rel='noopener noreferrer';row.append(a);}
    if(!receipt && retry) { const check=el('button','Check confirmation','secondary');check.type='button';check.dataset.nearOnline='';check.disabled=!navigator.onLine;check.onclick=()=>run(async()=>{await refreshNearPayments(config.contract);notice('Payment status checked.');});row.append(check); }
    if(!receipt && !note.id.startsWith('root:')) { const settle=el('button',retry?'Retry confirmation':'Confirm payment','secondary');settle.type='button';settle.dataset.nearOnline='';settle.disabled=!navigator.onLine;settle.onclick=()=>run(async()=> {
      notice('Confirming your payment…');
      settle.dataset.nearBusy='true';settle.disabled=true;
      try { const result=await confirmNearPayment(config.contract,note.id,{retry});notice(result.status==='confirmed'?'Payment confirmed.':result.status==='pending'?'Confirmation is still pending. Check again, or choose Retry confirmation to resend the same signed payment.':'This money was used in another payment. It is excluded from your balance.'); }
      catch(error) { notice(walletError(error)); }
      finally { settle.dataset.nearBusy='false';paymentConnection(); }
    });row.append(settle); }
    if(!receipt)row.append(el('small',retry?'The last confirmation has no verified result yet. Check for an update, or retry the same signed payment.':'Saved offline. Connect to confirm this payment before relying on it.'));
    list.append(row);
  }
  for(const outgoing of [...vault.outbox].reverse()) { const row=el('article',undefined,'near-payment'), contact=state.contacts.find(c=>c.id===outgoing.packet.to);row.append(el('strong',`${displayUnits(outgoing.amount)} tUSD → ${contact?.name??'Contact'}`),el('span','Ready to share','near-state'));const save=el('button','Save payment file','secondary');save.onclick=()=>download(outgoing.packet);row.append(save);list.append(row); }
  $('#near-empty').hidden=!!list.children.length;
}
