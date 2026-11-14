import {iconButton} from './wallet-actions.js';
import {walletAmount} from './wallet-visibility.js';
import {WALLET_NETWORKS} from './evm-networks.js';
const el=(tag,text)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;return node;};
function dollars(value){const [whole,fraction='']=value.split('.');if(whole==='0'&&value!=='0'&&Number('0.'+fraction)<.01)return '< $0.01';return '$'+whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction.padEnd(2,'0').slice(0,2);}
function health(value){if(value===null)return 'No debt';const [whole,fraction='']=value.split('.');return whole+'.'+fraction.padEnd(2,'0').slice(0,2);}
export function mountLendingAccount(wallet,host){
 const section=el('section');section.id='wallet-lending';section.className='wallet-lending';
 section.innerHTML='<div class="section-heading"><h2>Aave V3</h2><span id="lending-network" class="quiet"></span><button id="lending-refresh" type="button" class="secondary" hidden></button></div><p id="lending-account-address" class="quiet"></p><div id="lending-read"><p class="quiet">Check your lending balance and loans. Your wallet’s network provider can see the account address.</p><button id="lending-load" type="button">Load account</button></div><dl id="lending-values" hidden></dl><p id="lending-observed" class="quiet"></p><p id="lending-status" class="quiet" role="status"></p><details id="lending-details" hidden><summary>Account details</summary><p>Collateral and debt use Aave’s USD oracle values. Available to borrow is an account limit; available liquidity and market restrictions also apply.</p><p>These positions are public. Checking them does not move money. A safety ratio below 1 means your collateral can be sold to repay the loan.</p><p id="lending-source"></p></details>';
 host.prepend(section);const $=id=>section.querySelector('#'+id);
 iconButton($('lending-refresh'),'Refresh lending account','M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
 let version=0,reading=false;
 function reset(){
  version++;reading=false;$('lending-values').replaceChildren();$('lending-values').hidden=true;$('lending-details').hidden=true;$('lending-refresh').hidden=true;$('lending-read').hidden=false;$('lending-observed').textContent='';$('lending-source').textContent='';
  const snapshot=wallet.snapshot,supported=snapshot&&Object.hasOwn(WALLET_NETWORKS,snapshot.chainId);
  $('lending-network').textContent=snapshot?.network.name??'';$('lending-account-address').textContent=snapshot?.address??'';
  $('lending-load').textContent=snapshot?'Load account':'Connect wallet';$('lending-load').disabled=!navigator.onLine||!!snapshot&&!supported;
  $('lending-status').textContent=!navigator.onLine?'Offline. Connect to read current positions.':snapshot&&!supported?'Aave account reads are unavailable on this network.':'';
 }
 async function load(){
  if(reading)return;if(!wallet.snapshot){wallet.openConnect();return;}
  const snapshot=wallet.snapshot,ticket=++version;reading=true;$('lending-load').disabled=true;$('lending-refresh').disabled=true;$('lending-status').textContent='Reading account…';
  $('lending-values').hidden=true;$('lending-details').hidden=true;$('lending-observed').textContent='';
  try{
   const account=await wallet.readLendingAccount();if(ticket!==version||snapshot!==wallet.snapshot)return;
   const values=$('lending-values');values.replaceChildren();
   for(const [label,value]of [['Collateral',dollars(account.collateral)],['Debt',dollars(account.debt)],['Available to borrow',dollars(account.borrowingPower)],['Liquidation safety ratio',health(account.healthFactor)+(account.liquidationRisk?' · Liquidation risk':'')]]){
    const row=el('div');row.append(el('dt',label),walletAmount(el('dd'),value));values.append(row);
   }
   values.hidden=false;$('lending-read').hidden=true;$('lending-refresh').hidden=false;$('lending-details').hidden=false;$('lending-status').textContent='';
   $('lending-observed').textContent='Read '+new Date(account.observedAt).toLocaleTimeString()+' · Public position';
   $('lending-source').textContent='Block '+BigInt(account.block).toString()+' · Pool '+account.pool;
  }catch(error){if(ticket===version){$('lending-values').replaceChildren();$('lending-read').hidden=false;$('lending-status').textContent='Could not check this account. '+error.message;}}
  finally{if(ticket===version){reading=false;$('lending-load').disabled=false;$('lending-refresh').disabled=false;}}
 }
 $('lending-load').onclick=load;$('lending-refresh').onclick=load;
 addEventListener('lenz-evm-session',reset);addEventListener('offline',reset);reset();
}
