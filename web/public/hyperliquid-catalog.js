const requireValue=(value)=>{if(!value)throw Error('Invalid Hyperliquid catalogue');};
const label=(value,max=200)=>{requireValue(typeof value==='string'&&value.length>0&&value.length<=max);return value;};
const index=value=>{requireValue(Number.isSafeInteger(value)&&value>=0&&value<100000000);return value;};
const number=value=>value!==null&&value!==undefined&&/^-?\d+(?:\.\d+)?$/.test(String(value))&&Number.isFinite(Number(value))?String(value):null;
const stats=context=>({price:number(context?.midPx),volume:number(context?.dayNtlVlm),funding:number(context?.funding)});
const fields=text=>Object.fromEntries(String(text??'').split('|').filter(s=>s.includes(':')).map(s=>[s.slice(0,s.indexOf(':')),s.slice(s.indexOf(':')+1)]));
const expand=(text,values)=>String(text??'').replace(/^template:/,'').replace(/\{([^{}]+)\}/g,(match,key)=>Object.hasOwn(values,key)?values[key]:match);

export function normalizeHyperliquidCatalog({spot,perps,outcomes,templates},observedAt=Date.now()){
  const tokens=new Map((spot?.[0]?.tokens??[]).map(t=>[index(t.index),{...t,name:label(t.name,80)}]));
  const contexts=new Map((spot?.[1]??[]).map(c=>[c.coin,c]));
  const rows=[];
  for(const pair of spot?.[0]?.universe??[]){
    const base=tokens.get(pair.tokens[0]),quote=tokens.get(pair.tokens[1]);requireValue(base&&quote);
    rows.push({id:`spot:${index(pair.index)}`,kind:'spot',coin:label(pair.name,80),venue:'HyperCore',name:`${label(base.name,80)} / ${label(quote.name,80)}`,quote:{index:quote.index,symbol:quote.name},...stats(contexts.get(pair.name)),description:'',sides:[]});
  }
  for(const venue of perps??[]){
    requireValue(Array.isArray(venue.meta?.universe)&&Array.isArray(venue.contexts)&&venue.meta.universe.length===venue.contexts.length);
    const quote=tokens.get(venue.meta.collateralToken);
    for(const [i,market] of venue.meta.universe.entries()){
      if(market.isDelisted)continue;
      requireValue(!venue.dex||market.name.startsWith(venue.dex+':'));
      rows.push({id:`perp:${venue.dex}:${i}`,kind:venue.dex?'builder':'perp',coin:label(market.name,80),venue:venue.dex||'HyperCore',name:label(market.name.split(':').at(-1),80),quote:{index:index(venue.meta.collateralToken),symbol:quote?.name??`Token ${venue.meta.collateralToken}`},...stats(venue.contexts[i]),leverage:market.maxLeverage,description:'Perpetual contract',sides:[]});
    }
  }
  const templateMap=new Map((templates??[]).map(t=>[t.id,t])),parents=new Map();
  for(const question of outcomes?.questions??[])for(const id of [question.fallbackOutcome,...question.namedOutcomes??[]])parents.set(id,question);
  for(const outcome of outcomes?.outcomes??[]){
    const id=index(outcome.outcome),parent=parents.get(id),values={...fields(parent?.description),...fields(outcome.description)};
    const template=templateMap.get(outcome.name?.replace(/^template:/,'')),parentTemplate=templateMap.get(parent?.name?.replace(/^template:/,''));
    let name=expand(template?.name??outcome.name,values);
    if(outcome.name==='Recurring Named Outcome')name=`${values.underlying??'Recurring'} · bucket ${Number(values.index)+1} · ${values.expiry??''}`;
    if(outcome.name==='Recurring Fallback Outcome')name=`${values.underlying??'Recurring'} · fallback · ${values.expiry??''}`;
    const parentName=parentTemplate?expand(parentTemplate.name,values):'';
    const iconKeys=(template?.keywords??[]).filter(k=>Array.isArray(k)&&k[1]==='hlPerp');
    let artworkSymbol=iconKeys.length===1?values[iconKeys[0][0]]:outcome.name.startsWith('Recurring ')?values.underlying:null;
    if(!artworkSymbol&&['companyIpoConfirmed','companyIpoFirstDayMarketCap'].includes(template?.id)&&values.company==='Anthropic')artworkSymbol='xyz:ANT';
    const sides=outcome.sideSpecs.map((side,i)=>({name:expand(side.name,values),coin:`#${10*id+i}`,...stats(contexts.get(`#${10*id+i}`))}));
    requireValue(sides.length===2);
    rows.push({id:`outcome:${id}`,kind:'outcome',coin:sides[0].coin,venue:outcome.venue??'HyperCore',name:parentName?`${parentName} · ${name}`:name,quote:{index:null,symbol:label(outcome.quoteToken,80)},...stats(null),sides,artworkSymbol:typeof artworkSymbol==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/.test(artworkSymbol)?artworkSymbol:null,description:[parentTemplate&&expand(parentTemplate.description,values),template&&expand(template.description,values)].filter(Boolean).join('\n\n')||[parent?.description,outcome.description].filter(Boolean).join(' | ')});
  }
  return {version:1,observedAt,rows,unavailable:[]};
}

export const HYPERLIQUID_KINDS=Object.freeze({spot:'Spot',perp:'Perps',builder:'Builder perps',outcome:'Predictions'});
export function hyperliquidRequest(input){
  requireValue(input&&Object.keys(input).length===3&&input.privacy==='public');
  requireValue(typeof input.marketId==='string'&&/^hypercore:(spot|perp|builder|outcome):(?:@[0-9]{1,8}|#[0-9]{1,9}|[A-Za-z0-9][A-Za-z0-9:._/-]{0,79})$/.test(input.marketId));
  requireValue(['1m','5m','15m','1h','4h','1d'].includes(input.interval));
  return {marketId:input.marketId,interval:input.interval,privacy:'public'};
}

// This same boundary checks fresh responses and locally saved catalogue data.
export function checkedHyperliquidCatalog(value){
  requireValue(value?.version===1&&Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=Date.now()+5000);
  requireValue(Array.isArray(value.rows)&&value.rows.length<=10000&&Array.isArray(value.unavailable)&&value.unavailable.length<=100);
  const ids=new Set();
  const rows=value.rows.map(row=>{
    requireValue(Object.hasOwn(HYPERLIQUID_KINDS,row.kind)&&!ids.has(row.id));ids.add(label(row.id,100));
    hyperliquidRequest({marketId:`hypercore:${row.kind}:${row.coin}`,interval:'1m',privacy:'public'});
    requireValue(row.quote?.index===null||Number.isSafeInteger(row.quote?.index));
    requireValue(Array.isArray(row.sides)&&row.sides.length===(row.kind==='outcome'?2:0));
    const sides=row.sides.map((s,i)=>{requireValue(s.coin===`#${10*Number(row.id.split(':')[1])+i}`);return {name:label(s.name,200),coin:s.coin,price:number(s.price),volume:number(s.volume),funding:null};});
    return {id:row.id,kind:row.kind,coin:row.coin,venue:label(row.venue,80),name:label(row.name,1000),quote:{index:row.quote.index,symbol:label(row.quote.symbol,80)},price:number(row.price),volume:number(row.volume),funding:number(row.funding),leverage:Number.isFinite(row.leverage)?row.leverage:null,artworkSymbol:row.kind==='outcome'&&typeof row.artworkSymbol==='string'&&/^[A-Za-z0-9][A-Za-z0-9:._-]{0,79}$/.test(row.artworkSymbol)?row.artworkSymbol:null,description:typeof row.description==='string'?row.description.slice(0,24000):'',sides};
  });
  return {version:1,observedAt:value.observedAt,rows,unavailable:value.unavailable.map(x=>label(x,100))};
}
