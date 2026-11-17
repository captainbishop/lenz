import {readState,updateState} from './chat-store.js';
import {assert,keysAre,openMessage} from './peer-crypto.js';
import {requirePaymentAccess,isRecoveredContact} from './chat-access.js';
import {confidentialInboxSummary,setConfidentialInboxEnabled,acceptConfidentialCourierEnvelope,submitConfidentialRequest,observeConfidentialRequest,confidentialRequestUpdate} from './intents-courier.js';
import {validateEnvelope,wrapForCarrier} from './carrier-protocol.js';
import {walletAmount} from './wallet-visibility.js';
import {iconButton} from './wallet-actions.js';
import {FUNDING_NETWORKS} from './private-funding.js';
import {receiveAssets,receiveChain} from './receive-assets.js';

const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const assetNetwork=asset=>Object.values(FUNDING_NETWORKS).find(network=>network.asset===asset);
const line=(list,label,value)=>list.append(el('dt',label),el('dd',value));
const status=row=>row.observation?'Provider reports '+row.observation.status.toLowerCase().replaceAll('_',' ')+' · completion unverified':({'submission-unknown':'Submission reply lost · check before trying again',submitted:'Submitted · completion unverified','not-submitted':'Not submitted',stored:'Saved here · not submitted','expired-unresolved':'Permission expired · completion unknown'}[row.status]??'Completion unknown');
function failure(error){
 if(/abort|cancel/i.test(error?.name+' '+error?.message))return 'Stopped here. Check the saved request for any submitted payment.';
 if(/quota|storage|IndexedDB/i.test(error?.message))return 'Could not save this change. The saved request stays unresolved.';
 if(/account changed|recovered account|approved|verify|conflict|expired|changed|not enabled|not receiving|already recorded|activity|reconciliation/i.test(error?.message))return error.message;
 return 'Could not complete this step. Check the saved request before trying again.';
}
async function api(path,body,signal){
 signal?.throwIfAborted();
 const response=await fetch('/api/private-executor/'+path,{method:body===undefined?'GET':'POST',...(body===undefined?{}:{headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([AbortSignal.timeout(25000),...(signal?[signal]:[])])});
 assert(response.ok,'Private request execution is unavailable.');const text=await response.text();assert(text.length<=65536,'Private response too large.');return JSON.parse(text);
}
export function mountPrivateExecutor(panel){
 const open=el('button','Received requests');open.type='button';open.id='private-executor-open';open.className='secondary';panel.querySelector('.section-heading').append(open);
 const dialog=el('dialog');dialog.id='private-executor-dialog';dialog.setAttribute('aria-labelledby','private-executor-title');
 dialog.innerHTML=`<div class="dialog-top"><h2 id="private-executor-title">Received requests</h2><button id="private-executor-close" class="secondary wallet-close" type="button"></button></div>
 <p class="quiet">Receive a contact’s approved payment. Each request needs your review before submission.</p>
 <p id="private-executor-disclosure" class="quiet">Checking or submitting shares the owner, recipient and amount with Lenz and NEAR Intents. Privacy and completion are not independently verified.</p>
 <details id="private-executor-permissions"><summary>Allowed senders</summary>
 <form id="private-executor-policy"><label for="private-executor-sender">Contact</label><select id="private-executor-sender" required data-empty-label="No contacts yet" aria-describedby="private-executor-sender-note"></select>
 <p id="private-executor-sender-note" class="quiet">Add and verify a contact in Wallet first.</p><button id="private-executor-add-contact" type="button" class="secondary">Add a contact</button>
 <label for="private-executor-owner">Owner’s Lenz account</label><input id="private-executor-owner" placeholder="0x…" autocomplete="off" spellcheck="false" required>
 <p class="quiet">Allow this contact to send requests for this exact account. Requests stay encrypted on this device.</p><button id="private-executor-allow" type="submit">Allow sender</button></form>
 <ul id="private-executor-policies"></ul><label class="check"><input id="private-executor-enabled" type="checkbox">Receive requests from allowed senders</label></details>
 <button id="private-executor-import" type="button" class="secondary">Open request file</button><input id="private-executor-file" type="file" accept="application/json,.json" hidden>
 <p id="private-executor-feedback" class="wallet-feedback" role="status" aria-atomic="true"></p>
 <section id="private-executor-review" hidden><h3 id="private-executor-review-title">Review payment</h3><dl id="private-executor-terms"></dl>
 <details><summary>Transfer details</summary><dl id="private-executor-exact"></dl></details>
 <p id="private-executor-submit-note" class="quiet">Submission sends only this signed payment; no wallet signature is requested here.</p>
 <label class="check"><input id="private-executor-consent" type="checkbox"><span id="private-executor-consent-label">I checked this payment and agree to submit it.</span></label>
 <button id="private-executor-submit" type="button">Submit payment</button></section>
 <div class="section-heading"><h3>Saved requests</h3><button id="private-executor-refresh" class="secondary" type="button">Refresh</button></div>
 <p id="private-executor-connection" class="quiet"></p><ul id="private-executor-history"></ul><p id="private-executor-empty" class="quiet">Received requests will appear here.</p>`;
 document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);
 iconButton($('private-executor-close'),'Close received requests','m6 6 12 12M18 6 6 18');iconButton($('private-executor-refresh'),'Refresh received requests','M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
 let busy=false,ready=false,identity=null,selected=null,summary={enabled:false,policies:[],requests:[]},controller=null,generation=0,view=0,access=false,assets=[];
 const assetDetails=asset=>{const network=assetNetwork(asset);return network?{decimals:18,symbol:'ETH',network:network.name}:assets.find(token=>token.assetId===asset);};
 function amount(value,asset){
  const token=assetDetails(asset);if(!token)return 'Asset amount unavailable';
  const n=value.padStart(token.decimals+1,'0'),fraction=token.decimals?n.slice(-token.decimals).replace(/0+$/,''):'';
  return (token.decimals?n.slice(0,-token.decimals):n)+(fraction?'.'+fraction:'')+' '+token.symbol+' · '+(token.network??receiveChain(token.blockchain));
 }
 function controls(){
  dialog.setAttribute('aria-busy',String(busy));for(const node of dialog.querySelectorAll('input,select,button:not(#private-executor-close):not(.lenz-choice-button)'))node.disabled=busy;
  $('private-executor-sender').disabled=busy||!access||![...$('private-executor-sender').options].some(option=>option.value&&!option.disabled);
  $('private-executor-allow').disabled=busy||!access||!$('private-executor-sender').value;
  $('private-executor-enabled').disabled=busy||(!summary.enabled&&(!access||!summary.policies.length));
  $('private-executor-file').disabled=busy||!access||!summary.enabled;
  $('private-executor-import').disabled=$('private-executor-file').disabled;
  const known=selected&&assetDetails(selected.originAsset)&&assetDetails(selected.destinationAsset);
  $('private-executor-consent').disabled=busy||!selected?.canSubmit||!known||!ready||!navigator.onLine;
  $('private-executor-submit').disabled=busy||!selected?.canSubmit||!known||!ready||!navigator.onLine||!$('private-executor-consent').checked;
  for(const button of $('private-executor-history').querySelectorAll('button[data-action]')){const row=summary.requests.find(r=>r.id===button.dataset.id);button.disabled=busy||(button.dataset.action==='check'&&(!ready||!navigator.onLine||!row?.canCheck));}
 }
 function review(row){
  const action=row&&row.originAsset!==row.destinationAsset?'swap':'payment';
  $('private-executor-review-title').textContent='Review '+action;$('private-executor-submit').textContent='Submit '+action;$('private-executor-consent-label').textContent='I checked this '+action+' and agree to submit it.';$('private-executor-submit-note').textContent='Submission sends only this signed '+action+'; no wallet signature is requested here.';
  selected=row;$('private-executor-review').hidden=!row;$('private-executor-consent').checked=false;$('private-executor-terms').replaceChildren();$('private-executor-exact').replaceChildren();if(!row){controls();return;}
  for(const [name,value]of [['From',row.senderName],['Owner',row.owner],['Send',amount(row.amount,row.originAsset)],['Recipient',row.recipient],['Receive at least',amount(row.minOutput,row.destinationAsset)],['Refund can begin after',new Date(row.refundDeadline).toLocaleString()],['Permission ends',new Date(row.signingDeadline).toLocaleString()],['Refund / withdrawal fee','0 / 0']])line($('private-executor-terms'),name,value);
  for(const [name,value]of [['Account type','Confidential Intents'],['Provider','NEAR Intents'],['Source asset',row.originAsset],['Destination asset',row.destinationAsset],['Deposit',row.depositAddress],['Refund-start time','Not covered by the quote signature'],['Confidentiality','Requested; not covered by the quote signature']])line($('private-executor-exact'),name,value);
  if(!assetDetails(row.originAsset)||!assetDetails(row.destinationAsset)){line($('private-executor-exact'),'Send base units',row.amount);line($('private-executor-exact'),'Minimum output base units',row.minOutput);line($('private-executor-terms'),'Availability','Asset details unavailable. Submission paused.');}
  controls();
 }
 async function current(signal){signal?.throwIfAborted();const s=await readState();assert(s.identity?.profile.id===identity,'Executor account changed.');signal?.throwIfAborted();return s;}
 async function refresh(){
  const ticket=++view,s=await readState();assert(s.identity,'Create a Lenz profile first.');const next=await confidentialInboxSummary();if(ticket!==view||!dialog.open)return;
  assert((await readState()).identity?.profile.id===s.identity.profile.id,'Executor account changed.');
  identity=s.identity.profile.id;access=s.identity.access===undefined;summary=next;summary.requests=summary.requests.map(row=>({...row,senderName:s.contacts.find(c=>c.id===row.sender)?.name??row.sender}));
  const contact=$('private-executor-sender').value,peers=s.contacts.filter(p=>p.id!==identity&&!isRecoveredContact(s,p.id)),placeholder=new Option(peers.length?'Choose a contact':s.contacts.length?'No eligible contacts':'No contacts yet','');placeholder.disabled=true;
  $('private-executor-sender').replaceChildren(placeholder);for(const peer of peers){const option=el('option',peer.name);option.value=peer.id;$('private-executor-sender').append(option);}$('private-executor-sender').value=peers.some(p=>p.id===contact)?contact:'';
  $('private-executor-sender-note').textContent=peers.length?'Choose the contact whose requests you want to receive.':'Add and verify a contact in Wallet first.';$('private-executor-add-contact').hidden=peers.length>0;
  $('private-executor-enabled').checked=next.enabled;$('private-executor-policies').replaceChildren();
  for(const policy of next.policies){const item=el('li'),text=el('p',(s.contacts.find(c=>c.id===policy.sender)?.name??policy.sender)+' · '+policy.owner),remove=el('button','Remove sender');remove.type='button';remove.className='secondary';
   remove.onclick=()=>act(async signal=>{const policies=summary.policies.filter(p=>p.sender!==policy.sender||p.owner!==policy.owner);await setConfidentialInboxEnabled(summary.enabled&&policies.length>0,policies,{signal,identity,previous:summary.policies});$('private-executor-feedback').textContent='Sender removed. Existing requests remain saved.';});item.append(text,remove);$('private-executor-policies').append(item);}
  $('private-executor-history').replaceChildren();$('private-executor-empty').hidden=next.requests.length>0;
  for(const row of summary.requests){const item=el('li'),title=walletAmount(el('strong'),amount(row.amount,row.originAsset)),who=el('p',row.senderName),state=el('p',status(row));state.className='quiet';item.append(title,who,state);
   if(row.statusCheckPending)item.append(el('p','Update check unfinished · reconcile before submission'));
   for(const [text,action,handler]of [['Review request','review',()=>{review(row);$('private-executor-review').scrollIntoView({block:'nearest'});}],['Check update','check',()=>act(async signal=>{await observeConfidentialRequest(row.id,(offer,{signal})=>api('status',{offer},signal),{signal});$('private-executor-feedback').textContent='Update saved. Completion remains unverified.';})],['Save update','save',()=>act(async signal=>{
    const s=await current(signal),packet=await confidentialRequestUpdate(row.id,{signal}),envelope=await wrapForCarrier(s.identity,packet);await current(signal);
    const url=URL.createObjectURL(new Blob([JSON.stringify({type:'lenz/private-update-file/v1',envelope})],{type:'application/json'})),a=el('a');a.href=url;a.download='lenz-private-update.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('private-executor-feedback').textContent='Encrypted update saved for your contact.';
   })]]){const button=el('button',text);button.type='button';button.className='secondary';button.dataset.action=action;button.dataset.id=row.id;button.onclick=handler;item.append(button);} $('private-executor-history').append(item);
  }
  if(selected){const row=summary.requests.find(r=>r.id===selected.id);review(row??null);}
  $('private-executor-connection').textContent=!navigator.onLine?'Offline · requests remain saved.':ready?'Ready to submit reviewed requests.':'Submission unavailable. Requests remain saved.';controls();
 }
 async function act(fn){
  if(busy)return;const ticket=++generation;controller=new AbortController();const signal=controller.signal;busy=true;controls();$('private-executor-feedback').textContent='Working…';
  try{await current(signal);await fn(signal);await current(signal);if(ticket===generation){channel?.postMessage('changed');await refresh();}}
  catch(error){if(ticket===generation)$('private-executor-feedback').textContent=failure(error);}
  finally{if(ticket===generation){busy=false;controller=null;try{await refresh();}catch{review(null);}controls();}}
 }
 async function connection(signal){
  ready=false;assets=[];if(!navigator.onLine)return;
  try{ready=(await api('config',undefined,signal)).ready===true;}catch{signal?.throwIfAborted();}
  if(!ready)return;
  try{
   const response=await fetch('/api/receive/assets',{credentials:'omit',redirect:'error',cache:'no-store',signal:AbortSignal.any([AbortSignal.timeout(10000),...(signal?[signal]:[])])});
   assert(response.ok,'Asset catalogue unavailable.');const text=await response.text();assert(text.length<=2000000,'Asset catalogue too large.');
   const checked=receiveAssets(JSON.parse(text).tokens).filter(token=>/^nep141:[a-z0-9._-]{2,128}$/.test(token.assetId)&&token.decimals<=36);
   await current(signal);assets=checked;
  }catch{signal?.throwIfAborted();}
 }
 open.onclick=async()=>{const ticket=++generation;controller=new AbortController();busy=true;ready=false;identity=null;review(null);$('private-executor-feedback').textContent='';dialog.showModal();controls();try{await refresh();await connection(controller.signal);if(ticket!==generation)return;await refresh();}catch(error){if(ticket===generation)$('private-executor-feedback').textContent=failure(error);}finally{if(ticket===generation){busy=false;controller=null;controls();}}};
 $('private-executor-policy').onsubmit=event=>{event.preventDefault();void act(async signal=>{
  const s=await current(signal);requirePaymentAccess(s.identity);const sender=$('private-executor-sender').value,owner=$('private-executor-owner').value.trim().toLowerCase();assert(s.contacts.some(c=>c.id===sender)&&!isRecoveredContact(s,sender),'Add and verify the approved sender first.');
  const policies=[...summary.policies];if(!policies.some(p=>p.sender===sender&&p.owner===owner))policies.push({sender,owner});await setConfidentialInboxEnabled(true,policies,{signal,identity,previous:summary.policies});$('private-executor-owner').value='';$('private-executor-feedback').textContent='Sender allowed for this account. Review each payment before submitting.';
 });};
 $('private-executor-sender').onchange=controls;
 $('private-executor-enabled').onchange=event=>{const enabled=event.target.checked;void act(async signal=>{await setConfidentialInboxEnabled(enabled,summary.policies,{signal,identity,previous:summary.policies});$('private-executor-feedback').textContent=enabled?'Receiving allowed requests.':'Receiving paused. Existing requests remain saved.';});};
 $('private-executor-file').onchange=()=>{const file=$('private-executor-file').files[0];$('private-executor-file').value='';if(!file)return;void act(async signal=>{
  assert(file.size<=210000,'Private request too large.');const value=JSON.parse(await file.text());assert(keysAre(value,['type','envelope'])&&value.type==='lenz/private-request-file/v1','Choose a saved private request.');await validateEnvelope(value.envelope);await current(signal);
  await updateState(async s=>{assert(s.identity?.profile.id===identity,'Executor account changed.');requirePaymentAccess(s.identity);const sender=s.contacts.find(p=>p.id===value.envelope.packet.from);assert(sender,'Add and verify the original sender first.');assert((await openMessage(s.identity,sender,value.envelope.packet))?.type==='lenz/private-spend/v1','Choose a signed payment request.');await acceptConfidentialCourierEnvelope(s,value.envelope);},{signal});$('private-executor-feedback').textContent='Request saved here. No payment submitted.';
 });};
 $('private-executor-import').onclick=()=>$('private-executor-file').click();
 $('private-executor-consent').onchange=controls;
 $('private-executor-submit').onclick=()=>{const row=selected;if(!row||!$('private-executor-consent').checked)return;void act(async signal=>{
  assert(ready&&navigator.onLine&&row.canSubmit&&assetDetails(row.originAsset)&&assetDetails(row.destinationAsset),'Check the saved request before submitting.');requirePaymentAccess((await current(signal)).identity);const result=await submitConfidentialRequest(row.id,(offer,signedData,{signal})=>api('submit',{offer,signedData},signal),{signal});$('private-executor-feedback').textContent=status(result);
 });};
 $('private-executor-refresh').onclick=()=>act(async signal=>{await connection(signal);});
 function cancel(){generation++;view++;controller?.abort();controller=null;busy=false;selected=null;ready=false;review(null);}
 $('private-executor-close').onclick=()=>{cancel();dialog.close();};dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',()=>{if(!dialog.open)cancel();});
 $('private-executor-add-contact').onclick=()=>{$('private-executor-close').click();document.querySelector('#show-add-contact')?.click();};
 const identityChanged=()=>{cancel();identity=null;if(dialog.open){$('private-executor-history').replaceChildren();$('private-executor-policies').replaceChildren();access=false;summary={enabled:false,policies:[],requests:[]};$('private-executor-feedback').textContent='Account changed. Reopen received requests.';controls();}};
 const changed=()=>{if(dialog.open&&!busy)void refresh().catch(identityChanged);},offline=()=>{controller?.abort();ready=false;controls();},storage=event=>{if(event.key==='lenz-wallet-balances-hidden'||event.key===null)changed();};
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('proof-u-chat-refresh'):null;channel?.addEventListener('message',changed);
 addEventListener('lenz-account-identity',identityChanged);addEventListener('offline',offline);addEventListener('online',changed);addEventListener('storage',storage);
 return {refresh:changed};
}
