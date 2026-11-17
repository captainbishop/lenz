import {defiInboxSummary,setDefiInboxEnabled,acceptDefiCourierEnvelope,reviewDefiInboxRequest,submitDefiInboxRequest,checkDefiInboxRequest,defiInboxUpdate} from './defi-courier.js';
import {displayUnits} from './near-protocol.js';
import {readState,updateState} from './chat-store.js';
import {assert} from './peer-crypto.js';
import {wrapForCarrier,MAX_ENVELOPE_BYTES} from './carrier-protocol.js';

export function mountDefiInboxControls(dialog,{getConfig}){
 const panel=document.createElement('details');panel.id='nearby-defi-inbox';
 panel.innerHTML=`<summary>DeFi requests <span id="defi-inbox-count"></span></summary>
 <label class="courier-toggle"><input id="defi-inbox-enabled" type="checkbox" disabled>Receive DeFi requests on this device</label>
 <p class="quiet">Receive a contact’s approved swap. Review its exact terms, then submit it while connected. The sender can stay offline.</p>
 <button id="defi-inbox-import" type="button" class="secondary" disabled>Open request file</button><input id="defi-inbox-file" type="file" accept=".json,application/json" hidden>
 <p id="defi-inbox-feedback" class="quiet" role="status"></p><ul id="defi-inbox-items" class="courier-items"></ul>`;
 dialog.querySelector('#nearby-courier').after(panel);const $=id=>panel.querySelector('#'+id);let busy=false,run=0,review=null,controller=null;
 async function refresh(){
  const version=++run,summary=await defiInboxSummary();if(version!==run)return;
  $('defi-inbox-enabled').checked=summary.enabled;$('defi-inbox-enabled').disabled=busy||(!summary.enabled&&!getConfig()?.ready);
  $('defi-inbox-import').disabled=busy||!summary.enabled||!getConfig()?.ready;
  const opened=new Set([...$('defi-inbox-items').querySelectorAll('details[open]')].map(item=>item.dataset.requestId));$('defi-inbox-count').textContent=summary.requests.length||'';$('defi-inbox-items').replaceChildren();
  if(!$('defi-inbox-feedback').textContent&&!getConfig()?.ready)$('defi-inbox-feedback').textContent='Receiving swap requests is unavailable right now.';
  for(const request of summary.requests){
   const row=document.createElement('li'),details=document.createElement('details'),title=document.createElement('summary'),status=document.createElement('p'),terms=document.createElement('dl');
   details.dataset.requestId=request.id;details.open=opened.has(request.id);
   title.textContent=`${displayUnits(request.amount)} tUSD ${request.operation==='rhea-refund-return'?'refund request':'swap'} · ${request.sender}`;
   status.className='quiet';status.textContent=({'submission-unresolved':'Submission unknown · Check before retrying',complete:'Swap reported complete · Sender must verify',refunded:'Refund reported · Sender must verify','not-started':'Not started · Original request retained',expired:'Time limit ended · Original request retained',stored:'Approved by sender · Awaiting your review'}[request.status]??'Swap in progress · Check status');
   for(const [name,value]of [['Receiving wallet',request.receiver],['Receive at least',formatNear(request.minOutput)+' wrapped test NEAR'],['Start before',new Date(request.expiresAt).toLocaleString()],['Network','Public NEAR test network']]){
    const dt=document.createElement('dt'),dd=document.createElement('dd');dt.textContent=name;dd.textContent=value;terms.append(dt,dd);
   }
   details.append(title,status,terms);
   const button=(label,operation,online=false)=>{const b=document.createElement('button');b.type='button';b.className='secondary';b.textContent=label;b.disabled=busy||online&&!navigator.onLine;b.onclick=()=>act(operation);details.append(b);return b;};
   if(request.canReview)button(review?.requestId===request.id?'Review again':'Review swap',async()=>{review=await reviewDefiInboxRequest(getConfig(),request.id);});
   if(review?.requestId===request.id&&request.canReview){
    details.open=true;const note=document.createElement('p'),label=document.createElement('label'),consent=document.createElement('input'),text=document.createElement('span');
    note.className='quiet';note.textContent='Submit only this approved swap. The testnet service pays network fees; no extra fee is authorized. Amounts and the receiving wallet are public on NEAR testnet.';
    label.className='courier-toggle';consent.type='checkbox';consent.disabled=busy;consent.setAttribute('aria-label','I checked this swap and agree to submit it');text.textContent='I checked these terms and agree to submit.';label.append(consent,text);details.append(note,label);
    const exact=review,submit=button(exact.operation==='submit'?'Submit approved swap':'Continue approved swap',async signal=>{assert(consent.checked,'Check the exact terms before submission.');await submitDefiInboxRequest(getConfig(),request.id,exact,{signal});review=null;$('defi-inbox-feedback').textContent='Result saved. Send the encrypted update to your contact for verification.';},true);submit.disabled=true;consent.onchange=()=>{submit.disabled=busy||!navigator.onLine||!consent.checked||Date.now()>=exact.expiresAt;};
   }
   if(request.operation==='rhea-swap')button('Check status',async signal=>{await checkDefiInboxRequest(getConfig(),request.id,{signal});review=null;$('defi-inbox-feedback').textContent='Status saved. Your contact must verify the chain result.';},true);
   else{const note=document.createElement('p');note.className='quiet';note.textContent='Refund signing is unavailable here. The original request remains saved.';details.append(note);}
   if(request.hasUpdate){
    button('Send update nearby',async()=>{dispatchEvent(new Event('lenz-nearby-open'));$('defi-inbox-feedback').textContent='Choose a courier for your contact under Send with a courier.';});
    button('Save update file',async signal=>{const state=await readState(),packet=await defiInboxUpdate(getConfig(),request.id);assert(state.identity?.profile.id===packet.from,'The executor account changed.');signal?.throwIfAborted();const envelope=await wrapForCarrier(state.identity,packet);signal?.throwIfAborted();assert((await readState()).identity?.profile.id===packet.from,'The executor account changed.');download(envelope);$('defi-inbox-feedback').textContent='Encrypted update saved for your contact.';});
   }
   row.append(details);$('defi-inbox-items').append(row);
  }
 }
 async function act(operation){
  if(busy)return;busy=true;controller=new AbortController();const signal=controller.signal;panel.setAttribute('aria-busy','true');
  try{for(const control of panel.querySelectorAll('input,button'))control.disabled=true;await operation(signal);signal.throwIfAborted();}
  catch(error){$('defi-inbox-feedback').textContent=error.message;}
  finally{busy=false;controller=null;panel.removeAttribute('aria-busy');try{await refresh();}catch(error){$('defi-inbox-feedback').textContent=error.message;}}
 }
 $('defi-inbox-import').onclick=()=>$('defi-inbox-file').click();
 $('defi-inbox-file').onchange=()=>{const file=$('defi-inbox-file').files[0];$('defi-inbox-file').value='';if(!file)return;void act(async signal=>{assert(file.size<=MAX_ENVELOPE_BYTES,'The received request file is too large.');const envelope=JSON.parse(await file.text());signal.throwIfAborted();await updateState(async state=>{signal.throwIfAborted();assert(await acceptDefiCourierEnvelope(state,getConfig(),envelope),'Choose an approved DeFi request or its encrypted update.');},{signal});$('defi-inbox-feedback').textContent='Request saved here. Review before submission.';});};
 $('defi-inbox-enabled').onchange=async event=>{
  if(busy)return;const enabled=event.target.checked;busy=true;panel.setAttribute('aria-busy','true');$('defi-inbox-enabled').disabled=true;
  try{await setDefiInboxEnabled(enabled,getConfig());$('defi-inbox-feedback').textContent=enabled?'Ready to receive swap requests.':'New DeFi requests paused. Existing requests remain saved.';}
  catch(error){$('defi-inbox-feedback').textContent=error.message;}
  finally{busy=false;panel.removeAttribute('aria-busy');try{await refresh();}catch(error){$('defi-inbox-enabled').disabled=false;$('defi-inbox-feedback').textContent=error.message;}}
 };
 const cancel=()=>{controller?.abort();review=null;};dialog.addEventListener('close',cancel);addEventListener('lenz-account-identity',cancel);addEventListener('offline',()=>{controller?.abort();review=null;void refresh().catch(()=>{});});addEventListener('online',()=>void refresh().catch(()=>{}));
 return {refresh};
}
function formatNear(value){const n=BigInt(value),base=10n**24n,fraction=(n%base).toString().padStart(24,'0').replace(/0+$/,'');return (n/base).toString()+(fraction?'.'+fraction:'');}
function download(envelope){const url=URL.createObjectURL(new Blob([JSON.stringify(envelope)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='lenz-defi-update.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
