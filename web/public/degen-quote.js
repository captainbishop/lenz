import {immutable} from './defi-catalog.js';
import {canonicalAmount,decimalUnits} from './market-quote.js';
const check=(ok,message='Invalid swap quote.')=>{if(!ok)throw Error(message);};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
const uint=value=>typeof value==='string'&&/^[1-9][0-9]{0,77}$/.test(value)&&BigInt(value)<2n**256n;
export function degenQuoteRequest(value){
 const quoting=value?.kind==='quote',keys=['kind','network','pool','token','privacy',...(quoting?['side','amount','slippageBps']:[])];
 check(exact(value,keys)&&['pool','quote'].includes(value.kind),'Invalid swap request.');
 check(value.network==='base','Swap quotes are available on Base.');
 check(value.privacy==='public','Allow a public quote first.');
 check(address(value.pool)&&address(value.token),'Invalid pool or token contract.');
 const request={kind:value.kind,network:'base',pool:value.pool,token:value.token,privacy:'public'};
 if(quoting){
  check(['buy','sell'].includes(value.side),'Choose buy or sell.');
  check(Number.isInteger(value.slippageBps)&&value.slippageBps>=0&&value.slippageBps<=500,'Price change must be between 0 and 5%.');
  const amount=canonicalAmount(value.amount);decimalUnits(amount,18);
  Object.assign(request,{side:value.side,amount,slippageBps:value.slippageBps});
 }
 return immutable(request);
}
export const pairRequest=request=>degenQuoteRequest({kind:'pool',network:request.network,pool:request.pool,token:request.token,privacy:request.privacy});
const common=['version','kind','request','assets','feePips','observedAt','expiresAt','evidence','executable'];
function checkPair(value,request,now){
 check(value.version===1&&value.executable===false);
 check(JSON.stringify(degenQuoteRequest(value.request))===JSON.stringify(request),'Swap terms changed.');
 check(Array.isArray(value.assets)&&value.assets.length===2);
 for(const asset of value.assets){
  check(exact(asset,['id','symbol','decimals'])&&address(asset.id));
  check(typeof asset.symbol==='string'&&asset.symbol.trim().length>0&&asset.symbol.length<=32&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(asset.symbol),'Unsupported token symbol.');
  check(Number.isInteger(asset.decimals)&&asset.decimals>=0&&asset.decimals<=18,'Unsupported token precision.');
 }
 check(value.assets[0].id<value.assets[1].id&&value.assets.some(asset=>asset.id===request.token),'Pool token changed.');
 check(Number.isInteger(value.feePips)&&value.feePips>0&&value.feePips<1000000);
 check(Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=now+5000);
 check(Number.isSafeInteger(value.expiresAt)&&value.expiresAt>now&&value.expiresAt>value.observedAt&&value.expiresAt<=value.observedAt+30000,'Quote expired. Check again.');
 const evidence=value.evidence;
 check(exact(evidence,['source','blockNumber','blockHash','blockTimestamp'])&&evidence.source==='https://mainnet.base.org');
 check(typeof evidence.blockNumber==='string'&&/^(0|[1-9][0-9]{0,19})$/.test(evidence.blockNumber)&&/^0x[0-9a-f]{64}$/.test(evidence.blockHash));
 check(Number.isSafeInteger(evidence.blockTimestamp)&&evidence.blockTimestamp>0&&evidence.blockTimestamp<=now+5000&&value.expiresAt<=evidence.blockTimestamp+60000,'Pool data expired. Check again.');
}
export function checkedDegenPair(value,expected,{now=Date.now()}={}){
 const request=degenQuoteRequest(expected);check(request.kind==='pool'&&exact(value,common)&&value.kind==='degen-pair');checkPair(value,request,now);return immutable(structuredClone(value));
}
export function checkedDegenQuote(value,expected,{now=Date.now()}={}){
 const request=degenQuoteRequest(expected);check(request.kind==='quote'&&exact(value,[...common,'input','output','inputUnits','outputUnits','minOutputUnits','gasUnits'])&&value.kind==='degen-quote');checkPair(value,request,now);
 const selected=value.assets.find(asset=>asset.id===request.token),counter=value.assets.find(asset=>asset.id!==request.token),input=request.side==='buy'?counter:selected,output=request.side==='buy'?selected:counter;
 check(JSON.stringify(value.input)===JSON.stringify(input)&&JSON.stringify(value.output)===JSON.stringify(output),'Quote assets changed.');
 check(value.inputUnits===decimalUnits(request.amount,input.decimals).toString(),'Quote amount changed.');
 check(uint(value.outputUnits)&&uint(value.minOutputUnits)&&uint(value.gasUnits));
 check(BigInt(value.minOutputUnits)===BigInt(value.outputUnits)*BigInt(10000-request.slippageBps)/10000n,'Quote minimum changed.');
 return immutable(structuredClone(value));
}
