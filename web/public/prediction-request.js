export const PREDICTION_PAGE_SIZE=100;
export function predictionRequest(input){
 if(!input||input.privacy!=='public'||!['polymarket','kalshi','hyperliquid'].includes(input.provider)||Object.keys(input).some(k=>!['provider','privacy','cursor','eventId'].includes(k)))throw Error('Invalid prediction request');
 const cursor=input.cursor??'',eventId=input.eventId??'';
 if(typeof cursor!=='string'||cursor.length>2048||/[\x00-\x20\x7f]/.test(cursor)||typeof eventId!=='string'||eventId.length>160||cursor&&eventId)throw Error('Invalid prediction page');
 if(input.provider==='hyperliquid'&&(cursor||eventId)||eventId&&!(input.provider==='polymarket'?/^\d{1,20}$/:/^[A-Z0-9][A-Z0-9_-]{0,159}$/).test(eventId))throw Error('Invalid prediction event');
 return {provider:input.provider,cursor,eventId};
}
export function predictionSourceURL(input){
 const {provider,cursor,eventId}=predictionRequest({...input,privacy:'public'});
 if(provider==='hyperliquid')return null;
 if(provider==='polymarket'){
  if(eventId)return 'https://gamma-api.polymarket.com/events/'+eventId;
  const query=new URLSearchParams({closed:'false',limit:String(PREDICTION_PAGE_SIZE),order:'volume24hr',ascending:'false',include_markets:'false'});if(cursor)query.set('after_cursor',cursor);
  return 'https://gamma-api.polymarket.com/events/keyset?'+query;
 }
 if(eventId)return 'https://external-api.kalshi.com/trade-api/v2/events/'+eventId+'?with_nested_markets=true';
 const query=new URLSearchParams({status:'open',with_nested_markets:'false',limit:String(PREDICTION_PAGE_SIZE)});if(cursor)query.set('cursor',cursor);
 return 'https://external-api.kalshi.com/trade-api/v2/events?'+query;
}
export function isPredictionSourceURL(value){
 try{
  const u=new URL(value);if(u.username||u.password||u.port||u.protocol!=='https:')return false;
  for(const provider of ['polymarket','kalshi']){
   const isPoly=provider==='polymarket',host=isPoly?'gamma-api.polymarket.com':'external-api.kalshi.com',prefix=isPoly?'/events/':'/trade-api/v2/events/';
   if(u.hostname!==host)continue;
   const id=u.pathname.startsWith(prefix)?u.pathname.slice(prefix.length):'';
   for(const input of [{provider,cursor:u.searchParams.get(isPoly?'after_cursor':'cursor')??''},{provider,eventId:id}])try{if(predictionSourceURL(input)===value)return true;}catch{}
  }
 }catch{}return false;
}
