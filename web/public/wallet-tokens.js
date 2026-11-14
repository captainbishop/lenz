import {assetPriceCard} from './asset-price-card.js';
import {assetIcon} from './asset-icon.js';
import {walletHoldings,holdingsValue,walletIntentHoldings,walletHyperliquidHoldings} from './wallet-holdings.js';
import {readHyperliquidHoldings} from './hyperliquid-holdings.js';
import {WALLET_NETWORKS} from './evm-networks.js';
import {readState} from './chat-store.js';
import {readTokenWatch,tokenDecimal,tokenUsd} from './token-watch.js';
import {iconButton} from './wallet-actions.js';
import {walletAmount} from './wallet-visibility.js';
import {TOKEN_NETWORKS} from './token-metadata.js';
import {mountTokenImport} from './wallet-token-import.js';
import {mountWalletDiscovery} from './wallet-discovery-ui.js';
const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
let renderTokens=async()=>{};
export const renderWalletTokens=()=>renderTokens();
export function mountWalletTokens({action,wallet,intentController,privateFundingController}){
 const section=el('section');section.className='wallet-tokens';section.id='wallet-tokens';
 section.innerHTML='<div class="section-heading token-list-heading"><h2>Tokens</h2><div class="token-list-tools"><button id="wallet-token-display" type="button"></button><button id="wallet-add-token" type="button" aria-label="Add token" title="Add token"></button></div></div><div id="wallet-holdings-total"><small>Portfolio value</small><strong id="wallet-holdings-value">—</strong><small id="wallet-holdings-coverage"></small></div><div class="token-columns" aria-hidden="true"><span>Token</span><span>Price</span><span>Balance</span></div><div id="wallet-intent-list"></div><div id="wallet-native-list"></div><div id="wallet-token-list"></div><p id="wallet-token-empty" class="quiet" hidden></p>';
 $('.wallet-lower').before(section);iconButton($('#wallet-add-token'),'Add token','M12 5v14M5 12h14');
 const hyperList=el('div');hyperList.id='wallet-hyperliquid-list';$('#wallet-native-list').before(hyperList);
 const privateList=el('div');privateList.id='wallet-private-list';$('#wallet-intent-list').before(privateList);
 const importer=mountTokenImport({action,wallet});
 $('#wallet-token-display').remove();
 function paintEmpty(){
  const count=['wallet-private-list','wallet-intent-list','wallet-hyperliquid-list','wallet-native-list','wallet-token-list'].reduce((total,id)=>total+($('#'+id)?.children.length??0),0),offline=$('.wallet-offline-token');
  section.querySelector('.token-columns').hidden=count===0;$('#wallet-token-empty').hidden=count>0||!!offline&&!offline.hidden;$('#wallet-token-empty').textContent='No tokens yet. Use the faucet or receive a transfer.';
 }
 function paintIntentHoldings(snapshot){
  const list=$('#wallet-intent-list');list.replaceChildren();
  for(const row of snapshot?.balances??[]){
   const known=row.units??row.cachedUnits;if(known==null||BigInt(known)<=0n)continue;
   const item=el('details'),summary=el('summary'),identity=el('span'),labels=el('span'),amount=el('span'),details=el('div');item.className='wallet-token-row';identity.className='token-identity';amount.className='token-amount';details.className='token-row-details';
   labels.append(el('strong',row.symbol),el('small','NEAR testnet'));identity.append(assetIcon({symbol:row.symbol}),labels);
   amount.append(walletAmount(el('strong'),known==null?'—':tokenDecimal(known,row.decimals)+' '+row.symbol),el('small',row.status==='unknown'?'Balance not checked':row.units===null?'Last checked balance':'Test token · No cash value'));
   summary.append(identity,el('span','—'),amount);details.append(el('small',row.purpose),el('small',row.accountId),el('small',row.asset));
   if(row.verifiedAt)details.append(el('small','Checked '+new Date(row.verifiedAt).toLocaleString()));
   if(row.verifierUnits&&BigInt(row.verifierUnits)>0n)details.append(el('small',tokenDecimal(row.verifierUnits,row.decimals)+' '+row.symbol+' held in the route; separate from the receiving account balance.'));
   item.append(summary,details);list.append(item);
  }
  paintEmpty();
 }
 intentController?.subscribe(paintIntentHoldings);
 function paintPrivateHoldings(snapshot){privateList.replaceChildren();for(const row of [...(snapshot?.balances??[]),...(snapshot?.resultBalances??[])]){const amount=row.units??row.cachedUnits;if(amount==null||BigInt(amount)<=0n)continue;const item=el('details'),summary=el('summary'),identity=el('span'),labels=el('span'),quantity=el('span'),details=el('div');item.className='wallet-token-row';identity.className='token-identity';quantity.className='token-amount';details.className='token-row-details';labels.append(el('strong',row.symbol),el('small',row.custody==='Aurora account'?'Aurora testnet':'Private pool · Aurora testnet'));identity.append(assetIcon({symbol:row.symbol}),labels);quantity.append(walletAmount(el('strong'),tokenDecimal(amount,row.decimals)+' '+row.symbol),el('small',row.pending?'Pending private swap':row.units===null?'Last checked balance':'Test token · No cash value'));summary.append(identity,el('span','—'),quantity);details.append(el('small',row.purpose),el('small','Checked '+new Date(row.verifiedAt).toLocaleString()));item.append(summary,details);privateList.append(item);}paintEmpty();}
 privateFundingController?.subscribe(paintPrivateHoldings);
 const discovery=mountWalletDiscovery(wallet,()=>renderTokens().catch(()=>{}));
 let renderVersion=0;
 addEventListener('lenz-evm-session',()=>renderTokens().catch(()=>{}));
 renderTokens=async()=>{
  const ticket=++renderVersion,owner=wallet.snapshot,state=await readState(),saved=await readTokenWatch(state);if(ticket!==renderVersion||wallet.snapshot!==owner)return;const rows=owner?walletHoldings(saved,owner):[],list=$('#wallet-token-list');list.replaceChildren();
  let hyperRows=[];if(owner){try{hyperRows=walletHyperliquidHoldings(await readHyperliquidHoldings(owner.address));}catch{}}
  if(ticket!==renderVersion||wallet.snapshot!==owner)return;
  intentController?.setHoldings([...walletIntentHoldings(saved,owner),...hyperRows]);paintIntentHoldings(intentController?.snapshot());paintPrivateHoldings(privateFundingController?.snapshot());
  hyperList.replaceChildren();for(const row of hyperRows){
   const item=el('details'),summary=el('summary'),identity=el('span'),labels=el('span'),amount=el('span'),details=el('div');item.className='wallet-token-row';identity.className='token-identity';amount.className='token-amount';details.className='token-row-details';
   labels.append(el('strong',row.symbol),el('small','Hyperliquid testnet · '+row.bucket));identity.append(assetIcon({symbol:row.symbol}),labels);amount.append(walletAmount(el('strong'),row.displayAmount+' '+row.symbol),el('small',row.status==='current'?'Test token · No cash value':'Last checked balance'));
   summary.append(identity,el('span','—'),amount);details.append(el('small',row.accountId),el('small',row.asset),el('small','Available '+(row.availableAmount??'not checked')+' '+row.symbol),el('small','Checked '+new Date(row.verifiedAt).toLocaleString()));item.append(summary,details);hyperList.append(item);
  }
  const now=Date.now(),fresh=time=>now-time<=60000,total=holdingsValue(rows,{nativeBalance:owner?.balance??'0x0',nativeObservedAt:owner?.observedAt??0,nativePrice:discovery.nativePrice});
  walletAmount($('#wallet-holdings-value'),!owner||total.value===null?'—':'$'+total.value);$('#wallet-holdings-coverage').textContent=owner?(total.unpriced?total.unpriced+' unpriced · Partial value · ':'')+owner.network.name+' · '+owner.address.slice(0,6)+'…'+owner.address.slice(-4):'Choose an account to see your balances';
  function rowContent({symbol,name,network,quantity,price,value,icon,referenceKey,contract,chain}){
   const amount=el('span');amount.className='token-amount';const qty=walletAmount(el('strong'),quantity);qty.className='token-quantity';amount.append(qty,walletAmount(el('small'),value));
   const card=assetPriceCard({name,symbol,subtitle:network,icon,priceLabel:price==='—'?null:price,referencePrice:price==='—',quote:'USD',referenceKey,contract,network:chain,referenceChange:true});card.priceElement.classList.add('token-price');return [card.element,amount];
  }
  const unitPrice=price=>{if(!price)return '—';const value=Number(price.answer)/10**price.decimals;return new Intl.NumberFormat(undefined,{style:'currency',currency:'USD',...(value>=1?{minimumFractionDigits:2,maximumFractionDigits:2}:{maximumSignificantDigits:6})}).format(value);};
  const nativeList=$('#wallet-native-list');nativeList.replaceChildren();
  const natives=owner?[{symbol:owner.network.symbol,name:owner.network.name,network:owner.network.name,custom:!WALLET_NETWORKS[owner.chainId]}]:[];
  for(const native of natives){
   const selected=!!owner&&(native.custom||native.symbol==='ETH'&&!!WALLET_NETWORKS[owner.chainId]),balance=selected?BigInt(owner.balance).toString():null;
   if(balance===null||BigInt(balance)<=0n)continue;
   const item=el('article');item.className='wallet-native-row';const price=selected&&!native.custom?(discovery.nativePrice&&fresh(discovery.nativePrice.observedAt)?discovery.nativePrice:rows.find(r=>r.nativePrice&&fresh(r.nativePrice.observedAt))?.nativePrice):null;
   const value=balance===null?'Connect an account':!fresh(owner.observedAt)?'Saved balance':balance==='0'?'$0.00':price?'$'+tokenUsd({balance,decimals:18,price}):'Value unavailable';
   item.append(...rowContent({...native,referenceKey:native.custom?null:native.symbol,network:selected?owner.network.name:native.network,quantity:balance===null?'—':tokenDecimal(balance,owner.network.decimals??18)+' '+native.symbol,price:unitPrice(price),value,icon:assetIcon({symbol:native.symbol,trusted:!native.custom})}));nativeList.append(item);
  }
  for(const row of rows){
   if(row.balance===null||BigInt(row.balance)<=0n)continue;
   const item=el('details'),summary=el('summary'),tools=el('div');item.className='wallet-token-row';tools.className='token-row-details';
   const current=!!owner&&fresh(row.observedAt),usd=current&&row.price&&fresh(row.price.observedAt)?tokenUsd(row):null;
   summary.append(...rowContent({symbol:row.symbol,name:row.name,contract:row.request.contract,chain:row.request.network,network:TOKEN_NETWORKS[row.request.network].name,quantity:row.balance===null?'—':tokenDecimal(row.balance,row.decimals)+' '+row.symbol,price:unitPrice(row.price&&fresh(row.price.observedAt)?row.price:null),value:row.balance===null?'Balance not checked':!current?'Saved balance':row.balance==='0'?'$0.00':usd===null?'Value unavailable':'$'+usd,icon:assetIcon({symbol:row.symbol,contract:row.request.contract,network:row.request.network,image:row.image})}));
   const address=el('span',row.request.contract.slice(0,6)+'…'+row.request.contract.slice(-4));address.title=row.request.contract;tools.append(address,el('small','Read '+new Date(row.observedAt).toLocaleString()));
   if(!owner&&row.request.account)tools.append(el('small','Saved address '+row.request.account.slice(0,6)+'…'+row.request.account.slice(-4)));
   const edit=el('button');edit.type='button';iconButton(edit,'Update '+row.symbol,'M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
   edit.disabled=!navigator.onLine;
   edit.onclick=()=>importer.open(row.request.contract);
   const send=el('button');send.type='button';iconButton(send,'Send '+row.symbol,'M5 19 19 5M5 5h14v14');send.disabled=!owner||!navigator.onLine||BigInt(row.balance??'0')===0n;
   send.onclick=()=>{if(wallet.snapshot===owner)wallet.openSend(row.request.contract);};tools.append(send);
   tools.append(edit);item.append(summary,tools);list.append(item);
  }
  paintEmpty();
 };
 addEventListener('lenz-transfers-changed',()=>renderTokens().catch(()=>{}));
 addEventListener('lenz-holdings-changed',()=>renderTokens().catch(()=>{}));
 addEventListener('lenz-hyperliquid-holdings',()=>renderTokens().catch(()=>{}));
 setInterval(()=>{if(!document.hidden)renderTokens().catch(()=>{});},60000);
}
