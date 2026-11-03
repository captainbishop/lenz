import {marketJson} from './market-discovery.mjs';
import {marketNetwork} from '../web/public/evm-markets.js';
import {tokenWatchRequest,tokenWatchSnapshot,tokenPriceFeed} from '../web/public/token-watch.js';
import {tokenCalldata,tokenResult} from '../aurora/token-read-codec.mjs';
import {readOraclePrices} from './oracle-prices.mjs';
const check=(ok,message)=>{if(!ok)throw Error(message);};
export async function readTokenWatch(input,{fetcher,clock=Date.now,oracle=readOraclePrices}={}){
 const request=tokenWatchRequest(input),network=marketNetwork(request.network),signal=AbortSignal.timeout(45000);let id=0;
 const rpc=async(method,params)=>{const q={jsonrpc:'2.0',id:++id,method,params},r=await marketJson(network.rpc,q,{fetcher,signal,maxBytes:method==='eth_getBlockByNumber'?1024*1024:method==='eth_getCode'?65536:16384});check(r?.jsonrpc==='2.0'&&r.id===q.id&&!r.error,'Token RPC rejected');return r.result;};
 check(await rpc('eth_chainId',[])==='0x'+BigInt(network.chainId.split(':')[1]).toString(16),'Wrong token network');
 const block=await rpc('eth_getBlockByNumber',['latest',false]);
 check(block&&/^0x[0-9a-f]{64}$/.test(block.hash)&&/^0x[0-9a-f]{1,16}$/.test(block.timestamp)&&/^0x[0-9a-f]{1,16}$/.test(block.number),'Invalid token block');
 const timestamp=Number(BigInt(block.timestamp))*1000;check(timestamp<=clock()+5000&&clock()-timestamp<60000,'Stale token block');
 const tag={blockHash:block.hash,requireCanonical:true};
 check(/^0x(?:[0-9a-f]{2})+$/i.test(await rpc('eth_getCode',[request.contract,tag])),'No token contract');
 const call=async(method,args=[])=>tokenResult(method,await rpc('eth_call',[{to:request.contract,data:tokenCalldata(method,args),gas:'0x186a0'},tag]));
 const [name,symbol,decimals,balance]=await Promise.all([call('name'),call('symbol'),call('decimals'),request.account?call('balanceOf',[request.account]):null]);
 check((await rpc('eth_getBlockByNumber',[block.number,false]))?.hash===block.hash,'Token block changed');
 let price=null;const f=tokenPriceFeed(request);
 if(f){try{const result=await oracle({network:request.network},{fetcher,clock}),row=result.feeds.find(r=>r.id===f.id&&r.status==='current');if(row)price={id:row.id,answer:row.answer,decimals:row.decimals,updatedAt:row.updatedAt,observedAt:result.observedAt};}catch{signal.throwIfAborted();}}
 return tokenWatchSnapshot({kind:'token-watch',request,name,symbol,decimals:Number(decimals),balance:balance?.toString()??null,price,blockHash:block.hash,blockNumber:BigInt(block.number).toString(),observedAt:clock(),executable:false},request,{now:clock()});
}
