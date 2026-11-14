const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v);
export function tokenImageURL(value){
 if(typeof value!=='string'||value.length>1024)return null;
 try{const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password&&!u.port&&['cdn.dexscreener.com','dd.dexscreener.com','assets.coingecko.com','coin-images.coingecko.com'].includes(u.hostname)?u.href:null;}catch{return null;}
}
export function checkedMarketPrice(p,request,{now=Date.now(),cached=false}={}){
 if(!p||p.id!=='dexscreener'||p.network!==request.network||p.contract!==request.contract||!address(p.pool)||p.decimals!==18||!/^\d{1,60}$/.test(p.answer)||BigInt(p.answer)<=0n)throw Error('Invalid token market price.');
 if(!Number.isFinite(p.liquidityUsd)||p.liquidityUsd<10000||!Number.isFinite(p.volume24hUsd)||p.volume24hUsd<1000)throw Error('Insufficient market activity.');
 if(!Number.isSafeInteger(p.observedAt)||p.observedAt<=0||p.observedAt>now+5000||(!cached&&now-p.observedAt>60000)||p.updatedAt!==p.observedAt)throw Error('Token market price needs updating.');
 return p;
}
export function tokenMarket(pairs,request,{now=Date.now()}={}){
 const candidates=Array.isArray(pairs)?pairs.filter(p=>p.chainId===request.network&&p.baseToken?.address?.toLowerCase()===request.contract&&address(p.pairAddress?.toLowerCase())):[];
 candidates.sort((a,b)=>(b.liquidity?.usd??0)-(a.liquidity?.usd??0));
 const image=candidates.map(p=>tokenImageURL(p.info?.imageUrl)).find(Boolean)??null;
 for(const p of candidates){
  if(typeof p.priceUsd!=='string'||!/^\d{1,20}(?:\.\d{1,36})?$/.test(p.priceUsd))continue;
  const [whole,fraction='']=p.priceUsd.split('.'),answer=(BigInt(whole)*10n**18n+BigInt(fraction.padEnd(18,'0').slice(0,18))).toString();
  try{return {image,price:checkedMarketPrice({id:'dexscreener',network:request.network,contract:request.contract,pool:p.pairAddress.toLowerCase(),answer,decimals:18,updatedAt:now,observedAt:now,liquidityUsd:p.liquidity?.usd,volume24hUsd:p.volume?.h24},request,{now})};}catch{}
 }
 return {image,price:null};
}
