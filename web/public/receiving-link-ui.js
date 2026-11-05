import {readState} from './chat-store.js';
import {isRecoveredChat} from './chat-access.js';
import {receivingTerms,signReceivingInstruction,receivingLink} from './receiving-instructions.js';
import {transferAssets} from './evm-transfer.js';
import {WALLET_NETWORKS} from './evm-networks.js';

export function mountReceivingLinks(session){
 const $=id=>document.getElementById(id),dialog=$('evm-receive-dialog');
 const panel=document.createElement('details');panel.id='evm-receiving-link';
 panel.innerHTML='<p id="evm-link-disclosure" class="quiet">Anyone with this link can see your Lenz identity and wallet address. Only the link expires, after 15 minutes.</p><button id="evm-create-link" type="button" class="secondary">Create wallet payment link</button><div id="evm-link-result" hidden><button id="evm-copy-link" type="button">Copy receiving link</button><p id="evm-link-expiry" class="quiet"></p><details><summary>Link details</summary><label for="evm-receiving-link-text">Receiving link</label><textarea id="evm-receiving-link-text" rows="3" readonly spellcheck="false"></textarea></details></div><p id="evm-link-status" class="wallet-feedback" role="status"></p>';
 const summary=document.createElement('summary');summary.textContent='Wallet payment link';panel.prepend(summary);
 const choice=document.createElement('div');choice.id='evm-receiving-asset-field';choice.innerHTML='<label for="evm-receiving-asset">Asset</label><select id="evm-receiving-asset"></select>';$('evm-receive-network').after(choice);
 dialog.append(panel);let generation=0,busy=false,timer=null;
 function clear(){generation++;clearTimeout(timer);$('evm-link-result').hidden=true;$('evm-create-link').hidden=false;$('evm-receiving-link-text').value='';$('evm-link-status').textContent='';}
 async function refresh(){
  clear();panel.open=false;const ticket=generation,snapshot=session.snapshot;panel.hidden=choice.hidden=true;
  if(!dialog.open||!snapshot||!Object.hasOwn(WALLET_NETWORKS,snapshot.chainId))return;
  choice.hidden=false;$('evm-receiving-asset').replaceChildren();
  for(const asset of transferAssets(snapshot.chainId)){const option=document.createElement('option');option.value=asset.id;option.textContent=asset.symbol;$('evm-receiving-asset').append(option);}
  const state=await readState();if(ticket!==generation||session.snapshot!==snapshot||!dialog.open)return;
  panel.hidden=!state.identity||isRecoveredChat(state.identity);
  $('evm-create-link').disabled=busy;
 }
 const refreshSafely=()=>refresh().catch(()=>{panel.hidden=true;});
 new MutationObserver(refreshSafely).observe(dialog,{attributes:true,attributeFilter:['open']});
 $('evm-receiving-asset').onchange=()=>{clear();dispatchEvent(new CustomEvent('lenz-receiving-asset',{detail:$('evm-receiving-asset').value}));};
 addEventListener('lenz-evm-session',refreshSafely);
 $('evm-create-link').onclick=async()=>{
  if(busy)return;clear();const ticket=generation;busy=true;$('evm-create-link').disabled=true;$('evm-link-status').textContent='Confirm receiving details in your wallet…';
  try{
   const state=await readState(),lease=session.capture();if(!state.identity||isRecoveredChat(state.identity))throw Error('Open your original Lenz account to create a receiving link.');
   const terms=await receivingTerms(state.identity.profile,lease.identity,$('evm-receiving-asset').value);
   const signature=await lease.signReceiving(terms);lease.assertCurrent();
   if(ticket!==generation||!dialog.open)return;
   const current=await readState();if(current.identity?.profile.id!==state.identity.profile.id||isRecoveredChat(current.identity))throw Error('Lenz account changed.');
   const instruction=await signReceivingInstruction(current.identity,terms,signature);lease.assertCurrent();
   const latest=await readState();if(latest.identity?.profile.id!==current.identity.profile.id||isRecoveredChat(latest.identity))throw Error('Lenz account changed.');
   if(ticket!==generation||!dialog.open)return;
   $('evm-receiving-link-text').value=receivingLink(instruction,location.origin);$('evm-link-result').hidden=false;$('evm-create-link').hidden=true;
   $('evm-link-expiry').textContent='Expires '+new Date(terms.expiresAt).toLocaleTimeString()+'.';$('evm-link-status').textContent='';
   timer=setTimeout(()=>{clear();$('evm-link-status').textContent='Link expired. Create a new link.';},Math.max(0,terms.expiresAt-Date.now()));
  }catch(error){if(ticket===generation)$('evm-link-status').textContent=error.code===4001?'Receiving link declined.':error.message;}
  finally{busy=false;$('evm-create-link').disabled=false;}
 };
 $('evm-copy-link').onclick=async()=>{try{await navigator.clipboard.writeText($('evm-receiving-link-text').value);$('evm-link-status').textContent='Receiving link copied.';}catch{$('evm-link-status').textContent='Select and copy the link above.';}};
}
