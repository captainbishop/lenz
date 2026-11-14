import {assetDiscoveryRequest,assetDiscoverySnapshot} from './asset-discovery.js';
import {readState,updateState} from './chat-store.js';
import {readTokenWatch,saveTokenWatch} from './token-watch.js';
import {WALLET_NETWORKS} from './evm-networks.js';
import {iconButton} from './wallet-actions.js';
export function mountWalletDiscovery(wallet,changed){
 const button=document.createElement('button');button.id='wallet-discover';button.type='button';iconButton(button,'Refresh tokens','M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');document.querySelector('.token-list-tools').prepend(button);
 const status=document.createElement('p');status.id='wallet-discovery-status';status.className='quiet';status.setAttribute('role','status');document.querySelector('#wallet-tokens').append(status);
 const dialog=document.createElement('dialog');dialog.id='wallet-discovery-dialog';dialog.setAttribute('aria-labelledby','wallet-discovery-title');dialog.innerHTML='<div class="dialog-top"><h2 id="wallet-discovery-title">Find your tokens</h2><button type="button" class="secondary wallet-close"></button></div><p>Share your wallet address to find tokens and check their balances. Blockscout and public network providers can see the address. Prices and images come from Chainlink and DEX Screener.</p><p class="quiet">Ethereum, Arbitrum and Base · checks up to 24 tokens at a time. Some may be missing.</p><button id="wallet-discovery-allow" type="button">Find tokens</button>';document.body.append(dialog);const close=dialog.querySelector('.wallet-close');iconButton(close,'Close','m6 6 12 12M18 6 6 18');close.onclick=()=>dialog.close();
 let version=0,controller=null,price=null,authorized=null,busy=false;
 const key=owner=>owner?owner.chainId+'/'+owner.address:null;
 function clear(){version++;controller?.abort();controller=null;price=null;busy=false;button.disabled=!navigator.onLine;status.textContent='';}
 async function refresh(){
  const owner=wallet.snapshot;if(!owner||!WALLET_NETWORKS[owner.chainId]||!navigator.onLine||busy)return;
  const ticket=++version;controller=new AbortController();busy=true;button.disabled=true;status.textContent='Finding tokens…';
  try{
   const initial=await readState();if(!initial.identity)throw Error('Create a profile to keep your tokens.');
   await wallet.checkAccount(owner);if(ticket!==version)return;
   const request=assetDiscoveryRequest({network:WALLET_NETWORKS[owner.chainId].key,account:owner.address,publicConsent:true});
   const response=await fetch('/api/tokens/discover',{method:'POST',headers:{'Content-Type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(55000)])});
   if(!response.ok)throw Error('Could not find tokens. Try again or add a token by its contract address.');
   const raw=await response.text();if(raw.length>262144)throw Error('Token list too large.');
   const result=assetDiscoverySnapshot(JSON.parse(raw),request);await wallet.checkAccount(owner);if(ticket!==version||wallet.snapshot!==owner)return;
   let full=false;
   await updateState(async s=>{
    if(ticket!==version||wallet.snapshot!==owner||s.identity?.profile.id!==initial.identity.profile.id)throw Error('Wallet changed.');
    const saved=await readTokenWatch(s);
    if(ticket!==version||wallet.snapshot!==owner)throw Error('Wallet changed.');
    for(const row of result.rows){const index=saved.findIndex(r=>r.request.network===request.network&&r.request.account===request.account&&r.request.contract===row.request.contract);if(index>=0)saved[index]=row;else if(saved.length<30)saved.push(row);else full=true;}
    await saveTokenWatch(s,saved);
    if(ticket!==version||wallet.snapshot!==owner)throw Error('Wallet changed.');
   });
   if(ticket!==version||wallet.snapshot!==owner)return;price=result.nativePrice;
   status.textContent=(result.partial||full?'Partial token list · ':result.rows.length?'':'No tokens found · ')+(result.skipped?result.skipped+' unavailable or filtered · ':'')+'Read '+new Date(result.observedAt).toLocaleTimeString();
   changed();dispatchEvent(new Event('lenz-holdings-changed'));
  }catch(error){if(ticket===version&&error.name!=='AbortError')status.textContent=error.message;}
  finally{if(ticket===version){busy=false;button.disabled=!navigator.onLine;}}
 }
 button.onclick=()=>{if(!wallet.snapshot){wallet.openConnect();return;}if(!WALLET_NETWORKS[wallet.snapshot.chainId]){status.textContent='Token discovery is available on Ethereum, Arbitrum and Base.';return;}if(authorized===key(wallet.snapshot))refresh();else dialog.showModal();};
 document.querySelector('#wallet-discovery-allow').onclick=()=>{authorized=key(wallet.snapshot);dialog.close();refresh();};
 addEventListener('lenz-evm-session',()=>{clear();dialog.close();if(!wallet.snapshot){authorized=null;return;}if(wallet.discoveryConsent){authorized=key(wallet.snapshot);refresh();}});
 addEventListener('offline',()=>{clear();authorized=null;});
 return {get nativePrice(){return price;}};
}
