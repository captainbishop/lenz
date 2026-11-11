import {readState} from './chat-store.js';
import {requirePaymentAccess} from './chat-access.js';
import {checkPrivateFunding,FUNDING_NETWORKS} from './private-funding.js';
import {prepareTransfer,validateReview,amount,check} from './evm-transfer.js';
import {createTransferService} from './evm-transfer-service.js';
import {readTransfers,transferOpen} from './evm-transfer-store.js';
import {iconButton,walletIcon} from './wallet-actions.js';
import {walletAmount} from './wallet-visibility.js';

const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
const eth=value=>amount('0x'+BigInt(value).toString(16))+' ETH';
const labels={awaiting_wallet:'Waiting for your wallet',submitted:'Sent · waiting for confirmation',unknown:'Wallet response lost · check before trying again',pending:'Waiting for confirmation',included:'Confirming transfer',confirmed:'Transfer confirmed · arrival in Lenz not yet verified',failed:'Transfer failed',declined:'Cancelled in wallet',not_sent:'Not sent'};

export function mountPrivateFunding(session,{connect}={}){
 const button=el('button');button.id='private-funding-open';button.type='button';button.className='secondary';iconButton(button,'Add funds','M12 5v14M5 12h14');button.append(el('span','Add funds'));
 document.querySelector('#wallet-private-approvals .section-heading').append(button);
 const dialog=el('dialog');dialog.id='private-funding-dialog';dialog.setAttribute('aria-labelledby','private-funding-title');
 dialog.innerHTML=`<div class="dialog-top"><h2 id="private-funding-title">Add funds</h2><button id="private-funding-close" type="button" class="secondary wallet-close"></button></div>
 <div class="private-funding-route" aria-label="Transfer"><div><span class="quiet">From your wallet</span><button id="private-funding-source" type="button" class="secondary"><span id="private-funding-source-label">Choose wallet</span>${walletIcon('m9 6 6 6-6 6')}</button><span id="private-funding-source-balance" class="quiet"></span></div><span class="private-funding-arrow">${walletIcon('M4 12h16m-5-5 5 5-5 5')}</span><div><span class="quiet">To</span><strong>Your Lenz account</strong><span class="quiet">ETH · approved in your wallet</span></div></div>
 <p id="private-funding-intro" class="quiet">Choose an amount. Check the fees, then confirm in your wallet.</p>
 <form id="private-funding-form"><div class="private-funding-value"><label for="private-funding-amount">Amount</label><input id="private-funding-amount" inputmode="decimal" autocomplete="off" placeholder="0.00" maxlength="80" required><span>ETH</span></div>
 <label class="check"><input id="private-funding-consent" type="checkbox"><span>I understand this transfer is public. My address and amount will be visible.</span></label>
 <button id="private-funding-prepare" type="submit">Review transfer</button></form>
 <details id="private-funding-how"><summary>How this works</summary><p>Lenz handles the transfer between networks through NEAR Intents. ETH goes to a Confidential Intents account controlled by your wallet. Aurora may be used for some later actions.</p><p>Your wallet, network providers, Lenz and Intents operators can see your address and amount. Privacy is requested, but has not been independently verified.</p></details>
 <section id="private-funding-review" hidden><h3>Review transfer</h3><dl id="private-funding-terms"></dl><p class="quiet">Lenz still needs to verify that the money arrived. Privacy and refunds are not yet verified.</p><details><summary>Transfer details</summary><dl id="private-funding-exact"></dl><p>The expected amount is not a confirmed balance. A signed price estimate does not prove privacy, that funds arrived or that a refund completed. The refund-start time and privacy request are not covered by the signature.</p></details><button id="private-funding-approve" type="button">Confirm in wallet</button><button id="private-funding-edit" type="button" class="secondary">Edit amount</button></section>
 <p id="private-funding-feedback" role="status" class="wallet-feedback" aria-atomic="true"></p>
 <div class="section-heading"><h3>Recent transfers</h3><button id="private-funding-refresh" type="button" class="secondary">Refresh</button></div><ul id="private-funding-history"></ul>`;
 document.body.append(dialog);const $=id=>dialog.querySelector('#'+id),service=createTransferService();
 iconButton($('private-funding-close'),'Close','m6 6 12 12M18 6 6 18');
 iconButton($('private-funding-refresh'),'Refresh transfers','M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
 let review=null,lease=null,busy=false,controller=null,generation=0,renderVersion=0,access=false,pending=false,choosingFunds=false;
 function controls(){
  dialog.setAttribute('aria-busy',String(busy));
  $('private-funding-amount').disabled=busy;$('private-funding-consent').disabled=busy;
  const network=FUNDING_NETWORKS[session.snapshot?.chainId];
  $('private-funding-source').disabled=busy||!connect||!navigator.onLine;
  $('private-funding-source-label').textContent=network?'ETH · '+network.name:'Choose wallet';
  $('private-funding-source-balance').replaceChildren();if(network)$('private-funding-source-balance').append(walletAmount(el('span'),session.snapshot.amount+' ETH available'));
  $('private-funding-prepare').disabled=busy||!access||pending||!navigator.onLine||!network||!$('private-funding-consent').checked;
  $('private-funding-approve').disabled=busy||!access||pending||!navigator.onLine||!review||session.snapshot!==lease?.identity;
  $('private-funding-edit').disabled=busy;$('private-funding-refresh').disabled=busy;
  for(const node of $('private-funding-history').querySelectorAll('button'))node.disabled=busy||!navigator.onLine||session.snapshot?.chainId!==node.dataset.chain||session.snapshot?.address!==node.dataset.owner;
 }
 function clearReview(){review=null;lease=null;$('private-funding-review').hidden=true;$('private-funding-intro').hidden=false;$('private-funding-form').hidden=false;controls();}
 function cancel(){generation++;renderVersion++;controller?.abort();controller=null;busy=false;clearReview();}
 $('private-funding-close').onclick=()=>{cancel();dialog.close();};dialog.addEventListener('cancel',cancel);dialog.addEventListener('close',()=>{if(!dialog.open)cancel();});
 addEventListener('pagehide',()=>{choosingFunds=false;cancel();});addEventListener('lenz-account-identity',()=>{choosingFunds=false;cancel();if(dialog.open)dialog.close();});
 addEventListener('lenz-evm-session',()=>{cancel();if(dialog.open)void refresh().catch(showError);});
 addEventListener('offline',()=>{cancel();controls();});addEventListener('online',controls);
 addEventListener('lenz-transfers-changed',()=>{if(dialog.open)void refresh().catch(showError);});
 $('private-funding-consent').onchange=controls;$('private-funding-edit').onclick=()=>{clearReview();$('private-funding-amount').focus();};
 function showError(error){$('private-funding-feedback').textContent=/abort|cancel/i.test(error?.name+' '+error?.message)?'Cancelled here. Close any open request in your wallet.':error?.code===4001?'Cancelled in your wallet. Review again to retry.':error instanceof Error?error.message:'Could not check this transfer.';}
 function line(host,label,value){host.append(el('dt',label),el('dd',value));}
 async function refresh(){
  const ticket=++renderVersion,state=await readState(),rows=await readTransfers(),snapshot=session.snapshot;
  if(ticket!==renderVersion||!dialog.open)return;
  access=!!state.identity&&state.identity.access===undefined;pending=!!snapshot&&rows.some(r=>transferOpen(r)&&r.review.terms.chainId===snapshot.chainId&&r.review.terms.from===snapshot.address);
  $('private-funding-history').replaceChildren();
  for(const row of rows.filter(r=>r.review.version===3&&(!snapshot||r.review.terms.from===snapshot.address)).reverse()){
   const funding=checkPrivateFunding(row.review.funding,{now:row.review.createdAt}),item=el('li'),details=el('details'),terms=el('dl');
   const title=el('summary');title.append(walletAmount(el('span'),eth(funding.amount)),el('span',' · '+FUNDING_NETWORKS[funding.chainId].name));details.append(title);
   for(const [label,value]of [['From',FUNDING_NETWORKS[funding.chainId].name+' · ETH'],['Your wallet',funding.owner],['Transfer address',funding.depositAddress],['Expected to arrive',eth(funding.amountOut)],['Refund can begin after',new Date(funding.refundDeadline).toLocaleString()],['Send before',new Date(funding.depositDeadline).toLocaleString()]])line(terms,label,value);
   details.append(terms);item.append(details,el('p',labels[row.state]));
   if(!['confirmed','failed','declined','not_sent'].includes(row.state)){
    const hash=el('input');hash.placeholder='Transaction ID from your wallet';hash.setAttribute('aria-label','Transaction ID from your wallet');hash.maxLength=66;hash.hidden=!!row.hash;
    const checkButton=el('button','Check transfer');checkButton.type='button';checkButton.className='secondary';checkButton.dataset.owner=funding.owner;checkButton.dataset.chain=funding.chainId;
    checkButton.disabled=busy||!navigator.onLine||!snapshot||snapshot.address!==funding.owner||snapshot.chainId!==funding.chainId;
    checkButton.onclick=()=>act(async signal=>{const original=session.capture();signal.throwIfAborted();await service.reconcile(original,row.id,hash.value.trim()||undefined);signal.throwIfAborted();});item.append(hash,checkButton);
   }
   $('private-funding-history').append(item);
  }
  if(!rows.some(r=>r.review.version===3))$('private-funding-history').append(el('li','Your transfers will appear here.'));
  controls();
 }
 async function act(operation){
  if(busy)return;const ticket=++generation;controller=new AbortController();const signal=controller.signal;busy=true;controls();$('private-funding-feedback').textContent='Checking…';
  try{await operation(signal,ticket);signal.throwIfAborted();if(ticket===generation)await refresh();}
  catch(error){if(ticket===generation)showError(error);}
  finally{if(ticket===generation){busy=false;controller=null;controls();}}
 }
 button.onclick=()=>{clearReview();$('private-funding-feedback').textContent=FUNDING_NETWORKS[session.snapshot?.chainId]?'':'Choose funds from an Ethereum, Arbitrum or Base wallet.';dialog.showModal();void refresh().catch(showError);};
 $('private-funding-source').onclick=async()=>{
  if(busy||!connect)return;const identity=(await readState()).identity?.profile.id;choosingFunds=true;cancel();dialog.close();
  try{const snapshot=await connect();if(!choosingFunds||!snapshot||(await readState()).identity?.profile.id!==identity)return;dialog.showModal();await refresh();}
  catch(error){showError(error);}finally{choosingFunds=false;}
 };
 $('private-funding-refresh').onclick=()=>act(async()=>{});
 $('private-funding-form').onsubmit=event=>{event.preventDefault();void act(async(signal,ticket)=>{
  const identity=(await readState()).identity;requirePaymentAccess(identity);check(identity,'Create a Lenz profile first.');
  const current=session.capture();check(FUNDING_NETWORKS[current.identity.chainId],'Choose ETH on Ethereum, Arbitrum or Base to add funds.');check($('private-funding-consent').checked,'Confirm that this transfer is public first.');
  const {receiveAmount}=await import('./receive-assets.js');const chosen={owner:current.identity.address,chainId:current.identity.chainId,amount:receiveAmount($('private-funding-amount').value,18),refundDeadline:new Date(Date.now()+3600000).toISOString()};
  const response=await fetch('/api/private-spend/fund-prepare',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(chosen),redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.any([signal,AbortSignal.timeout(25000)])});
  check(response.ok,'Adding funds is unavailable right now. Your amount stays here.');const text=await response.text();check(text.length<=70000,'The transfer details are too large to check.');const result=JSON.parse(text);
  check(result.state==='awaiting-funding-review','Could not open the transfer review.');for(const [key,value]of Object.entries(chosen))check(result.offer?.terms?.[key]===value,'The transfer details changed. Review again.');
  const funding=checkPrivateFunding(result.offer),transfer=await prepareTransfer(current,{asset:'native',recipient:funding.depositAddress,amount:eth(funding.amount).slice(0,-4),publicConsent:true});
  signal.throwIfAborted();current.assertCurrent();check(dialog.open&&ticket===generation,'Funding review closed.');const latest=(await readState()).identity;check(latest?.profile.id===identity.profile.id,'Lenz account changed.');requirePaymentAccess(latest);
  review=validateReview({...transfer,version:3,funding:result.offer});lease=current;const terms=$('private-funding-terms'),exact=$('private-funding-exact');terms.replaceChildren();exact.replaceChildren();
  for(const [label,value]of [['From',FUNDING_NETWORKS[funding.chainId].name+' · ETH'],['To','Your Lenz account · ETH'],['You send',eth(funding.amount)],['Expected to arrive',eth(funding.amountOut)],['Transfer fee',eth(funding.fees)],['Refund fee',eth(funding.refundFee)],['Withdrawal fee · already included',eth(funding.withdrawFee)],['Network fee estimate',eth((BigInt(transfer.transaction.gas)*BigInt(transfer.transaction.gasPrice)).toString())],['Refund can begin after',new Date(funding.refundDeadline).toLocaleString()],['Send before',new Date(funding.depositDeadline).toLocaleString()]])line(terms,label,value);
  for(const [label,value]of [['Your wallet / refund address',funding.owner],['Transfer address · '+FUNDING_NETWORKS[funding.chainId].name,funding.depositAddress]])line(exact,label,value);
  if(funding.chainId!=='0x1')line(terms,'Additional network fees','Extra network fees may apply. Check the total in your wallet.');
  $('private-funding-form').hidden=true;$('private-funding-intro').hidden=true;$('private-funding-review').hidden=false;$('private-funding-feedback').textContent='Check the amount and fees before confirming.';
 });};
 $('private-funding-approve').onclick=()=>act(async(signal,ticket)=>{
  const selected=review,current=lease,identity=(await readState()).identity;check(selected&&current&&identity,'Review the deposit first.');requirePaymentAccess(identity);
  const guard=()=>{signal.throwIfAborted();current.assertCurrent();check(dialog.open&&ticket===generation,'Funding review closed or changed.');};
  const guarded={...current,assertCurrent:guard,sendTransaction:async tx=>{guard();const latest=(await readState()).identity;check(latest?.profile.id===identity.profile.id,'Lenz account changed.');requirePaymentAccess(latest);guard();return current.sendTransaction(tx);}};
  const row=await service.send(guarded,selected);signal.throwIfAborted();clearReview();$('private-funding-feedback').textContent=labels[row.state]+(row.error?'. '+row.error:'');
 });
 controls();
}
