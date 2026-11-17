import { updateDeliveryMode, updateInternetConnection, updateBluetoothConnection, requeueRequestedDeliveries } from './delivery-mode.js';
import { readState, updateState } from './chat-store.js';
import { createCarrierClient, setCarrierEnabled } from './carrier-client.js';
import { createNostrClient, setNostrEnabled } from './nostr-client.js';
import { createBluetoothClient } from './bluetooth-client.js';

const button=document.createElement('button');button.type='button';button.className='secondary';button.textContent='Delivery';button.id='carrier-open';
(document.querySelector('#wallet-settings-actions')??document.querySelector('header nav'))?.append(button);
const dialog=document.createElement('dialog');dialog.id='carrier-settings';dialog.setAttribute('aria-labelledby','carrier-title');
dialog.innerHTML='<div class="dialog-top"><h2 id="carrier-title">Automatic delivery</h2><button type="button" class="secondary" id="carrier-close">Close</button></div><p>Send to your contacts when connected. Keep Lenz open; saved messages wait while offline.</p><label class="check"><input type="checkbox" id="nostr-enabled" disabled>Internet delivery</label><p class="quiet">Public relays carry encrypted messages and may keep them indefinitely. Both contacts must enable internet delivery.</p><p id="nostr-status" role="status" aria-live="polite">Checking internet delivery…</p><details><summary>Privacy &amp; delivery details</summary><p>Relays can see your IP address, mailbox, sizes and timing. Contents are encrypted. Existing history stays local; requested deliveries resume when enabled. Turning this off stops new requests, but cannot recall messages already sent. Receipts confirm arrival, not blockchain settlement.</p><p>Private chat does not make blockchain payments private.</p></details><details id="carrier-options"><summary>Additional carriers</summary><p>Configured carriers hold encrypted messages for up to 24 hours. They see routing identities, sizes and timing.</p><label class="check"><input type="checkbox" id="carrier-enabled" disabled>Enable delivery &amp; receipts</label><p id="carrier-status" role="status" aria-live="polite">Checking available carriers…</p></details>';
document.body.append(dialog);
const toggle=dialog.querySelector('#carrier-enabled'),status=dialog.querySelector('#carrier-status');
const internetToggle=dialog.querySelector('#nostr-enabled'),internetStatus=dialog.querySelector('#nostr-status');
button.onclick=()=>{dialog.showModal();void render();};dialog.querySelector('#carrier-close').onclick=()=>dialog.close();
let client,internet,bluetooth,lastError='',internetError='',timer;
let defaultInternetSetup=null;
let radio={state:'off',peers:0},radioError='',bluetoothStarting=false,radioStopped=false;
const nearbyButton=document.createElement('button');nearbyButton.type='button';nearbyButton.className='secondary';nearbyButton.id='bluetooth-open';nearbyButton.textContent='Nearby';nearbyButton.hidden=true;
(document.querySelector('#wallet-settings-actions')??document.querySelector('header nav'))?.append(nearbyButton);
const nearbyDialog=document.createElement('dialog');nearbyDialog.id='bluetooth-dialog';nearbyDialog.setAttribute('aria-labelledby','bluetooth-title');
nearbyDialog.innerHTML='<div class="dialog-top"><h2 id="bluetooth-title">Nearby</h2><button type="button" class="secondary" id="bluetooth-close">Close</button></div><p id="bluetooth-status" role="status" aria-live="polite">Nearby is off. Messages stay queued.</p><button type="button" id="bluetooth-start">Enable nearby</button><button type="button" class="secondary" id="bluetooth-stop" hidden>Turn off nearby</button><p class="quiet">Keep Lenz open. Nearby devices carry encrypted messages; presence, routing IDs, sizes and timing remain visible. Verify your contact’s Lenz ID. A nearby device is not proof of their identity.</p>';
document.body.append(nearbyDialog);
const radioStatus=nearbyDialog.querySelector('#bluetooth-status'),radioStart=nearbyDialog.querySelector('#bluetooth-start'),radioStop=nearbyDialog.querySelector('#bluetooth-stop');
function renderBluetooth(){
 const supported=!!bluetooth?.supported;nearbyButton.hidden=!supported;
 const wifi=document.querySelector('#nearby-open');if(wifi){wifi.hidden=supported;wifi.textContent='Wi-Fi tools';}
 updateBluetoothConnection({supported,...radio});
 radioStatus.textContent=radioError||({off:'Nearby is off. Messages stay queued.',permission:'Allow Nearby in your device settings, then try again.',unavailable:'Bluetooth is unavailable. Messages stay queued.',starting:'Starting nearby…',ready:radio.peers?radio.peers+' nearby device'+(radio.peers===1?'':'s')+'. Requested messages send automatically.':'Looking for nearby devices. Messages stay queued until one is reachable.'})[radio.state];
 radioStart.hidden=radio.state==='ready'||radio.state==='starting';radioStop.hidden=radio.state==='off'||radio.state==='permission'||radio.state==='unavailable';
}
async function startBluetooth({automatic=false}={}){
 if(bluetoothStarting)return;
 const state=await readState(),owner=state.identity?.profile.id;
 if(automatic&&(radioStopped||state.bluetoothPreference?.owner===owner&&state.bluetoothPreference.disabled))return;
 bluetoothStarting=true;radioStopped=false;
 radioStart.disabled=true;radioError='';
 try{await bluetooth.start();if(!automatic)await updateState(current=>{if(current.identity?.profile.id===owner)current.bluetoothPreference={owner,disabled:false};},{markBackup:false});await tick();}catch(error){radioError=error.message;}
 finally{bluetoothStarting=false;radioStart.disabled=false;renderBluetooth();}
}
nearbyButton.onclick=()=>{nearbyDialog.showModal();if(radio.state!=='ready')void startBluetooth();};
radioStart.onclick=()=>{void startBluetooth();};radioStop.onclick=async()=>{radioStopped=true;const owner=(await readState()).identity?.profile.id;try{await bluetooth.stop();await updateState(current=>{if(current.identity?.profile.id===owner)current.bluetoothPreference={owner,disabled:true};},{markBackup:false});}catch(error){radioError=error.message;}renderBluetooth();};
nearbyDialog.querySelector('#bluetooth-close').onclick=()=>nearbyDialog.close();
addEventListener('lenz-nearby-open',event=>{if(bluetooth?.supported){event.stopImmediatePropagation();nearbyButton.click();}},true);
addEventListener('lenz-bluetooth-ready',()=>{renderBluetooth();void render();});
let defiLoading=null,defiRetryAt=0;
function loadDefiConfig(){
  if(!client&&!bluetooth||defiLoading||!navigator.onLine||Date.now()<defiRetryAt)return;
  defiRetryAt=Date.now()+30000;
  // Optional swap checks must not hold up either chat delivery service.
  defiLoading=fetch('/rhea-config.json',{signal:AbortSignal.timeout(10000)})
    .then(response=>response.ok?response.json():null)
    .then(config=>{if(config){client?.setDefiConfig(config);bluetooth?.setDefiConfig(config);defiRetryAt=Infinity;void tick().catch(()=>{});}})
    .catch(()=>{}).finally(()=>{defiLoading=null;});
}
const relayErrors=new Map(),relayReady=new Map();
async function render(){
  renderBluetooth();
  let state=await readState();
  if(state.identity&&internet?.relays.length&&!state.nostr){
    if(!defaultInternetSetup)defaultInternetSetup=setNostrEnabled(true,{owner:state.identity.profile.id}).finally(()=>{defaultInternetSetup=null;});
    await defaultInternetSetup;state=await readState();
  }
  updateDeliveryMode(!!client?.carriers.length,state,!!internet?.relays.length);
  const reachability=!navigator.onLine?'offline':!internet?.relays.length?'unavailable':internetError||relayErrors.size===internet.relays.length?'unavailable':[...relayReady.values()].some(at=>Date.now()-at<60000)?'online':'connecting';
  updateInternetConnection(reachability);
  toggle.checked=!!state.carrier?.enabled;toggle.disabled=!state.identity||!client?.carriers.length;
  internetToggle.checked=!!state.nostr?.enabled;internetToggle.disabled=!state.identity||!internet?.relays.length;
  if(!state.identity){status.textContent=internetStatus.textContent='Create your profile to set up delivery.';return;}
  if(!internet?.relays.length)internetStatus.textContent='Internet delivery is unavailable. Messages stay queued for another connection.';
  else if(!state.nostr?.enabled)internetStatus.textContent='Internet delivery is off.';
  else {
    const outbox=state.nostr.outbox,unreceived=e=>!e.isReceipt&&!state.messages.some(r=>r.packet.id===e.packetId&&r.receivedReceipt);
    const waiting=outbox.filter(e=>unreceived(e)&&e.expiresAt>Date.now()).length,expired=outbox.filter(e=>unreceived(e)&&e.expiresAt<=Date.now()).length;
    internetStatus.textContent=(reachability==='offline'?'Offline. Messages wait here and send when a connection returns. ':reachability==='unavailable'?'Chat relays are unreachable. Retrying; messages stay saved. ':reachability==='connecting'?'Connecting to chat relays. ':'Internet delivery is on. ')+waiting+' awaiting a recipient receipt.'+(expired?' '+expired+' await a delivery retry.':'');
  }
  if(!client?.carriers.length){status.textContent='No additional carriers configured.';return;}
  if(!state.carrier?.enabled){status.textContent=client.carriers.length+' carriers configured. Automatic delivery is off.';return;}
  const outbox=state.carrier.outbox,acknowledged=e=>state.messages.some(r=>r.packet.id===e.envelope.packet.id&&r.receivedReceipt);
  const expired=outbox.filter(e=>!e.isReceipt&&e.envelope.expiresAt<=Date.now()&&!acknowledged(e)).length;
  const waiting=outbox.filter(e=>e.envelope.expiresAt>Date.now()&&!acknowledged(e)).length;
  status.textContent=(!navigator.onLine?'Offline. Queued messages will resume when connected. ':lastError?'A carrier is unavailable or rejected a message. Other carriers continue; your messages stay saved. ':'Automatic delivery is on. ')+waiting+' queued messages (including receipts).'+(expired?' '+expired+' await a delivery retry.':'');
}
const tick=async()=>{
  await requeueRequestedDeliveries();
  const results=await Promise.allSettled([client?.tick(),internet?.tick(),bluetooth?.tick()]);
  if(results[0].status==='rejected')lastError=results[0].reason.message;
  if(results[1].status==='rejected')internetError=results[1].reason.message;
  if(results[2].status==='rejected')radioError=results[2].reason.message;
  await render();
};
try{
  let contract=null;
  try{const near=await(await fetch('/near-config.json',{signal:AbortSignal.timeout(10000)})).json();if(near.ready&&near.network==='testnet'&&typeof near.contract==='string'&&near.contract.endsWith('.testnet'))contract=near.contract;}catch{}
  bluetooth=createBluetoothClient({contract,onUpdate:()=>{radioError='';void render();},onError:error=>{radioError=error.message;renderBluetooth();},onState:state=>{radio=state;renderBluetooth();void render();}});
  const nativePage=['https://appassets.androidplatform.net','http://127.0.0.1:8765'].includes(location.origin);
  if(!nativePage&&!bluetooth.supported&&!document.querySelector('#nearby-open'))await import('./nearby-ui.js');renderBluetooth();
  await Promise.allSettled([
    (async()=>{const response=await fetch('/carrier-config.json',{cache:'no-store'});if(!response.ok)throw Error('Carrier configuration unavailable.');
      client=createCarrierClient({config:await response.json(),contract,onUpdate:()=>{lastError='';void render();},onError:error=>{lastError=error.message;}});})(),
    (async()=>{const response=await fetch('/nostr-config.json',{cache:'no-store'});if(!response.ok)throw Error('Internet delivery configuration unavailable.');
      internet=createNostrClient({config:await response.json(),contract,onUpdate:({origin,ok})=>{if(ok){relayErrors.delete(origin);relayReady.set(origin,Date.now());}void render();},onError:(error,origin)=>{if(origin){relayErrors.set(origin,error.message);relayReady.delete(origin);}else internetError=error.message;void render();}});})(),
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
const wake=()=>{client?.wake();internet?.wake();defiRetryAt=0;loadDefiConfig();void(async()=>{if(bluetooth?.supported&&radio.state==='off')await startBluetooth({automatic:true});await tick();})().catch(error=>{radioError=error.message;renderBluetooth();});};
addEventListener('lenz-delivery-ready',wake);
addEventListener('online',wake);
addEventListener('offline',()=>{client?.pause();internet?.pause();void render();});
addEventListener('pagehide',()=>{clearInterval(timer);client?.close();internet?.close();bluetooth?.close();});
