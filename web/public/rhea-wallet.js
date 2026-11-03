import { readState, updateState } from './chat-store.js';
import { walletAmount } from './wallet-visibility.js';
import { readNearVault, saveNearVault, displayUnits, units, compressed, nearLedger } from './near-protocol.js';
import { prepareRefundReturn, acceptDepositResult } from './near-deposit.js';
import { prepareRheaSwap, checkRheaConfig } from './rhea-protocol.js';
import { connectedNearAccount, connectNearWallet, disconnectNearWallet, signRefundDeposit } from './near-signer.js';
import { walletError } from './wallet-feedback.js';
import { mountDefiApproval } from './defi-wallet-ui.js';
import { mountDefiWorkspace, requirePublicSwap } from './defi-workspace.js';
const $=s=>document.querySelector(s), el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const walletLab=document.body.dataset.walletTools==='true';
let config=null, run, returnId=null, savedCount=0, defi, dex;
const terminal=new Set(['complete','refunded','rejected','attention']);
const labels={checking:'Checking your swap',ready:'Ready',redeeming:'Starting swap',funded:'Swap in progress',depositing:'Swap in progress',deposited:'Ready to swap',swapping:'Swapping',output_on_dex:'Getting your funds ready',refund_on_dex:'Getting your refund ready',withdrawing_output:'Getting your funds ready',withdrawing_refund:'Getting your refund ready',output_available:'Ready to send',refund_available:'Refund ready to send',paying_output:'Sending to your wallet',paying_refund:'Sending your refund',complete:'Swap complete',refunded:'Refund available',rejected:'Swap could not start',attention:'Swap needs checking'};
const notice=text=>{$('#rhea-feedback').textContent=text;};
function refreshSwapConnection(){
  const online=navigator.onLine, summary=$('#rhea-queue');if(!summary)return;
  summary.textContent=savedCount?`${savedCount} saved swap${savedCount===1?'':'s'} · awaiting review.`:'No saved swaps.';
  document.querySelectorAll('[data-rhea-online]').forEach(button=>{button.disabled=!online||button.dataset.rheaBusy==='true';});
  document.querySelectorAll('[data-defi-send]').forEach(button=>{button.disabled=!online||Date.now()>=Number(button.dataset.defiExpiry);});
  if($('#rhea-privacy')?.value!=='public-testnet')$('#rhea-quote').disabled=true;
}
function needsConnection(button){button.dataset.rheaOnline='';button.disabled=!navigator.onLine;return button;}
function wrapped(n){const v=BigInt(n),part=(v%10n**24n).toString().padStart(24,'0').replace(/0+$/,'');return `${v/10n**24n}${part?'.'+part:''}`;}
async function request(route,data){if(!navigator.onLine)throw new Error('You are offline. Your saved swap and reserved money are unchanged.');const r=await fetch(route,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(150000)});const reply=await r.json();if(!r.ok)throw new Error(reply.error??'Connection interrupted. The saved order can be retried.');return reply;}
function download(packet){const url=URL.createObjectURL(new Blob([JSON.stringify(packet)],{type:'application/json'}));const a=el('a');a.href=url;a.download=`lenz-swap-${packet.id}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
export async function loadRheaConfig(){const r=await fetch('/rhea-config.json');if(!r.ok)return;const c=await r.json();if(c.ready){checkRheaConfig(c);config=c;}}
export function mountRheaWallet({action}){
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
  defi=mountDefiApproval({config:()=>config,run,notice,wrapped});
  $('#rhea-close').onclick=()=>panel.close();$('#rhea-open').onclick=()=>run(async()=>{await defi.open();dex.reset();panel.showModal();});
  const useAccount=el('button','Use my connected wallet','secondary');useAccount.type='button';useAccount.id='rhea-use-account';useAccount.hidden=!walletLab;$('#rhea-receiver').after(useAccount);
  useAccount.onclick=()=>run(async()=>{const id=await connectedNearAccount();if(!id)throw new Error('Connect Meteor first.');$('#rhea-receiver').value=id;});
  $('#rhea-amount').oninput=()=>{$('#rhea-estimate').textContent='Amount changed. Get a new estimate or choose your own minimum.';};
  $('#rhea-quote').onclick=()=>run(async()=>{
    requirePublicSwap();
    $('#rhea-estimate').textContent='Getting a Rhea estimate…';
    const amountIn=units($('#rhea-amount').value),slippageBps=Number($('#rhea-slippage').value);
    if(![50,100,200].includes(slippageBps))throw Error('Invalid slippage tolerance');
    const q=await request('/api/defi/rhea/quote',{network:'testnet',contract:config.exchange,poolId:config.poolId,tokenIn:config.reserve,tokenOut:config.tokenOut,amountIn,slippageBps});
    requirePublicSwap();
    if(q.request?.amountIn!==amountIn||q.request?.poolId!==config.poolId||q.request?.tokenIn!==config.reserve||q.request?.tokenOut!==config.tokenOut)throw new Error('The quote does not match this swap');
    if(units($('#rhea-amount').value)!==amountIn||Number($('#rhea-slippage').value)!==slippageBps)throw new Error('Amount or slippage changed while getting the estimate');
    if(q.request.slippageBps!==slippageBps||!/^[1-9][0-9]{0,38}$/.test(q.amountOut)||BigInt(q.minAmountOut)!==BigInt(q.amountOut)*BigInt(10000-slippageBps)/10000n)throw Error('Invalid quote minimum');
    $('#rhea-output').textContent=wrapped(q.amountOut);$('#rhea-rate').textContent=`1 tUSD ≈ ${wrapped(BigInt(q.amountOut)*1000000n/BigInt(amountIn))} wNEAR`;
    $('#rhea-minimum').value=wrapped(q.minAmountOut);$('#rhea-estimate').textContent=`Rate checked now. Minimum allows ${slippageBps/100}% price movement. Execution checks the rate again.`;
  });
  $('#rhea-form').onsubmit=event=>{event.preventDefault();run(async()=>{
    requirePublicSwap();
    const text=$('#rhea-amount').value, minimum=$('#rhea-minimum').value;
    if(!/^(0|[1-9][0-9]*)(\.[0-9]{1,24})?$/.test(minimum))throw new Error('Use up to 24 decimal places for wrapped NEAR');
    const [whole,part='']=minimum.split('.'),minOutput=String(BigInt(whole)*10n**24n+BigInt(part.padEnd(24,'0')));
    const options={text,minOutput,receiver:$('#rhea-receiver').value.trim(),deadlineMs:Date.now()+Number($('#rhea-duration').value)};
    if(defi.review(options))return;
    await updateState(async state=>{const result=await prepareRheaSwap(await readNearVault(state,config.reserve),state.identity,config,options);await saveNearVault(state,result.vault);});
    panel.close();notice('Swap saved. This money is set aside. Start the swap when you are online.');
  });};
  needsConnection($('#rhea-quote'));addEventListener('online',refreshSwapConnection);addEventListener('offline',refreshSwapConnection);refreshSwapConnection();
}
async function saveStatus(packet,result){
  if(result.finality!=='FINAL'||result.order?.id!==packet.id||Object.entries(packet.instruction).some(([k,v])=>result.order?.instruction?.[k]!==v))throw new Error('NEAR returned a different swap order');
  await updateState(async state=>{const v=await readNearVault(state,config.reserve),o=v.rheaOrders.find(o=>o.packet.id===packet.id);o.status=result.order;if(result.txHash)o.txHash=result.txHash;if(result.reconciliation){o.reconciliation=result.reconciliation;if(result.reconciliation.finality==='FINAL')o.txHash=result.reconciliation.txHash;}await saveNearVault(state,v);});
  const recovery=result.reconciliation?.state;
  notice(recovery==='needs_review'?'This swap needs checking. Its money is still set aside.':recovery==='unavailable'||recovery==='unverified'?'The latest payment confirmation could not be verified. Your saved swap and reserved money are unchanged.':labels[result.order.stage]??'Swap updated');
}
async function execute(packet){
  notice('Starting your swap…');
  let result=await request('/api/rhea/submit',{adapter:config.adapter,packet});await saveStatus(packet,result);
  for(let n=0;n<9&&!terminal.has(result.order.stage);n++){
    result=await request('/api/rhea/advance',{adapter:config.adapter,id:packet.id});await saveStatus(packet,result);
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
  const enabled=!!config&&config.reserve===vault?.contract;$('#rhea-open').disabled=!enabled;
  const selected=await connectedNearAccount();$('#near-signer-connect').disabled=!enabled;$('#near-signer-connect').hidden=!!selected;$('#near-signer-disconnect').hidden=!selected;
  $('#near-signer-account').textContent=selected?`Selected on testnet: ${selected}`:'Connect a test wallet to receive swaps and return refunds.';$('#rhea-use-account').disabled=!selected;
  if(!enabled){notice('Swaps are not available right now.');return;}
  dex.balance((await nearLedger(vault)).available.reduce((sum,n)=>sum+BigInt(n.amount),0n).toString());
  const list=$('#rhea-orders');list.replaceChildren();
  savedCount=(vault.rheaOrders??[]).filter(o=>!['complete','refunded'].includes(o.status?.stage)).length;
  for(const o of [...(vault.rheaOrders??[])].reverse()){
    const row=el('article',undefined,'near-payment'),i=o.packet.instruction;
    const amount=el('strong'),minimum=el('small');
    amount.append(walletAmount(el('span'),displayUnits(i.amount)),document.createTextNode(' tUSD → wrapped NEAR'));
    minimum.append(document.createTextNode(`Receiving wallet: ${i.receiver_id}. Receive at least: `),walletAmount(el('span'),wrapped(i.min_output)),document.createTextNode(' wrapped test NEAR.'));
    row.append(amount,el('span',labels[o.status?.stage]??'Saved · money set aside','near-state'),minimum);
    if(o.defi){defi.render(row,o);list.append(row);continue;}

    if(o.returnReceipt)row.append(el('small','Refund returned to Lenz.'));
    const save=el('button','Share swap request','secondary');save.onclick=()=>download(o.packet);row.append(save);
    const check=needsConnection(el('button','Check status','secondary'));check.onclick=()=>run(async()=>{const r=await request('/api/rhea/order',{adapter:config.adapter,id:o.packet.id});if(!r.order){notice('This swap has not started yet. Its money is still set aside.');return;}await saveStatus(o.packet,r);});row.append(check);
    if(o.status?.stage==='redeeming'&&config.recoverRedemption===true){
      row.append(el('small','Check the saved payment so this swap can continue. This does not send the payment again.'));
      const resume=needsConnection(el('button','Resume swap'));resume.onclick=()=>run(async()=>{
        resume.disabled=true;resume.dataset.rheaBusy='true';resume.textContent='Checking payment…';
        notice('Checking your saved payment…');
        try{const r=await request('/api/rhea/recover',{adapter:config.adapter,id:o.packet.id});await saveStatus(o.packet,r);
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
    if(o.txHash){const a=el('a','View confirmation');a.href='https://testnet.nearblocks.io/txns/'+encodeURIComponent(o.txHash);a.target='_blank';a.rel='noopener noreferrer';row.append(a);}
    list.append(row);
  }
  refreshSwapConnection();
}
