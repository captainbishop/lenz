import { createHash } from 'node:crypto';
import { readCalldata,readResult } from '../aurora/market-read-codec.mjs';
import { immutable } from '../web/public/defi-catalog.js';
export const MARKET_READS=immutable({
  baseRpc:'https://mainnet.base.org',hyperliquid:'https://api.hyperliquid.xyz/info',
  factory:'0x33128a8fc17869897dce68ed026d694621f6fdfd',
  aavePool:'0xa238dd80c259a72e81d7e4664a9801593f98d1c5',
  tokens:[
    {chainId:'eip155:8453',kind:'erc20',id:'0x4200000000000000000000000000000000000006',symbol:'WETH',decimals:18},
    {chainId:'eip155:8453',kind:'erc20',id:'0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',symbol:'USDC',decimals:6},
  ],
});
const check=(ok,message)=>{if(!ok)throw Error(message);};
const hash=x=>createHash('sha256').update(x).digest('hex');
const hex=x=>typeof x==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(x);
const hash32=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{64}$/.test(x);
const quantity=x=>typeof x==='string'&&/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(x)&&x.length<=66;
const address=x=>typeof x==='string'&&/^0x[0-9a-fA-F]{40}$/.test(x)&&!/^0x0{40}$/i.test(x);
const decimal=x=>typeof x==='string'&&/^-?(?:0|[1-9][0-9]{0,29})(?:\.[0-9]{1,24})?$/.test(x);
export async function marketJson(url,body,{fetcher=fetch,signal=AbortSignal.timeout(20000),maxBytes=1024*1024}={}){
  check([MARKET_READS.baseRpc,MARKET_READS.hyperliquid].includes(url),'Unapproved market endpoint');
  const response=await fetcher(url,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body),redirect:'error',signal});
  if(!response.ok){await response.body?.cancel();throw Error(`Market source HTTP ${response.status}`);}
  check(response.body,'Empty market response');
  const reader=response.body.getReader(),chunks=[];let size=0;
  try {while(true){signal.throwIfAborted();const {value,done}=await reader.read();if(done)break;size+=value.byteLength;check(size<=maxBytes,'Market response too large');chunks.push(value);}}
  finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)));
}
function envelope(provider,rows,evidence,clock){
  const observedAt=clock();
  return immutable({version:1,provider,chainId:provider==='hyperliquid'?'hypercore:mainnet':'eip155:8453',network:'mainnet',kind:'market-observation',observedAt,expiresAt:observedAt+60000,executable:false,rows,evidence,
    scope:'Public read-only discovery. No quote, signing, reservation, transaction or position access.',
  });
}
export async function discoverHyperliquid({fetcher=fetch,clock=Date.now}={}){
  const data=await marketJson(MARKET_READS.hyperliquid,{type:'metaAndAssetCtxs',dex:''},{fetcher});
  check(Array.isArray(data)&&data.length===2,'Invalid Hyperliquid response');
  const [meta,contexts]=data,universe=meta?.universe;
  check(Array.isArray(universe)&&universe.length>0&&universe.length<=2000&&Array.isArray(contexts)&&contexts.length===universe.length,'Misaligned Hyperliquid market contexts');
  check(Number.isSafeInteger(meta.collateralToken)&&meta.collateralToken>=0,'Missing venue collateral token');
  const names=new Set();
  const rows=universe.map((m,i)=>{
    check(m&&typeof m.name==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._/-]{0,39}$/.test(m.name)&&!names.has(m.name),'Invalid or duplicate instrument');names.add(m.name);
    check(Number.isInteger(m.szDecimals)&&m.szDecimals>=0&&m.szDecimals<=12&&Number.isInteger(m.maxLeverage)&&m.maxLeverage>=1&&m.maxLeverage<=100,'Invalid venue precision/leverage');
    check((m.isDelisted===undefined||typeof m.isDelisted==='boolean')&&(m.onlyIsolated===undefined||typeof m.onlyIsolated==='boolean'),'Invalid venue market flags');
    const c=contexts[i];check(c&&['markPx','oraclePx','funding','openInterest'].every(k=>decimal(c[k])),'Invalid venue prices or funding');
    check(Number(c.markPx)>=0&&Number(c.oraclePx)>=0&&Number(c.openInterest)>=0,'Negative venue price or interest');
    return {id:`hyperliquid:${i}:${m.name}`,marketId:'hyperliquid',category:'perpetuals',chainId:'hypercore:mainnet',label:`${m.name} perpetual`,instrument:m.name,venueIndex:i,sizeDecimals:m.szDecimals,maxLeverage:m.maxLeverage,collateralToken:meta.collateralToken,isolatedOnly:m.onlyIsolated===true,status:m.isDelisted?'delisted':'listed',markPrice:c.markPx,oraclePrice:c.oraclePx,funding:c.funding,openInterest:c.openInterest,executable:false};
  });
  return envelope('hyperliquid',rows,{source:MARKET_READS.hyperliquid,method:'metaAndAssetCtxs',dex:'',assurance:'provider-https',providerTimestamp:null,statement:'The provider supplies no timestamp in this response; observation time is the local receipt time.',responseSha256:hash(JSON.stringify(data))},clock);
}
export async function baseSnapshot(options,recent=false){
  const {fetcher=fetch,clock=Date.now}=options,signal=AbortSignal.timeout(40000);let id=0;
  async function rpc(method,params){
    check(['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'].includes(method),'Unsupported market RPC method');
    const request={jsonrpc:'2.0',id:++id,method,params};
    const response=await marketJson(MARKET_READS.baseRpc,request,{fetcher,signal,maxBytes:256*1024});
    check(response?.jsonrpc==='2.0'&&response.id===request.id&&!response.error&&Object.hasOwn(response,'result'),'Invalid market RPC response');return response.result;
  }
  check(await rpc('eth_chainId',[])==='0x2105','Wrong market chain');
  const block=await rpc('eth_getBlockByNumber',[recent?'latest':'finalized',false]);
  check(block&&quantity(block.number)&&quantity(block.timestamp)&&hash32(block.hash),'Invalid finalized block');
  const timestamp=Number(BigInt(block.timestamp))*1000;
  check(Number.isSafeInteger(timestamp)&&timestamp>=clock()-(recent?60000:3600000)&&timestamp<=clock()+(recent?5000:60000),'Stale or future block');
  const tag={blockHash:block.hash,requireCanonical:true},codeHashes={};
  async function code(to){check(address(to),'Invalid contract');const bytes=await rpc('eth_getCode',[to,tag]);check(hex(bytes),'Market contract has no code');codeHashes[to]=hash(Buffer.from(bytes.slice(2),'hex'));}
  async function call(to,method,args=[],gas){
    const data=await rpc('eth_call',[{to,data:readCalldata(method,args),...(gas?{gas}:{})},tag]);check(hex(data),'Invalid contract response');return readResult(method,data);
  }
  await Promise.all(MARKET_READS.tokens.map(async token=>{await code(token.id);check(Number((await call(token.id,'decimals'))[0])===token.decimals,'Token decimals differ from reviewed identity');}));
  async function finish(){const current=await rpc('eth_getBlockByNumber',[block.number,false]);check(current?.hash===block.hash,'Market block changed during read');return {source:MARKET_READS.baseRpc,assurance:recent?'rpc-latest-block':'rpc-finalized-block',blockHash:block.hash,blockNumber:BigInt(block.number).toString(),blockTimestamp:timestamp,codeSha256:codeHashes,statement:'RPC-authenticated chain and code observations, not independent light-client verification or a code audit.'};}
  return {code,call,finish,clock};
}
export async function discoverUniswap(options={}){
  const s=await baseSnapshot(options),[weth,usdc]=MARKET_READS.tokens;
  await s.code(MARKET_READS.factory);
  const pool=(await s.call(MARKET_READS.factory,'getPool',[weth.id,usdc.id,500]))[0].toLowerCase();
  check(address(pool),'Reviewed Uniswap pool is unavailable');await s.code(pool);
  const [t0,t1,fee,liquidity,slot]=await Promise.all(['token0','token1','fee','liquidity','slot0'].map(name=>s.call(pool,name)));
  check(t0[0].toLowerCase()===weth.id&&t1[0].toLowerCase()===usdc.id&&fee[0]===500n,'Uniswap pool identity mismatch');
  const rows=[{id:`uniswap:${pool}`,marketId:'uniswap',category:'liquidity',chainId:'eip155:8453',label:'WETH / USDC',address:pool,version:'v3',assets:MARKET_READS.tokens,feePips:500,liquidity:liquidity[0].toString(),sqrtPriceX96:slot[0].toString(),tick:Number(slot[1]),status:liquidity[0]>0n&&slot[0]>0n&&slot[6]?'liquidity-observed':'unavailable',executable:false}];
  return envelope('uniswap',rows,await s.finish(),s.clock);
}
export async function discoverAave(options={}){
  const s=await baseSnapshot(options);await s.code(MARKET_READS.aavePool);
  const reserves=(await s.call(MARKET_READS.aavePool,'getReservesList'))[0].map(x=>x.toLowerCase());
  check(reserves.length>0&&reserves.length<=256&&new Set(reserves).size===reserves.length,'Invalid Aave reserve list');
  const rows=await Promise.all(MARKET_READS.tokens.map(async token=>{
    check(reserves.includes(token.id),'Reviewed asset is not an Aave reserve');
    const bits=(await s.call(MARKET_READS.aavePool,'getConfiguration',[token.id]))[0],flag=n=>(bits&(1n<<BigInt(n)))!==0n;
    check(Number((bits>>48n)&255n)===token.decimals,'Aave reserve decimals mismatch');
    return {id:`aave:${token.id}`,marketId:'aave',category:'credit',chainId:'eip155:8453',label:`${token.symbol} reserve`,address:MARKET_READS.aavePool,version:'v3',assets:[token],ltvBps:Number(bits&65535n),liquidationThresholdBps:Number((bits>>16n)&65535n),active:flag(56),frozen:flag(57),borrowingEnabled:flag(58),paused:flag(60),status:!flag(56)?'inactive':flag(60)?'paused':flag(57)?'frozen':'listed',executable:false};
  }));
  check(rows.every(r=>r.ltvBps<=10000&&r.liquidationThresholdBps<=10000),'Invalid reserve risk parameters');
  return envelope('aave',rows,await s.finish(),s.clock);
}
export async function discoverMarket(provider,options={}){
  const readers={uniswap:discoverUniswap,aave:discoverAave,hyperliquid:discoverHyperliquid};
  check(Object.hasOwn(readers,provider),'Unsupported discovery provider');return readers[provider](options);
}
