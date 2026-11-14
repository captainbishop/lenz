import {updateState} from './chat-store.js';
import {TOKEN_NETWORKS,tokenAddressNetworks,tokenMetadataRequest,tokenMetadataResult,tokenMetadata,readTokenMetadata,saveTokenMetadata} from './token-metadata.js';
import {readTokenWatch,saveTokenWatch,tokenWatchRequest,tokenWatchSnapshot,tokenDecimal,tokenUsd} from './token-watch.js';
import {WALLET_NETWORKS} from './evm-networks.js';
import {iconButton} from './wallet-actions.js';
import {assetIcon} from './asset-icon.js';
const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function mountTokenImport({action,wallet}){
 const dialog=el('dialog');dialog.id='wallet-token-dialog';dialog.setAttribute('aria-labelledby','wallet-token-title');
 dialog.innerHTML=`<div class="dialog-top"><h2 id="wallet-token-title">Add token</h2><button id="wallet-token-close" type="button" class="secondary wallet-close"></button></div><form id="wallet-token-form"><label for="wallet-token-contract">Contract address</label><input id="wallet-token-contract" placeholder="Contract address or token mint" autocomplete="off" spellcheck="false" required maxlength="64" aria-describedby="wallet-token-autofill wallet-token-feedback"><p id="wallet-token-autofill" class="quiet">Paste to load public token details.</p><label for="wallet-token-network">Network</label><input id="wallet-token-network" readonly placeholder="Detected from the address"><div id="wallet-token-matches" role="group" aria-label="Matching networks" hidden></div><div class="token-metadata-fields"><div class="token-name-field"><label for="wallet-token-name">Token name</label><input id="wallet-token-name" readonly placeholder="—"></div><div><label for="wallet-token-symbol">Symbol</label><input id="wallet-token-symbol" readonly placeholder="—"></div><div><label for="wallet-token-decimals">Decimals</label><input id="wallet-token-decimals" readonly placeholder="—"></div></div><div id="wallet-token-balance-choice" hidden><p id="wallet-token-owner" class="quiet"></p><label class="token-lookup-consent"><input id="wallet-token-consent" type="checkbox">Read balance and price. Shares this address with Lenz’s server and the network RPC provider.</label></div><div id="wallet-token-result" hidden></div><p id="wallet-token-feedback" class="wallet-feedback" role="status"></p><button id="wallet-token-retry" type="button" class="secondary" hidden>Retry details</button><button id="wallet-token-save" type="submit" disabled>Add token</button></form>`;
 document.body.append(dialog);iconButton($('wallet-token-close'),'Close','m6 6 12 12M18 6 6 18');
 const sources=el('p');sources.id='wallet-token-sources';sources.className='wallet-feedback';sources.setAttribute('role','status');sources.hidden=true;$('wallet-token-feedback').after(sources);
 let version=0,timer=null,controller=null,selected=null,observation=null,readingBalance=false,saving=false;
 const stop=()=>{version++;clearTimeout(timer);timer=null;controller?.abort();controller=null;readingBalance=false;};
 function controls(){
  const owner=wallet.snapshot,eligible=selected&&owner&&WALLET_NETWORKS[owner.chainId]?.key===selected.network;
  $('wallet-token-balance-choice').hidden=!eligible;$('wallet-token-owner').textContent=eligible?owner.address.slice(0,6)+'…'+owner.address.slice(-4):'';
  $('wallet-token-save').disabled=!selected||saving||readingBalance;
 }
 function clear(){stop();selected=null;observation=null;for(const field of ['network','name','symbol','decimals'])$('wallet-token-'+field).value='';$('wallet-token-result').hidden=true;$('wallet-token-matches').hidden=true;$('wallet-token-matches').replaceChildren();$('wallet-token-feedback').textContent='';sources.textContent='';sources.hidden=true;$('wallet-token-retry').hidden=true;controls();}
 function choose(metadata){selected=metadata;observation=null;for(const field of ['name','symbol','decimals'])$('wallet-token-'+field).value=metadata[field];$('wallet-token-network').value=TOKEN_NETWORKS[metadata.network].name;for(const button of $('wallet-token-matches').children)button.setAttribute('aria-pressed',String(button.dataset.network===metadata.network));$('wallet-token-feedback').textContent='';controls();if($('wallet-token-consent').checked&&!$('wallet-token-balance-choice').hidden)readBalance();}
 async function lookup(){
  clear();if(!dialog.open||!navigator.onLine)return;const input=tokenMetadataRequest({contract:$('wallet-token-contract').value.trim()}),ticket=version;controller=new AbortController();$('wallet-token-feedback').textContent='Reading token details…';
  try{
   const response=await fetch('/api/tokens/metadata',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input),signal:controller.signal});const value=await response.json();if(ticket!==version||!dialog.open)return;if(!response.ok)throw Error(value.error||'Token details unavailable.');
   const result=tokenMetadataResult(value,input);sources.hidden=!result.unavailable.length;sources.textContent=result.unavailable.length?'Could not check: '+result.unavailable.map(network=>TOKEN_NETWORKS[network].name).join(', ')+'.':'';
   if(!result.matches.length)throw Error(result.unavailable.length?'Token details unavailable. Retry the lookup.':'No token details found. Check the address. Supported: Ethereum, Arbitrum, Base, Solana and NEAR.');
   if(result.matches.length===1)choose(result.matches[0]);
   else {const matches=$('wallet-token-matches');matches.hidden=false;for(const metadata of result.matches){const button=el('button',TOKEN_NETWORKS[metadata.network].name+' · '+metadata.symbol);button.type='button';button.className='secondary';button.dataset.network=metadata.network;button.setAttribute('aria-pressed','false');button.onclick=()=>{stop();$('wallet-token-result').hidden=true;choose(metadata);};matches.append(button);}$('wallet-token-feedback').textContent='This address exists on several networks. Choose its network.';}
   $('wallet-token-retry').hidden=!result.unavailable.length;
  }catch(error){if(ticket===version&&dialog.open){$('wallet-token-feedback').textContent=error.name==='AbortError'?'':error.message;$('wallet-token-retry').hidden=false;}}
  finally{if(ticket===version)controls();}
 }
 function schedule(){clear();const value=$('wallet-token-contract').value.trim();if(!navigator.onLine){$('wallet-token-feedback').textContent='Go online to read token details.';return;}if(tokenAddressNetworks(value).length)timer=setTimeout(lookup,400);}
 async function readBalance(){
  stop();observation=null;$('wallet-token-result').hidden=true;controls();if(!selected||!$('wallet-token-consent').checked||$('wallet-token-balance-choice').hidden)return;
  const owner=wallet.snapshot,metadata=selected,ticket=version;controller=new AbortController();readingBalance=true;controls();$('wallet-token-feedback').textContent='Reading balance…';
  try{await wallet.checkAccount(owner);if(ticket!==version||wallet.snapshot!==owner)return;
   const request=tokenWatchRequest({network:metadata.network,contract:metadata.contract,account:owner.address,publicConsent:true}),response=await fetch('/api/tokens/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal}),value=await response.json();
   if(ticket!==version||!dialog.open||wallet.snapshot!==owner)return;if(!response.ok)throw Error(value.error||'Balance unavailable.');await wallet.checkAccount(owner);if(ticket!==version||wallet.snapshot!==owner)return;
   const checked=tokenWatchSnapshot(value,request);if(checked.name!==metadata.name||checked.symbol!==metadata.symbol||checked.decimals!==metadata.decimals)throw Error('Token details changed. Recheck the address.');
   observation=checked;const panel=$('wallet-token-result');panel.replaceChildren(assetIcon({symbol:checked.symbol,contract:checked.request.contract,network:checked.request.network,image:checked.image}),el('p',tokenDecimal(checked.balance,checked.decimals)+' '+checked.symbol),el('small',tokenUsd(checked)===null?'Price unavailable.':'Reference value $'+tokenUsd(checked)));panel.hidden=false;$('wallet-token-feedback').textContent='';
  }catch(error){if(ticket===version&&dialog.open)$('wallet-token-feedback').textContent=error.name==='AbortError'?'':error.message;}
  finally{if(ticket===version){readingBalance=false;controls();}}
 }
 $('wallet-token-contract').oninput=schedule;$('wallet-token-retry').onclick=lookup;$('wallet-token-consent').onchange=()=>{if($('wallet-token-consent').checked)readBalance();else{stop();observation=null;$('wallet-token-result').hidden=true;$('wallet-token-feedback').textContent='';controls();}};
 $('wallet-token-close').onclick=()=>dialog.close();dialog.addEventListener('close',clear);
 $('wallet-add-token').onclick=()=>{$('wallet-token-form').reset();clear();dialog.showModal();$('wallet-token-contract').focus();};
 addEventListener('offline',()=>{stop();observation=null;$('wallet-token-consent').checked=false;$('wallet-token-result').hidden=true;$('wallet-token-feedback').textContent='Offline. Token details can be saved; balance reads need a connection.';controls();});
 addEventListener('lenz-evm-session',()=>{stop();observation=null;$('wallet-token-consent').checked=false;$('wallet-token-result').hidden=true;controls();if(dialog.open&&!selected)schedule();});
 $('wallet-token-form').onsubmit=event=>{event.preventDefault();if(!selected||saving||readingBalance)return;action(async()=>{
  saving=true;controls();try{
   const metadata=tokenMetadata(selected,{cached:true}),checked=observation&&tokenWatchSnapshot(observation,observation.request,{cached:true}),owner=wallet.snapshot,ticket=version;
   if(checked){await wallet.checkAccount(owner);if(ticket!==version||owner!==wallet.snapshot||owner?.address!==checked.request.account||WALLET_NETWORKS[owner?.chainId]?.key!==checked.request.network)throw Error('Wallet changed. Read the balance again.');}
   await updateState(async state=>{
    const rows=await readTokenMetadata(state);if(ticket!==version||!dialog.open)throw Error('Token import changed.');const index=rows.findIndex(row=>row.network===metadata.network&&row.contract===metadata.contract);if(index<0)rows.push(metadata);else rows[index]=metadata;await saveTokenMetadata(state,rows);
    if(checked){const watches=await readTokenWatch(state),index=watches.findIndex(row=>JSON.stringify(row.request)===JSON.stringify(checked.request));if(index<0)watches.push(checked);else watches[index]=checked;await saveTokenWatch(state,watches);}
    if(ticket!==version||!dialog.open||checked&&wallet.snapshot!==owner)throw Error('Token import changed.');
   });dialog.close();dispatchEvent(new Event('lenz-holdings-changed'));
  }finally{saving=false;controls();}
 });};
 return {open(contract){$('wallet-add-token').click();$('wallet-token-contract').value=contract;schedule();}};
}
