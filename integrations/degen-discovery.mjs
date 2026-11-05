import {degenRequest,DEGEN_INTERVALS,checkedMarket,checkedDiscovery,checkedCandles,checkedTrades,checkedNetworks,chainReference,addressKey,requireData,identifier} from '../web/public/degen-model.js';
const bases={dexscreener:'https://api.dexscreener.com',geckoterminal:'https://api.geckoterminal.com/api/v2'};
export function discoveryURL(input){
  const r=degenRequest(input),base=bases[r.provider];let path;
  if(r.provider==='dexscreener')path=r.kind==='search'?'/latest/dex/search':`/latest/dex/pairs/${r.network}/${r.pool}`;
  else path=r.kind==='networks'?'/networks':r.kind==='search'?'/search/pools':r.kind==='feed'?`/networks/${r.network?r.network+'/':''}${r.feed==='new'?'new_pools':'trending_pools'}`:`/networks/${r.network}/pools/${r.pool}${r.kind==='trades'?'/trades':''}`;
  const url=new URL(base+path);
  if(r.kind==='search')url.searchParams.set(r.provider==='dexscreener'?'q':'query',r.query);
  if(r.kind==='search'&&r.network)url.searchParams.set('network',r.network);
  if(r.kind==='networks')url.searchParams.set('page',String(r.page));
  if(r.provider==='geckoterminal'&&!['networks','trades'].includes(r.kind))url.searchParams.set('include','base_token,quote_token,dex,network');
  return url;
}
async function jsonRead(url,fetchImpl,signal){
  const response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json'},redirect:'error',credentials:'omit',signal:AbortSignal.any([AbortSignal.timeout(12000),...(signal?[signal]:[])])});
  if(response.status===429){const error=Error('Source rate limit'),header=response.headers.get('Retry-After'),seconds=Number(header),date=Date.parse(header);error.providerRetryAfter=Boolean(header)&&(Number.isFinite(seconds)&&seconds>0||Number.isFinite(date)&&date>Date.now());error.retryAfterMs=error.providerRetryAfter?Math.max(1000,Math.min(300000,Number.isFinite(seconds)&&seconds>0?seconds*1000:date-Date.now())):5000;throw error;}
  requireData(response.ok,'Source unavailable');
  const reader=response.body.getReader();let length=0;const chunks=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;length+=value.byteLength;requireData(length<=1500000,'Source response too large');chunks.push(value);}}finally{await reader.cancel();}
  const bytes=new Uint8Array(length);let offset=0;for(const c of chunks){bytes.set(c,offset);offset+=c.length;}return JSON.parse(new TextDecoder().decode(bytes));
}
function normalized(source,network,pool,fields){return checkedMarket({id:`${source}/${network}/${addressKey(pool)}`,source,network,pool,chain:chainReference(source,network),...fields,executable:false});}
export function normalizeDiscovery(provider,raw){
  const rows=[];let candidates;
  if(provider==='dexscreener'){requireData(raw&&Object.hasOwn(raw,'pairs')&&(raw.pairs===null||Array.isArray(raw.pairs)));candidates=raw.pairs??[];}
  else {requireData(raw&&Object.hasOwn(raw,'data')&&(Array.isArray(raw.data)||raw.data?.type==='pool'));candidates=Array.isArray(raw.data)?raw.data:[raw.data];}
  requireData(candidates.length<=1000);
  const included=new Map((Array.isArray(raw.included)?raw.included:[]).map(item=>[item.id,item]));
  for(const p of candidates.slice(0,100)){
    try{
      let row;if(provider==='dexscreener')row=normalized(provider,p.chainId,p.pairAddress,{address:p.baseToken.address,symbol:p.baseToken.symbol,name:p.baseToken.name,quote:p.quoteToken.symbol,venue:p.dexId,price:p.priceUsd,change:p.priceChange?.h24,liquidity:p.liquidity?.usd,volume:p.volume?.h24,marketCap:p.marketCap,fdv:p.fdv,createdAt:p.pairCreatedAt,boosted:p.boosts?.active>0});
      else {
        const a=p.attributes,r=p.relationships,network=identifier(r.network?.data?.id??p.id.split('_')[0]),base=included.get(r.base_token?.data?.id)?.attributes,quote=included.get(r.quote_token?.data?.id)?.attributes;
        requireData(base&&quote);row=normalized(provider,network,a.address,{address:base.address,symbol:base.symbol,name:base.name,quote:quote.symbol,venue:included.get(r.dex?.data?.id)?.attributes?.name??r.dex?.data?.id,price:a.base_token_price_usd,change:a.price_change_percentage?.h24,liquidity:a.reserve_in_usd,volume:a.volume_usd?.h24,marketCap:a.market_cap_usd,fdv:a.fdv_usd,createdAt:a.pool_created_at?Date.parse(a.pool_created_at):null,boosted:false});
      }
      if(!rows.some(r=>r.id===row.id))rows.push(row);if(rows.length===60)break;
    }catch{/* Ignore malformed individual listings without accepting their metadata. */}
  }
  requireData(!candidates.length||rows.length,'No usable source data');return rows;
}
export async function readDegen(input,{fetchImpl=fetch,clock=Date.now,signal}={}){
  const request=degenRequest(input);
  requireData(request.kind!=='candles');
  const raw=await jsonRead(discoveryURL(request).href,fetchImpl,signal);
  if(request.kind==='networks'){requireData(Array.isArray(raw.data)&&raw.data.length<=100);return checkedNetworks({request,networks:raw.data.map(n=>({id:n.id,name:n.attributes?.name})),hasMore:raw.data.length===100,executable:false},request);}
  if(request.kind==='trades')return normalizeTrades(raw,request,clock());
  const rows=normalizeDiscovery(request.provider,raw);
  return checkedDiscovery({version:1,request,observedAt:clock(),rows,executable:false},request,{now:clock()});
}
export function normalizeTrades(raw,request,now=Date.now()){
  degenRequest(request);requireData(Array.isArray(raw?.data)&&raw.data.length<=300);const rows=[],events=new Map();
  for(const event of raw.data){
    requireData(event?.type==='trade');const t=event.attributes,to=addressKey(t.to_token_address),from=addressKey(t.from_token_address),address=addressKey(request.address);
    requireData((to===address)!==(from===address),'Trade token changed');requireData(['buy','sell'].includes(t.kind),'Invalid trade direction');
    // Provider kind describes its base token. The selected token may be the
    // quote, so its direction and quantity come from its own transfer leg.
    const side=to===address?'buy':'sell';
    const row={id:event.id,hash:t.tx_hash,time:Date.parse(t.block_timestamp),side,address:request.address,amount:side==='buy'?t.to_token_amount:t.from_token_amount,price:side==='buy'?t.price_to_in_usd:t.price_from_in_usd,usd:t.volume_in_usd};
    if(events.has(row.id)){requireData(JSON.stringify(events.get(row.id))===JSON.stringify(row),'Conflicting trade event');continue;}events.set(row.id,row);rows.push(row);
  }
  rows.sort((a,b)=>b.time-a.time);return checkedTrades({version:1,request,observedAt:now,trades:rows.slice(0,100),executable:false},request,{now});
}
export async function readDegenCandles(input,{fetchImpl=fetch,clock=Date.now,signal}={}){
  const request=degenRequest(input);requireData(request.kind==='candles');
  const [frame,aggregate]={'1m':['minute',1],'5m':['minute',5],'15m':['minute',15],'30m':['minute',15],'1h':['hour',1],'4h':['hour',4],'1d':['day',1],'1w':['day',1]}[request.interval];
  const url=new URL(`${bases.geckoterminal}/networks/${request.network}/pools/${request.pool}/ohlcv/${frame}`);
  for(const [key,value]of Object.entries({aggregate,limit:request.interval==='1w'?1000:request.interval==='30m'?600:300,currency:'usd',token:request.address,include_empty_intervals:'false'}))url.searchParams.set(key,String(value));
  const result=await jsonRead(url.href,fetchImpl,signal),list=result.data?.attributes?.ohlcv_list;
  // The fixed pool endpoint returns token identities alongside its candles. Bind
  // those to the requested address without a second quota-consuming pool read.
  const base=addressKey(result.meta?.base?.address),quote=addressKey(result.meta?.quote?.address),selected=addressKey(request.address);
  requireData((base===selected)!==(quote===selected),'Pool token changed');requireData(Array.isArray(list)&&list.length<=1000);
  const candles=list.map(c=>{requireData(Array.isArray(c)&&c.length===6);return {time:c[0]*1000,open:c[1],high:c[2],low:c[3],close:c[4],volume:c[5]};}).reverse();
  const sourceInterval=request.interval==='30m'?'15m':request.interval==='1w'?'1d':request.interval;
  for(let start=0;start<candles.length;start+=300)checkedCandles({request:{...request,interval:sourceInterval},observedAt:clock(),candles:candles.slice(start,start+300),executable:false},{...request,interval:sourceInterval},{now:clock()});
  requireData(candles.every((c,i)=>!i||c.time>candles[i-1].time));
  const groups=new Map(),duration=DEGEN_INTERVALS[request.interval],offset=request.interval==='1w'?345600000:0;
  for(const candle of candles){const c=Object.fromEntries(Object.entries(candle).map(([k,v])=>[k,Number(v)])),time=Math.floor((c.time-offset)/duration)*duration+offset,old=groups.get(time);if(old){old.high=Math.max(old.high,c.high);old.low=Math.min(old.low,c.low);old.close=c.close;old.volume+=c.volume;}else groups.set(time,{...c,time});}
  // A truncated first source bucket cannot represent a complete historical aggregate.
  if(sourceInterval!==request.interval&&candles.length){const first=groups.keys().next().value;if(candles[0].time!==first)groups.delete(first);}
  return checkedCandles({version:1,request,observedAt:clock(),candles:[...groups.values()].slice(-300),executable:false},request,{now:clock()});
}
