import {prepareReserveFunding,fundReserveFunding,openNearSend} from './near-wallet.js';
import {displayUnits} from './near-protocol.js';
import {iconButton} from './wallet-actions.js';
import {readState} from './chat-store.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};

export function createWalletFundingController({openPrivateFunding,openSwapFunding,openLendingFunding,refreshWallet}={}){
 const style=el('link');style.rel='stylesheet';style.href='/intent-near-ui.css';document.head.append(style);
 const dialog=el('dialog');dialog.id='wallet-funding-dialog';dialog.className='near-intent-dialog';dialog.setAttribute('aria-labelledby','wallet-funding-title');
 dialog.innerHTML='<div class="dialog-top"><h2 id="wallet-funding-title">Test funds</h2><button id="wallet-funding-close" type="button" class="secondary wallet-close"></button></div><p>tUSD · Offline payments · No cash value</p><dl id="wallet-funding-terms"></dl><p class="quiet">One grant per spending key. Funding and confirmed payment amounts are public on NEAR testnet. Messages and shared payment files are encrypted.</p><button id="wallet-funding-confirm" type="button" hidden>Add 100 tUSD</button><button id="wallet-funding-review" type="button" class="secondary" hidden>Review test funds again</button><p id="wallet-funding-feedback" class="wallet-feedback" role="status" aria-live="polite"></p><button id="wallet-funding-send" type="button" hidden>Send tUSD</button><p id="wallet-funding-next" class="quiet" hidden>Choose a recipient, then share the encrypted payment file. The recipient can pass it onward offline; confirmation needs an online participant.</p><section class="wallet-funding-assets" aria-labelledby="wallet-funding-other-title"><h3 id="wallet-funding-other-title">Other test actions</h3><button id="wallet-funding-link" type="button" class="secondary"><strong>Private LINK</strong><small>1 LINK · Sepolia · Supply lending collateral</small><small>Recoverable lending account required</small></button><button id="wallet-funding-usdc" type="button" class="secondary"><strong>Repay USDC</strong><small>1 USDC · Sepolia · Cover loan interest</small><small>Outstanding loan required</small></button><button id="wallet-funding-private" type="button" class="secondary"><strong>Private Swap · LTS</strong><small>1 LTS · Aurora testnet · Private pool swap</small></button><button id="wallet-funding-swap" type="button" class="secondary"><strong>NEAR Swap · LTS</strong><small>NEAR testnet · Check availability</small></button><details class="near-intent-details"><summary>Funding availability</summary><p>Private swap funds: one 1 LTS grant per original source, while test funding is available. NEAR swap grants remain limited to supported test accounts.</p></details></section>';
 document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);iconButton($('wallet-funding-close'),'Close','m6 6 12 12M18 6 6 18');
 let identity=null,busy=false,generation=0,review=null,opener=null,disposed=false;const listeners=new Set();
 const snapshot=()=>({identity,busy});
 const routes={private:openPrivateFunding,swap:openSwapFunding,link:()=>openLendingFunding?.('LINK'),usdc:()=>openLendingFunding?.('USDC')};
 function emit(){dialog.setAttribute('aria-busy',String(busy));for(const id of ['confirm','review'])$('wallet-funding-'+id).disabled=busy||!navigator.onLine;for(const id of Object.keys(routes))$('wallet-funding-'+id).disabled=typeof (['link','usdc'].includes(id)?openLendingFunding:routes[id])!=='function';for(const listener of listeners)listener(snapshot());}
 function reset(){review=null;for(const id of ['confirm','review','send','next'])$('wallet-funding-'+id).hidden=true;dialog.querySelectorAll('details[data-funding-details]').forEach(node=>node.remove());}
 function current(ticket){check(!disposed&&ticket===generation&&dialog.open,'Review test funds again.');}
 async function operation(task){if(busy||disposed)return;busy=true;const ticket=generation;emit();try{await task(ticket);}catch(error){if(ticket===generation&&!disposed){$('wallet-funding-feedback').textContent=error.message;$('wallet-funding-review').hidden=false;}}finally{busy=false;if(!disposed)emit();}}
 async function prepare(ticket){
  reset();$('wallet-funding-terms').replaceChildren();$('wallet-funding-feedback').textContent='Checking test funding…';
  check(identity,'Create a profile before requesting test funds.');check(navigator.onLine,'Reconnect to get test funds. Your saved payments remain available offline.');
  const response=await fetch('/api/testnet/status',{cache:'no-store',signal:AbortSignal.timeout(15000)}),config=await response.json();current(ticket);check(response.ok&&config.ready&&config.network==='testnet',config.error||'Test funding is unavailable. Try again later.');
  const terms=await prepareReserveFunding();current(ticket);check(terms.identityId===identity&&terms.contract===config.contract,'The funding account or contract changed. Review again.');
  const state=await readState();current(ticket);check(state.identity?.profile.id===terms.identityId,'The receiving account changed. Review again.');
  for(const [name,value]of [['Funds',displayUnits(terms.amount)+' tUSD'],['To',state.identity.profile.name],['Network','NEAR testnet'],['Fees','Paid by the testnet relay']])$('wallet-funding-terms').append(el('dt',name),el('dd',value));
  const details=el('details');details.className='near-intent-details';details.append(el('summary','Funding details'));for(const [name,value]of [['Spending key',terms.owner],['Contract',terms.contract]]){const row=el('p');row.append(el('strong',name),el('br'),document.createTextNode(value));details.append(row);}$('wallet-funding-terms').after(details);dialog.querySelectorAll('details[data-funding-details]').forEach(node=>node.remove());details.dataset.fundingDetails='';
  if(terms.status==='funded'){$('wallet-funding-feedback').textContent='Your test grant is already confirmed.';$('wallet-funding-send').hidden=false;$('wallet-funding-next').hidden=false;return;}
  review={terms,deadline:Date.now()+300000};$('wallet-funding-confirm').textContent=terms.status==='original'?'Check original funding':'Add '+displayUnits(terms.amount)+' tUSD';$('wallet-funding-confirm').hidden=false;$('wallet-funding-feedback').textContent=terms.status==='original'?'Uses your saved request. It will not sign a new grant.':'Review the grant, then confirm to sign this funding request.';
 }
 function close(){generation++;reset();if(dialog.open)dialog.close();emit();opener?.focus();}
 function openFunding(){opener=document.activeElement;reset();if(!dialog.open)dialog.showModal();return operation(prepare);}
 $('wallet-funding-confirm').onclick=()=>operation(async ticket=>{
  const exact=review;check(exact&&exact.deadline>Date.now(),'Review test funds again.');check(navigator.onLine,'Reconnect to confirm test funding.');review=null;$('wallet-funding-confirm').hidden=true;$('wallet-funding-feedback').textContent='Checking the signed funding request…';
  const result=await fundReserveFunding(exact.terms);await refreshWallet?.();current(ticket);$('wallet-funding-feedback').textContent=result.description;$('wallet-funding-send').hidden=false;$('wallet-funding-next').hidden=false;
 });
 $('wallet-funding-review').onclick=()=>operation(prepare);$('wallet-funding-close').onclick=close;dialog.addEventListener('cancel',event=>{event.preventDefault();close();});
 $('wallet-funding-send').onclick=()=>{close();openNearSend();};
 for(const [id,open]of Object.entries(routes))$('wallet-funding-'+id).onclick=()=>{close();void Promise.resolve().then(open).catch(()=>{});};
 const changed=()=>{identity=null;close();},connection=()=>{if(!dialog.open){emit();return;}generation++;reset();$('wallet-funding-feedback').textContent=navigator.onLine?'Review test funds again.':'Reconnect to get test funds. Your saved payments remain available offline.';$('wallet-funding-review').hidden=false;emit();};
 addEventListener('lenz-account-identity',changed);addEventListener('pagehide',changed);addEventListener('online',connection);addEventListener('offline',connection);
 return Object.freeze({openFunding,snapshot,subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener);},render(next){if(next===identity)return;close();identity=next;emit();},dispose(){disposed=true;close();dialog.remove();style.remove();listeners.clear();removeEventListener('lenz-account-identity',changed);removeEventListener('pagehide',changed);removeEventListener('online',connection);removeEventListener('offline',connection);}});
}
