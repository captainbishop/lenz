import {HYPERLIQUID} from './hyperliquid-environment.js';

export const HYPERLIQUID_TESTNET_GRANTS=Object.freeze({spotUSDC:'12',perpsUSDC:'3'});
const exact=(value,keys)=>value&&Object.keys(value).sort().join(',')===keys.sort().join(',');
const check=(value,message)=>{if(!value)throw Error(message);};
export function checkedHyperFundingRequest(request){
 check(exact(request,request?.version===1?['version','id','account','chainId']:['version','id','account','chainId','grants'])&&[1,2].includes(request.version)&&request.chainId===HYPERLIQUID.chainId&&typeof request.account==='string'&&/^0x[0-9a-f]{40}$/.test(request.account)&&!/^0x0{40}$/.test(request.account)&&typeof request.id==='string'&&/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(request.id),'Invalid testnet funding request.');
 if(request.version===2)check(exact(request.grants,['spotUSDC','perpsUSDC'])&&request.grants.spotUSDC===HYPERLIQUID_TESTNET_GRANTS.spotUSDC&&request.grants.perpsUSDC===HYPERLIQUID_TESTNET_GRANTS.perpsUSDC,'The testnet grant amounts changed.');
 return structuredClone(request);
}
export function hyperFundingGrants(request){checkedHyperFundingRequest(request);return request.version===1?{spotUSDC:'100',perpsUSDC:'100'}:{...request.grants};}
export function hyperFundingAmount(request,bucket){check(['spot','perps'].includes(bucket),'Invalid funding balance.');return hyperFundingGrants(request)[bucket==='spot'?'spotUSDC':'perpsUSDC'];}
