import { readState, updateState } from './chat-store.js';
import { walletAmount } from './wallet-visibility.js';
import { readNearVault, saveNearVault, displayUnits, units, compressed, nearLedger } from './near-protocol.js';
import { prepareRefundReturn, acceptDepositResult } from './near-deposit.js';
import { prepareRheaSwap, checkRheaConfig } from './rhea-protocol.js';
import { connectedNearAccount, connectNearWallet, disconnectNearWallet, signRefundDeposit } from './near-signer.js';
import { walletError } from './wallet-feedback.js';
import { iconButton } from './wallet-actions.js';
import { mountDefiApproval } from './defi-wallet-ui.js';
import { mountDefiWorkspace, requirePublicSwap } from './defi-workspace.js';
import {requirePaymentAccess} from './chat-access.js';
const $=s=>document.querySelector(s), el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const walletLab=document.body.dataset.walletTools==='true';
let config=null, run, returnId=null, savedCount=0, defi, dex, intentSwap,currentIdentityId=null,invalidateQuote=()=>{};
let executionGeneration=0;
addEventListener('lenz-account-identity',()=>{executionGeneration++;});addEventListener('pagehide',()=>{executionGeneration++;});
const terminal=new Set(['complete','refunded','rejected','attention']);
const labels={checking:'Checking your swap',ready:'Ready',redeeming:'Starting swap',funded:'Swap in progress',depositing:'Swap in progress',deposited:'Ready to swap',swapping:'Swapping',output_on_dex:'Getting your funds ready',refund_on_dex:'Getting your refund ready',withdrawing_output:'Getting your funds ready',withdrawing_refund:'Getting your refund ready',output_available:'Ready to send',refund_available:'Refund ready to send',paying_output:'Sending to your wallet',paying_refund:'Sending your refund',complete:'Swap complete',refunded:'Refund available',rejected:'Swap could not start',attention:'Swap needs checking'};
const notice=text=>{$('#rhea-feedback').textContent=text;};
function refreshSwapConnection(){
  const online=navigator.onLine, summary=$('#rhea-queue');if(!summary)return;
  summary.textContent=savedCount?`${savedCount} pending swap${savedCount===1?'':'s'}.`:'No pending swaps.';
  document.querySelectorAll('[data-rhea-online]').forEach(button=>{button.disabled=!online||button.dataset.rheaBusy==='true';});
  document.querySelectorAll('[data-defi-send]').forEach(button=>{button.disabled=!online||Date.now()>=Number(button.dataset.defiExpiry);});
  if($('#rhea-privacy')?.value!=='public-testnet')$('#rhea-quote').disabled=true;
}
function needsConnection(button){button.dataset.rheaOnline='';button.disabled=!navigator.onLine;return button;}
function wrapped(n){const v=BigInt(n),part=(v%10n**24n).toString().padStart(24,'0').replace(/0+$/,'');return `${v/10n**24n}${part?'.'+part:''}`;}
function compactAmount(value){
  const [whole,fraction='']=value.split('.'),digits=(whole+fraction).replace(/^0+/,'');if(!digits)return '0';
  const exponent=whole==='0'?-(fraction.match(/^0*/)[0].length+1):whole.length-1,significant=digits.slice(0,6).replace(/0+$/,'');
  if(exponent<-7||exponent>7)return significant[0]+(significant.length>1?'.'+significant.slice(1):'')+'e'+exponent;
  if(whole!=='0')return exponent>=7?whole:whole+(fraction.slice(0,Math.max(0,6-whole.length)).replace(/0+$/,'')?'.'+fraction.slice(0,Math.max(0,6-whole.length)).replace(/0+$/,''):'');
  return '0.'+fraction.slice(0,-exponent-1+6).replace(/0+$/,'');
}
async function request(route,data,{signal}={}){if(!navigator.onLine)throw new Error('You are offline. Your saved swap and reserved money are unchanged.');const timeout=AbortSignal.timeout(150000);const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:signal?AbortSignal.any([signal,timeout]):timeout});const reply=await r.json();if(!r.ok)throw new Error(reply.error??'Connection interrupted. The saved order can be retried.');return reply;}
function download(packet){const url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:'application/json'}));const a=el('a');a.href=url;a.download=`lenz-swap-${packet.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function loadRheaConfig(){const r=await fetch('/rhea-config.json');if(!r.ok)return;const c=await r.json();if(c.ready){checkRheaConfig(c);config=c;}}
export function mountRheaWallet({action,intentController}){
  run=op=>action(async()=>{try{await op();}catch(e){const message=walletError(e);notice(message);throw new Error(message);}});
  const section=el('section',undefined,'rhea-wallet');section.id='rhea-wallet';section.innerHTML=`<div class="section-heading"><h2>Swap</h2><button id="rhea-open" type="button" class="secondary">New swap</button></div><p class="quiet">Exchange test dollars for wrapped NEAR. Powered by Rhea.</p><p id="rhea-queue" class="rhea-queue" role="status" aria-atomic="true"></p><p id="rhea-feedback" class="status" role="status"></p><div id="rhea-orders"></div>`;
  $('#near-wallet').append(section);
  const connection=el('div',undefined,'near-signer');
  connection.hidden=!walletLab;
  connection.innerHTML='<p id="near-signer-account" class="quiet" role="status">Connect a test wallet to receive swaps and return refunds.</p><div class="near-signer-actions"><button id="near-signer-connect" type="button" class="secondary">Connect Meteor</button><button id="near-signer-disconnect" type="button" class="secondary" hidden>Disconnect</button></div><p class="quiet">Your other wallet opens separately for approval.</p>';
  section.querySelector('#rhea-feedback').before(connection);
  $('#near-signer-connect').onclick=()=>run(async()=>{notice('Opening Meteor on testnet…');try{const id=await connectNearWallet();notice(`Selected ${id}. You can now use this wallet for swaps.`);}catch(e){notice(`Wallet connection did not complete. ${walletError(e)}`);}});
  $('#near-signer-disconnect').onclick=()=>run(async()=>{await disconnectNearWallet();notice('Wallet disconnected. Your saved payments are still here.');});
  const review=el('dialog');review.id='near-return-dialog';review.setAttribute('aria-labelledby','near-return-title');
  review.innerHTML='<div class="dialog-top"><h2 id="near-return-title">Return your test refund</h2><button id="near-return-close" type="button" class="secondary">Close</button></div><p id="near-return-summary"></p><p>Move the refund back to your Lenz balance. This uses 0.03 test NEAR for storage, plus a network fee. The amount will be visible on the test network.</p><p>Your balance updates once the return is confirmed.</p><button id="near-return-sign" type="button">Review in Meteor</button><p class="wallet-feedback error" role="status"></p>';
  document.body.append(review);$('#near-return-close').onclick=()=>review.close();
  $('#near-return-sign').onclick=()=>run(async()=>{
    const id=returnId;
    const r=await refundRequest(id),state=await readState(),v=await readNearVault(state,config.reserve),entry=v.rheaOrders.find(o=>o.packet.id===id);
    review.close();notice('Request saved. Approve the return in your other wallet…');
    try {await signRefundDeposit(r,{config,entry,identity:state.identity});notice('Confirming your refund…');const result=await request('/api/rhea/deposit-check',{adapter:config.adapter,id,request:r});await finishReturn(id,r,result);}
    catch(e){notice(`Return not confirmed. ${walletError(e)} Your request is saved. Check the refund before trying again.`);}
  });
  const panel=el('dialog');panel.id='rhea-dialog';panel.setAttribute('aria-labelledby','rhea-title');panel.innerHTML=`<div class="dialog-top"><h2 id="rhea-title">New swap</h2><button type="button" id="rhea-close" class="secondary">Close</button></div><form id="rhea-form"><label for="rhea-amount">Amount in tUSD</label><input id="rhea-amount" inputmode="decimal" value="1" required><button id="rhea-quote" type="button" class="secondary">Check rate</button><p id="rhea-estimate" class="quiet" role="status">Check the rate while online, then choose the least you want to receive.</p><label for="rhea-minimum">Minimum wrapped NEAR to receive</label><input id="rhea-minimum" inputmode="decimal" placeholder="0.00" required><label for="rhea-receiver">Receive in this test wallet</label><input id="rhea-receiver" placeholder="your-account.testnet" autocomplete="off" required><label for="rhea-duration">Start within</label><select id="rhea-duration"><option value="3600000">1 hour</option><option value="86400000">24 hours</option></select><p class="quiet">The swap or refund goes to this wallet. It needs to support the chosen token. The amount and receiving wallet are public on the test network. You can return a refund to Lenz after it arrives.</p><p class="quiet">Saving sets this money aside until the swap is resolved. The time limit does not make it available again.</p><button type="submit">Save swap</button></form><p class="wallet-feedback error" role="status"></p>`;document.body.append(panel);
  dex=mountDefiWorkspace(section,panel);
  iconButton($('#rhea-close'),'Close','m6 6 12 12M18 6 6 18');$('#rhea-close').classList.add('wallet-close');
  defi=mountDefiApproval({config:()=>config,run,notice,wrapped});
  let recipientEdited=false,recipientDefault='';
  async function fillConnectedRecipient(){
    if(intentSwap?.managed()||recipientEdited)return;
    const id=await connectedNearAccount();
    if(intentSwap?.managed()||recipientEdited)return;
    if(!$('#rhea-receiver').value||$('#rhea-receiver').value===recipientDefault){$('#rhea-receiver').value=id??'';recipientDefault=id??'';}
  }
  $('#rhea-receiver').addEventListener('input',()=>{if(!intentSwap?.managed())recipientEdited=true;});
  $('#rhea-close').onclick=()=>panel.close();$('#rhea-open').onclick=()=>run(async()=>{await defi.open();dex.reset();await intentSwap?.open();await fillConnectedRecipient();if(!panel.open)panel.showModal();scheduleQuote();});
  const useAccount=el('button','Use my connected wallet','secondary');useAccount.type='button';useAccount.id='rhea-use-account';useAccount.hidden=!walletLab;$('#rhea-receiver').after(useAccount);
  useAccount.onclick=()=>run(async()=>{const id=await connectedNearAccount();if(!id)throw new Error('Connect Meteor first.');$('#rhea-receiver').value=id;});
  const connectRecipient=el('button',undefined,'secondary');connectRecipient.id='rhea-connect-receiver';connectRecipient.type='button';connectRecipient.hidden=true;iconButton(connectRecipient,'Connect NEAR receiving wallet','M3 6h18v14H3zM3 6V3h14v3M15 11h6v5h-6z');$('#rhea-receiver').after(connectRecipient);
  const recipientConnection=()=>{connectRecipient.hidden=!!intentSwap?.managed()||$('#rhea-privacy').value!=='public-testnet'||!!$('#rhea-receiver').value;connectRecipient.disabled=!navigator.onLine;};
  connectRecipient.onclick=()=>run(async()=>{const owner=currentIdentityId,selected=$('#swap-pay-asset').value,target=$('#swap-receive-asset').value,id=await connectNearWallet();if(intentSwap?.managed()||owner!==currentIdentityId||selected!==$('#swap-pay-asset').value||target!==$('#swap-receive-asset').value)return;$('#rhea-receiver').value=id;$('#rhea-receiver').dispatchEvent(new Event('input'));recipientConnection();});
  $('#rhea-receiver').addEventListener('input',recipientConnection);
  let quoteRevision=0,quoteTimer=null,quoteAbort=null,quote=null,minimumEdited=false;
  const quoteSelection=()=>JSON.stringify([currentIdentityId,config,$('#swap-pay-asset').value,$('#swap-receive-asset').value,$('#rhea-amount').value,$('#rhea-slippage').value,$('#rhea-privacy').value]);
  const quoteAllowed=()=>panel.open&&!intentSwap?.managed()&&$('#rhea-privacy').value==='public-testnet';
  function stopQuote(){quoteRevision++;clearTimeout(quoteTimer);quoteTimer=null;quoteAbort?.abort();quoteAbort=null;}
  invalidateQuote=()=>{stopQuote();quote=null;};
  function scheduleQuote({immediate=false}={}){
    stopQuote();recipientConnection();if(!quoteAllowed())return;
    $('#rhea-output').removeAttribute('title');$('#rhea-rate').removeAttribute('title');
    const selection=quoteSelection();
    if(!navigator.onLine){if(quote?.selection===selection){$('#rhea-output').textContent=quote.output;$('#rhea-output').title=quote.exactOutput+' wNEAR · exact estimate';$('#rhea-rate').textContent=quote.rate;$('#rhea-estimate').textContent='Last rate '+new Date(quote.checkedAt).toLocaleTimeString()+'. Offline estimate; execution checks the rate again.';}else{$('#rhea-output').textContent='—';$('#rhea-rate').textContent='Offline · no current rate';$('#rhea-estimate').textContent='Choose a minimum under Swap settings to review offline.';}return;}
    let amountIn;try{amountIn=units($('#rhea-amount').value);}catch{$('#rhea-output').textContent='—';$('#rhea-rate').textContent='Enter an amount';$('#rhea-estimate').textContent='';return;}
    $('#rhea-output').textContent='—';$('#rhea-rate').textContent='Checking rate…';$('#rhea-estimate').textContent='';
    const ticket=quoteRevision,chosenConfig=config,slippageBps=Number($('#rhea-slippage').value);
    quoteTimer=setTimeout(async()=>{
      quoteTimer=null;const controller=new AbortController();quoteAbort=controller;
      try{
        if(!chosenConfig||![50,100,200].includes(slippageBps))throw Error('This rate source is unavailable.');
        const q=await request('/api/defi/rhea/quote',{network:'testnet',contract:chosenConfig.exchange,poolId:chosenConfig.poolId,tokenIn:chosenConfig.reserve,tokenOut:chosenConfig.tokenOut,amountIn,slippageBps},{signal:controller.signal});
        if(ticket!==quoteRevision||!quoteAllowed()||selection!==quoteSelection())return;
        if(q.request?.network!=='testnet'||q.request?.contract!==chosenConfig.exchange||q.request?.amountIn!==amountIn||q.request?.poolId!==chosenConfig.poolId||q.request?.tokenIn!==chosenConfig.reserve||q.request?.tokenOut!==chosenConfig.tokenOut||q.request.slippageBps!==slippageBps)throw Error('The quote does not match this swap.');
        if(!/^[1-9][0-9]{0,38}$/.test(q.amountOut)||!/^[1-9][0-9]{0,38}$/.test(q.minAmountOut)||BigInt(q.minAmountOut)!==BigInt(q.amountOut)*BigInt(10000-slippageBps)/10000n)throw Error('The quote minimum is invalid.');
        const exactOutput=wrapped(q.amountOut),exactRate=wrapped(BigInt(q.amountOut)*1000000n/BigInt(amountIn));
        quote={selection,checkedAt:Date.now(),output:compactAmount(exactOutput),exactOutput,rate:`1 tUSD ≈ ${compactAmount(exactRate)} wNEAR`};
        $('#rhea-output').textContent=quote.output;$('#rhea-rate').textContent=quote.rate;
        $('#rhea-output').title=exactOutput+' wNEAR · exact estimate';$('#rhea-rate').title='1 tUSD ≈ '+exactRate+' wNEAR';
        if(!minimumEdited)$('#rhea-minimum').value=wrapped(q.minAmountOut);
        $('#rhea-estimate').textContent='Estimate via Rhea · checked '+new Date(quote.checkedAt).toLocaleTimeString()+'.';
      }catch(reason){if(ticket===quoteRevision&&quoteAllowed()){quote=null;$('#rhea-output').textContent='—';$('#rhea-rate').textContent='Rate unavailable';$('#rhea-estimate').textContent=reason.message;}}
      finally{if(quoteAbort===controller)quoteAbort=null;}
    },immediate?0:250);
  }
  $('#rhea-minimum').addEventListener('input',()=>{minimumEdited=true;});
  $('#rhea-quote').onclick=()=>scheduleQuote({immediate:true});$('#rhea-quote').hidden=true;
  for(const id of ['rhea-amount','rhea-slippage','rhea-privacy','swap-pay-asset','swap-receive-asset'])$('#'+id).addEventListener(id==='rhea-amount'?'input':'change',()=>queueMicrotask(()=>scheduleQuote()));
  panel.addEventListener('close',stopQuote);addEventListener('pagehide',invalidateQuote);addEventListener('online',()=>scheduleQuote());addEventListener('offline',()=>scheduleQuote());
  addEventListener('lenz-account-identity',()=>{invalidateQuote();recipientEdited=false;recipientDefault='';minimumEdited=false;$('#rhea-receiver').value='';});
  const selfReview=el('dialog');selfReview.id='rhea-save-review';selfReview.className='near-intent-dialog';selfReview.setAttribute('aria-labelledby','rhea-save-review-title');
  selfReview.innerHTML='<div class="dialog-top"><h2 id="rhea-save-review-title">Review offline swap</h2><button id="rhea-save-back" type="button" class="secondary">Back</button></div><dl id="rhea-save-terms"></dl><p>Amounts and receiving account are public on NEAR testnet. These test assets have no cash value.</p><p id="rhea-save-execution">Authorization sets this amount aside until the swap or refund is resolved. Saving does not execute the swap. An online participant must start it, and the minimum still applies.</p><button id="rhea-save-confirm" type="button">Authorize and save</button><p class="wallet-feedback" role="status"></p>';
  document.body.append(selfReview);let selfDraft=null,savingSelf=false;
  const executionNote=selfReview.querySelector('#rhea-save-execution');
  const selfSelection=()=>JSON.stringify([currentIdentityId,config,$('#swap-pay-asset').value,$('#swap-receive-asset').value,$('#rhea-amount').value,$('#rhea-minimum').value,$('#rhea-receiver').value,$('#rhea-duration').value,$('#rhea-privacy').value,$('#defi-method').value]);
  const selfBack=()=>{if(savingSelf)return;selfDraft=null;selfReview.close();if(!panel.open)panel.showModal();};
  $('#rhea-save-back').onclick=selfBack;selfReview.addEventListener('cancel',event=>{event.preventDefault();selfBack();});
  addEventListener('lenz-account-identity',()=>{selfDraft=null;if(selfReview.open&&!savingSelf)selfReview.close();});
  $('#rhea-save-confirm').onclick=()=>{if(savingSelf||!selfDraft)return;run(async()=>{
    const original=selfDraft;requirePublicSwap();if(original.selection!==selfSelection()||intentSwap?.managed()||Date.now()>=original.options.deadlineMs)throw Error('The swap changed. Return and review it again.');
    savingSelf=true;$('#rhea-save-confirm').disabled=true;$('#rhea-save-back').disabled=true;
    try{
      const packet=await updateState(async state=>{if(selfDraft!==original||!selfReview.open||state.identity?.profile.id!==original.identityId||original.selection!==selfSelection())throw Error('The account or swap changed. Review again.');requirePaymentAccess(state.identity);const result=await prepareRheaSwap(await readNearVault(state,original.config.reserve),state.identity,original.config,original.options);await saveNearVault(state,result.vault);return result.packet;});
      const start=original.startOnline&&selfDraft===original&&navigator.onLine;
      selfDraft=null;selfReview.close();
      if(start)await execute(packet,{owner:original.identityId,config:original.config,fresh:true});
      else notice('Swap authorized and saved. Money is set aside. Start it online or share its request.');
    }finally{savingSelf=false;$('#rhea-save-confirm').disabled=false;$('#rhea-save-back').disabled=false;}
  });};
  $('#rhea-form').onsubmit=event=>{event.preventDefault();if(intentSwap?.managed()){run(()=>intentSwap.submit(event));return;}run(async()=>{
    requirePublicSwap();
    const text=$('#rhea-amount').value, minimum=$('#rhea-minimum').value;
    if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,24})?$/.test(minimum))throw new Error('Use up to 24 decimal places for wrapped NEAR');
    const [whole,part='']=minimum.split('.'),minOutput=String(BigInt(whole)*10n**24n+BigInt(part.padEnd(24,'0')));
    const options={text,minOutput,receiver:$('#rhea-receiver').value.trim(),deadlineMs:Date.now()+Number($('#rhea-duration').value)};
    units(text);if(BigInt(minOutput)<=0n||BigInt(minOutput)>=(1n<<128n))throw Error('Choose a positive minimum to receive.');
    if(!/^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(options.receiver)||options.receiver.length>64||[config.adapter,config.reserve,config.exchange].includes(options.receiver))throw Error('Choose a separate named NEAR testnet account to receive this swap.');
    if(defi.review(options))return;
    const state=await readState();if(!state.identity||state.identity.profile.id!==currentIdentityId)throw Error('Open the original Lenz account.');
    selfDraft={identityId:state.identity.profile.id,selection:selfSelection(),config:structuredClone(config),options:structuredClone(options),startOnline:navigator.onLine};
    $('#rhea-save-review-title').textContent=selfDraft.startOnline?'Review swap via Rhea':'Review offline swap';
    $('#rhea-save-confirm').textContent=selfDraft.startOnline?'Confirm swap':'Authorize and save';
    executionNote.textContent=selfDraft.startOnline?'Confirming authorizes these exact terms and starts the swap via Rhea. The amount stays set aside until the swap or refund is resolved.':'Authorization sets this amount aside until the swap or refund is resolved. Saving does not execute the swap. An online participant must start it, and the minimum still applies.';
    const terms=$('#rhea-save-terms');terms.replaceChildren();for(const [label,value]of [['Pay',displayUnits(units(text))+' tUSD'],['Receive at least',wrapped(minOutput)+' wNEAR'],['Swap / refund account',options.receiver],['Swap service','Rhea · NEAR testnet'],['Start before',new Date(options.deadlineMs).toLocaleString()],['Fees','Pool fee included; no extra service fee authorized']])terms.append(el('dt',label),el('dd',value));
    selfReview.querySelector('.wallet-feedback').textContent='';panel.close();selfReview.showModal();
  });};
  needsConnection($('#rhea-quote'));addEventListener('online',refreshSwapConnection);addEventListener('offline',refreshSwapConnection);refreshSwapConnection();
  if(intentController){intentSwap=intentController.mountSwap(section,panel,dex);intentController.subscribe(state=>{$('#rhea-open').disabled=!config&&!state.balances.some(row=>BigInt(row.units??row.cachedUnits??'0')>0n)&&!state.holdings.some(row=>BigInt(row.units??row.cachedUnits??'0')>0n);});}
}
function checkExecutionOwner(state,packet,execution){
  if(execution.generation!==executionGeneration)throw Error('The swap account changed. Reopen the original account.');
  if(state.identity?.profile.id!==execution.owner||compressed(state.identity.profile.signingPublic)!==packet.instruction.owner)throw Error('The swap account changed. Reopen the original account.');
  requirePaymentAccess(state.identity);
  if(['network','adapter','reserve','exchange','poolId','tokenOut'].some(key=>execution.config[key]!==config?.[key]||packet.config[key]!==execution.config[key]))throw Error('The swap route changed. Check the original request.');
}
async function checkExecution(packet,execution){
  const state=await readState();checkExecutionOwner(state,packet,execution);
  const vault=await readNearVault(state,execution.config.reserve),saved=vault.rheaOrders.find(row=>row.packet.id===packet.id);
  if(!saved||JSON.stringify(saved.packet)!==JSON.stringify(packet))throw Error('The original saved swap changed.');
  checkExecutionOwner(await readState(),packet,execution);
  if(execution.fresh&&Date.now()>=Number(packet.instruction.deadline_ms))throw Error('The swap start deadline ended. Check the original request.');
}
async function saveStatus(packet,result,execution){
  if(result.finality!=='FINAL'||result.order?.id!==packet.id||Object.entries(packet.instruction).some(([k,v])=>result.order?.instruction?.[k]!==v))throw new Error('NEAR returned a different swap order');
  await updateState(async state=>{if(execution)checkExecutionOwner(state,packet,execution);const v=await readNearVault(state,execution?.config.reserve??config.reserve),o=v.rheaOrders.find(o=>o.packet.id===packet.id);if(!o||JSON.stringify(o.packet)!==JSON.stringify(packet))throw Error('The original saved swap changed.');o.status=result.order;if(result.txHash)o.txHash=result.txHash;if(result.reconciliation){o.reconciliation=result.reconciliation;if(result.reconciliation.finality==='FINAL')o.txHash=result.reconciliation.txHash;}await saveNearVault(state,v);});
  const recovery=result.reconciliation?.state;
  notice(recovery==='needs_review'?'This swap needs checking. Its money is still set aside.':recovery==='unavailable'||recovery==='unverified'?'The latest payment confirmation could not be verified. Your saved swap and reserved money are unchanged.':labels[result.order.stage]??'Swap updated');
}
async function execute(packet,execution={owner:currentIdentityId,config:structuredClone(config),fresh:false}){
  execution={...execution,generation:executionGeneration};
  await checkExecution(packet,execution);notice('Starting your swap via Rhea…');
  let result;
  try{result=await request('/api/rhea/signed-submit',{adapter:execution.config.adapter,packet});}
  catch{throw Error('Confirmation is uncertain. Your money stays set aside. Check the original swap before trying again.');}
  execution.fresh=false;
  try{await saveStatus(packet,result,execution);}
  catch{throw Error('Confirmation is uncertain. Your money stays set aside. Check the original swap before trying again.');}
  for(let n=0;n<9&&!terminal.has(result.order.stage);n++){
    await checkExecution(packet,execution);
    try{result=await request('/api/rhea/signed-advance',{adapter:execution.config.adapter,packet});}
    catch{throw Error('Confirmation is uncertain. Your money stays set aside. Check the original swap before trying again.');}
    try{await saveStatus(packet,result,execution);}
    catch{throw Error('Confirmation is uncertain. Your money stays set aside. Check the original swap before trying again.');}
    if(result.failedReceipts?.length && ['output_available','refund_available'].includes(result.order.stage)){notice('Your receiving wallet could not accept the token. Check its token support, then try again.');break;}
    if(['checking','redeeming','depositing','swapping','withdrawing_output','withdrawing_refund','paying_output','paying_refund'].includes(result.order.stage)){notice('Your swap is still processing. Check again shortly.');break;}
  }
}
async function refundRequest(id){
  return updateState(async state=>{const v=await readNearVault(state,config.reserve),o=v.rheaOrders.find(o=>o.packet.id===id);
    o.returnRequest??=await prepareRefundReturn(v,state.identity,o);await saveNearVault(state,v);return o.returnRequest;});
}
async function finishReturn(id,r,result){
  await updateState(async state=>{const v=await acceptDepositResult(await readNearVault(state,config.reserve),state.identity,r,result);
    v.rheaOrders.find(o=>o.packet.id===id).returnReceipt={rootId:r.id,txHash:result.txHash??null};await saveNearVault(state,v);});
  notice('Refund returned. Your Lenz balance is up to date.');
}
export async function renderRheaWallet(vault,identity){
  if(currentIdentityId!==identity?.profile.id){currentIdentityId=identity?.profile.id??null;invalidateQuote();}
  const enabled=!!config&&config.reserve===vault?.contract;if(!intentSwap)$('#rhea-open').disabled=!enabled;
  const selected=await connectedNearAccount();$('#near-signer-connect').disabled=!enabled;$('#near-signer-connect').hidden=!!selected;$('#near-signer-disconnect').hidden=!selected;
  $('#near-signer-account').textContent=selected?`Selected on testnet: ${selected}`:'Connect a test wallet to receive swaps and return refunds.';$('#rhea-use-account').disabled=!selected;
  const owner=compressed(identity.profile.signingPublic);
  dex.balance((await nearLedger(vault)).available.filter(note=>note.owner===owner).reduce((sum,n)=>sum+BigInt(n.amount),0n).toString(),{asset:'nep141:'+vault.contract,accountId:owner,routeAvailable:enabled});
  intentSwap?.paint();
  if(!enabled){notice('Swaps are not available right now.');return;}
  const deliveries=await defi.deliveries(),list=$('#rhea-orders');list.replaceChildren();
  savedCount=(vault.rheaOrders??[]).filter(o=>!['complete','refunded'].includes(o.status?.stage)).length;
  for(const o of [...(vault.rheaOrders??[])].reverse()){
    const row=el('article',undefined,'near-payment'),i=o.packet.instruction;
    const amount=el('strong'),minimum=el('small');
    amount.append(walletAmount(el('span'),displayUnits(i.amount)),document.createTextNode(' tUSD → wrapped NEAR · via Rhea'));
    minimum.append(document.createTextNode(`Receiving wallet: ${i.receiver_id}. Receive at least: `),walletAmount(el('span'),wrapped(i.min_output)),document.createTextNode(' wrapped test NEAR.'));
    row.append(amount,el('span',labels[o.status?.stage]??'Saved · money set aside','near-state'),minimum);
    if(o.defi){defi.render(row,o,deliveries);list.append(row);continue;}

    if(o.returnReceipt)row.append(el('small','Refund returned to Lenz.'));
    const save=el('button','Share swap request','secondary');save.onclick=()=>download(o.packet);row.append(save);
    const check=needsConnection(el('button','Check status','secondary'));check.onclick=()=>run(async()=>{const r=await request('/api/rhea/signed-order',{adapter:config.adapter,packet:o.packet});if(!r.order){notice('This swap has not started yet. Its money is still set aside.');return;}await saveStatus(o.packet,r);});row.append(check);
    if(o.status?.stage==='redeeming'&&config.recoverRedemption===true){
      row.append(el('small','Check the saved payment so this swap can continue. This does not send the payment again.'));
      const resume=needsConnection(el('button','Resume swap'));resume.onclick=()=>run(async()=>{
        resume.disabled=true;resume.dataset.rheaBusy='true';resume.textContent='Checking payment…';
        notice('Checking your saved payment…');
        try{const r=await request('/api/rhea/signed-recover',{adapter:config.adapter,packet:o.packet});await saveStatus(o.packet,r);
          notice(r.order.stage==='funded'?'Your payment is confirmed. Choose Continue swap when you are ready.':r.order.stage==='redeeming'?'Your payment is still being checked. Its money remains set aside.':labels[r.order.stage]??'Swap updated');
        }finally{delete resume.dataset.rheaBusy;resume.disabled=!navigator.onLine;resume.textContent='Resume swap';}
      });row.append(resume);
    }else if(!terminal.has(o.status?.stage)){const go=needsConnection(el('button',o.status?'Continue swap':'Start swap'));go.onclick=()=>run(()=>execute(o.packet));row.append(go);}
    if(o.status?.stage==='refunded'&&identity&&i.owner===compressed(identity.profile.signingPublic)){
      if(config.refundPayer===i.receiver_id&&!o.returnReceipt){
        const back=el('button','Return to Lenz');back.onclick=()=>run(async()=>{notice('Saving your refund request…');const r=await refundRequest(o.packet.id);notice('Returning your refund…');const result=await request('/api/rhea/return',{adapter:config.adapter,id:o.packet.id,request:r});await finishReturn(o.packet.id,r,result);});row.append(back);
      }else if(!o.returnReceipt){
        if(walletLab){
        row.append(el('small',`Return this refund with ${i.receiver_id} in Meteor. It needs 0.03 test NEAR for storage, plus the network fee.`));
        const back=el('button','Return to Lenz');back.onclick=()=>run(async()=>{
          const live=await request('/api/rhea/order',{adapter:config.adapter,id:o.packet.id});await saveStatus(o.packet,live);
          const r=await refundRequest(o.packet.id);returnId=o.packet.id;$('#near-return-summary').textContent=`Return ${displayUnits(r.amount)} tUSD from ${r.payer} to this Lenz profile.`;$('#near-return-dialog').showModal();
        });row.append(back);
        }else row.append(el('small','Your refund is in the receiving wallet. Returning it to Lenz is not available here yet.'));
      }
      if(o.returnRequest){const checkReturn=el('button','Check refund','secondary');checkReturn.onclick=()=>run(async()=>{const r=o.returnRequest,result=await request('/api/rhea/deposit-check',{adapter:config.adapter,id:o.packet.id,request:r});await finishReturn(o.packet.id,r,result);});row.append(checkReturn);}
    }
    if(o.txHash)row.append(el('small','Confirmation: '+o.txHash,'transaction-reference'));
    list.append(row);
  }
  refreshSwapConnection();
}
