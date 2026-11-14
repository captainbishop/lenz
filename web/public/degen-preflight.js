import {checkedDegenQuote} from './degen-quote.js';
import {immutable} from './defi-catalog.js';
export const DEGEN_ROUTER='0x2626664c2603336e57b271c5c0b26f421741e481';
const check=(ok,message='Invalid wallet simulation.')=>{if(!ok)throw Error(message);};
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const units=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n;
export function degenPreflightRequest(value,{now=Date.now()}={}){
 check(exact(value,['quote','account','privacy'])&&value.privacy==='public','Allow public wallet checks first.');
 check(typeof value.account==='string'&&/^0x[0-9a-f]{40}$/.test(value.account)&&!/^0x0{40}$/.test(value.account),'Invalid wallet account.');
 return immutable({quote:checkedDegenQuote(value.quote,value.quote?.request,{now}),account:value.account,privacy:'public'});
}
export function checkedDegenPreflight(value,expected,{now=Date.now()}={}){
 const request=degenPreflightRequest(expected,{now}),quote=request.quote;
 check(exact(value,['version','kind','request','balances','allowanceUnits','simulation','fees','affordable','observedAt','expiresAt','evidence','executable']));
 check(value.version===1&&value.kind==='degen-preflight'&&value.executable===false&&JSON.stringify(value.request)===JSON.stringify(request),'Wallet check terms changed.');
 check(exact(value.balances,['inputUnits','nativeWei'])&&Object.values(value.balances).every(units)&&units(value.allowanceUnits));
 check(exact(value.simulation,['status','spentUnits','receivedUnits']));
 const enough=BigInt(value.balances.inputUnits)>=BigInt(quote.inputUnits);
 if(!enough){check(value.simulation.status==='insufficient-token'&&value.simulation.spentUnits===null&&value.simulation.receivedUnits===null&&value.fees===null&&value.affordable===false);}
 else {
  check(value.simulation.status==='passed'&&value.simulation.spentUnits===quote.inputUnits&&units(value.simulation.receivedUnits)&&BigInt(value.simulation.receivedUnits)>=BigInt(quote.minOutputUnits),'Simulation did not preserve the token amounts.');
  check(exact(value.fees,['actions','totalWei'])&&units(value.fees.totalWei));
  const kinds=BigInt(value.allowanceUnits)>=BigInt(quote.inputUnits)?['swap']:BigInt(value.allowanceUnits)>0n?['reset-approval','approve','swap']:['approve','swap'];
  check(Array.isArray(value.fees.actions)&&value.fees.actions.length===kinds.length);
  let total=0n;
  for(const [index,fee]of value.fees.actions.entries()){
   check(exact(fee,['kind','gasUnits','gasPriceWei','l2Wei','l1Wei','operatorWei','totalWei'])&&fee.kind===kinds[index]);
   check(Object.entries(fee).filter(([key])=>key!=='kind').every(([,n])=>units(n)));
   check(BigInt(fee.gasUnits)>=21000n&&BigInt(fee.gasUnits)<=2400000n&&BigInt(fee.gasPriceWei)>0n);
   check(BigInt(fee.l2Wei)===BigInt(fee.gasUnits)*BigInt(fee.gasPriceWei)&&BigInt(fee.totalWei)===BigInt(fee.l2Wei)+BigInt(fee.l1Wei)+BigInt(fee.operatorWei),'Fee totals changed.');total+=BigInt(fee.totalWei);
  }
  check(total.toString()===value.fees.totalWei&&value.affordable===(BigInt(value.balances.nativeWei)>=total),'Wallet gas balance changed.');
 }
 check(Number.isSafeInteger(value.observedAt)&&value.observedAt>0&&value.observedAt<=now+5000);
 check(Number.isSafeInteger(value.expiresAt)&&value.expiresAt>now&&value.expiresAt>value.observedAt&&value.expiresAt<=quote.expiresAt&&value.expiresAt<=value.observedAt+30000,'Wallet check expired. Get a fresh quote.');
 const e=value.evidence;
 check(exact(e,['source','blockNumber','blockHash','blockTimestamp'])&&e.source==='https://mainnet.base.org'&&/^(0|[1-9][0-9]{0,19})$/.test(e.blockNumber)&&/^0x[0-9a-f]{64}$/.test(e.blockHash));
 check(Number.isSafeInteger(e.blockTimestamp)&&e.blockTimestamp>0&&e.blockTimestamp<=now+5000&&value.expiresAt<=e.blockTimestamp+60000);
 return immutable(structuredClone(value));
}
