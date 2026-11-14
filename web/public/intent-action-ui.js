import {createIntentWorkspace} from './intent-workspace.js';
import {iconButton} from './wallet-actions.js';
import {walletAmount} from './wallet-visibility.js';

const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const labels={pay:'Pay',swap:'Swap',supply:'Supply',borrow:'Borrow',liquidity:'Liquidity',stake:'Stake',withdraw:'Withdraw'};
const states={'approval-unresolved':'Approval unknown · Check your wallet',declined:'Approval declined',authorized:'Approved · Not submitted','submission-unresolved':'Completion unknown · Check status',executed:'Result verified',refunded:'Refund verified',expired:'Expired · Funds unchanged'};
export function intentTransaction(evidence,source){
 if(evidence?.network!=='testnet'||!evidence.verifier||typeof evidence.transaction!=='string'||! /^[A-Za-z0-9_-]{1,128}$/.test(evidence.transaction))return null;
 const reference=evidence.transaction;
 if(source?.chainId==='zcash:testnet'&&evidence.verifier==='native-canonical-wallet-effects/v1'&&/^[0-9a-f]{64}$/.test(reference))return {label:'Zcash testnet transaction',reference};
 if((source?.chainId==='near:testnet'||evidence.verifier==='Aurora original factory')&&/^[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(reference))return {label:'View on NEAR testnet',reference,href:'https://testnet.nearblocks.io/txns/'+reference};
 return {label:'Transaction ID',reference};
}
export function mountIntentAction({service,store,source,host=document.body,idPrefix='intent-action',formatAmount=(amount,asset)=>amount+' base units · '+asset,formatAccount=account=>account.accountId,feeCoverage,editSelection}){
 if(!/^[a-z][a-z0-9-]{0,63}$/.test(idPrefix))throw Error('Invalid action dialog identity.');
 const style=el('link');style.rel='stylesheet';style.href='/intent-action.css';document.head.append(style);
 const dialog=el('dialog');dialog.id='intent-action-dialog';dialog.className='intent-action-dialog';dialog.setAttribute('aria-labelledby','intent-action-title');
 dialog.innerHTML=`<div class="dialog-top"><h2 id="intent-action-title">Review action</h2><button id="intent-action-close" class="secondary wallet-close" type="button"></button></div>
  <div id="intent-action-exchange" class="intent-action-exchange"><div><span>Use</span><strong id="intent-action-debit"></strong><small id="intent-action-source"></small></div><span class="intent-action-arrow" aria-hidden="true">→</span><div><span>Receive at least</span><strong id="intent-action-credit"></strong><small id="intent-action-destination"></small></div></div>
  <dl id="intent-action-terms"></dl><p id="intent-action-privacy" class="quiet"></p><p id="intent-action-recovery" class="quiet"></p>
  <details id="intent-action-details" hidden><summary>Details</summary><dl id="intent-action-accounts"></dl></details>
  <div class="intent-action-controls"><button id="intent-action-review" type="button">Review route</button><button id="intent-action-confirm" type="button" hidden>Confirm in wallet</button><button id="intent-action-edit" class="secondary" type="button">Edit action</button></div>
  <p id="intent-action-feedback" class="wallet-feedback" role="status" aria-live="polite"></p>
  <section class="intent-action-history"><h3>Activity</h3><ul id="intent-action-attempts"></ul><p id="intent-action-empty" class="quiet">No approved request.</p></section>`;
 const prefixed=id=>id.replace(/^intent-action/,idPrefix);dialog.id=prefixed(dialog.id);dialog.setAttribute('aria-labelledby',prefixed('intent-action-title'));
 for(const node of dialog.querySelectorAll('[id]'))node.id=prefixed(node.id);
 host.append(dialog);const $=id=>dialog.querySelector('#'+prefixed(id));iconButton($('intent-action-close'),'Close','m6 6 12 12M18 6 6 18');
 const workspace=createIntentWorkspace({service,store,source,changed:paint});
 let disposed=false,opener=null;
 function line(label,value,amount=false,target=$('intent-action-terms')){const term=el('dt',label),description=el('dd',value);if(amount)walletAmount(description,value);target.append(term,description);}
 function paint(state){
  if(disposed)return;
  const selected=state.review??state.draft;
  $('intent-action-exchange').hidden=!selected;$('intent-action-title').textContent=selected?(labels[selected.action]??'Review action'):'Activity';
  dialog.setAttribute('aria-busy',String(state.busy));$('intent-action-terms').replaceChildren();$('intent-action-accounts').replaceChildren();$('intent-action-details').hidden=true;
  if(selected){
   $('intent-action-title').textContent=labels[selected.action]??'Review action';
   walletAmount($('intent-action-debit'),formatAmount(selected.source.amount,selected.source.asset));
   walletAmount($('intent-action-credit'),formatAmount(selected.destination.minAmount,selected.destination.asset));
   const sourceLabel=formatAccount(selected.source,'source'),destinationLabel=formatAccount(selected.destination,'destination');
   $('intent-action-source').textContent=sourceLabel;
   $('intent-action-destination').textContent=destinationLabel;
   if(sourceLabel!==selected.source.accountId||destinationLabel!==selected.destination.accountId){
    $('intent-action-details').hidden=false;
    line('Source account',selected.source.accountId,false,$('intent-action-accounts'));
    line('Receiving account',selected.destination.accountId,false,$('intent-action-accounts'));
   }
   line('Permission ends',new Date(selected.deadline).toLocaleString());
   if(state.review&&feeCoverage)line('Network fees',feeCoverage);
   for(const fee of state.review?.fees??[])line(fee.label??'Fee',formatAmount(fee.amount,fee.asset),true);
   for(const term of state.review?.reviewTerms??[])line(term.label,term.amount!==undefined?formatAmount(term.amount,term.asset):term.value,term.amount!==undefined);
  }
  $('intent-action-privacy').textContent=selected?(state.review?.privacyDisclosure??(selected.privacy==='private'?'The private route must be verified before approval.':'The route’s on-chain activity is public.')):'';
  $('intent-action-recovery').textContent=state.review?.recoveryDisclosure??'';
  const existing=state.attempts.find(attempt=>attempt.id===state.review?.id&&attempt.status!=='declined');
  const expired=existing?.status==='expired';
  $('intent-action-review').hidden=!selected||expired||!!state.review&&state.executionAvailable;
  $('intent-action-confirm').hidden=!state.review||!!existing;$('intent-action-confirm').disabled=state.busy||!state.executionAvailable;
  $('intent-action-confirm').textContent=state.review?.authorization?.label??'Confirm in wallet';
  $('intent-action-edit').hidden=!selected||typeof editSelection!=='function';
  for(const button of dialog.querySelectorAll('button'))if(button!==$('intent-action-close')&&button!==$('intent-action-confirm'))button.disabled=state.busy;
  $('intent-action-feedback').textContent=state.error||(!expired&&!state.executionAvailable&&state.review?'Execution is unavailable for this route.':'');
  $('intent-action-attempts').replaceChildren();$('intent-action-empty').hidden=state.attempts.length>0;
  for(const attempt of [...state.attempts].reverse()){
   const item=el('li'),summary=el('strong',labels[attempt.review.action]??'Action'),status=el('p',states[attempt.status]);item.append(summary,status);
   if(attempt.status==='approval-unresolved'&&typeof service.recoverAuthorization==='function'){
    const recover=el('button','Recover original approval');recover.className='secondary';recover.type='button';recover.disabled=state.busy;recover.onclick=()=>run(()=>workspace.recoverAuthorization(attempt.id));item.append(recover);
   }
   if(attempt.status==='authorized'){
    const submit=el('button','Submit approved request');submit.className='secondary';submit.type='button';submit.disabled=state.busy;submit.onclick=()=>run(()=>workspace.dispatch(attempt.id));item.append(submit);
   }
   if((attempt.authorization||attempt.status==='approval-unresolved'&&service.supportsUnsignedExpiry===true)&&!['executed','refunded','expired'].includes(attempt.status)){
    const check=el('button','Check status');check.className='secondary';check.type='button';check.disabled=state.busy;check.onclick=()=>run(()=>workspace.reconcile(attempt.id));item.append(check);
   }
   if(service.supportsOriginalResume===true&&attempt.status==='submission-unresolved'&&attempt.outcome?.resubmissionSafe===true){
    const resume=el('button','Resume original request');resume.className='secondary';resume.type='button';resume.disabled=state.busy;resume.onclick=()=>run(()=>workspace.resume(attempt.id));item.append(resume);
   }
   if(typeof service.recover==='function'&&!['executed','refunded','expired'].includes(attempt.status)&&attempt.outcome?.recovery?.available===true&&['recover','withdrawRefund'].includes(attempt.outcome.recovery.operation)){
    const operation=attempt.outcome.recovery.operation,recover=el('button',operation==='withdrawRefund'?'Recover test funds':'Complete original request');recover.className='secondary';recover.type='button';recover.disabled=state.busy;recover.onclick=()=>run(()=>workspace.recover(attempt.id,operation));item.append(recover);
   }
   if(attempt.outcome?.verified!==true&&typeof attempt.outcome?.evidence?.description==='string'&&attempt.outcome.evidence.description.length<=2000)item.append(el('p',attempt.outcome.evidence.description));
   if(attempt.outcome?.verified===true&&attempt.outcome.evidence?.description){
    const evidence=attempt.outcome.evidence;
    const result=el('p');if(evidence.inputAsset&&evidence.outputAsset&&evidence.inputAmount&&evidence.outputAmount)result.append('Swapped ',walletAmount(el('span'),formatAmount(evidence.inputAmount,evidence.inputAsset)),' for ',walletAmount(el('span'),formatAmount(evidence.outputAmount,evidence.outputAsset)),'.');else result.textContent=evidence.description;item.append(result);
    const transaction=intentTransaction(evidence,attempt.review.source);if(transaction){
     const details=el('details'),summary=el('summary','Transaction');details.append(summary);
     if(transaction.href){const link=el('a',transaction.label);link.href=transaction.href;link.target='_blank';link.rel='noopener noreferrer';details.append(link);}
     else details.append(el('p',transaction.label),el('code',transaction.reference));item.append(details);
    }
   }
   $('intent-action-attempts').append(item);
  }
 }
 async function run(operation){try{await operation();}catch(error){if(!disposed)$('intent-action-feedback').textContent=error instanceof Error?error.message:'Could not complete this step.';}}
 function close(){void run(()=>workspace.cancel());if(dialog.open)dialog.close();opener?.focus();}
 $('intent-action-close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 $('intent-action-review').onclick=()=>run(()=>workspace.prepare());
 $('intent-action-confirm').onclick=()=>run(async()=>{const state=await workspace.approve();const approved=state.attempts.find(attempt=>attempt.id===state.review?.id&&attempt.status==='authorized');if(approved)await workspace.dispatch(approved.id);});
 $('intent-action-edit').onclick=()=>run(async()=>{const draft=workspace.snapshot().draft,selected=await editSelection(structuredClone(draft));if(selected)await workspace.select(selected);});
 const accountChanged=()=>{close();},sourceChanged=()=>{void run(()=>workspace.cancel());};addEventListener('lenz-account-identity',accountChanged);addEventListener('lenz-evm-session',sourceChanged);addEventListener('lenz-near-intent-session',sourceChanged);addEventListener('lenz-zcash-intent-session',sourceChanged);addEventListener('pagehide',accountChanged);
 paint(workspace.snapshot());
 return Object.freeze({workspace,dialog,async open(selection){opener=document.activeElement;await workspace.select(selection);paint(workspace.snapshot());dialog.showModal();},async restore(selectedSource){opener=document.activeElement;await workspace.restore(selectedSource);paint(workspace.snapshot());dialog.showModal();},dispose(){disposed=true;void workspace.cancel().catch(()=>{});dialog.remove();style.remove();removeEventListener('lenz-account-identity',accountChanged);removeEventListener('lenz-evm-session',sourceChanged);removeEventListener('lenz-near-intent-session',sourceChanged);removeEventListener('lenz-zcash-intent-session',sourceChanged);removeEventListener('pagehide',accountChanged);}});
}
