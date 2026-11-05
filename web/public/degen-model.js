export const DEGEN_SOURCES = Object.freeze({dexscreener:'DEX Screener',geckoterminal:'GeckoTerminal'});
export const DEGEN_NETWORKS=Object.freeze({solana:'Solana',eth:'Ethereum',base:'Base',bsc:'BNB Chain',ton:'TON',sui:'Sui',arbitrum:'Arbitrum',polygon_pos:'Polygon',avax:'Avalanche',optimism:'Optimism'});
export const DEGEN_INTERVALS=Object.freeze({'1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000});
const chains = {ethereum:['eip155:1','Ethereum','eth'],base:['eip155:8453','Base','base'],arbitrum:['eip155:42161','Arbitrum','arbitrum'],optimism:['eip155:10','Optimism','optimism'],bsc:['eip155:56','BNB Chain','bsc'],polygon:['eip155:137','Polygon','polygon_pos'],avalanche:['eip155:43114','Avalanche','avax'],solana:['solana:mainnet','Solana','solana'],sui:['sui:mainnet','Sui','sui'],near:['near:mainnet','NEAR','near']};
export function requireData(ok,message='Invalid market data'){if(!ok)throw Error(message);}
export function identifier(value){requireData(typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value));return value;}
export function addressKey(value){identifier(value);return /^0x[0-9a-f]{40,64}$/i.test(value)?value.toLowerCase():value;}
export function chainReference(provider,network){
  requireData(Object.hasOwn(DEGEN_SOURCES,provider));identifier(network);
  const known=provider==='dexscreener'?(Object.hasOwn(chains,network)?chains[network]:null):Object.values(chains).find(c=>c[2]===network);
  return known?{id:known[0],name:known[1],gecko:known[2]}:{id:`${provider}:${network}`,name:network,gecko:provider==='geckoterminal'?network:null};
}
export const tokenKey=row=>`${row.chain.id}/${addressKey(row.address)}`;
export function degenRequest(value){
  requireData(value&&typeof value==='object'&&!Array.isArray(value));
  const {provider,kind}=value;requireData(Object.hasOwn(DEGEN_SOURCES,provider));
  const fields={search:['provider','kind','query'],feed:['provider','kind','feed'],networks:['provider','kind','page'],trades:['provider','kind','network','pool','address'],pool:['provider','kind','network','pool'],candles:['provider','kind','network','pool','address','interval']}[kind];
  if(['search','feed'].includes(kind)&&Object.hasOwn(value,'network')){requireData(provider==='geckoterminal');identifier(value.network);fields.push('network');}
  requireData(fields&&Object.keys(value).length===fields.length&&fields.every(k=>Object.hasOwn(value,k)),'Invalid discovery request');
  if(kind==='search')requireData(typeof value.query==='string'&&value.query.trim().length>=2&&value.query.length<=120&&!/[\u0000-\u001f]/.test(value.query),'Enter a token or address');
  if(kind==='feed')requireData(provider==='geckoterminal'&&['trending','new'].includes(value.feed));
  if(['pool','candles','trades'].includes(kind)){identifier(value.network);identifier(value.pool);}
  if(kind==='networks')requireData(provider==='geckoterminal'&&Number.isInteger(value.page)&&value.page>=1&&value.page<=20);
  if(kind==='trades'){requireData(provider==='geckoterminal');identifier(value.address);}
  if(kind==='candles'){requireData(provider==='geckoterminal'&&Object.hasOwn(DEGEN_INTERVALS,value.interval));identifier(value.address);}
  return Object.freeze(Object.fromEntries(fields.map(key=>[key,key==='query'?value.query.trim():value[key]])));
}
export function tokenLinkRequest(text){
  let u;try{u=new URL(text);}catch{return null;}
  requireData(u.protocol==='https:'&&!u.username&&!u.password&&!u.port,'Unsupported token link');
  const parts=u.pathname.split('/').filter(Boolean);
  if(u.hostname==='dexscreener.com'&&parts.length===2)return degenRequest({provider:'dexscreener',kind:'pool',network:parts[0],pool:parts[1]});
  if(u.hostname==='www.geckoterminal.com'&&parts.length===3&&parts[1]==='pools')return degenRequest({provider:'geckoterminal',kind:'pool',network:parts[0],pool:parts[2]});
  throw Error('Paste a token address or a DEX Screener / GeckoTerminal pool link');
}
const text=(value,max=100)=>{requireData(typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u202a-\u202e\u2066-\u2069]/.test(value));return value;};
export function metric(value,signed=false){if(value===null||value===undefined||value==='')return null;requireData((typeof value==='string'||typeof value==='number')&&Number.isFinite(Number(value))&&(signed||Number(value)>=0));return Number(value);}
export function checkedMarket(value){
  requireData(value?.executable===false&&Object.hasOwn(DEGEN_SOURCES,value.source));
  const network=identifier(value.network),pool=identifier(value.pool),address=identifier(value.address),chain=chainReference(value.source,network);
  requireData(value.chain?.id===chain.id&&value.id===`${value.source}/${network}/${addressKey(pool)}`);
  const row={id:value.id,source:value.source,network,pool,chain,address,symbol:text(value.symbol,40),name:text(value.name),venue:text(value.venue,100),quote:text(value.quote,40),price:metric(value.price),change:metric(value.change,true),liquidity:metric(value.liquidity),volume:metric(value.volume),marketCap:metric(value.marketCap),fdv:metric(value.fdv),createdAt:metric(value.createdAt),boosted:value.boosted===true,executable:false};
  requireData(row.createdAt===null||Number.isSafeInteger(row.createdAt));return Object.freeze(row);
}
export function checkedDiscovery(value,expected,{now=Date.now(),saved=false}={}){
  const request=degenRequest(expected);requireData(value?.version===1&&value.executable===false&&JSON.stringify(degenRequest(value.request))===JSON.stringify(request));
  requireData(Number.isSafeInteger(value.observedAt)&&value.observedAt<=now+5000&&(saved||value.observedAt>=now-120000));
  requireData(Array.isArray(value.rows)&&value.rows.length<=60);
  const rows=value.rows.map(checkedMarket);requireData(rows.every(r=>r.source===request.provider)&&new Set(rows.map(r=>r.id)).size===rows.length);
  if(request.kind==='pool')requireData(rows.every(r=>r.network===request.network&&addressKey(r.pool)===addressKey(request.pool)));
  if(['feed','search'].includes(request.kind)&&request.network)requireData(rows.every(r=>r.network===request.network),'Source returned another chain');
  return {version:1,request,observedAt:value.observedAt,rows,executable:false};
}
export function checkedCandles(value,expected,{now=Date.now(),saved=false}={}){
  const request=degenRequest(expected);requireData(request.kind==='candles'&&value?.executable===false&&JSON.stringify(degenRequest(value.request))===JSON.stringify(request));
  requireData(Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=now+5000&&(saved||value.observedAt>=now-120000));
  requireData(Array.isArray(value.candles)&&value.candles.length<=300);
  const duration=DEGEN_INTERVALS[request.interval],offset=request.interval==='1w'?345600000:0;
  const candles=value.candles.map((c,i)=>{requireData(Number.isSafeInteger(c.time)&&c.time>0&&c.time<=value.observedAt+5000&&(c.time-offset)%duration===0&&(!i||c.time>value.candles[i-1].time));const result={time:c.time,open:metric(c.open),high:metric(c.high),low:metric(c.low),close:metric(c.close),volume:metric(c.volume)};requireData(['open','high','low','close','volume'].every(k=>result[k]!==null)&&result.low>0&&result.low<=Math.min(result.open,result.close)&&result.high>=Math.max(result.open,result.close));return result;});
  return {version:1,request,observedAt:value.observedAt,candles,executable:false};
}
export function groupTokens(rows){
  const groups=new Map();for(const raw of rows){const row=checkedMarket(raw),key=tokenKey(row);if(!groups.has(key))groups.set(key,{key,markets:[]});const group=groups.get(key);if(!group.markets.some(m=>m.id===row.id))group.markets.push(row);}
  for(const group of groups.values()){group.markets.sort((a,b)=>(b.liquidity??-1)-(a.liquidity??-1));group.token=group.markets[0];}
  return [...groups.values()];
}
export function marketURL(row){checkedMarket(row);return row.source==='dexscreener'?`https://dexscreener.com/${row.network}/${row.pool}`:`https://www.geckoterminal.com/${row.network}/pools/${row.pool}`;}
export function checkedNetworks(value,expected){
  const request=degenRequest(expected);requireData(request.kind==='networks'&&value?.executable===false&&JSON.stringify(value.request)===JSON.stringify(request)&&Array.isArray(value.networks)&&value.networks.length<=100);
  const networks=value.networks.map(n=>({id:identifier(n.id),name:text(n.name,100)}));requireData(new Set(networks.map(n=>n.id)).size===networks.length);return {version:1,request,networks,hasMore:value.hasMore===true,executable:false};
}
export function checkedTrades(value,expected,{now=Date.now(),saved=false}={}){
  const request=degenRequest(expected);requireData(request.kind==='trades'&&value?.executable===false&&JSON.stringify(degenRequest(value.request))===JSON.stringify(request));
  requireData(Number.isSafeInteger(value.observedAt)&&value.observedAt<=now+5000&&(saved||value.observedAt>=now-120000));
  requireData(Array.isArray(value.trades)&&value.trades.length<=100);
  const trades=value.trades.map((t,i)=>{const id=identifier(t.id),hash=identifier(t.hash);requireData(['buy','sell'].includes(t.side)&&Number.isSafeInteger(t.time)&&t.time>0&&t.time<=now+60000&&(!i||t.time<=value.trades[i-1].time));requireData(addressKey(t.address)===addressKey(request.address),'Trade token changed');const amount=metric(t.amount),usd=metric(t.usd),price=metric(t.price);requireData(amount>0&&usd!==null&&price>0);return {id,hash,time:t.time,side:t.side,address:t.address,amount,usd,price};});
  requireData(new Set(trades.map(t=>t.id)).size===trades.length,'Duplicate trade event');return {version:1,request,observedAt:value.observedAt,trades,executable:false};
}
