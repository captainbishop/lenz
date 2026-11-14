import {readTokenWatch,tokenUsd} from './token-watch.js';
import {WALLET_NETWORKS} from './evm-networks.js';
import {transferAssets,importedTransferToken} from './evm-transfer.js';
import {readState} from './chat-store.js';
import {checkedHyperliquidHoldings} from './hyperliquid-holdings-model.js';
import {orderAmount} from './hyperliquid-order.js';

export function walletHoldings(rows,identity){
 const network=WALLET_NETWORKS[identity?.chainId]?.key;
 if(!network)return [];
 const unique=new Map();
 for(const row of rows){
  if(row.request.network!==network||row.request.account!==identity.address||row.balance===null)continue;
  const previous=unique.get(row.request.contract);
  if(!previous||row.observedAt>previous.observedAt)unique.set(row.request.contract,row);
 }
 return [...unique.values()];
}
export function walletIntentHoldings(rows,identity,{online=globalThis.navigator?.onLine!==false,now=Date.now()}={}){
 if(!identity)return [];
 const chainId='eip155:'+BigInt(identity.chainId).toString(),accountId=identity.address;
 const holding=(asset,symbol,name,decimals,quantity,verifiedAt)=>{
  const cachedUnits=BigInt(quantity).toString(),current=online&&Number.isSafeInteger(verifiedAt)&&verifiedAt>0&&now>=verifiedAt&&now-verifiedAt<=60000;
  return {id:chainId+':'+accountId+':'+asset,chainId,accountId,asset,symbol,name,decimals,units:current?cachedUnits:null,cachedUnits,verifiedAt,status:current?'current':'last-verified'};
 };
 const result=[];
 if(identity.balance!==null&&identity.balance!==undefined&&BigInt(identity.balance)>0n)result.push(holding('native',identity.network.symbol,identity.network.name??identity.network.symbol,identity.network.decimals??18,identity.balance,identity.observedAt));
 for(const row of walletHoldings(rows,identity))if(BigInt(row.balance)>0n)result.push(holding('erc20:'+row.request.contract,row.symbol,row.name,row.decimals,row.balance,row.observedAt));
 return result;
}
export function walletHyperliquidHoldings(value,{online=globalThis.navigator?.onLine!==false,now=Date.now()}={}){
 if(!value)return [];const snapshot=checkedHyperliquidHoldings(value),current=online&&now>=snapshot.observedAt&&now-snapshot.observedAt<=60000;
 const units=(amount,decimals)=>{if(amount===null||decimals===null)return null;const value=orderAmount(amount)*10n**BigInt(decimals);return value%10n**18n===0n?(value/10n**18n).toString():null;};
 const row=(asset,symbol,decimals,total,available,bucket)=>{const cachedUnits=units(available,decimals);return {id:snapshot.chainId+':'+snapshot.account+':'+asset,chainId:snapshot.chainId,accountId:snapshot.account,asset,symbol,name:symbol,decimals:decimals??18,displayAmount:total,availableAmount:available,bucket,units:current?cachedUnits:null,cachedUnits,status:current?'current':'last-verified',verifiedAt:snapshot.observedAt};};
 const result=snapshot.spot.map(token=>row('hypercore:spot:'+(token.tokenId??token.tokenIndex),token.symbol,token.decimals,token.total,token.available,'Spot'));
 if(snapshot.perps.totalRawUSDC!==null&&orderAmount(snapshot.perps.totalRawUSDC)>0n)result.push(row('hypercore:perps:usdc','USDC',6,snapshot.perps.totalRawUSDC,snapshot.perps.withdrawable,'Perpetuals'));
 return result;
}
export async function walletTransferAssets(identity){
 const base=transferAssets(identity.chainId),rows=walletHoldings(await readTokenWatch(await readState()),identity);
 return [...base,...rows.filter(r=>!base.some(t=>t.id===r.request.contract)).map(r=>({...importedTransferToken({id:r.request.contract,symbol:r.symbol,decimals:r.decimals}),image:r.image??null}))];
}
export function holdingsValue(rows,{now=Date.now(),nativeBalance='0x0',nativeObservedAt=0,nativePrice=null}={}){
 let cents=0n,unpriced=0,priced=0;
 if(BigInt(nativeBalance)>0n){
  const p=now-nativeObservedAt<=60000&&(nativePrice&&now-nativePrice.observedAt<=60000?nativePrice:rows.find(r=>r.nativePrice&&now-r.nativePrice.observedAt<=60000)?.nativePrice);
  if(p){cents+=BigInt(nativeBalance)*BigInt(p.answer)*100n/10n**BigInt(18+p.decimals);priced++;}else unpriced++;
 }
 for(const row of rows){
  if(row.balance===null||BigInt(row.balance)===0n)continue;
  const value=now-row.observedAt<=60000&&row.price&&now-row.price.observedAt<=60000?tokenUsd(row):null;
  if(value===null){unpriced++;continue;}cents+=BigInt(value.replace('.',''));priced++;
 }
 return {value:priced?(cents/100n)+'.'+(cents%100n).toString().padStart(2,'0'):null,unpriced,priced};
}
