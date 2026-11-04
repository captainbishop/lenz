import {degenRequest,checkedMarket,checkedDiscovery,checkedCandles,chainReference,addressKey,requireData,identifier} from '../web/public/degen-model.js';
const bases={dexscreener:'https://api.dexscreener.com',geckoterminal:'https://api.geckoterminal.com/api/v2'};
export function discoveryURL(input){
  const r=degenRequest(input),base=bases[r.provider];let path;
  if(r.provider==='dexscreener')path=r.kind==='search'?'/latest/dex/search':`/latest/dex/pairs/${r.network}/${r.pool}`;
  else path=r.kind==='search'?'/search/pools':r.kind==='feed'?`/networks/${r.feed==='new'?'new_pools':'trending_pools'}`:`/networks/${r.network}/pools/${r.pool}`;
  const url=new URL(base+path);
  if(r.kind==='search')url.searchParams.set(r.provider==='dexscreener'?'q':'query',r.query);
  if(r.provider==='geckoterminal')url.searchParams.set('include','base_token,quote_token,dex,network');
  return url;
}
async function jsonRead(url,fetchImpl){
  const response=await fetchImpl(url,{method:'GET',headers:{accept:'application/json'},redirect:'error',credentials:'omit',signal:AbortSignal.timeout(12000)});
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
export async function readDegen(input,{fetchImpl=fetch,clock=Date.now}={}){
  const request=degenRequest(input);
  requireData(request.kind!=='candles');
  const raw=await jsonRead(discoveryURL(request).href,fetchImpl),rows=normalizeDiscovery(request.provider,raw);
  return checkedDiscovery({version:1,request,observedAt:clock(),rows,executable:false},request,{now:clock()});
}
export async function readDegenCandles(input,{fetchImpl=fetch,clock=Date.now}={}){
  const request=degenRequest(input);requireData(request.kind==='candles');
  const raw=await jsonRead(discoveryURL({provider:'geckoterminal',kind:'pool',network:request.network,pool:request.pool}).href,fetchImpl);
  const rows=normalizeDiscovery('geckoterminal',raw);requireData(rows.length===1&&rows[0].network===request.network&&addressKey(rows[0].pool)===addressKey(request.pool)&&addressKey(rows[0].address)===addressKey(request.address),'Pool token changed');
  const [frame,aggregate]={'5m':['minute',5],'1h':['hour',1],'1d':['day',1]}[request.interval];
  const url=new URL(`${bases.geckoterminal}/networks/${request.network}/pools/${request.pool}/ohlcv/${frame}`);
  for(const [key,value]of Object.entries({aggregate,limit:96,currency:'usd',token:'base',include_empty_intervals:'false'}))url.searchParams.set(key,String(value));
  const result=await jsonRead(url.href,fetchImpl),list=result.data?.attributes?.ohlcv_list;requireData(Array.isArray(list)&&list.length<=100);
  const candles=list.map(c=>{requireData(Array.isArray(c)&&c.length===6);return {time:c[0]*1000,open:c[1],high:c[2],low:c[3],close:c[4],volume:c[5]};}).reverse();
  return checkedCandles({version:1,request,observedAt:clock(),candles,executable:false},request,{now:clock()});
}
