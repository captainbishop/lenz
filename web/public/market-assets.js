export const MARKET_ASSETS=Object.freeze({BTC:'bitcoin',ETH:'ethereum',BNB:'binancecoin',SOL:'solana',XRP:'ripple',HYPE:'hyperliquid',LINK:'chainlink',NEAR:'near',USDC:'usd-coin',DOGE:'dogecoin',AVAX:'avalanche-2',ZEC:'zcash',UNI:'uniswap',AAVE:'aave',WETH:'weth',WBTC:'wrapped-bitcoin',DAI:'dai',USDT:'tether'});
export const MARKET_ASSETS_URL='https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids='+Object.values(MARKET_ASSETS).join(',')+'&sparkline=true&price_change_percentage=7d';
const n=(v,signed=false)=>typeof v==='number'&&Number.isFinite(v)&&(signed||v>=0)?v:null;
const history=v=>Array.isArray(v)&&v.length>=144&&v.length<=200&&v.every(p=>n(p)!==null&&p>0)?v:[];
export function normalizeMarketAssets(rows,now=Date.now()){
 if(!Array.isArray(rows)||rows.length>100)throw Error('Invalid asset context');
 const assets=[];
 for(const [key,id]of Object.entries(MARKET_ASSETS)){
  const matches=rows.filter(r=>r.id===id&&r.symbol===key.toLowerCase());if(matches.length!==1)continue;const r=matches[0],updatedAt=Date.parse(r.last_updated);if(!Number.isSafeInteger(updatedAt)||updatedAt<=0||updatedAt>now+5000)continue;
  assets.push({key,id,name:typeof r.name==='string'?r.name.slice(0,80):key,price:n(r.current_price),change:n(r.price_change_percentage_24h,true),change7d:n(r.price_change_percentage_7d_in_currency,true),marketCap:n(r.market_cap),volume:n(r.total_volume),supply:n(r.circulating_supply),history:history(r.sparkline_in_7d?.price),updatedAt});
 }return {version:1,provider:'coingecko',observedAt:now,assets};
}
export function checkedMarketAssets(value,now=Date.now()){
 if(value?.version!==1||value.provider!=='coingecko'||!Number.isSafeInteger(value.observedAt)||value.observedAt<=0||value.observedAt>now+5000||!Array.isArray(value.assets)||value.assets.length>Object.keys(MARKET_ASSETS).length)throw Error('Invalid asset context');
 const seen=new Set();const assets=value.assets.map(a=>{if(!Object.hasOwn(MARKET_ASSETS,a.key)||MARKET_ASSETS[a.key]!==a.id||seen.has(a.key)||typeof a.name!=='string'||a.name.length>80||!Number.isSafeInteger(a.updatedAt)||a.updatedAt<=0||a.updatedAt>now+5000)throw Error('Wrong asset identity');seen.add(a.key);return {...a,price:n(a.price),change:n(a.change,true),change7d:n(a.change7d,true),marketCap:n(a.marketCap),volume:n(a.volume),supply:n(a.supply),history:history(a.history)};});return {...value,assets};
}
