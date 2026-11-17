export function hyperliquidFixtureFetcher(url,options){
  if(url!=='https://api.hyperliquid-testnet.xyz/info')throw Error('Unexpected source');
  const request=JSON.parse(options.body),now=Date.now(),coin=request.coin??request.req?.coin;
  let value;
  switch(request.type){
    case 'spotMeta':value={tokens:[{index:360,name:'USDH'},{index:150,name:'HYPE'},{index:0,name:'USDC'}],universe:[{index:107,name:'@107',tokens:[150,0]},{index:1188,name:'@1188',tokens:[150,360]}]};break;
    case 'spotMetaAndAssetCtxs':value=[{tokens:[{index:360,name:'USDH'},{index:150,name:'HYPE'},{index:0,name:'USDC'}],universe:[{index:107,name:'@107',tokens:[150,0]},{index:1188,name:'@1188',tokens:[150,360]}]},[{coin:'#120',midPx:'0.6'},{coin:'@107',midPx:'42',dayNtlVlm:'1000'},{coin:'#121',midPx:'0.4'}]];break;
    case 'perpDexs':value=[null,{name:'xyz'}];break;
    case 'metaAndAssetCtxs':value=[{collateralToken:request.dex?360:0,universe:[{name:request.dex?'xyz:GOLD':'BTC',maxLeverage:20},{name:request.dex?'xyz:OLD':'OLD',isDelisted:true}]},[{midPx:'100',dayNtlVlm:'500'},{}]];break;
    case 'outcomeMeta':value={questions:[],outcomes:[{outcome:12,name:'template:binary',description:'participant:<img src=x onerror=alert(1)>',sideSpecs:[{name:'Yes'},{name:'No'}],quoteToken:'USDC',venue:'out'}]};break;
    case 'outcomeTemplates':value=[{id:'binary',name:'Will {participant} win?',description:'Resolve against the official result.'}];break;
    case 'l2Book':value={coin,time:now,levels:[[{px:coin.startsWith('#')?'0.4':'41',sz:'3',n:1}],coin==='@1188'?[]:[{px:coin.startsWith('#')?'0.5':'42',sz:'2',n:1}]]};break;
    case 'candleSnapshot':{
      const duration={'1m':60000,'5m':300000,'15m':900000,'1h':3600000,'4h':14400000,'1d':86400000}[request.req.interval],end=Math.floor(now/duration)*duration;
      value=coin==='@1188'?[]:Array.from({length:30},(_,i)=>({s:coin,i:request.req.interval,t:end-(29-i)*duration,o:'1',h:'2',l:'0.1',c:'1',v:'10',n:3}));break;
    }
    default:throw Error('Unexpected info request '+request.type);
  }
  return Promise.resolve(new Response(JSON.stringify(value),{headers:{'content-type':'application/json'}}));
}
