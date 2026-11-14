import {createHash} from 'node:crypto';
import {ed25519} from '../web/near-connector/node_modules/@noble/curves/ed25519.js';
import {marketJson} from './market-discovery.mjs';
import {readTokenWatch} from './token-watch.mjs';
import {tokenAddressNetworks,tokenMetadataRequest,tokenMetadata} from '../web/public/token-metadata.js';
import {METADATA_RPC} from './market-http.mjs';
const check=(ok,message)=>{if(!ok)throw Error(message);},alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const b58decode=text=>{check(typeof text==='string'&&/^[1-9A-HJ-NP-Za-km-z]{1,44}$/.test(text),'Invalid public key');let n=0n;for(const c of text)n=n*58n+BigInt(alphabet.indexOf(c));const body=n?Buffer.from(n.toString(16).padStart(Math.ceil(n.toString(16).length/2)*2,'0'),'hex'):Buffer.alloc(0);return Buffer.concat([Buffer.alloc(text.match(/^1*/)[0].length),body]);};
const b58encode=bytes=>{let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),out='';while(n){out=alphabet[Number(n%58n)]+out;n/=58n;}for(const b of bytes){if(b)break;out='1'+out;}return out;};
const METAPLEX='metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s',SPL='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',SPL2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export function solanaMetadataAddress(mint){
 const program=b58decode(METAPLEX),key=b58decode(mint);check(key.length===32,'Invalid Solana mint');
 for(let bump=255;bump>=0;bump--){const hash=createHash('sha256').update(Buffer.concat([Buffer.from('metadata'),program,key,Buffer.from([bump]),program,Buffer.from('ProgramDerivedAddress')])).digest();let onCurve=true;try{ed25519.Point.fromBytes(hash);}catch{onCurve=false;}if(!onCurve)return b58encode(hash);}
 throw Error('Metadata address unavailable');
}
function decodeMetaplex(value,mint){
 check(value?.owner===METAPLEX&&value.executable===false&&Array.isArray(value.data)&&value.data[1]==='base64'&&typeof value.data[0]==='string'&&value.data[0].length<=8192,'Token metadata unavailable');
 const data=Buffer.from(value.data[0],'base64');check(data.length>=73&&data[0]===4&&data.subarray(33,65).equals(b58decode(mint)),'Metadata mint changed');let offset=65;
 const readText=max=>{check(offset+4<=data.length,'Truncated token metadata');const size=data.readUInt32LE(offset);offset+=4;check(size<=max&&offset+size<=data.length,'Invalid metadata text');const text=new TextDecoder('utf-8',{fatal:true}).decode(data.subarray(offset,offset+size)).replace(/\0+$/,'').trim();offset+=size;return text;};
 return {name:readText(32),symbol:readText(10)};
}
export async function readTokenMetadata(network,contract,{fetcher,clock=Date.now,signal=AbortSignal.timeout(12000)}={}){
 let id=0;const rpc=async(method,params)=>{const q={jsonrpc:'2.0',id:++id,method,params},r=await marketJson(METADATA_RPC[network],q,{fetcher,signal,maxBytes:65536});check(r?.jsonrpc==='2.0'&&r.id===q.id&&!r.error,'Token metadata source unavailable');return r.result;};
 let name,symbol,decimals;
 if(network==='solana'){
  check(await rpc('getGenesisHash',[])==='5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d','Wrong Solana network');
  const r=await rpc('getAccountInfo',[contract,{encoding:'jsonParsed',commitment:'finalized'}]),v=r?.value,info=v?.data?.parsed?.info;
  check(Number.isSafeInteger(r?.context?.slot)&&v?.executable===false&&[SPL,SPL2022].includes(v?.owner)&&v.data.parsed?.type==='mint'&&info?.isInitialized===true,'Not an initialized Solana token mint');decimals=info.decimals;
  const extension=v.owner===SPL2022&&info.extensions?.find(x=>x.extension==='tokenMetadata')?.state;
  if(extension){check(extension.mint===contract,'Metadata mint changed');({name,symbol}=extension);}
  else {const metadata=await rpc('getAccountInfo',[solanaMetadataAddress(contract),{encoding:'base64',commitment:'finalized',minContextSlot:r.context.slot}]);check(metadata?.context?.slot>=r.context.slot,'Stale token metadata');({name,symbol}=decodeMetaplex(metadata.value,contract));}
 }else if(network==='near'){
  check((await rpc('status',[]))?.chain_id==='mainnet','Wrong NEAR network');
  const r=await rpc('query',{request_type:'call_function',finality:'final',account_id:contract,method_name:'ft_metadata',args_base64:'e30='});
  check(Number.isSafeInteger(r?.block_height)&&b58decode(r.block_hash).length===32&&Array.isArray(r.result)&&r.result.length<=16384&&r.result.every(x=>Number.isInteger(x)&&x>=0&&x<=255),'Invalid NEAR metadata response');
  const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(r.result)));check(data.spec==='ft-1.0.0','Unsupported NEAR token metadata');({name,symbol,decimals}=data);
 }else{
  const row=await readTokenWatch({network,contract,account:null,publicConsent:true},{fetcher,clock,signal,enrich:false});({name,symbol,decimals}=row);
 }
 return tokenMetadata({network,contract,name,symbol,decimals,observedAt:clock()},{now:clock()});
}
export async function resolveTokenMetadata(input,{read=readTokenMetadata,...options}={}){
 const request=tokenMetadataRequest(input),networks=tokenAddressNetworks(request.contract),matches=[],unavailable=[];
 const results=await Promise.allSettled(networks.map(network=>read(network,request.contract,options)));
 results.forEach((result,i)=>{if(result.status==='fulfilled')matches.push(result.value);else if(result.reason?.message!=='No token contract')unavailable.push(networks[i]);});
 return {request,matches,unavailable};
}
