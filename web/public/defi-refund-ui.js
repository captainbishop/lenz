import {prepareDefiRefund,checkDefiRefund,reviewDefiRefund,submitDefiRefund} from './defi-wallet.js';
import {displayUnits} from './near-protocol.js';

const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
export function mountDefiRefund({config,run,notice}) {
  const lab=document.body.dataset.walletTools==='true';let draft=null,busy=false;
  const dialog=el('dialog');dialog.id='defi-refund-review';dialog.setAttribute('aria-labelledby','defi-refund-title');
  dialog.innerHTML='<div class="dialog-top"><h2 id="defi-refund-title">Return refund to Lenz</h2><button type="button" class="secondary" data-refund-close>Close</button></div><p data-refund-terms></p><p>The return is public on NEAR testnet. It needs 0.03 test NEAR for storage, plus a network fee. Your Lenz balance changes only after the returned funds are confirmed.</p><p data-refund-help></p><button type="button" data-refund-sign>Review in Meteor</button><p class="wallet-feedback error" role="status"></p>';
  document.body.append(dialog);
  const sign=dialog.querySelector('[data-refund-sign]'),close=dialog.querySelector('[data-refund-close]');sign.hidden=!lab;
  const dismiss=()=>{if(busy)return;draft=null;dialog.close();};close.onclick=dismiss;dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});
  sign.onclick=()=>{
    if(busy||!draft)return;
    const chosen=draft;draft=null;
    run(async()=>{
      busy=true;sign.disabled=true;close.disabled=true;
      try {
        await submitDefiRefund(chosen.config,chosen.requestId,chosen.review);
        notice('Return submitted but not confirmed. Check the saved return before reviewing another submission.');dialog.close();
      } catch(error) {
        dialog.querySelector('.wallet-feedback').textContent=error.message+' Your request stays saved. Close this review and check the return before trying again.';
      } finally {busy=false;close.disabled=false;}
    });
  };
  return {render(row,order){
    const a=order.defi,returned=!!order.returnReceipt;
    const button=(text,action)=>{const b=el('button',text);b.type='button';b.className='secondary';b.onclick=()=>run(action);row.append(b);return b;};
    if(returned)row.append(el('small','Returned funds are confirmed. Your available balance also accounts for saved payments and known spending.'));
    else {
      button(order.returnRequest?'Review return':'Prepare return',async()=>{
        const c=structuredClone(config()),requestId=a.request.id;
        const prepared=lab?await reviewDefiRefund(c,requestId):{deposit:await prepareDefiRefund(c,requestId)};
        draft={...prepared,config:c,requestId};
        dialog.querySelector('[data-refund-terms]').textContent=`Return ${displayUnits(prepared.deposit.amount)} tUSD from ${prepared.deposit.payer} to this Lenz profile.`;
        dialog.querySelector('[data-refund-help]').textContent=lab?'Check the payer and amount in Meteor before approving. A closed window or lost reply may still leave a submitted return.': 'Wallet approval for this test route is not available here yet. Your request remains saved and can be checked after a return.';
        dialog.querySelector('.wallet-feedback').textContent='';sign.disabled=!navigator.onLine;dialog.showModal();
      });
      if(a.refundAttempt)row.append(el('small','A return was opened for approval. Its outcome is unconfirmed. Check it before reviewing another submission.'));
    }
    if(order.returnRequest){
      const check=button('Check return',async()=>{
        check.disabled=true;check.dataset.rheaBusy='true';
        try {const result=await checkDefiRefund(config(),a.request.id);notice(result.state==='observed'?'Refund return confirmed. Your available balance includes saved payments and known spending.':'Return is not confirmed. The request stays saved.');}
        finally{delete check.dataset.rheaBusy;check.disabled=!navigator.onLine;}
      });check.dataset.rheaOnline='';check.disabled=!navigator.onLine;
    }
  }};
}
