import {readState} from './chat-store.js';
import {backupNow} from './account-sync.js';
import {createNearIntentSource} from './intent-near-route.js';
import {createAuroraIntentSource} from './intent-aurora-source.js';
import {createAuroraFundingClient} from './intent-aurora-funding.js';
import {AURORA_INTENT_DEPLOYMENT as deployment} from './intent-aurora-config.js';
import {walletAmount} from './wallet-visibility.js';
import {iconButton} from './wallet-actions.js';
import {createIntentActionStore} from './intent-action-store.js';
import {mountIntentAction} from './intent-action-ui.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
export function createAuroraFundingWalletController({openPublicFunding,editSwapSelection,accountFactory,serviceFactory}={}){
 const style=el('link');style.rel='stylesheet';style.href='/intent-near-ui.css';document.head.append(style);
 const dialog=el('dialog');dialog.id='aurora-intent-funding';dialog.className='near-intent-dialog';dialog.setAttribute('aria-labelledby','aurora-intent-funding-title');
 dialog.innerHTML='<div class="dialog-top"><h2 id="aurora-intent-funding-title">Get test funds</h2><button id="aurora-funding-close" type="button" class="secondary wallet-close"></button></div><p class="quiet">Private pool funding · Aurora testnet · No cash value</p><dl id="aurora-funding-terms"></dl><p id="aurora-funding-disclosure" class="quiet"></p><a id="aurora-funding-recovery" href="/account.html?next=wallet&funding=private" hidden>Save your account backup</a><button id="aurora-funding-confirm" type="button" hidden>Confirm private test funds</button><button id="aurora-funding-check" type="button" class="secondary" hidden>Check original funding</button><button id="aurora-funding-continue" type="button" hidden>Continue original funding</button><button id="aurora-funding-cleanup" type="button" class="secondary" hidden>Clear funding approval</button><button id="aurora-funding-review" type="button" class="secondary" hidden>Review private test funds</button><p id="aurora-funding-feedback" class="wallet-feedback" role="status" aria-live="polite"></p><details class="near-intent-details"><summary>Funding history</summary><ul id="aurora-funding-history"></ul></details><button id="aurora-funding-other" type="button" class="secondary">Other test funds</button>';
 document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);iconButton($('aurora-funding-close'),'Close','m6 6 12 12M18 6 6 18');$('aurora-funding-disclosure').textContent='Funding is public. Your note stays in your encrypted account backup. The withdrawal proof hides which deposit is spent; receiving and refund addresses and trade terms stay public. Lenz and network providers may correlate activity.';
 let identity=null,near=null,source=null,client=null,rows=[],owned=[],results=[],review=null,config=null,busy=false,generation=0,disposed=false,opener=null,account=null,swapService=null,wrappedSource=null,swapStore=null,swapView=null,restoring=Promise.resolve();
 const displayed=row=>{const current=navigator.onLine&&Date.now()>=row.verifiedAt&&Date.now()-row.verifiedAt<=60000;return {...row,units:current?row.units:null,status:current?'verified':'last-verified'};};
 const listeners=new Set(),snapshot=()=>({identity,busy,balances:owned.map(displayed),resultBalances:results.map(displayed)}),assertCurrent=ticket=>check(!disposed&&ticket===generation&&source?.identity()?.lenzIdentity===identity,'Open the original private funding account.');
 function emit(){const state=snapshot();for(const listener of listeners)listener(state);dialog.setAttribute('aria-busy',String(busy));for(const button of dialog.querySelectorAll('button:not(#aurora-funding-close)'))button.disabled=busy||!navigator.onLine;}
 function hideActions(){for(const id of ['confirm','check','continue','cleanup','review'])$('aurora-funding-'+id).hidden=true;}
 function paint(){
  hideActions();const row=rows.at(-1),terms=$('aurora-funding-terms');terms.replaceChildren();
  for(const [label,value]of [['Funds','1 LTS'],['Custody','Original Tornado pool note'],['Network fees','Paid by the testnet service']]){const amount=el('dd',value);if(label==='Funds')walletAmount(amount,value);terms.append(el('dt',label),amount);}
  if(row?.review)terms.append(el('dt','Permission ends'),el('dd',new Date(row.review.deadline).toLocaleString()));
  const history=$('aurora-funding-history');history.replaceChildren();for(const saved of rows){const item=el('li');item.append(walletAmount(el('strong'),'1 LTS'),el('p',saved.outcome?.funded?'Pool deposit confirmed':saved.outcome?.cancelled?'Funding cancelled; original note retained':saved.signed?'Original signed request retained':'Unsigned funding review'));
   for(const transaction of saved.outcome?.stages??[]){if(!transaction.transaction)continue;const link=el('a','View on NEAR testnet');link.href='https://testnet.nearblocks.io/txns/'+encodeURIComponent(transaction.transaction);link.target='_blank';link.rel='noopener noreferrer';item.append(link);}history.append(item);
  }
  if(!row?.signed){if(review&&review.deadline>Date.now()&&config?.available)$('aurora-funding-confirm').hidden=false;}
  else if(row.outcome?.cancelled&&row.outcome.cleanupComplete)$('aurora-funding-review').hidden=false;
  else if(row.outcome?.state==='confirmed')$('aurora-funding-feedback').textContent=owned.length?'Test funds received in your private pool note.':'Deposit confirmed. Current available balance has not been verified.';
  else{
   $('aurora-funding-check').hidden=false;
   const stages=row.outcome?.stages??[],canContinue=row.outcome?.state==='pending'&&stages.length>0&&stages.every(stage=>stage.success===true)&&!row.outcome.cleanupComplete;
   $('aurora-funding-continue').hidden=!canContinue;
   const failedDeposit=stages.some(stage=>stage.stage===1&&stage.success===false),unstarted=stages.every(stage=>stage.stage!==1),expired=row.review.deadline<=Date.now();
   $('aurora-funding-cleanup').hidden=!!row.outcome?.funded||row.outcome?.cleanupComplete===true||!(failedDeposit||unstarted&&expired);
   $('aurora-funding-cleanup').textContent=expired&&!stages.length?'Cancel expired grant':'Clear funding approval';
  }
  emit();
 }
 async function connect(ticket){
  if(source?.identity())return;check(identity,'Create or sign in to your Lenz account first.');const state=await readState();check(ticket===generation&&state.identity?.profile.id===identity,'Open the original account.');
  const openedNear=createNearIntentSource(identity);let openedSource;near=openedNear;
  try{await openedNear.connect();check(ticket===generation&&!disposed,'The funding account changed.');openedSource=createAuroraIntentSource(identity,{nearSource:openedNear});source=openedSource;await openedSource.connect();assertCurrent(ticket);client=createAuroraFundingClient(openedSource);}
  catch(error){openedSource?.dispose();openedNear.dispose();if(source===openedSource)source=null;if(near===openedNear)near=null;throw error;}
 }
 async function readOwned(ticket){
  owned=[];results=[];if(!rows.some(row=>row.outcome?.funded)){emit();return;}
  try{const receiver=await connectOwnedAccount(ticket,{create:false});assertCurrent(ticket);const address=receiver?.identity().address,response=await fetch('/api/intent-aurora/snapshot',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(address?{owner:address}:{}),cache:'no-store',signal:AbortSignal.timeout(60000)}),observed=await response.json();assertCurrent(ticket);check(response.ok,'The private pool balance cannot be verified right now.');const holdings=await source.holdings(observed);assertCurrent(ticket);owned=holdings.map(row=>({id:'aurora-note:'+row.commitment,commitment:row.commitment,symbol:row.symbol,name:'Private pool funds',chainId:'eip155:1313161555',accountId:row.accountId,asset:row.asset,decimals:row.decimals,units:row.available,cachedUnits:row.amount,pending:row.pending,status:'verified',verifiedAt:row.observedAt,purpose:'Original Tornado pool note · '+deployment.network}));if(address){check(observed.source?.owner===address&&typeof observed.source.outputBalance==='string'&&/^[0-9]{1,78}$/.test(observed.source.outputBalance),'The received token balance belongs to another account.');if(BigInt(observed.source.outputBalance)>0n)results=[{id:'aurora-account:'+address+':'+deployment.outputToken,chainId:'eip155:1313161555',accountId:address,asset:deployment.outputToken,symbol:'LTT',name:'Lenz Test Target',decimals:6,units:observed.source.outputBalance,cachedUnits:observed.source.outputBalance,status:'verified',verifiedAt:observed.observedAt,custody:'Aurora account',purpose:'Received swap funds · Aurora testnet'}];}}
  catch(error){assertCurrent(ticket);$('aurora-funding-feedback').textContent=error.message;}emit();
 }
 async function refresh(ticket){const saved=await source.snapshot();assertCurrent(ticket);rows=saved;await readOwned(ticket);assertCurrent(ticket);paint();}
 async function operation(task){check(!disposed&&!busy,'Finish the current funding check first.');busy=true;const ticket=generation;emit();try{return await task(ticket);}catch(error){if(ticket===generation&&!disposed){$('aurora-funding-feedback').textContent=error.message;const original=source;try{if(original?.identity()){const saved=await original.snapshot();assertCurrent(ticket);check(source===original,'The funding account changed.');rows=saved;}}catch{}if(ticket===generation&&!disposed)paint();}throw error;}finally{if(ticket===generation&&!disposed){busy=false;emit();}}}
 const quiet=task=>void operation(task).catch(()=>{});
 async function connectOwnedAccount(ticket,{create=true}={}){
  if(account)return account;if(!create){const state=await readState();assertCurrent(ticket);if(!state.auroraOwnedAccount)return null;}
  const {createAuroraOwnedAccount}=await import('./intent-aurora-account.js');assertCurrent(ticket);const opened=(accountFactory??createAuroraOwnedAccount)(identity);try{await(create&&opened.connectReceiving?opened.connectReceiving():opened.connect());assertCurrent(ticket);account=opened;return account;}catch(error){opened.dispose();throw error;}
 }
 async function swapContext(ticket){
  await connect(ticket);assertCurrent(ticket);
  await connectOwnedAccount(ticket);assertCurrent(ticket);if(!swapService){const route=await import('./intent-aurora-route.js');assertCurrent(ticket);swapStore=createIntentActionStore(identity);wrappedSource=route.createAuroraSwapSource(source);swapService=(serviceFactory??route.createAuroraIntentService)({source,account,store:swapStore});}
  return {source,account,service:swapService,wrappedSource};
 }
 function connectSwap(){return operation(swapContext);}
 function openSwap(selection){return operation(async ticket=>{
  const context=await swapContext(ticket);assertCurrent(ticket);if(!swapView){const original=source;swapView=mountIntentAction({idPrefix:'aurora-intent-action',source:context.wrappedSource,service:context.service,store:swapStore,formatAmount:(value,asset)=>{const amount=BigInt(value),fraction=(amount%1000000n).toString().padStart(6,'0').replace(/0+$/,'');return (amount/1000000n).toString()+(fraction?'.'+fraction:'')+' '+(asset===deployment.inputToken?'LTS':'LTT');},formatAccount:(value,role)=>(role==='source'?'Private pool funds':value.accountId)+' · Aurora testnet',feeCoverage:'Paid by testnet service',editSelection:async draft=>{swapView.dialog.close();editSwapSelection?.(draft);return null;}});swapView.dialog.addEventListener('close',()=>{if(source===original&&!busy&&!disposed&&navigator.onLine)quiet(refresh);});}
  await swapView.open(selection);assertCurrent(ticket);if(navigator.onLine)await swapView.workspace.prepare();else swapView.dialog.querySelector('#aurora-intent-action-feedback').textContent='Selection saved offline. Reconnect to review this exact private swap before approval.';
 });}
 function restoreSwap(row){return operation(async ticket=>{await swapContext(ticket);const saved=await swapStore.read(JSON.stringify(['eip155:1313161555',row.accountId]));assertCurrent(ticket);return saved;});}
 async function prepare(ticket){
  review=null;hideActions();const received=await client.configuration();assertCurrent(ticket);check(typeof received.available==='boolean'&&received.network==='testnet'&&received.chainId===deployment.chainId&&received.pool===deployment.pool&&received.asset===deployment.inputToken&&received.amount===deployment.denomination&&received.privacy==='pool-withdrawal','The private funding configuration changed.');config=received;
  const saved=await source.snapshot();assertCurrent(ticket);rows=saved;const row=rows.at(-1);if(row?.signed&&!(row.outcome?.cancelled&&row.outcome.cleanupComplete)){await refresh(ticket);assertCurrent(ticket);$('aurora-funding-feedback').textContent=row.outcome?.funded?'Pool deposit confirmed. Check the current balance above.':'Keep the original signed request. Check its funding status before continuing.';return;}
  check(config.available,config.reason||'Private test funding is unavailable.');
  try{const receiver=await connectOwnedAccount(ticket);assertCurrent(ticket);await backupNow();assertCurrent(ticket);await near.capture().requireRecovery();await receiver.capture().requireRecovery();assertCurrent(ticket);}catch(error){$('aurora-funding-recovery').hidden=false;throw error;}
  const prepared=await client.prepare();assertCurrent(ticket);const current=await source.snapshot();assertCurrent(ticket);rows=current;review=dialog.open?prepared:null;$('aurora-funding-feedback').textContent='Review the funding terms before confirming.';paint();
 }
 async function openFunding(){const ticket=generation;opener=document.activeElement;await restoring;check(!disposed&&ticket===generation,'The funding account changed.');$('aurora-funding-recovery').hidden=true;$('aurora-funding-feedback').textContent='Checking private test funding…';hideActions();if(!dialog.open)dialog.showModal();return operation(async ticket=>{await connect(ticket);await prepare(ticket);});}
 function close(){review=null;hideActions();if(dialog.open)dialog.close();opener?.focus();}
 $('aurora-funding-close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 $('aurora-funding-confirm').onclick=()=>quiet(async ticket=>{const exact=review;check(dialog.open&&exact&&exact.deadline>Date.now(),'Review private test funding again.');assertCurrent(ticket);await account.capture().requireRecovery({latest:true});assertCurrent(ticket);check(dialog.open&&review===exact,'Review private test funding again.');review=null;hideActions();$('aurora-funding-feedback').textContent='Saving the original request before funding…';const result=await client.fund(exact.id);assertCurrent(ticket);$('aurora-funding-feedback').textContent=result.funded?'Pool deposit confirmed. Checking your available funds…':'Funding is not confirmed. Keep this original request and check it again.';await refresh(ticket);});
 $('aurora-funding-check').onclick=()=>quiet(async ticket=>{const row=rows.at(-1);check(row?.signed,'Open the original signed funding request.');await client.reconcile(row.review.id);assertCurrent(ticket);await refresh(ticket);});
 $('aurora-funding-continue').onclick=()=>quiet(async ticket=>{const row=rows.at(-1);check(dialog.open&&row?.signed,'Review the original funding request.');await client.resume(row.review.id);assertCurrent(ticket);await refresh(ticket);});
 $('aurora-funding-cleanup').onclick=()=>quiet(async ticket=>{const row=rows.at(-1);check(dialog.open&&row?.signed,'Review the original funding approval.');await client.cleanup(row.review.id);assertCurrent(ticket);await refresh(ticket);});
 $('aurora-funding-review').onclick=()=>quiet(prepare);
 $('aurora-funding-other').onclick=()=>{close();void openPublicFunding?.().catch(()=>{});};
 function invalidate(){generation++;busy=false;review=null;config=null;rows=[];owned=[];results=[];swapView?.dispose();swapView=null;account?.dispose();account=null;swapService=null;wrappedSource=null;swapStore=null;source?.dispose();near?.dispose();source=null;near=null;client=null;close();emit();}
 const changed=()=>{identity=null;invalidate();},connection=()=>{review=null;hideActions();if(dialog.open)$('aurora-funding-feedback').textContent=navigator.onLine?'Review private test funding again.':'Offline. Your original note and request stay saved.';emit();if(navigator.onLine&&source?.identity()&&!busy)quiet(refresh);};addEventListener('lenz-account-identity',changed);addEventListener('pagehide',changed);addEventListener('online',connection);addEventListener('offline',connection);
 const actionChanged=()=>{if(source?.identity()&&!busy&&navigator.onLine)quiet(refresh);};addEventListener('lenz-aurora-intent',actionChanged);
 return Object.freeze({openFunding,connectSwap,openSwap,restoreSwap,recipient:async()=>(await connectSwap()).account.identity().address,snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},render(next){if(next===identity)return;invalidate();identity=next;emit();restoring=next?operation(async ticket=>{const state=await readState();if(state.auroraIntentNotes){await connect(ticket);await refresh(ticket);}}).catch(()=>{}):Promise.resolve();},dispose(){disposed=true;invalidate();dialog.remove();style.remove();removeEventListener('lenz-account-identity',changed);removeEventListener('pagehide',changed);removeEventListener('online',connection);removeEventListener('offline',connection);removeEventListener('lenz-aurora-intent',actionChanged);listeners.clear();}});
}
