import {SigningKey,computeAddress,recoverAddress,TypedDataEncoder,keccak256} from './evm-vendor/offline-budget.js';
import {sealMessage,openMessage} from './peer-crypto.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join(',')===[...keys].sort().join(',');
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&!/^0x0{40}$/.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const uint=(v,bits)=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<2n**BigInt(bits);
export const PUBLIC_BUDGET_REHEARSAL=keccak256(new TextEncoder().encode('lenz/public-local-rehearsal/v1'));
export const BUDGET_ORDER_TYPES=Object.freeze({Order:Object.freeze([
 ['budgetId','uint256'],['nonce','uint256'],['amount','uint128'],['minOutput','uint128'],['fee','uint128'],['feeRecipient','address'],['deadline','uint64'],['dataHash','bytes32'],['privacyPolicy','bytes32'],
].map(([name,type])=>Object.freeze({name,type})))});
const orderKeys=BUDGET_ORDER_TYPES.Order.map(v=>v.name);
function domain(value){
 check(exact(value,['name','version','chainId','verifyingContract'])&&value.name==='LenzOfflineBudget'&&value.version==='1'&&value.chainId==='31337'&&address(value.verifyingContract),'Unsupported budget deployment.');
 return structuredClone(value);
}
export function checkBudgetPolicy(value){
 check(exact(value,['domain','signer','budgetId','privacyPolicy'])&&address(value.signer)&&uint(value.budgetId,256)&&value.budgetId!=='0','Missing independently checked budget.');
 domain(value.domain);check(value.privacyPolicy===PUBLIC_BUDGET_REHEARSAL,'Private budget execution for this privacy policy is not connected.');
 return structuredClone(value);
}
export function checkBudgetOrder(value){
 check(exact(value,orderKeys),'Invalid budget order fields.');
 for(const f of ['budgetId','nonce'])check(uint(value[f],256),'Invalid budget counter.');
 for(const f of ['amount','minOutput','fee'])check(uint(value[f],128),'Invalid budget amount.');
 check(value.budgetId!=='0'&&value.amount!=='0'&&value.minOutput!=='0'&&uint(value.deadline,64)&&address(value.feeRecipient)&&hash(value.dataHash),'Invalid budget terms.');
 // This candidate has no verified private execution route. No fallback is permitted.
 check(value.privacyPolicy===PUBLIC_BUDGET_REHEARSAL,'Private budget execution is not connected.');
 return structuredClone(value);
}
export function budgetDigest(deployment,order){return TypedDataEncoder.hash(domain(deployment),BUDGET_ORDER_TYPES,checkBudgetOrder(order));}
export function budgetNonceKey(packet){const d=domain(packet.domain),o=checkBudgetOrder(packet.order);return[d.chainId,d.verifyingContract,o.budgetId,o.nonce].join(':');}
export function offlineSignerAddress(secret){check(secret instanceof Uint8Array&&secret.length===32,'Invalid offline signing key.');return computeAddress(new SigningKey(secret).publicKey).toLowerCase();}
export function signBudgetOrder(secret,deployment,order){
 check(secret instanceof Uint8Array&&secret.length===32,'Invalid offline signing key.');
 return new SigningKey(secret).sign(budgetDigest(deployment,order)).serialized;
}
export function budgetCallHash(data){check(typeof data==='string'&&/^0x(?:[0-9a-f]{2}){4,16384}$/.test(data),'Invalid budget call data.');return keccak256(data);}
export function checkBudgetPacket(input,expected,{now=Math.floor(Date.now()/1000)}={}){
 const packet=structuredClone(input);
 check(exact(packet,['type','domain','order','data','signature'])&&packet.type==='lenz/offline-budget/v1','Invalid budget packet.');
 const d=domain(packet.domain),o=checkBudgetOrder(packet.order);
 checkBudgetPolicy(expected);
 check(JSON.stringify(d)===JSON.stringify(domain(expected.domain))&&o.budgetId===expected.budgetId&&o.privacyPolicy===expected.privacyPolicy,'Budget destination or privacy policy differs.');
 check(Number.isSafeInteger(now)&&now>=0&&BigInt(o.deadline)>BigInt(now),'Offline instruction expired.');
 check(budgetCallHash(packet.data)===o.dataHash,'Budget call bytes differ.');
 check(typeof packet.signature==='string'&&/^0x[0-9a-f]{130}$/.test(packet.signature),'Invalid offline signature.');
 check(recoverAddress(budgetDigest(d,o),packet.signature).toLowerCase()===expected.signer,'Offline signer differs from funded policy.');
 return packet;
}
export async function sealBudgetPacket(identity,executor,packet,expected,options){
 return sealMessage(identity,executor,checkBudgetPacket(packet,expected,options));
}
export async function openBudgetPacket(identity,sender,envelope,expected,options){
 return checkBudgetPacket(await openMessage(identity,sender,envelope),expected,options);
}
