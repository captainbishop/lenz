import {HYPERLIQUID,checkedHyperliquidDomain} from './hyperliquid-environment.js';
export const PREDICTION_PROVIDERS=Object.freeze({polymarket:'Polymarket',kalshi:'Kalshi',hyperliquid:'Hyperliquid testnet'});
const check=value=>{if(!value)throw Error('Invalid prediction data');};
const text=(value,max=1000)=>typeof value==='string'?value.trim().slice(0,max):'';
const numeric=value=>(typeof value==='number'||typeof value==='string'&&value.trim()!=='')&&Number.isFinite(Number(value))&&Number(value)>=0?Number(value):null;
const chance=value=>{const n=numeric(value);return n!==null&&n<=1?n:null;};
const date=value=>Number.isFinite(Date.parse(value))?Date.parse(value):null;
const array=value=>{try{const a=typeof value==='string'?JSON.parse(value):value;return Array.isArray(a)?a:[];}catch{return [];}};
const sum=values=>values.length&&values.every(v=>v!==null)?values.reduce((a,b)=>a+b,0):null;
export function predictionImageURL(value){
 try{const u=new URL(value);return typeof value==='string'&&value.length<=1024&&u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['polymarket-upload.s3.us-east-2.amazonaws.com','images.polymarket.com','assets.kalshi.com'].includes(u.hostname)?u.href:null;}catch{return null;}
}
function category(value){
 const s=String(value).toLowerCase();
 return /crypto|bitcoin|ethereum|defi/.test(s)?'Crypto':/sport|nba|nfl|soccer|esport|games|league|football|baseball|hockey|tennis|\blol\b|la liga|bundesliga|serie a|ligue 1/.test(s)?'Sports':/politic|election|government/.test(s)?'Politics':/econom|financ|business|inflation|federal open market|interest rate|\bipo\b|market cap/.test(s)?'Economy':/tech|science|climate/.test(s)?'Science & tech':/culture|entertain|music|movie/.test(s)?'Culture':'Other';
}
function publicURL(provider,value){
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&u.hostname==='polymarket.com'&&provider==='polymarket'&&/^\/event\/[a-zA-Z0-9_-]+$/.test(u.pathname)?u.href:null;}catch{return null;}
}
export function normalizePredictions(provider,data,observedAt=Date.now()){
 check(Object.hasOwn(PREDICTION_PROVIDERS,provider));
  if(provider==='hyperliquid')checkedHyperliquidDomain(data);
 const source=provider==='polymarket'?(Array.isArray(data)?data:data?.events):provider==='kalshi'?data?.events:data?.rows;
 check(Array.isArray(source));const events=[];
 for(const e of source){
  if(events.length>=10000)break;
  if(provider==='polymarket'){
   if(e.active!==true||e.closed!==false||e.ended===true)continue;
   const markets=array(e.markets).filter(m=>m.active===true&&m.closed===false&&m.acceptingOrders===true).slice(0,500).map(m=>{
    const labels=array(m.outcomes),prices=array(m.outcomePrices);if(labels.length<2||labels.length>20||prices.length!==labels.length)return null;
    return {id:String(m.id),title:text(m.groupItemTitle||m.question),question:text(m.question),rules:text(m.description,12000),endsAt:date(m.endDate),basis:'Market price',outcomes:labels.map((name,i)=>({name:text(name,200),probability:chance(prices[i])}))};
   }).filter(Boolean);
   if(Array.isArray(e.markets)&&!markets.length)continue;
   events.push({id:`polymarket:${e.id}`,provider,title:text(e.title),category:category(array(e.tags).map(t=>t.label).join(' ')),image:predictionImageURL(e.image||e.icon),url:typeof e.slug==='string'?publicURL(provider,`https://polymarket.com/event/${e.slug}`):null,endsAt:date(e.endDate),volume:numeric(e.volume24hr),totalVolume:numeric(e.volume),liquidity:numeric(e.liquidity),openInterest:numeric(e.openInterest),volumeUnit:'USD',markets,hydrated:Array.isArray(e.markets),hyperId:null,description:text(e.description,12000),observedAt});
  }else if(provider==='kalshi'){
   const active=array(e.markets).filter(m=>m.status==='active');
   const markets=active.slice(0,500).map(m=>{
    // Quotes are dollar amounts for the stated payout. A missing/zero bid is not a 0% forecast.
    const payout=numeric(m.notional_value_dollars),bid=numeric(m.yes_bid_dollars),ask=numeric(m.yes_ask_dollars);
    const p=payout>0&&bid>0&&ask>0&&ask>=bid?chance((bid+ask)/(2*payout)):null;
    return {id:text(m.ticker,160),title:text(m.yes_sub_title||m.title),question:text(m.title),rules:text([m.rules_primary,m.rules_secondary,m.can_close_early?m.early_close_condition:''].filter(Boolean).join('\n\n'),12000),endsAt:date(m.close_time),basis:'Bid / ask midpoint',outcomes:[{name:'Yes',probability:p},{name:'No',probability:p===null?null:1-p}]};
   });
   if(Array.isArray(e.markets)&&!markets.length)continue;
   events.push({id:`kalshi:${e.event_ticker}`,provider,title:text(e.title),category:category(e.category),image:null,url:null,endsAt:Math.min(...markets.map(m=>m.endsAt??Infinity))===Infinity?null:Math.min(...markets.map(m=>m.endsAt??Infinity)),volume:sum(active.map(m=>numeric(m.volume_24h_fp))),totalVolume:sum(active.map(m=>numeric(m.volume_fp))),openInterest:sum(active.map(m=>numeric(m.open_interest_fp))),volumeUnit:'contracts',markets,hydrated:Array.isArray(e.markets),hyperId:null,observedAt});
  }else if(e.kind==='outcome'){
   checkedHyperliquidDomain(e);
   events.push({id:`hyperliquid:${e.id}`,provider,title:text(e.name),category:category(e.name),artworkSymbol:e.artworkSymbol,image:predictionImageURL(e.artworkImage),url:null,endsAt:null,volume:sum(e.sides.map(s=>numeric(s.volume))),volumeUnit:e.quote.symbol,hyperId:e.id,markets:[{id:e.id,title:text(e.name),question:text(e.name),rules:text(e.description,12000),endsAt:null,basis:'Market price',outcomes:e.sides.map(s=>({name:text(s.name,200),probability:chance(s.price),coin:s.coin}))}]});
  }
 }
 const nextCursor=provider==='polymarket'?data?.next_cursor:provider==='kalshi'?data.cursor:null;
  return checkedPredictions({version:provider==='hyperliquid'?2:1,...(provider==='hyperliquid'?{environment:HYPERLIQUID.environment,chainId:HYPERLIQUID.chainId}:{}),provider,observedAt,events,nextCursor:nextCursor||null,more:Boolean(nextCursor)});
}
export function checkedPredictions(value){
 if(value?.provider==='hyperliquid')checkedHyperliquidDomain(value);
 check(value?.version===(value.provider==='hyperliquid'?2:1)&&Object.hasOwn(PREDICTION_PROVIDERS,value.provider)&&Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=Date.now()+5000&&Array.isArray(value.events)&&value.events.length<=10000);
 const ids=new Set(),provider=value.provider;
 const events=value.events.map(e=>{
  check(typeof e.id==='string'&&e.id.startsWith(provider+':')&&e.id.length<=200&&!ids.has(e.id));ids.add(e.id);check(text(e.title)&&e.provider===provider&&Array.isArray(e.markets)&&(e.markets.length>0||e.hydrated===false)&&e.markets.length<=500);
  const marketIds=new Set();const markets=e.markets.map(m=>{check(text(m.id,200)&&!marketIds.has(m.id)&&Array.isArray(m.outcomes)&&m.outcomes.length>=2&&m.outcomes.length<=20);marketIds.add(m.id);return {id:text(m.id,200),title:text(m.title),question:text(m.question),rules:text(m.rules,12000),endsAt:Number.isSafeInteger(m.endsAt)?m.endsAt:null,basis:m.basis==='Bid / ask midpoint'?m.basis:'Market price',outcomes:m.outcomes.map(o=>{check(text(o.name,200));return {name:text(o.name,200),probability:chance(o.probability),...(provider==='hyperliquid'&&typeof o.coin==='string'&&/^#[0-9]{1,12}$/.test(o.coin)?{coin:o.coin}:{})};})};});
  return {id:e.id,provider,title:text(e.title),category:['Crypto','Sports','Politics','Economy','Science & tech','Culture','Other'].includes(e.category)?e.category:'Other',artworkSymbol:provider==='hyperliquid'&&typeof e.artworkSymbol==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/.test(e.artworkSymbol)?e.artworkSymbol:null,image:predictionImageURL(e.image),url:publicURL(provider,e.url),endsAt:Number.isSafeInteger(e.endsAt)?e.endsAt:null,volume:numeric(e.volume),totalVolume:numeric(e.totalVolume),liquidity:numeric(e.liquidity),openInterest:numeric(e.openInterest),volumeUnit:provider==='kalshi'?'contracts':provider==='polymarket'?'USD':text(e.volumeUnit,80),hyperId:provider==='hyperliquid'&&/^outcome:\d{1,8}$/.test(e.hyperId)?e.hyperId:null,markets,hydrated:e.hydrated!==false,description:text(e.description,12000),observedAt:Number.isSafeInteger(e.observedAt)&&e.observedAt>0&&e.observedAt<=Date.now()+5000?e.observedAt:value.observedAt};
 });
 const nextCursor=typeof value.nextCursor==='string'&&value.nextCursor.length<=2048&&!/[\x00-\x20\x7f]/.test(value.nextCursor)?value.nextCursor:null;
 return {version:value.version,...(provider==='hyperliquid'?{environment:HYPERLIQUID.environment,chainId:HYPERLIQUID.chainId}:{}),provider,observedAt:value.observedAt,events,nextCursor,more:Boolean(nextCursor)};
}
export function mergePredictionPage(prior,page,{extend=false,reset=false}={}){
 if(!prior)return page;
 check(prior.provider===page.provider);
 const combined=new Map(prior.events.map(e=>[e.id,e]));for(const event of page.events)combined.set(event.id,event);
 const events=[...combined.values()].slice(0,10000);
 const nextCursor=events.length>=10000?null:reset?page.nextCursor:extend?(page.nextCursor===prior.nextCursor?null:page.nextCursor):prior.nextCursor;
 return {...page,events,nextCursor,more:Boolean(nextCursor)};
}
