import {marketFetch} from './market-http.mjs';
import {tokenWatchRequest} from '../web/public/token-watch.js';
import {tokenMarket} from '../web/public/token-market.js';
export async function readTokenMarket(input,{fetcher=marketFetch,clock=Date.now}={}){
 const request=tokenWatchRequest(input);
 // Only the contract and network leave Lenz for market data, never the holder.
 const response=await fetcher('https://api.dexscreener.com/token-pairs/v1/'+request.network+'/'+request.contract,{method:'GET',headers:{accept:'application/json'},redirect:'error',signal:AbortSignal.timeout(8000)});
 if(!response.ok)throw Error('Token market unavailable.');
 const reader=response.body.getReader(),chunks=[];let size=0;
 try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>500000)throw Error('Token market response too large.');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
 const raw=JSON.parse(new TextDecoder().decode(Buffer.concat(chunks)));
 return tokenMarket(raw,request,{now:clock()});
}
