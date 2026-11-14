export const account='0x'+'33'.repeat(20);
export function quoteFixture(now=Date.now()){
 const assets=[{id:'0x'+'11'.repeat(20),symbol:'DGN',decimals:18},{id:'0x4200000000000000000000000000000000000006',symbol:'WETH',decimals:18}];
 return {version:1,kind:'degen-quote',request:{kind:'quote',network:'base',pool:'0x'+'22'.repeat(20),token:assets[0].id,privacy:'public',side:'buy',amount:'0.25',slippageBps:50},assets,feePips:3000,input:assets[1],output:assets[0],inputUnits:'250000000000000000',outputUnits:'42000000000000000000',minOutputUnits:'41790000000000000000',gasUnits:'120000',observedAt:now,expiresAt:now+30000,evidence:{source:'https://mainnet.base.org',blockNumber:'4660',blockHash:'0x'+'ab'.repeat(32),blockTimestamp:now-1000},executable:false};
}
export function preflightFixture(request,{mode='funded',expiresAt=request.quote.expiresAt}={}){
 const actions=[{kind:'approve',gasUnits:'60000',gasPriceWei:'1000000000',l2Wei:'60000000000000',l1Wei:'1000',operatorWei:'50',totalWei:'60000000001050'},{kind:'swap',gasUnits:'144000',gasPriceWei:'1000000000',l2Wei:'144000000000000',l1Wei:'1000',operatorWei:'50',totalWei:'144000000001050'}];
 return {version:1,kind:'degen-preflight',request,balances:{inputUnits:mode==='token'?'1':'1000000000000000000',nativeWei:mode==='eth'?'1':'1000000000000000000'},allowanceUnits:'0',simulation:mode==='token'?{status:'insufficient-token',spentUnits:null,receivedUnits:null}:{status:'passed',spentUnits:'250000000000000000',receivedUnits:'41900000000000000000'},fees:mode==='token'?null:{actions,totalWei:'204000000002100'},affordable:mode==='funded',observedAt:Date.now(),expiresAt,evidence:request.quote.evidence,executable:false};
}
