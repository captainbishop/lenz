import {assetDiscoveryRequest,assetDiscoverySnapshot} from '../web/public/asset-discovery.js';
import {readTokenWatch} from './token-watch.mjs';
import {readOraclePrices} from './oracle-prices.mjs';
import {marketFetch} from './market-http.mjs';
const hosts={ethereum:'eth.blockscout.com',arbitrum:'arbitrum.blockscout.com',base:'base.blockscout.com'};
export async function discoverWalletAssets(input,{fetcher=marketFetch,read=readTokenWatch,oracle=readOraclePrices,clock=Date.now}={}){
 const request=assetDiscoveryRequest(input),signal=AbortSignal.timeout(45000),url=`https://${hosts[request.network]}/api/v2/addresses/${request.account}/tokens?type=ERC-20`;
 const response=await fetcher(url,{method:'GET',headers:{accept:'application/json'},redirect:'error',signal});
 if(!response.ok){await response.body?.cancel();throw Error('Token discovery unavailable.');}
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>524288)throw Error('Token list too large.');chunks.push(value);}}finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 const data=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
 if(!data||!Array.isArray(data.items)||data.items.length>50)throw Error('Invalid token discovery.');
 const candidates=new Set();let skipped=0;
 for(const item of data.items){const t=item?.token;if(t?.type!=='ERC-20'||t.reputation==='scam'||t.reputation==='spam'||typeof t.address_hash!=='string'||!/^0x[0-9a-f]{40}$/i.test(t.address_hash)||/^0x0{40}$/i.test(t.address_hash)){skipped++;continue;}candidates.add(t.address_hash.toLowerCase());}
 const contracts=[...candidates].slice(0,24),prices=Promise.resolve().then(()=>oracle({network:request.network},{fetcher,clock})).catch(()=>null),rows=[];let index=0,failed=0;
 await Promise.all(Array.from({length:Math.min(3,contracts.length)},async()=>{while(index<contracts.length){const contract=contracts[index++];try{signal.throwIfAborted();rows.push(await read({...request,contract},{fetcher,clock,signal,oracle:()=>prices}));}catch{failed++;}}}));
 const result=await prices,native=result?.feeds.find(f=>f.id===request.network+':ETH'&&f.status==='current');
 const nativePrice=native?{id:native.id,answer:native.answer,decimals:native.decimals,updatedAt:native.updatedAt,observedAt:result.observedAt}:null;
 return assetDiscoverySnapshot({request,rows,nativePrice,partial:!!data.next_page_params||candidates.size>24||failed>0,skipped:skipped+failed,observedAt:clock()},request,{now:clock()});
}
