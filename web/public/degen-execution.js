import {checkedDegenPreflight,DEGEN_ROUTER} from './degen-preflight.js';
import {check,uint,hash,address} from './evm-transfer.js';
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const hex=n=>'0x'+BigInt(n).toString(16),word=n=>BigInt(n).toString(16).padStart(64,'0'),addr=a=>a.slice(2).padStart(64,'0');
const quantity=v=>{check(uint(v),'Invalid wallet quantity.');return BigInt(v);};
export function degenAction(preflight){
 const q=preflight.request.quote,fee=preflight.fees?.actions[0];check(fee&&preflight.affordable&&preflight.simulation.status==='passed','Check sufficient funds and fees first.');
 const kind=fee.kind;
 if(kind!=='swap')return {kind,to:q.input.id,data:'0x095ea7b3'+addr(DEGEN_ROUTER)+word(kind==='approve'?q.inputUnits:0)};
 const inner='04e45aaf'+addr(q.input.id)+addr(q.output.id)+word(q.feePips)+addr(preflight.request.account)+word(q.inputUnits)+word(q.minOutputUnits)+word(0);
 // multicall(deadline, [exactInputSingle(...)]) uses one dynamic bytes element.
 return {kind,to:DEGEN_ROUTER,data:'0x5ae401dc'+word(Math.floor(q.expiresAt/1000))+word(64)+word(1)+word(32)+word(inner.length/2)+inner.padEnd(Math.ceil(inner.length/64)*64,'0')};
}
export function validateDegenReview(value){
 check(exact(value,['version','preflight','kind','transaction','createdAt','expiresAt'])&&value.version===1,'Invalid swap review.');
 check(Number.isSafeInteger(value.createdAt)&&value.createdAt>0,'Invalid review time.');
 const p=checkedDegenPreflight(value.preflight,value.preflight?.request,{now:value.createdAt}),action=degenAction(p),fee=p.fees.actions[0];
 check(value.createdAt>=p.observedAt&&value.expiresAt===p.expiresAt&&value.kind===action.kind,'Swap review changed.');
 const tx=value.transaction;check(exact(tx,['chainId','from','to','value','data','nonce','gas','gasPrice'])&&uint(tx.nonce),'Invalid swap transaction.');
 const expected={chainId:'0x2105',from:p.request.account,to:action.to,value:'0x0',data:action.data,nonce:tx.nonce,gas:hex(fee.gasUnits),gasPrice:hex(fee.gasPriceWei)};
 check(JSON.stringify(expected)===JSON.stringify(tx),'Transaction differs from the reviewed swap.');return structuredClone(value);
}
export async function checkDegenWallet(lease,account){
 lease.assertCurrent();check(lease.identity.address===account&&lease.identity.chainId==='0x2105','Connect the original wallet on Base.');
 const accounts=await lease.request('eth_accounts'),chain=await lease.request('eth_chainId');check(Array.isArray(accounts)&&accounts[0]?.toLowerCase()===account&&quantity(chain)===8453n,'Wallet changed. Reconnect and review again.');lease.assertCurrent();
}
export async function prepareDegenAction(lease,preflight){
 const p=checkedDegenPreflight(preflight,preflight.request),action=degenAction(p),fee=p.fees.actions[0];await checkDegenWallet(lease,p.request.account);
 const nonce=hex(quantity(await lease.request('eth_getTransactionCount',[p.request.account,'pending'])));await checkDegenWallet(lease,p.request.account);
 return validateDegenReview({version:1,preflight:p,kind:action.kind,transaction:{chainId:'0x2105',from:p.request.account,to:action.to,value:'0x0',data:action.data,nonce,gas:hex(fee.gasUnits),gasPrice:hex(fee.gasPriceWei)},createdAt:Date.now(),expiresAt:p.expiresAt});
}
export async function fetchDegenPreflight(request,{signal}={}){
 const response=await fetch('/api/degen/preflight',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal:AbortSignal.any([AbortSignal.timeout(45000),...(signal?[signal]:[])])});
 check(response.ok,'Wallet simulation unavailable. Refresh the quote and try again.');const text=await response.text();check(text.length<=32000,'Invalid simulation response.');return checkedDegenPreflight(JSON.parse(text),request);
}
export async function recheckDegenAction(lease,review,{read=fetchDegenPreflight,current=()=>true}={}){
 const r=validateDegenReview(review),tx=r.transaction;check(current()&&Date.now()<r.expiresAt,'Review expired or changed. Check again.');await checkDegenWallet(lease,tx.from);
 const fresh=checkedDegenPreflight(await read(r.preflight.request),r.preflight.request),action=degenAction(fresh),fee=fresh.fees.actions[0];
 check(action.kind===r.kind&&action.to===tx.to&&action.data===tx.data,'Approval or swap terms changed. Review again.');
 check(BigInt(fee.gasUnits)<=quantity(tx.gas)&&BigInt(fee.gasPriceWei)<=quantity(tx.gasPrice)&&BigInt(fee.totalWei)<=BigInt(r.preflight.fees.actions[0].totalWei),'Estimated fees changed. Check again.');
 check(quantity(await lease.request('eth_getTransactionCount',[tx.from,'pending']))===quantity(tx.nonce),'Wallet activity changed. Review again.');
 check(quantity(await lease.request('eth_gasPrice'))<=quantity(tx.gasPrice),'Gas price changed. Review again.');
 const gas=quantity(await lease.request('eth_estimateGas',[tx]));check(gas>=21000n&&gas<=quantity(tx.gas),'Gas estimate changed. Review again.');
 check(quantity(await lease.request('eth_getBalance',[tx.from,'pending']))>=BigInt(r.preflight.fees.totalWei),'Not enough ETH for the reviewed fees.');
 await checkDegenWallet(lease,tx.from);check(current()&&Date.now()<r.expiresAt,'Review expired or changed. Check again.');return r;
}
