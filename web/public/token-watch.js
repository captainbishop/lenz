import {marketNetwork} from './evm-markets.js';
import {immutable} from './defi-catalog.js';
import {ORACLE_FEEDS} from './oracle-feeds.js';
import {bytes,hex,unhex} from './peer-crypto.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const exact=(o,keys)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join(',')===[...keys].sort().join(',');
const addr=v=>typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v)&&!/^0x0{40}$/.test(v);
const uint=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<2n**256n;
export function tokenWatchRequest(value){
 check(exact(value,['network','contract','account','publicConsent'])&&value.publicConsent===true,'Allow the network lookup first.');marketNetwork(value.network);
 check(addr(value.contract)&&(value.account===null||addr(value.account)),'Enter a valid contract and wallet address.');
 return immutable({network:value.network,contract:value.contract.toLowerCase(),account:value.account?.toLowerCase()??null,publicConsent:true});
}
export function tokenPriceFeed(request){
 const token=marketNetwork(request.network).tokens.find(t=>t.id===request.contract);
 return token?ORACLE_FEEDS.find(f=>f.network===request.network&&f.asset===(token.symbol==='WETH'?'ETH':token.symbol)):null;
}
export function tokenWatchSnapshot(value,request,{now=Date.now(),cached=false}={}){
 request=tokenWatchRequest(request);
 check(exact(value,['kind','request','name','symbol','decimals','balance','price','blockHash','blockNumber','observedAt','executable'])&&value.kind==='token-watch'&&value.executable===false,'Invalid token read.');
 check(JSON.stringify(tokenWatchRequest(value.request))===JSON.stringify(request),'Token read changed.');
 for(const [key,max] of [['name',80],['symbol',24]])check(typeof value[key]==='string'&&value[key].trim().length>0&&value[key].length<=max&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value[key]),'Invalid token label.');
 check(Number.isInteger(value.decimals)&&value.decimals>=0&&value.decimals<=36,'Invalid token decimals.');
 const known=marketNetwork(request.network).tokens.find(t=>t.id===request.contract);check(!known||value.decimals===known.decimals,'Token precision changed.');
 check(request.account?uint(value.balance):value.balance===null,'Invalid token balance.');
 check(/^0x[0-9a-f]{64}$/.test(value.blockHash)&&uint(value.blockNumber),'Invalid token block.');
 check(Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=now+5000&&(cached||now-value.observedAt<60000),'Token data needs updating.');
 if(value.price!==null){
  const f=tokenPriceFeed(request),p=value.price;
  check(f&&exact(p,['id','answer','decimals','updatedAt','observedAt'])&&p.id===f.id&&p.decimals===f.decimals&&uint(p.answer)&&BigInt(p.answer)>0n,'No verified price for this contract.');
  check(Number.isSafeInteger(p.observedAt)&&p.observedAt<=now+5000&&Number.isSafeInteger(p.updatedAt)&&p.updatedAt>0&&p.updatedAt<=p.observedAt+5000&&p.observedAt-p.updatedAt<=f.heartbeat*1000&&(cached||now-p.observedAt<60000),'Token price needs updating.');
 }
 return immutable(structuredClone(value));
}
export function tokenDecimal(units,decimals){const s=units.padStart(decimals+1,'0');if(!decimals)return s;const fraction=s.slice(-decimals).replace(/0+$/,'');return s.slice(0,-decimals)+(fraction?'.'+fraction:'');}
export function tokenUsd(value){
 if(value.balance===null||value.price===null)return null;
 // Integer cents, rounded down; never convert token quantities through Number.
 const cents=BigInt(value.balance)*BigInt(value.price.answer)*100n/10n**BigInt(value.decimals+value.price.decimals);
 return (cents/100n).toString()+'.'+(cents%100n).toString().padStart(2,'0');
}
const aad=s=>bytes(['lenz-token-watch-v1',s.identity.profile.id]);
export async function readTokenWatch(s){
 if(!s.tokenWatchBox)return [];
 check(s.identity&&s.tokenWatchKey,'Token storage is unavailable.');
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(s.tokenWatchBox.iv),additionalData:aad(s)},s.tokenWatchKey,unhex(s.tokenWatchBox.ciphertext));
 const rows=JSON.parse(new TextDecoder().decode(plain));check(Array.isArray(rows)&&rows.length<=30,'Invalid token list.');return rows.map(r=>tokenWatchSnapshot(r,r.request,{cached:true}));
}
export async function saveTokenWatch(s,rows){
 check(s.identity&&Array.isArray(rows)&&rows.length<=30,'Token list is full.');
 const checked=rows.map(r=>tokenWatchSnapshot(r,r.request,{cached:true}));
 s.tokenWatchKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.tokenWatchKey,bytes(checked));
 s.tokenWatchBox={iv:hex(iv),ciphertext:hex(ciphertext)};
}
