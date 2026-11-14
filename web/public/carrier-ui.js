import { updateDeliveryMode } from './delivery-mode.js';
import { readState } from './chat-store.js';
import { createCarrierClient, setCarrierEnabled } from './carrier-client.js';
import { createNostrClient, setNostrEnabled } from './nostr-client.js';

const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Delivery';button.id='carrier-open';
(document.querySelector('#wallet-settings-actions')??document.querySelector('header nav'))?.append(button);
const dialog=document.createElement('dialog');dialog.id='carrier-settings';dialog.setAttribute('aria-labelledby','carrier-title');
dialog.innerHTML='<div class="dialog-top"><h2 id="carrier-title">Automatic delivery</h2><button type="button" class="secondary" id="carrier-close">Close</button></div><p>Send to your contacts when connected. Keep Lenz open; saved files wait while offline.</p><label class="check"><input type="checkbox" id="nostr-enabled" disabled>Internet delivery</label><p class="quiet">Public relays carry encrypted files and may keep them indefinitely. Both contacts must enable internet delivery.</p><p id="nostr-status" role="status" aria-live="polite">Checking internet delivery…</p><details><summary>Privacy &amp; delivery details</summary><p>Relays can see your IP address, mailbox, file sizes and timing. Contents are encrypted. Existing history stays local; queued files resume when enabled. Turning this off stops new requests, but cannot recall files already sent. Receipts confirm arrival, not blockchain settlement. File sharing still works offline.</p><p>Private chat does not make blockchain payments private.</p></details><details id="carrier-options"><summary>Additional carriers</summary><p>Configured carriers hold encrypted files for up to 24 hours. They see routing identities, sizes and timing.</p><label class="check"><input type="checkbox" id="carrier-enabled" disabled>Enable delivery &amp; receipts</label><p id="carrier-status" role="status" aria-live="polite">Checking available carriers…</p></details>';
document.body.append(dialog);
const toggle=dialog.querySelector('#carrier-enabled'),status=dialog.querySelector('#carrier-status');
const internetToggle=dialog.querySelector('#nostr-enabled'),internetStatus=dialog.querySelector('#nostr-status');
button.onclick=()=>{dialog.showModal();void render();};dialog.querySelector('#carrier-close').onclick=()=>dialog.close();
let client,internet,lastError='',internetError='',timer;
let defiLoading=null,defiRetryAt=0;
function loadDefiConfig(){
  if(!client||defiLoading||!navigator.onLine||Date.now()<defiRetryAt)return;
  defiRetryAt=Date.now()+30000;
  // Optional swap checks must not hold up either chat delivery service.
  defiLoading=fetch('/rhea-config.json',{signal:AbortSignal.timeout(10000)})
    .then(response=>response.ok?response.json():null)
    .then(config=>{if(config){client.setDefiConfig(config);defiRetryAt=Infinity;void tick().catch(()=>{});}})
    .catch(()=>{}).finally(()=>{defiLoading=null;});
}
const relayErrors=new Map();
async function render(){
  const state=await readState();updateDeliveryMode(!!client?.carriers.length,state,!!internet?.relays.length);
  toggle.checked=!!state.carrier?.enabled;toggle.disabled=!state.identity||!client?.carriers.length;
  internetToggle.checked=!!state.nostr?.enabled;internetToggle.disabled=!state.identity||!internet?.relays.length;
  if(!state.identity){status.textContent=internetStatus.textContent='Create your profile to set up delivery.';return;}
  if(!internet?.relays.length)internetStatus.textContent='Internet delivery is unavailable. File sharing still works.';
  else if(!state.nostr?.enabled)internetStatus.textContent='Internet delivery is off.';
  else {
    const outbox=state.nostr.outbox,unreceived=e=>!e.isReceipt&&!state.messages.some(r=>r.packet.id===e.packetId&&r.receivedReceipt);
    const waiting=outbox.filter(e=>unreceived(e)&&e.expiresAt>Date.now()).length,expired=outbox.filter(e=>unreceived(e)&&e.expiresAt<=Date.now()).length;
    internetStatus.textContent=(!navigator.onLine?'Offline. Your files are saved. ':(internetError||relayErrors.size)?'A relay could not complete delivery. Retrying; files stay saved. ':'Internet delivery is on. ')+waiting+' awaiting a recipient receipt.'+(expired?' '+expired+' expired; use file sharing.':'');
  }
  if(!client?.carriers.length){status.textContent='No additional carriers configured.';return;}
  if(!state.carrier?.enabled){status.textContent=client.carriers.length+' carriers configured. Automatic delivery is off.';return;}
  const outbox=state.carrier.outbox,acknowledged=e=>state.messages.some(r=>r.packet.id===e.envelope.packet.id&&r.receivedReceipt);
  const expired=outbox.filter(e=>!e.isReceipt&&e.envelope.expiresAt<=Date.now()&&!acknowledged(e)).length;
  const waiting=outbox.filter(e=>e.envelope.expiresAt>Date.now()&&!acknowledged(e)).length;
  status.textContent=(!navigator.onLine?'Offline. Queued files will resume when connected. ':lastError?'A carrier is unavailable or rejected a file. Other carriers continue; your files stay saved. ':'Automatic delivery is on. ')+waiting+' queued files (including receipts).'+(expired?' '+expired+' expired without a recipient receipt; use file sharing.':'');
}
const tick=async()=>{
  const results=await Promise.allSettled([client?.tick(),internet?.tick()]);
  if(results[0].status==='rejected')lastError=results[0].reason.message;
  if(results[1].status==='rejected')internetError=results[1].reason.message;
  await render();
};
try{
  const near=await(await fetch('/near-config.json')).json();
  if(near.network!=='testnet'||typeof near.contract!=='string'||!near.contract.endsWith('.testnet'))throw Error('Invalid payment network.');
  const contract=near.ready?near.contract:null;
  await Promise.allSettled([
    (async()=>{const response=await fetch('/carrier-config.json',{cache:'no-store'});if(!response.ok)throw Error('Carrier configuration unavailable.');
      client=createCarrierClient({config:await response.json(),contract,onUpdate:()=>{lastError='';void render();},onError:error=>{lastError=error.message;}});})(),
    (async()=>{const response=await fetch('/nostr-config.json',{cache:'no-store'});if(!response.ok)throw Error('Internet delivery configuration unavailable.');
      internet=createNostrClient({config:await response.json(),contract,onUpdate:({origin,ok})=>{if(ok)relayErrors.delete(origin);void render();},onError:(error,origin)=>{if(origin)relayErrors.set(origin,error.message);else internetError=error.message;}});})(),
  ]);
  loadDefiConfig();await render();await tick();timer=setInterval(()=>{loadDefiConfig();void tick().catch(()=>{});},3000);
}catch(error){status.textContent=internetStatus.textContent=error.message;}
toggle.onchange=async()=>{
  toggle.disabled=true;client?.pause();
  try{await setCarrierEnabled(toggle.checked);client?.wake();await tick();}catch(error){lastError=error.message;}
  finally{await render();}
};
internetToggle.onchange=async()=>{
  internetToggle.disabled=true;internet?.pause();internetError='';relayErrors.clear();
  try{await setNostrEnabled(internetToggle.checked);internet?.wake();await tick();}catch(error){internetError=error.message;}
  finally{await render();}
};
const wake=()=>{client?.wake();internet?.wake();defiRetryAt=0;loadDefiConfig();void tick().catch(()=>{});};
addEventListener('lenz-delivery-ready',wake);
addEventListener('online',wake);
addEventListener('offline',()=>{client?.pause();internet?.pause();void render();});
addEventListener('pagehide',()=>{clearInterval(timer);client?.close();internet?.close();});
