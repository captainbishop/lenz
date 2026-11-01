import { updateDeliveryMode } from './delivery-mode.js';
import { readState } from './chat-store.js';
import { createCarrierClient, setCarrierEnabled } from './carrier-client.js';

const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Delivery';button.id='carrier-open';
document.querySelector('header nav')?.append(button);
const dialog=document.createElement('dialog');dialog.id='carrier-settings';dialog.setAttribute('aria-labelledby','carrier-title');
dialog.innerHTML='<div class="dialog-top"><h2 id="carrier-title">Automatic delivery</h2><button type="button" class="secondary" id="carrier-close">Close</button></div><p>Deliver new messages and payments while connected. Keep Lenz open.</p><p>Carriers hold encrypted files for up to 24 hours. They can see routing identities, file sizes and connection timing. They cannot read the contents.</p><label class="check"><input type="checkbox" id="carrier-enabled" disabled>Enable delivery &amp; receipts</label><p id="carrier-status" role="status" aria-live="polite">Checking available carriers…</p><p class="quiet">Existing history stays local. Turning this off stops new network requests; files already sent may remain with carriers until they expire. File sharing still works offline. A delivery receipt does not confirm money on the blockchain.</p>';
document.body.append(dialog);
const toggle=dialog.querySelector('#carrier-enabled'),status=dialog.querySelector('#carrier-status');
button.onclick=()=>{dialog.showModal();void render();};dialog.querySelector('#carrier-close').onclick=()=>dialog.close();
let client, lastError='',timer;
async function render(){
  const state=await readState();updateDeliveryMode(!!client?.carriers.length,state);toggle.checked=!!state.carrier?.enabled;toggle.disabled=!state.identity||!client?.carriers.length;
  if(!state.identity){status.textContent='Create your profile to set up delivery.';return;}
  if(!client?.carriers.length){status.textContent='No carriers are configured for this app yet. File sharing is available.';return;}
  if(!state.carrier?.enabled){status.textContent=`${client.carriers.length} carrier${client.carriers.length===1?'':'s'} configured. Automatic delivery is off.`;return;}
  const outbox=state.carrier.outbox,acknowledged=e=>state.messages.some(r=>r.packet.id===e.envelope.packet.id&&r.receivedReceipt);
  const expired=outbox.filter(e=>!e.isReceipt&&e.envelope.expiresAt<=Date.now()&&!acknowledged(e)).length;
  const waiting=outbox.filter(e=>e.envelope.expiresAt>Date.now()&&!acknowledged(e)).length;
  status.textContent=(!navigator.onLine?'Offline. Queued files will resume when connected. ':lastError?'A carrier is unavailable or rejected a file. Other carriers continue; your files stay saved. ':'Automatic delivery is on. ')+`${waiting} queued files (including receipts).`+(expired?` ${expired} expired without a recipient receipt; use file sharing.`:'');
}
const tick=async()=>{try{await client?.tick();await render();}catch(error){lastError=error.message;status.textContent='Delivery paused: '+error.message;}};
try{
  const response=await fetch('/carrier-config.json',{cache:'no-store'});
  if(!response.ok)throw Error('Carrier configuration unavailable.');
  const config=await response.json(),near=await(await fetch('/near-config.json')).json();
  if(near.network!=='testnet'||typeof near.contract!=='string'||!near.contract.endsWith('.testnet'))throw Error('Invalid payment network.');
  client=createCarrierClient({config,contract:near.ready?near.contract:null,onUpdate:()=>{lastError='';void render();},onError:error=>{lastError=error.message;}});
  await render();await tick();timer=setInterval(tick,3000);
}catch(error){status.textContent=error.message;}
toggle.onchange=async()=>{
  toggle.disabled=true;client?.pause();
  try{await setCarrierEnabled(toggle.checked);client?.wake();await tick();}catch(error){status.textContent=error.message;}
  finally{await render();}
};
addEventListener('lenz-delivery-ready',()=>{client?.wake();void tick();});
addEventListener('online',()=>{client?.wake();void tick();});
addEventListener('offline',()=>{client?.pause();void render();});
addEventListener('pagehide',()=>{clearInterval(timer);client?.close();});
