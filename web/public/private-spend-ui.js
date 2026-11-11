import {readState,updateState} from './chat-store.js';
import {assert,validateProfile,keysAre,openMessage} from './peer-crypto.js';
import {requirePaymentAccess,isRecoveredContact} from './chat-access.js';
import {receiveAssets,receiveAmount,receiveChain} from './receive-assets.js';
import {checkConfidentialSpend,signConfidentialSpend} from './intents-spend.js';
import {confidentialSpendOutbox,confidentialApprovalId} from './intents-spend-outbox.js';
import {readPrivateReview,savePrivateReview} from './private-spend-review.js';
import {wrapForCarrier,validateEnvelope} from './carrier-protocol.js';
import {iconButton} from './wallet-actions.js';
import {walletAmount} from './wallet-visibility.js';
import {setChoiceRenderer} from './form-controls.js';

const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const units=(value,decimals)=>{const padded=value.padStart(decimals+1,'0'),fraction=decimals?padded.slice(-decimals).replace(/0+$/,''):'';return (decimals?padded.slice(0,-decimals):padded)+(fraction?'.'+fraction:'');};
function assetLabel(text,token){
 const label=el('span');label.className='private-asset-label';
 if(token?.assetId==='nep141:eth.omft.near'&&token.blockchain==='eth'&&token.symbol==='ETH'&&token.decimals===18){const image=el('img');image.src='/asset-icons/eth.svg';image.alt='';image.width=image.height=24;label.append(image);}
 label.append(el('span',text));return label;
}
function feedback(error){
 if(/recovered account|Choose a verified|Create a Lenz profile|Lenz account changed|Wallet account or network changed|private approval expired/i.test(error?.message))return error.message;
 if(error?.code===4001)return 'Approval declined in your wallet. The review stays saved.';
 if(/abort|cancel/i.test(error?.name+' '+error?.message))return 'Cancelled here. Dismiss any open request in your wallet.';
 if(/storage|quota|IndexedDB/i.test(error?.message))return 'Could not save this change. Check browser storage and try again.';
 return 'Could not complete this step. Check the selected wallet and request, then try again.';
}
export function mountPrivateSpend(session,before){
 const style=el('link');style.rel='stylesheet';style.href='/private-spend.css';document.head.append(style);
 const panel=el('section');panel.id='wallet-private-approvals';panel.className='wallet-private-approvals';
 panel.innerHTML='<div class="section-heading"><h2>Private approvals</h2><button id="private-spend-open" type="button" class="secondary">Open</button></div><p class="quiet">Review a private account payment. Saved approvals can travel through nearby delivery.</p>';
 before.before(panel);
 const dialog=el('dialog');dialog.id='private-spend-dialog';dialog.setAttribute('aria-labelledby','private-spend-title');
 dialog.innerHTML=`<div class="dialog-top"><h2 id="private-spend-title">Private payment</h2><button id="private-spend-close" class="secondary wallet-close" type="button"></button></div>
 <p class="quiet">Uses funds already in a Confidential Intents account. Funding from your external wallet is not connected here.</p>
 <form id="private-spend-form">
  <label for="private-spend-recipient">Recipient’s private account</label><input id="private-spend-recipient" autocomplete="off" spellcheck="false" placeholder="0x…" required>
  <label for="private-spend-asset">Asset</label><select id="private-spend-asset" required></select>
  <div class="private-payment-value"><label for="private-spend-amount">Amount</label><input id="private-spend-amount" inputmode="decimal" autocomplete="off" placeholder="0.00" required></div>
  <label for="private-spend-executor">Deliver approval to</label><select id="private-spend-executor" required></select>
  <p class="quiet">This contact must agree to execute your request. They can read its terms and submit this one approval.</p>
  <p class="quiet">Preparation shares your wallet address, recipient and amount with Lenz and NEAR Intents. Its operators can see these details.</p>
  <button id="private-spend-prepare" type="submit">Prepare review</button>
 </form>
 <section id="private-spend-review" hidden><dl id="private-spend-terms"></dl>
  <p class="quiet">Signing authorizes this transfer until its approval deadline, including if funds arrive later. It does not reserve funds. Privacy and settlement have not been independently verified.</p>
  <label for="private-spend-signer">Signing wallet</label><select id="private-spend-signer"></select>
  <button id="private-spend-approve" type="button">Approve in wallet</button><button id="private-spend-new" type="button" class="secondary">New request</button>
  <details><summary>Exact terms</summary><dl id="private-spend-exact"></dl></details>
 </section>
 <p id="private-spend-feedback" class="wallet-feedback" role="status" aria-atomic="true"></p>
 <div class="section-heading"><h3>Saved approvals</h3><button id="private-spend-refresh" type="button" class="secondary">Refresh</button></div>
 <ul id="private-spend-history"></ul><p id="private-spend-empty" class="quiet">No private approvals saved.</p>
 <label for="private-spend-update">Open an executor update</label><input id="private-spend-update" type="file" accept="application/json,.json">`;
 document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);
 iconButton($('private-spend-close'),'Close','m6 6 12 12M18 6 6 18');
 iconButton($('private-spend-refresh'),'Refresh saved private approvals','M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
 let draft=null,tokens=[],savedAssets=[],providers=[],busy=false,controller=null,version=0,viewVersion=0,newRequest=false,paymentAccess=false;
 setChoiceRenderer($('private-spend-asset'),option=>assetLabel(option.textContent,tokens.find(t=>t.assetId===option.value)));
 const announce=event=>{
  const {provider,info}=event.detail??{};
  if(!provider||['request','on','removeListener'].some(k=>typeof provider[k]!=='function')||providers.some(p=>p.provider===provider)||providers.length>=12)return;
  if(typeof info?.name!=='string'||!info.name.trim()||info.name.length>80||/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/.test(info.name))return;
  providers.push({provider,name:info.name.trim()});paintSigners();
 };
 addEventListener('eip6963:announceProvider',announce);
 function paintSigners(){const selected=$('private-spend-signer').value;$('private-spend-signer').replaceChildren();providers.forEach((p,i)=>{const option=el('option',p.name);option.value=String(i);$('private-spend-signer').append(option);});if(providers[selected])$('private-spend-signer').value=selected;}
 function discover(){dispatchEvent(new Event('eip6963:requestProvider'));if(window.ethereum&&!providers.some(p=>p.provider===window.ethereum))announce({detail:{provider:window.ethereum,info:{name:'Browser wallet'}}});}
 function control(){
  dialog.setAttribute('aria-busy',String(busy));
  for(const node of dialog.querySelectorAll('input,select,button:not(#private-spend-close)'))node.disabled=busy;
  $('private-spend-prepare').disabled=busy||!paymentAccess||!navigator.onLine||!session.snapshot||!tokens.length;
  let valid=false;try{if(draft){checkConfidentialSpend(draft.offer);valid=true;}}catch{}
  $('private-spend-approve').disabled=busy||!paymentAccess||!valid||!providers[$('private-spend-signer').value]||$('private-spend-review').dataset.queued==='true';
 }
 function cancel(){version++;viewVersion++;controller?.abort();controller=null;busy=false;control();}
 $('private-spend-close').onclick=()=>{cancel();dialog.close();};dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',()=>{if(!dialog.open)cancel();});
 addEventListener('pagehide',cancel);addEventListener('lenz-account-identity',()=>{cancel();draft=null;if(dialog.open)dialog.close();});
 addEventListener('lenz-evm-session',control);addEventListener('offline',control);addEventListener('online',control);
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('proof-u-chat-refresh'):null;
 channel?.addEventListener('message',()=>{if(dialog.open&&!busy)void refresh().catch(e=>{$('private-spend-feedback').textContent=feedback(e);});});
 function line(host,label,value){const description=el('dd');if(value instanceof Node)description.append(value);else description.textContent=value;host.append(el('dt',label),description);}
 function assetAmount(value,asset){const token=savedAssets.find(t=>t.assetId===asset)??tokens.find(t=>t.assetId===asset);return token?units(value,token.decimals)+' '+token.symbol:'Asset details unavailable';}
 function paintReview(){
  $('private-spend-form').hidden=!!draft;$('private-spend-review').hidden=!draft;if(!draft)return;
  const r=checkConfidentialSpend(draft.offer,{now:draft.checkedAt});$('private-spend-terms').replaceChildren();$('private-spend-exact').replaceChildren();
  const token=draft.assets?.find(t=>t.assetId===r.destinationAsset)??tokens.find(t=>t.assetId===r.destinationAsset);
  line($('private-spend-terms'),'Receiving account','Confidential Intents');line($('private-spend-terms'),'Asset network',token?receiveChain(token.blockchain):'Details unavailable');
  for(const [label,value]of [['Send',assetLabel(assetAmount(r.amount,r.originAsset),token)],['Receive at least',assetLabel(assetAmount(r.minAmountOut,r.destinationAsset),token)],['Recipient',r.recipient],['Owner',r.owner],['Deliver to',draft.executor.name],['Refund may start',new Date(r.refundDeadline).toLocaleString()],['Approval ends',new Date(r.signingDeadline).toLocaleString()],['Refund / withdrawal fee','0 / 0']])line($('private-spend-terms'),label,value);
  for(const [label,value]of [['Source asset',r.originAsset],['Destination asset',r.destinationAsset],['Deposit',r.depositAddress],['Contract','intents.far'],['Nonce',JSON.parse(r.payload).nonce],['Refund-start time','Not covered by the quote signature'],['Confidentiality','Requested; not covered by the quote signature']])line($('private-spend-exact'),label,value);
  control();
 }
 async function refresh(){
  const ticket=++viewVersion,s=await readState();assert(s.identity,'Create a Lenz profile first.');
  const rows=await confidentialSpendOutbox.list(),saved=await readPrivateReview(),savedId=saved?await confidentialApprovalId(saved.offer.generated.intent.payload):null;if(ticket!==viewVersion||!dialog.open)return;
  assert((await readState()).identity?.profile.id===s.identity.profile.id,'Lenz account changed. Review again.');
  paymentAccess=s.identity.access===undefined;savedAssets=saved?.assets??[];draft=newRequest?null:saved;paintReview();
  $('private-spend-review').dataset.queued=String(rows.some(r=>r.id===savedId));
  $('private-spend-history').replaceChildren();$('private-spend-empty').hidden=rows.length>0;
  const labels={queued:'Waiting for delivery','shared-unresolved':'Shared · completion unknown','executor-reported-stored':'Executor stored · completion unknown','review-window-ended':'Delivery window ended · unresolved','expired-unresolved':'Approval expired · unresolved'};
  for(const row of rows){
   const item=el('li'),details=el('details'),title=walletAmount(el('summary'),assetAmount(row.amount,row.originAsset)),terms=el('dl');
   const report=row.observation?.status;
   details.append(title);
   for(const [label,value]of [['Recipient',row.recipient],['Owner',row.owner],['Executor',s.contacts.find(c=>c.id===row.executor)?.name??row.executor],['Approval ends',new Date(row.signingDeadline).toLocaleString()]])line(terms,label,value);
   details.append(terms);item.append(details,el('p',report?'Provider reports '+report.toLowerCase().replaceAll('_',' ')+' · settlement unverified':labels[row.status]??'Pending · settlement unverified'));
   if(['queued','shared-unresolved'].includes(row.status)){
    const button=el('button','Save request');button.type='button';button.className='secondary';button.onclick=()=>act(async(signal)=>{
     requirePaymentAccess((await readState()).identity);const packet=await confidentialSpendOutbox.handoff(row.id,{signal}),current=await readState();
     assert(current.identity?.profile.id===s.identity.profile.id,'Lenz account changed. Review again.');requirePaymentAccess(current.identity);
     const envelope=await wrapForCarrier(current.identity,packet);signal.throwIfAborted();
     const latest=await readState();assert(latest.identity?.profile.id===s.identity.profile.id,'Lenz account changed. Review again.');requirePaymentAccess(latest.identity);signal.throwIfAborted();
     download({type:'lenz/private-request-file/v1',envelope},'lenz-private-request.json');$('private-spend-feedback').textContent='Encrypted request saved for sharing. Completion is unknown.';
    });item.append(button);
   }
   $('private-spend-history').append(item);
  }
  $('private-spend-executor').replaceChildren();for(const contact of s.contacts.filter(p=>p.id!==s.identity.profile.id&&!isRecoveredContact(s,p.id))){const option=el('option',contact.name);option.value=contact.id;$('private-spend-executor').append(option);}
  control();
 }
 async function act(fn){
  if(busy)return;const ticket=++version;controller=new AbortController();const signal=controller.signal;busy=true;control();$('private-spend-feedback').textContent='Working…';
  try{await fn(signal);signal.throwIfAborted();if(ticket===version){channel?.postMessage('changed');await refresh();}}
  catch(error){if(ticket===version)$('private-spend-feedback').textContent=feedback(error);}
  finally{if(ticket===version){busy=false;controller=null;control();}}
 }
 panel.querySelector('button').onclick=async()=>{
  const ticket=++version;
  $('private-spend-feedback').textContent='';dialog.showModal();discover();
  try{
   await refresh();
   if(navigator.onLine){const response=await fetch('/api/receive/assets',{cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(5000)});if(response.ok){const result=await response.json();if(ticket!==version||!dialog.open)return;tokens=receiveAssets(result.tokens).filter(t=>/^nep141:[a-z0-9._-]{2,128}$/.test(t.assetId)&&t.decimals<=36);}}
   if(ticket!==version||!dialog.open)return;
   $('private-spend-asset').replaceChildren();for(const token of tokens){const option=el('option',token.symbol+' · '+receiveChain(token.blockchain));option.value=token.assetId;$('private-spend-asset').append(option);}
   await refresh();if(!session.snapshot&&!draft)$('private-spend-feedback').textContent='Connect an external wallet to prepare a request.';
  }catch(error){$('private-spend-feedback').textContent=feedback(error);}finally{control();}
 };
 $('private-spend-form').onsubmit=event=>{event.preventDefault();void act(async signal=>{
  const state=await readState();assert(state.identity,'Create a Lenz profile first.');requirePaymentAccess(state.identity);
  const lease=session.capture(),token=tokens.find(t=>t.assetId===$('private-spend-asset').value),executor=state.contacts.find(p=>p.id===$('private-spend-executor').value);
  assert(token&&executor&&!isRecoveredContact(state,executor.id),'Choose a verified executor contact.');await validateProfile(executor);
  const amount=receiveAmount($('private-spend-amount').value,token.decimals),recipient=$('private-spend-recipient').value.trim().toLowerCase();
  const chosen={owner:lease.identity.address,originAsset:token.assetId,destinationAsset:token.assetId,amount,minOutput:amount,recipient,refundDeadline:new Date(Date.now()+3600000).toISOString(),slippageBps:0};
  const accounts=await lease.request('eth_accounts');assert(accounts?.[0]?.toLowerCase()===chosen.owner,'Wallet account or network changed.');lease.assertCurrent();signal.throwIfAborted();
  const response=await fetch('/api/private-spend/prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(chosen),cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
  if(!response.ok){$('private-spend-feedback').textContent='Private preparation is unavailable. Your entries stay here.';return;}
  const text=await response.text();assert(text.length<=140000,'Private response too large.');const result=JSON.parse(text);
  assert(result.state==='awaiting-owner-review','Private review unavailable.');for(const [key,value]of Object.entries(chosen))assert(result.offer?.terms?.[key]===value,'Private quote changed '+key+'.');
  checkConfidentialSpend(result.offer);lease.assertCurrent();signal.throwIfAborted();
  assert((await lease.request('eth_accounts'))?.[0]?.toLowerCase()===chosen.owner&&await lease.request('eth_chainId')===lease.identity.chainId,'Wallet account or network changed.');
  draft=await savePrivateReview(result.offer,executor,state.identity.profile.id,{signal,token});newRequest=false;
  $('private-spend-feedback').textContent='Review saved. Check every term before approving.';
 });};
 $('private-spend-approve').onclick=()=>act(async signal=>{
  const selected=draft,provider=providers[$('private-spend-signer').value]?.provider,state=await readState();
  assert(selected&&state.identity?.profile.id===selected.identity,'Lenz account changed. Review again.');requirePaymentAccess(state.identity);
  const current=await readPrivateReview();assert(JSON.stringify(current)===JSON.stringify(selected),'Saved private review changed. Review again.');
  const signed=await signConfidentialSpend(provider,selected.offer,{signal});signal.throwIfAborted();
  assert((await readState()).identity?.profile.id===selected.identity,'Lenz account changed. Review again.');
  await confidentialSpendOutbox.queue(selected.offer,signed,selected.executor,{signal});$('private-spend-feedback').textContent='Approval saved. Use nearby delivery or save its encrypted request.';
 });
 $('private-spend-new').onclick=()=>{newRequest=true;draft=null;paintReview();control();$('private-spend-recipient').focus();};
 $('private-spend-refresh').onclick=()=>act(async()=>{});
 $('private-spend-update').onchange=()=>{const file=$('private-spend-update').files[0];$('private-spend-update').value='';if(!file)return;void act(async signal=>{
  assert(file.size<=210000,'Private update too large.');const value=JSON.parse(await file.text());assert(keysAre(value,['type','envelope'])&&value.type==='lenz/private-update-file/v1','Invalid private update.');
  await validateEnvelope(value.envelope);signal.throwIfAborted();
  const outcome=await updateState(async s=>{
   assert(s.identity&&value.envelope.packet.to===s.identity.profile.id,'Private update belongs to another account.');
   const peer=s.contacts.find(p=>p.id===value.envelope.packet.from);assert(peer,'Choose a verified executor contact.');
   const packet=await openMessage(s.identity,peer,value.envelope.packet);
   assert(['lenz/private-spend-report/v1','lenz/private-spend-ack/v1'].includes(packet?.type),'Choose an executor report or receipt.');
   let message;
   if(packet.type==='lenz/private-spend-report/v1'){
    const result=await confidentialSpendOutbox.acceptReport(s,value.envelope.packet);
    message=JSON.stringify(result.request.observation)===JSON.stringify(packet.observation)?'Executor report checked. Settlement remains unverified.':'Newer executor report retained. Settlement remains unverified.';
   }else{await confidentialSpendOutbox.acceptAcknowledgement(s,value.envelope.packet);message='Executor receipt checked. Completion remains unknown.';}
   assert(Date.now()<value.envelope.expiresAt,'Private update expired before storage.');return message;
  },{signal});
  $('private-spend-feedback').textContent=outcome;
 });};
 function download(value,name){const url=URL.createObjectURL(new Blob([JSON.stringify(value)],{type:'application/json'})),a=el('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 return {refresh};
}
