import {bytes,hex,unhex} from './peer-crypto.js';
export const TOKEN_NETWORKS=Object.freeze({ethereum:{name:'Ethereum',explorer:'https://etherscan.io/token/'},arbitrum:{name:'Arbitrum',explorer:'https://arbiscan.io/token/'},base:{name:'Base',explorer:'https://basescan.org/token/'},solana:{name:'Solana',explorer:'https://solscan.io/token/'},near:{name:'NEAR',explorer:'https://nearblocks.io/token/'}});
const check=(ok,message)=>{if(!ok)throw Error(message);};
const exact=(o,fields)=>o&&Object.getPrototypeOf(o)===Object.prototype&&Object.keys(o).sort().join(',')===[...fields].sort().join(',');
export function tokenAddressNetworks(contract){
 if(typeof contract!=='string')return [];
 if(/^0x[0-9a-fA-F]{40}$/.test(contract)&&!/^0x0{40}$/i.test(contract))return ['ethereum','arbitrum','base'];
 if(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(contract)){
  let value=0n;const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';for(const c of contract)value=value*58n+BigInt(alphabet.indexOf(c));
  const zeros=contract.match(/^1*/)[0].length,length=value===0n?0:Math.ceil(value.toString(16).length/2);if(zeros+length===32)return ['solana'];
 }
 if(contract.length<=64&&/^[a-z0-9]+(?:[-_][a-z0-9]+)*(?:\.[a-z0-9]+(?:[-_][a-z0-9]+)*)*\.near$/.test(contract))return ['near'];
 return [];
}
export function tokenMetadataRequest(input){
 check(exact(input,['contract']),'Invalid token lookup.');const networks=tokenAddressNetworks(input.contract);check(networks.length,'Use an EVM contract, Solana mint or NEAR token account.');
 return {contract:networks[0]==='ethereum'?input.contract.toLowerCase():input.contract};
}
export function tokenMetadata(value,{cached=false,now=Date.now()}={}){
 check(exact(value,['network','contract','name','symbol','decimals','observedAt']),'Invalid token details.');
 check(tokenAddressNetworks(value.contract).includes(value.network),'Token network does not match its address.');
 for(const [field,max] of [['name',80],['symbol',24]])check(typeof value[field]==='string'&&value[field].trim().length>0&&value[field].length<=max&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(value[field]),'Invalid token '+field+'.');
 check(Number.isInteger(value.decimals)&&value.decimals>=0&&value.decimals<=36,'Invalid token decimals.');
 check(Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=now+5000&&(cached||now-value.observedAt<60000),'Token details need updating.');
 return Object.freeze({...value});
}
export function tokenMetadataResult(value,input){
 const request=tokenMetadataRequest(input),networks=tokenAddressNetworks(request.contract);
 check(exact(value,['request','matches','unavailable'])&&JSON.stringify(tokenMetadataRequest(value.request))===JSON.stringify(request)&&Array.isArray(value.matches)&&value.matches.length<=networks.length&&Array.isArray(value.unavailable)&&value.unavailable.every(n=>networks.includes(n)),'Token lookup changed.');
 const seen=new Set(),matches=value.matches.map(row=>{const metadata=tokenMetadata(row);check(metadata.contract===request.contract&&!seen.has(metadata.network),'Token lookup changed.');seen.add(metadata.network);return metadata;});
 return {request,matches,unavailable:[...value.unavailable]};
}
const aad=s=>bytes(['lenz-token-metadata-v1',s.identity.profile.id]);
export async function readTokenMetadata(s){
 if(!s.tokenMetadataBox)return [];
 check(s.identity&&s.tokenMetadataKey,'Token storage is unavailable.');
 const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(s.tokenMetadataBox.iv),additionalData:aad(s)},s.tokenMetadataKey,unhex(s.tokenMetadataBox.ciphertext)),rows=JSON.parse(new TextDecoder().decode(plain));
 check(Array.isArray(rows)&&rows.length<=30,'Invalid token list.');return rows.map(row=>tokenMetadata(row,{cached:true}));
}
export async function saveTokenMetadata(s,rows){
 check(s.identity&&Array.isArray(rows)&&rows.length<=30,'Token list is full.');const checked=rows.map(row=>tokenMetadata(row,{cached:true}));
 s.tokenMetadataKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 const iv=crypto.getRandomValues(new Uint8Array(12)),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.tokenMetadataKey,bytes(checked));
 s.tokenMetadataBox={iv:hex(iv),ciphertext:hex(ciphertext)};
}
