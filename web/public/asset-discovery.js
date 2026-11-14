import {WALLET_NETWORKS} from './evm-networks.js';
import {tokenWatchSnapshot} from './token-watch.js';
import {ORACLE_FEEDS} from './oracle-feeds.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export function assetDiscoveryRequest(input){
 check(input&&Object.keys(input).sort().join(',')==='account,network,publicConsent'&&input.publicConsent===true,'Allow token discovery first.');
 check(Object.values(WALLET_NETWORKS).some(n=>n.key===input.network),'Unsupported discovery network.');
 check(typeof input.account==='string'&&/^0x[0-9a-f]{40}$/i.test(input.account)&&!/^0x0{40}$/i.test(input.account),'Invalid wallet address.');
 return {network:input.network,account:input.account.toLowerCase(),publicConsent:true};
}
export function assetDiscoverySnapshot(value,input,{now=Date.now()}={}){
 const request=assetDiscoveryRequest(input);
 check(value&&JSON.stringify(assetDiscoveryRequest(value.request))===JSON.stringify(request)&&Array.isArray(value.rows)&&value.rows.length<=24&&typeof value.partial==='boolean'&&Number.isSafeInteger(value.skipped)&&value.skipped>=0,'Invalid discovered holdings.');
 check(Number.isSafeInteger(value.observedAt)&&value.observedAt<=now+5000&&now-value.observedAt<60000,'Holdings need updating.');
 const seen=new Set(),rows=value.rows.map(row=>{check(row.request.network===request.network&&row.request.account===request.account&&!seen.has(row.request.contract),'Holdings account changed.');seen.add(row.request.contract);return tokenWatchSnapshot(row,{...request,contract:row.request.contract},{now});});
 let nativePrice=value.nativePrice??null;
 if(nativePrice){const f=ORACLE_FEEDS.find(f=>f.network===request.network&&f.asset==='ETH'),p=nativePrice;check(f&&p.id===f.id&&p.decimals===f.decimals&&typeof p.answer==='string'&&/^[1-9][0-9]{0,77}$/.test(p.answer)&&BigInt(p.answer)<2n**256n&&Number.isSafeInteger(p.observedAt)&&p.observedAt<=now+5000&&now-p.observedAt<60000&&Number.isSafeInteger(p.updatedAt)&&p.updatedAt>0&&p.updatedAt<=p.observedAt+5000&&p.observedAt-p.updatedAt<=f.heartbeat*1000,'Invalid native price.');nativePrice={id:p.id,answer:p.answer,decimals:p.decimals,updatedAt:p.updatedAt,observedAt:p.observedAt};}
 return {request,rows,nativePrice,partial:value.partial,skipped:value.skipped,observedAt:value.observedAt};
}
