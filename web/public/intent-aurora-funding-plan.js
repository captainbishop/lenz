import {base58,base64} from './intents-vendor/codecs.js';
import {AURORA_INTENT_DEPLOYMENT as deployment} from './intent-aurora-config.js';

const domain='lenz/aurora-test-funds/v1',recipient='lenz-aurora-testnet-faucet';
const field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const check=(ok,message)=>{if(!ok)throw Error(message);};
const exactKeys=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join()===keys.sort().join();
const equal=(left,right)=>JSON.stringify(left)===JSON.stringify(right);
export function auroraFundingOwner(publicKey){
 check(typeof publicKey==='string'&&publicKey.startsWith('ed25519:'),'Choose the original funding identity.');
 const raw=base58.decode(publicKey.slice(8));check(raw.length===32&&base58.encode(raw)===publicKey.slice(8),'The funding identity is invalid.');
 return Array.from(raw,value=>value.toString(16).padStart(2,'0')).join('');
}
export function buildAuroraFundingReview(owner,{nonce,deadline,commitment},{now=Date.now(),allowExpired=false}={}){
 check(typeof owner==='string'&&/^[0-9a-f]{64}$/.test(owner)&&!/^0{64}$/.test(owner),'Choose a test funding identity.');
 check(typeof commitment==='string'&&/^0x[0-9a-f]{64}$/.test(commitment)&&BigInt(commitment)>0n&&BigInt(commitment)<field,'Choose the original pool commitment.');
 const raw=base64.decode(nonce);check(raw.length===32&&base64.encode(raw)===nonce&&raw.some(value=>value!==0),'The funding nonce is invalid.');
 check(Number.isSafeInteger(deadline)&&deadline>0&&(allowExpired||deadline>now&&deadline<=now+300000),'Review an active test funding request.');
 const id='aurora-funds:'+Array.from(raw,value=>value.toString(16).padStart(2,'0')).join('');
 const message={domain,id,network:'testnet',chainId:deployment.chainId,owner,pool:deployment.pool,inputAsset:deployment.inputToken,amount:deployment.denomination,commitment,deadline};
 return {type:domain,id,owner,network:'testnet',chainId:deployment.chainId,pool:deployment.pool,inputAsset:deployment.inputToken,amount:deployment.denomination,commitment,deadline,privacy:'pool-withdrawal',payload:{message:JSON.stringify(message),nonce,recipient}};
}
export function checkAuroraFundingReview(review,{now=Date.now(),allowExpired=false}={}){
 check(exactKeys(review,['type','id','owner','network','chainId','pool','inputAsset','amount','commitment','deadline','privacy','payload'])&&exactKeys(review.payload,['message','nonce','recipient']),'The original private funding review changed.');
 const expected=buildAuroraFundingReview(review.owner,{nonce:review.payload.nonce,deadline:review.deadline,commitment:review.commitment},{now,allowExpired});
 check(equal(review,expected),'The original private funding terms changed.');return structuredClone(expected);
}
export function checkAuroraFundingSigned(signed,review){
 checkAuroraFundingReview(review,{allowExpired:true});
 check(exactKeys(signed,['standard','payload','public_key','signature'])&&signed.standard==='nep413'&&equal(signed.payload,review.payload)&&auroraFundingOwner(signed.public_key)===review.owner,'The funding approval belongs to another request.');
 check(typeof signed.signature==='string'&&signed.signature.startsWith('ed25519:'),'The funding approval is invalid.');
 const signature=base58.decode(signed.signature.slice(8));check(signature.length===64&&base58.encode(signature)===signed.signature.slice(8),'The funding approval is invalid.');return structuredClone(signed);
}
export function checkAuroraFundingPayload(payload,owner){
 check(exactKeys(payload,['message','nonce','recipient']),'The sponsored funding permission changed.');
 let message;try{message=JSON.parse(payload.message);}catch{throw Error('The sponsored funding permission is invalid.');}
 const review=buildAuroraFundingReview(owner,{nonce:payload.nonce,deadline:message.deadline,commitment:message.commitment});
 check(equal(payload,review.payload),'The sponsored funding permission changed.');return review;
}
export const AURORA_FUNDING_DISCLOSURE='Lenz deposits one test LTS into the original pool for your browser-generated commitment. Your note secrets stay in your encrypted account backup. Pool funding, commitment and operator are public; the original withdrawal proof hides which commitment is spent. Lenz and network providers may correlate requests. Beneficiary, refund account and trade terms remain public.';
