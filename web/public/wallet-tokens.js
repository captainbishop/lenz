import {readState,updateState} from './chat-store.js';
import {readTokenWatch,saveTokenWatch,tokenWatchRequest,tokenWatchSnapshot,tokenDecimal,tokenUsd} from './token-watch.js';
import {iconButton,walletIcon} from './wallet-actions.js';
import {walletAmount} from './wallet-visibility.js';
import {ORACLE_NETWORKS} from './oracle-feeds.js';
const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const key=r=>[r.network,r.contract,r.account].join('/');
let renderTokens=async()=>{};
export const renderWalletTokens=()=>renderTokens();
export function mountWalletTokens({action}){
 const section=el('section');section.className='wallet-tokens';section.id='wallet-tokens';
 section.innerHTML='<div class="section-heading"><h2>Tokens</h2><button id="wallet-add-token" type="button" aria-label="Add token" title="Add token"></button></div><div id="wallet-token-list"></div><p id="wallet-token-empty" class="quiet">Add a token by its contract address.</p>';
 $('.wallet-lower').before(section);iconButton($('#wallet-add-token'),'Add token','M12 5v14M5 12h14');
 const dialog=el('dialog');dialog.id='wallet-token-dialog';dialog.setAttribute('aria-labelledby','wallet-token-title');
 dialog.innerHTML=`<div class="dialog-top"><h2 id="wallet-token-title">Add token</h2><button id="wallet-token-close" type="button" class="secondary wallet-close"></button></div><div class="token-networks" aria-label="Token network"><button type="button" data-network="ethereum" aria-pressed="true">Ethereum</button><button type="button" data-network="arbitrum" aria-pressed="false">Arbitrum</button><button type="button" data-network="base" aria-pressed="false">Base</button></div><form id="wallet-token-form"><label for="wallet-token-contract">Contract address</label><input id="wallet-token-contract" placeholder="0x…" autocomplete="off" spellcheck="false" required><details id="wallet-token-account-panel"><summary>Read a wallet balance</summary><label for="wallet-token-account">Wallet address</label><input id="wallet-token-account" placeholder="0x…" autocomplete="off" spellcheck="false"><p class="quiet">Watched balance. Adding an address does not grant spending access.</p></details><label class="token-lookup-consent"><input id="wallet-token-consent" type="checkbox">Share these addresses with the network provider.</label><button type="submit" id="wallet-token-lookup" disabled>Look up token</button></form><div id="wallet-token-result" hidden></div><button id="wallet-token-save" type="button" hidden>Add token</button><p id="wallet-token-feedback" class="wallet-feedback" role="status"></p>`;
 document.body.append(dialog);iconButton($('#wallet-token-close'),'Close','m6 6 12 12M18 6 6 18');
 let network='ethereum',version=0,controller=null,result=null;
 const clear=()=>{version++;controller?.abort();controller=null;result=null;$('#wallet-token-result').hidden=true;$('#wallet-token-save').hidden=true;$('#wallet-token-feedback').textContent='';$('#wallet-token-lookup').disabled=!$('#wallet-token-consent').checked||!navigator.onLine;};
 $('#wallet-token-close').onclick=()=>dialog.close();dialog.addEventListener('close',clear);
 $('#wallet-add-token').onclick=()=>{$('#wallet-token-form').reset();$('#wallet-token-account-panel').open=false;clear();dialog.showModal();};
 for(const button of dialog.querySelectorAll('[data-network]'))button.onclick=()=>{network=button.dataset.network;clear();dialog.querySelectorAll('[data-network]').forEach(b=>b.setAttribute('aria-pressed',String(b===button)));};
 for(const id of ['wallet-token-contract','wallet-token-account','wallet-token-consent'])$('#'+id).addEventListener('input',clear);
 addEventListener('offline',clear);
 $('#wallet-token-form').onsubmit=async event=>{
  event.preventDefault();clear();const generation=version;controller=new AbortController();$('#wallet-token-lookup').disabled=true;
  try{
   const request=tokenWatchRequest({network,contract:$('#wallet-token-contract').value.trim(),account:$('#wallet-token-account').value.trim()||null,publicConsent:$('#wallet-token-consent').checked});
   $('#wallet-token-feedback').textContent='Reading token…';
   const response=await fetch('/api/tokens/read',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(request),signal:controller.signal});
   const value=await response.json();if(generation!==version||!dialog.open)return;if(!response.ok)throw Error(value.error||'Token unavailable.');
   result=tokenWatchSnapshot(value,request);const panel=$('#wallet-token-result');panel.replaceChildren();
   panel.append(el('strong',result.symbol),el('span',result.name),el('small',ORACLE_NETWORKS[network].name+' · '+result.decimals+' decimals'));
   panel.append(el('p',result.balance===null?'Add a wallet address to read its balance.':tokenDecimal(result.balance,result.decimals)+' '+result.symbol));
   panel.append(el('small',tokenUsd(result)===null?'Price unavailable.':'Reference value $'+tokenUsd(result)));
   panel.hidden=false;$('#wallet-token-save').hidden=false;$('#wallet-token-feedback').textContent='';
  }catch(error){if(generation===version)$('#wallet-token-feedback').textContent=error.name==='AbortError'?'':error.message;}
  finally{if(generation===version)$('#wallet-token-lookup').disabled=!$('#wallet-token-consent').checked||!navigator.onLine;}
 };
 $('#wallet-token-save').onclick=()=>action(async()=>{
  if(!result)throw Error('Look up the token first.');const checked=tokenWatchSnapshot(result,result.request);
  await updateState(async s=>{const rows=await readTokenWatch(s),index=rows.findIndex(r=>key(r.request)===key(checked.request));if(index<0)rows.push(checked);else rows[index]=checked;await saveTokenWatch(s,rows);});
  dialog.close();
 });
 renderTokens=async()=>{
  const state=await readState(),rows=await readTokenWatch(state),list=$('#wallet-token-list');list.replaceChildren();$('#wallet-token-empty').hidden=rows.length>0;
  for(const row of rows){
   const item=el('article'),identity=el('div'),amount=el('div'),tools=el('div');item.className='wallet-token-row';identity.append(el('strong',row.symbol),el('small',ORACLE_NETWORKS[row.request.network].name));
   const address=el('a',row.request.contract.slice(0,6)+'…'+row.request.contract.slice(-4));address.href=ORACLE_NETWORKS[row.request.network].explorer+row.request.contract;address.target='_blank';address.rel='noopener noreferrer';address.title=row.request.contract;identity.append(address);
   if(row.request.account){const account=el('small','Watching '+row.request.account.slice(0,6)+'…'+row.request.account.slice(-4));account.title=row.request.account;identity.append(account);}
   amount.append(walletAmount(el('strong'),row.balance===null?'No wallet added':tokenDecimal(row.balance,row.decimals)));
   const usd=tokenUsd(row);amount.append(walletAmount(el('small'),usd===null?'Price unavailable':'$'+usd));amount.append(el('small','Saved '+new Date(row.observedAt).toLocaleString()));
   const edit=el('button');edit.type='button';iconButton(edit,'Update '+row.symbol,'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
   edit.onclick=()=>{$('#wallet-add-token').click();network=row.request.network;dialog.querySelectorAll('[data-network]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.network===network)));$('#wallet-token-contract').value=row.request.contract;$('#wallet-token-account').value=row.request.account??'';$('#wallet-token-account-panel').open=!!row.request.account;};
   tools.append(edit);item.append(identity,amount,tools);list.append(item);
  }
 };
}
