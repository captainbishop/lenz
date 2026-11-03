import {prepareTransfer,amount,transferAssets,check} from './evm-transfer.js';
import {createTransferService} from './evm-transfer-service.js';
import {readTransfers,transferOpen} from './evm-transfer-store.js';
import {iconButton} from './wallet-actions.js';
import {walletAmount} from './wallet-visibility.js';
import {WALLET_NETWORKS} from './evm-networks.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const labels={awaiting_wallet:'Check wallet',unknown:'Check wallet activity',submitted:'Submitted',pending:'Pending',included:'Included · awaiting finality',confirmed:'Confirmed',failed:'Failed on chain',declined:'Declined',not_sent:'Not sent'};
export function mountEvmTransfers(session){
 const $=id=>document.getElementById(id),service=createTransferService(),button=el('button','Send');button.id='evm-send';button.type='button';$('evm-receive').before(button);
 const history=el('section');history.id='evm-transfers';history.hidden=true;history.innerHTML='<h3>Transfers</h3><div id="evm-transfer-list"></div><p id="evm-history-status" class="quiet" role="status"></p>';$('connected-wallet').append(history);
 const dialog=el('dialog');dialog.id='evm-send-dialog';dialog.setAttribute('aria-labelledby','evm-send-title');
 dialog.innerHTML='<div class="dialog-top"><h2 id="evm-send-title">Send</h2><button id="evm-send-close" type="button" class="secondary wallet-close"></button></div><p id="evm-send-network" class="quiet"></p><div id="evm-send-assets" class="evm-asset-choices" aria-label="Asset"></div><form id="evm-send-form"><label for="evm-send-recipient">To</label><input id="evm-send-recipient" required spellcheck="false" autocomplete="off" placeholder="0x…"><label for="evm-send-amount">Amount</label><div class="evm-transfer-amount"><input id="evm-send-amount" required inputmode="decimal" autocomplete="off" placeholder="0"><span id="evm-send-symbol">ETH</span></div><label class="check"><input id="evm-send-consent" type="checkbox">Public transfer. Share these terms with my wallet and its network provider.</label><button id="evm-send-review" type="submit" disabled>Review transfer</button></form><dl id="evm-send-summary" hidden></dl><p id="evm-send-fee-note" class="quiet" hidden></p><button id="evm-send-approve" type="button" hidden>Approve in wallet</button><p id="evm-send-status" class="wallet-feedback" role="status"></p>';
 document.body.append(dialog);iconButton($('evm-send-close'),'Close','m6 6 12 12M18 6 6 18');
 const edit=el('button');edit.id='evm-send-edit';edit.type='button';edit.className='secondary wallet-close';edit.hidden=true;iconButton(edit,'Edit transfer','m4 16 12-12 4 4-12 12H4zM13 7l4 4');$('evm-send-close').before(edit);
 let identity=null,asset='native',review=null,lease=null,version=0,busy=false,renderVersion=0;
 function invalidate(){version++;review=null;lease=null;$('evm-send-summary').hidden=true;$('evm-send-fee-note').hidden=true;$('evm-send-approve').hidden=true;edit.hidden=true;$('evm-send-form').hidden=false;$('evm-send-assets').hidden=false;$('evm-send-review').disabled=busy||!$('evm-send-consent').checked||!navigator.onLine;}
 edit.onclick=()=>{invalidate();$('evm-send-status').textContent='';$('evm-send-amount').focus();};
 const close=()=>{invalidate();dialog.close();};$('evm-send-close').onclick=close;dialog.addEventListener('cancel',invalidate);dialog.addEventListener('close',()=>{if(!dialog.open)invalidate();});
 for(const id of ['evm-send-recipient','evm-send-amount','evm-send-consent'])$(id).addEventListener('input',()=>{invalidate();$('evm-send-status').textContent='';});
 button.onclick=()=>{
  if(!session.snapshot || !Object.hasOwn(WALLET_NETWORKS,session.snapshot.chainId))return;
  check(session.snapshot,'Connect your wallet first.');identity=session.snapshot;asset='native';$('evm-send-form').reset();invalidate();$('evm-send-status').textContent='';$('evm-send-assets').replaceChildren();$('evm-send-symbol').textContent='ETH';$('evm-send-network').textContent=identity.network.name;
  for(const token of transferAssets(identity.chainId)){const choice=el('button',token.symbol);choice.type='button';choice.className='secondary';choice.setAttribute('aria-pressed',String(token.id===asset));choice.dataset.asset=token.id;choice.onclick=()=>{asset=token.id;invalidate();$('evm-send-symbol').textContent=token.symbol;$('evm-send-assets').querySelectorAll('button').forEach(b=>b.setAttribute('aria-pressed',String(b===choice)));};$('evm-send-assets').append(choice);}
  dialog.showModal();
 };
 $('evm-send-form').onsubmit=async event=>{
  event.preventDefault();if(busy)return;invalidate();const ticket=version;busy=true;$('evm-send-review').disabled=true;$('evm-send-status').textContent='Checking balance and fees…';
  try{
   const current=session.capture();check(current.identity===identity,'Wallet changed. Open Send again.');
   const terms=await prepareTransfer(current,{asset,recipient:$('evm-send-recipient').value.trim(),amount:$('evm-send-amount').value.trim(),publicConsent:$('evm-send-consent').checked});
   if(ticket!==version||!dialog.open)return;current.assertCurrent();review=terms;lease=current;
   const token=transferAssets(identity.chainId).find(t=>t.id===asset),summary=$('evm-send-summary');summary.replaceChildren();
   for(const [label,value]of [['Send',amount(terms.terms.units,token.decimals)+' '+token.symbol],['To',terms.terms.recipient],['Gas budget',amount('0x'+(BigInt(terms.transaction.gas)*BigInt(terms.transaction.gasPrice)).toString(16))+' ETH']]){const row=el('div');if(label==='Send')row.className='evm-review-amount';row.append(el('dt',label),el('dd',value));summary.append(row);}
   summary.hidden=false;$('evm-send-form').hidden=true;$('evm-send-assets').hidden=true;edit.hidden=false;$('evm-send-fee-note').textContent=identity.chainId==='0x1'?'Unused gas is not charged. Check the final terms in your wallet.':'Additional rollup fees may apply. Check the total in your wallet.';$('evm-send-fee-note').hidden=false;$('evm-send-approve').hidden=false;$('evm-send-approve').disabled=false;$('evm-send-status').textContent='';
  }catch(error){if(ticket===version)$('evm-send-status').textContent=error.message;}
  finally{busy=false;$('evm-send-review').disabled=!$('evm-send-consent').checked||!navigator.onLine;}
 };
 $('evm-send-approve').onclick=async()=>{
  if(busy||!review||!lease)return;const ticket=version,current=lease,terms=review;
  const guard=()=>{current.assertCurrent();check(dialog.open&&ticket===version,'Transfer review closed or changed.');};
  const guarded={...current,assertCurrent:guard,sendTransaction:tx=>{guard();return current.sendTransaction(tx);}};
  busy=true;$('evm-send-approve').disabled=true;$('evm-send-review').disabled=true;$('evm-send-status').textContent='Checking terms before opening your wallet…';
  try{const result=await service.send(guarded,terms);if(ticket===version&&dialog.open)$('evm-send-status').textContent=labels[result.state]+(result.error?'. '+result.error:'');}
  catch(error){if(ticket===version&&dialog.open)$('evm-send-status').textContent=error.message;}
  finally{busy=false;invalidate();if(dialog.open){$('evm-send-form').hidden=true;$('evm-send-assets').hidden=true;edit.hidden=false;}await render();}
 };
 async function render(){
  const ticket=++renderVersion,snapshot=session.snapshot;history.hidden=!snapshot;$('evm-transfer-list').replaceChildren();button.disabled=true;
  const supported=!!snapshot&&Object.hasOwn(WALLET_NETWORKS,snapshot.chainId);button.hidden=!!snapshot&&!supported;
  if(!snapshot)return;
  if(!supported){$('evm-history-status').textContent='Send and DeFi are unavailable on custom networks.';return;}
  try{
   const rows=(await readTransfers()).filter(r=>r.review.terms.from===snapshot.address&&r.review.terms.chainId===snapshot.chainId).reverse();
   if(ticket!==renderVersion||session.snapshot!==snapshot)return;
   button.disabled=rows.some(transferOpen);$('evm-history-status').textContent=button.disabled?'Check the pending transfer before sending another.':rows.length?'':'No transfers from Lenz yet.';
   for(const row of rows){
    const item=el('article');item.className='evm-transfer-row';const details=el('div'),tools=el('div'),token=transferAssets(snapshot.chainId).find(a=>a.id===row.review.terms.asset);
    details.append(walletAmount(el('strong'),amount(row.review.terms.units,token.decimals)+' '+token.symbol),el('span',labels[row.state]),el('small','To '+row.review.terms.recipient),el('small',new Date(row.createdAt).toLocaleString()));
    if(row.hash){const explorer={ethereum:'https://etherscan.io/tx/',arbitrum:'https://arbiscan.io/tx/',base:'https://basescan.org/tx/'}[snapshot.network.key],link=el('a','View transaction');link.href=explorer+row.hash;link.target='_blank';link.rel='noopener noreferrer';details.append(link);}
    if(row.observation?.executionFee)details.append(el('small','Execution fee '+amount(row.observation.executionFee)+' ETH'));
    if(row.error)details.append(el('small',row.error));
    if(transferOpen(row)){
     let input=null;if(!row.hash){const label=el('label','Transaction hash from your wallet');input=el('input');input.id='evm-recover-'+row.id;label.htmlFor=input.id;input.placeholder='0x…';input.autocomplete='off';input.spellcheck=false;tools.append(label,input);}
     const checkButton=el('button','Check status'),feedback=el('p');feedback.className='quiet';feedback.setAttribute('role','status');checkButton.type='button';checkButton.className='secondary';
     checkButton.onclick=async()=>{checkButton.disabled=true;feedback.textContent='Checking…';try{await service.reconcile(session.capture(),row.id,input?.value.trim());await render();}catch(error){feedback.textContent=error.message;}finally{checkButton.disabled=false;}};tools.append(checkButton,feedback);
    }
    item.append(details,tools);$('evm-transfer-list').append(item);
   }
  }catch(error){if(ticket===renderVersion){button.disabled=true;$('evm-history-status').textContent='Transfer history unavailable. '+error.message;}}
 }
 addEventListener('lenz-evm-session',()=>{if(identity!==session.snapshot&&dialog.open)close();render();});addEventListener('lenz-transfers-changed',render);
 render();
}
