import {HYPERLIQUID,checkedHyperliquidDomain} from './hyperliquid-environment.js';
import {orderAmount} from './hyperliquid-order.js';
import {readHyperFunding,updateHyperFunding,readHyperSetups,updateHyperSetups} from './hyperliquid-order-store.js';
import {refreshHyperliquidHoldings} from './hyperliquid-holdings.js';
import {HYPERLIQUID_TESTNET_GRANTS,checkedHyperFundingRequest,hyperFundingAmount,hyperFundingGrants} from './hyperliquid-funding-policy.js';
import {hyperInfo} from './hyperliquid-trading.js';
import {newHyperliquidSetupAction,checkedHyperliquidSetupAction,verifyHyperliquidSetupSignature} from './hyperliquid-account-setup.js';
const check=(value,message)=>{if(!value)throw Error(message);},base='/api/hyperliquid-testnet/funding';
async function read(path,body,signal){
 const response=await fetch(base+path,{method:body?'POST':'GET',credentials:'same-origin',redirect:'error',cache:'no-store',headers:body?{'Content-Type':'application/json'}:{},...(body?{body:JSON.stringify(body)}:{}),signal:signal??AbortSignal.timeout(40000)});
 const raw=await response.text();check(raw.length<=16000,'The funding response could not be read.');const value=JSON.parse(raw);check(response.ok,typeof value.error==='string'&&value.error.length<=300?value.error:'Testnet funding is unavailable. Keep this request and check again.');checkedHyperliquidDomain(value);check([1,2].includes(value.version),'The funding response could not be read.');return value;
}
export async function readHyperliquidFundingConfiguration({signal}={}){const value=await read('',null,signal);check(value.version===2,'The testnet funding service needs updating.');const grants=HYPERLIQUID_TESTNET_GRANTS;check(typeof value.available==='boolean'&&value.grants?.spotUSDC===grants.spotUSDC&&value.grants?.perpsUSDC===grants.perpsUSDC&&[null,'operator_unconfigured','operator_unfunded','operator_unavailable'].includes(value.reason),'The funding service could not be read.');return value;}
export async function readHyperliquidFundingRequest(account){return (await readHyperFunding()).find(row=>row.request.account===account)??null;}
export async function reviewHyperliquidFundingAccount(account,{signal}={}){
 check(typeof account==='string'&&/^0x[0-9a-f]{40}$/.test(account),'Connect the receiving wallet first.');
 const mode=await hyperInfo({type:'userAbstraction',user:account},{signal});
 if(mode==='disabled')return {account,mode,setupAction:null,expiresAt:Date.now()+60000};
 check(mode==='default','This account already uses another margin mode. Lenz will not change it.');
 const [spot,perps,orders]=await Promise.all([hyperInfo({type:'spotClearinghouseState',user:account},{signal}),hyperInfo({type:'clearinghouseState',user:account},{signal}),hyperInfo({type:'openOrders',user:account},{signal})]);
 check(Array.isArray(spot?.balances)&&spot.balances.every(row=>orderAmount(row.total)===0n&&orderAmount(row.hold)===0n)&&Array.isArray(perps?.assetPositions)&&perps.assetPositions.length===0&&orderAmount(perps.withdrawable)===0n&&orderAmount(perps.marginSummary?.totalRawUsd)===0n&&orderAmount(perps.marginSummary?.accountValue)===0n&&Array.isArray(orders)&&orders.length===0,'Standard mode setup requires a new empty account with no positions or orders.');
 const retained=(await readHyperSetups()).find(row=>row.action.user===account),now=Date.now(),setupAction=retained&&retained.state!=='not_sent'?retained.action:newHyperliquidSetupAction(account,now);
 return {account,mode,setupAction,expiresAt:now+60000};
}
export async function ensureHyperliquidFundingAccount(lease,review,{publicConsent=false,assertCurrent=()=>{}}={}){
 check(publicConsent===true&&review?.account===lease.identity.address,'Review the testnet account setup first.');check(Number.isSafeInteger(review.expiresAt)&&Date.now()<review.expiresAt&&review.expiresAt<=Date.now()+60000,'Account setup review expired. Review again.');assertCurrent();lease.assertCurrent();
 const current=await reviewHyperliquidFundingAccount(review.account);assertCurrent();lease.assertCurrent();
 if(current.mode==='disabled'){
  const row=(await readHyperSetups()).find(row=>row.action.user===review.account);if(row?.signature)await updateHyperSetups(rows=>{rows.find(item=>item.action.user===review.account).state='confirmed';});return;
 }
 const action=checkedHyperliquidSetupAction(review.setupAction);check(action.user===review.account&&action.nonce<=Date.now()+1000&&action.nonce>Date.now()-172800000+60000,'The retained account permission is outside the usable nonce window.');
 let reserved=false,row=await updateHyperSetups(rows=>{assertCurrent();lease.assertCurrent();let old=rows.find(item=>item.action.user===review.account);if(!old||old.state==='not_sent'){if(old)rows.splice(rows.indexOf(old),1);old={action,signature:null,state:'awaiting_wallet'};rows.push(old);reserved=true;}check(JSON.stringify(old.action)===JSON.stringify(action),'The original account setup is still retained.');return structuredClone(old);});
 check(!['submitting','unknown'].includes(row.state)&&(row.state!=='awaiting_wallet'||reserved),'Account setup confirmation is pending. Check the original request before trying again.');
 if(!row.signature){
  let signature;try{signature=await lease.signHyperliquidSetup(action,review.expiresAt,{retainSignature:signature=>updateHyperSetups(rows=>{const item=rows.find(item=>item.action.user===review.account);check(item&&JSON.stringify(item.action)===JSON.stringify(action)&&item.state==='awaiting_wallet','The account setup changed.');verifyHyperliquidSetupSignature(action,signature);item.signature=signature;item.state='signed';})});}catch(error){if(error?.hyperliquidSetupNotSigned===true)await updateHyperSetups(rows=>{const item=rows.find(item=>item.action.user===review.account);if(item?.state==='awaiting_wallet')item.state='not_sent';});throw error;}
  row={action,signature,state:'signed'};
 }
 assertCurrent();lease.assertCurrent();check(Date.now()<review.expiresAt,'Account setup review expired. Check the retained permission.');
 const signature=verifyHyperliquidSetupSignature(action,row.signature);await updateHyperSetups(rows=>{const item=rows.find(item=>item.action.user===review.account);check(item.state==='signed','The original setup is already being checked.');item.state='submitting';});
 let dispatched=false;try{assertCurrent();lease.assertCurrent();check(Date.now()<review.expiresAt,'Account setup review expired. Check the retained permission.');dispatched=true;const response=await fetch(HYPERLIQUID.api+'/exchange',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',redirect:'error',cache:'no-store',body:JSON.stringify({action,nonce:action.nonce,signature}),signal:AbortSignal.timeout(20000)});check(response.ok,'Account setup response was interrupted.');const value=await response.json();check(value.status==='ok'&&value.response?.type==='default','Account setup could not be confirmed.');}finally{await updateHyperSetups(rows=>{const item=rows.find(item=>item.action.user===review.account);if(item.state==='submitting')item.state=dispatched?'unknown':'signed';});}
 assertCurrent();lease.assertCurrent();const mode=await hyperInfo({type:'userAbstraction',user:review.account});check(mode==='disabled','Account setup confirmation is pending. Check the original request before trying again.');await updateHyperSetups(rows=>{rows.find(item=>item.action.user===review.account).state='confirmed';});
}
export async function readHyperliquidFundingRecovery(account,{signal}={}){
 check(typeof account==='string'&&/^0x[0-9a-f]{40}$/.test(account),'Connect the receiving wallet first.');const value=await read('/recover',{version:1,account,chainId:HYPERLIQUID.chainId},signal);check(value.account===account&&['pending','confirmed','rejected','not_found','unavailable'].includes(value.state),'The recovered funding request belongs to another wallet.');
 if(value.request){const request=checkedHyperFundingRequest(value.request);check(request.account===account&&Number.isSafeInteger(value.createdAt)&&value.createdAt>0&&value.createdAt<=Date.now()+5000,'The recovered funding request could not be verified.');}else check(['not_found','unavailable'].includes(value.state),'The recovered funding request is missing.');return value;
}
export async function requestHyperliquidTestnetFunding(account,{signal,assertCurrent=()=>{},publicConsent=false,reviewedGrants}={}){
 check(publicConsent===true,'Testnet funding transfers are public. Review and accept the public route before requesting funds.');
 check(typeof account==='string'&&/^0x[0-9a-f]{40}$/.test(account)&&!/^0x0{40}$/.test(account),'Connect the receiving wallet first.');assertCurrent();
 const existing=await readHyperliquidFundingRequest(account);assertCurrent();let recovered=null;if(!existing||existing.state==='unavailable')recovered=await readHyperliquidFundingRecovery(account,{signal});assertCurrent();
 const request=await updateHyperFunding(rows=>{assertCurrent();let row=rows.find(row=>row.request.account===account);if(recovered?.request&&(!row||row.state==='unavailable')&&(recovered.state==='pending'||Date.now()-recovered.createdAt<=86400000)){if(row)rows.splice(rows.indexOf(row),1);row={request:recovered.request,createdAt:recovered.createdAt,state:recovered.state};rows.push(row);}if(!row||['confirmed','rejected'].includes(row.state)&&Date.now()-row.createdAt>86400000){const next={request:{version:2,id:crypto.randomUUID(),account,chainId:HYPERLIQUID.chainId,grants:{...HYPERLIQUID_TESTNET_GRANTS}},createdAt:Date.now(),state:'pending'};if(row)rows.splice(rows.indexOf(row),1);rows.push(next);row=next;}return structuredClone(row.request);});
 const grants=hyperFundingGrants(request);check(reviewedGrants===undefined||reviewedGrants.spotUSDC===grants.spotUSDC&&reviewedGrants.perpsUSDC===grants.perpsUSDC,'The funding amounts changed. Review the retained request again.');
 assertCurrent();const value=await read('/request',request,signal);check(value.id===request.id&&value.account===account&&['pending','confirmed','rejected','unavailable'].includes(value.state),'The funding response belongs to another request.');
 const receipts=value.receipts??[];check(Array.isArray(receipts)&&receipts.length<=2&&new Set(receipts.map(row=>row.bucket)).size===receipts.length,'The funding receipts could not be read.');for(const r of receipts)check(['spot','perps'].includes(r.bucket)&&r.amount===hyperFundingAmount(request,r.bucket)&&/^0x[0-9a-f]{64}$/.test(r.hash)&&Number.isSafeInteger(r.time)&&orderAmount(r.fee)<=10n**18n,'The funding receipt could not be read.');check(value.state!=='confirmed'||receipts.length===2,'The funding transfer is not confirmed.');
 await updateHyperFunding(rows=>{const row=rows.find(row=>row.request.id===request.id);check(row,'The retained funding request is missing.');row.state=value.state;});assertCurrent();if(value.state==='confirmed')try{await refreshHyperliquidHoldings(account,{signal,assertCurrent});}catch{}assertCurrent();return value;
}
