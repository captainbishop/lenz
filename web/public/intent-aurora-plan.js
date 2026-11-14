import {keccak256} from './evm-vendor/offline-budget.js';
import {AURORA_INTENT_DEPLOYMENT as d,AURORA_INTENT_PRIVACY} from './intent-aurora-config.js';
import {AURORA_VAULT_CREATION_CODE} from './intent-aurora-vault-code.js';

export const AURORA_SWAP_CHAIN='eip155:1313161555',AURORA_SWAP_TARGET='aurora-testnet-ltt';
const domain='lenz/aurora-private-swap/v1',field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const check=(ok,message)=>{if(!ok)throw Error(message);};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).sort().join()===keys.slice().sort().join();
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&!/^0x0{40}$/.test(v);
const scalar=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)>0n&&BigInt(v)<field;
const uint=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<(1n<<256n);
const ordered=v=>Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;
export const sameAuroraSwapValue=(a,b)=>JSON.stringify(ordered(a))===JSON.stringify(ordered(b));
const digest=v=>keccak256(new TextEncoder().encode(JSON.stringify(ordered(v)))).slice(2);
const word=v=>BigInt(v).toString(16).padStart(64,'0');
const zero='0x'+'0'.repeat(40);
export function checkAuroraSwapPlan(plan){
 check(exact(plan,['beneficiary','refundRecipient','relayer','relayerFee','minOutput','deadline','salt'])&&address(plan.beneficiary)&&address(plan.refundRecipient)&&plan.relayer===zero&&plan.relayerFee==='0','The fixed private swap recipient or fee changed.');
 check(uint(plan.minOutput)&&BigInt(plan.minOutput)>0n&&BigInt(plan.minOutput)<=BigInt(d.outputAmount)&&uint(plan.deadline)&&BigInt(plan.deadline)>0n&&BigInt(plan.deadline)<=BigInt(Number.MAX_SAFE_INTEGER)&&/^0x[0-9a-f]{64}$/.test(plan.salt)&&!/^0x0{64}$/.test(plan.salt),'The private swap minimum, deadline or salt is invalid.');
 return structuredClone(plan);
}
export function auroraVaultAddress(value){
 const p=checkAuroraSwapPlan(value),terms=[d.inputToken,d.outputToken,d.adapter,d.denomination,p.minOutput,p.deadline,p.beneficiary,p.refundRecipient,d.chainId];
 const initHash=keccak256(AURORA_VAULT_CREATION_CODE+terms.map(word).join(''));
 const salt=keccak256('0x'+[d.chainId,p.beneficiary,p.refundRecipient,p.relayer,p.relayerFee,p.minOutput,p.deadline,p.salt].map(word).join(''));
 return '0x'+keccak256('0xff'+d.factory.slice(2)+salt.slice(2)+initHash.slice(2)).slice(-40);
}
export function auroraSwapSelection(row,{recipient,minimum=d.outputAmount,deadline=Math.floor((Date.now()+300000)/1000)*1000,now=Date.now(),allowExpired=false}={}){
 check(row?.chainId===AURORA_SWAP_CHAIN&&row.asset===d.inputToken&&typeof row.accountId==='string'&&/^[0-9a-f]{64}$/.test(row.accountId)&&scalar(row.commitment),'Choose the original verified private note.');
 check((row.units??row.amount)===d.denomination,'Spend the whole 1 LTS note.');check(address(recipient),'Choose your recoverable Aurora receiving account.');
 check(uint(minimum)&&BigInt(minimum)>0n&&BigInt(minimum)<=BigInt(d.outputAmount),'Enter a positive minimum of up to 2 LTT.');
 check(Number.isSafeInteger(deadline)&&deadline%1000===0&&deadline>0&&(allowExpired||deadline>now&&deadline<=now+300000),'Review an active private swap deadline.');
 return {action:'swap',source:{chainId:AURORA_SWAP_CHAIN,asset:d.inputToken,accountId:row.accountId,amount:d.denomination,commitment:row.commitment},destination:{chainId:AURORA_SWAP_CHAIN,asset:d.outputToken,accountId:recipient,minAmount:minimum},deadline,privacy:'private'};
}
export function checkAuroraSwapSelection(selection,{now=Date.now(),allowExpired=false}={}){
 check(exact(selection,['action','source','destination','deadline','privacy'])&&exact(selection.source,['chainId','asset','accountId','amount','commitment'])&&exact(selection.destination,['chainId','asset','accountId','minAmount']),'The selected private swap changed.');
 const expected=auroraSwapSelection({...selection.source,units:selection.source.amount},{recipient:selection.destination.accountId,minimum:selection.destination.minAmount,deadline:selection.deadline,now,allowExpired});
 check(sameAuroraSwapValue(selection,expected),'The selected private swap changed its asset, account or privacy.');return expected;
}
export function checkAuroraSwapSnapshot(s,{now=Date.now(),allowStale=false,requireVenueFunding=true}={}){
 check(s?.routeId===d.routeId&&s.network==='testnet'&&s.chainId===d.chainHex&&Object.entries(d.codeSha256).every(([name,hash])=>s.codes?.[name]===hash),'The original private route code changed.');
 check(Number.isSafeInteger(s.observedAt)&&s.observedAt>0&&(allowStale||Math.abs(now-s.observedAt)<=120000)&&/^0x[0-9a-f]{64}$/.test(s.block?.hash)&&/^0x[0-9a-f]+$/.test(s.block.number)&&Number.isSafeInteger(s.block.timestamp),'The final private snapshot is unavailable or stale.');
 const p=s.pool;check(p?.address===d.pool&&p.denomination===d.denomination&&p.levels===20&&scalar(p.root)&&Number.isSafeInteger(p.nextIndex)&&p.nextIndex>0&&p.nextIndex<=4096&&Array.isArray(p.commitments)&&p.commitments.length===p.nextIndex&&new Set(p.commitments).size===p.nextIndex&&p.commitments.every(scalar)&&Array.isArray(p.deposits)&&p.deposits.length===p.nextIndex&&p.deposits.every((row,i)=>row.index===i&&row.commitment===p.commitments[i])&&Array.isArray(p.withdrawals)&&p.withdrawals.length<=4096&&p.withdrawals.every(row=>scalar(row.nullifierHash)),'The complete final original pool history is unavailable.');
 check(s.venue?.address===d.adapter&&s.venue.inputAmount===d.denomination&&s.venue.outputAmount===d.outputAmount&&uint(s.venue.outputBalance)&&(!requireVenueFunding||BigInt(s.venue.outputBalance)>=BigInt(d.outputAmount)),'The declared test venue has insufficient output funds.');return structuredClone(s);
}
export function buildAuroraSwapReview(selection,spend,{snapshot,salt,now=Date.now(),allowExpired=false}={}){
 const chosen=checkAuroraSwapSelection(selection,{now,allowExpired}),observed=checkAuroraSwapSnapshot(snapshot,{now,allowStale:allowExpired});
 check(spend?.commitment===chosen.source.commitment&&scalar(spend.nullifierHash)&&spend.root===observed.pool.root&&observed.pool.commitments.includes(spend.commitment)&&!observed.pool.withdrawals.some(row=>row.nullifierHash===spend.nullifierHash),'The original private note is unavailable or spent.');
 check(Array.isArray(spend.pathElements)&&spend.pathElements.length===20&&spend.pathElements.every(v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&BigInt(v)<field)&&Array.isArray(spend.pathIndices)&&spend.pathIndices.length===20&&spend.pathIndices.every(v=>v===0||v===1),'The original private note path is incomplete.');
 const plan=checkAuroraSwapPlan({beneficiary:chosen.destination.accountId,refundRecipient:chosen.destination.accountId,relayer:zero,relayerFee:'0',minOutput:chosen.destination.minAmount,deadline:String(chosen.deadline/1000),salt});
 const core={type:domain,...chosen,routeId:d.routeId,plan,vault:auroraVaultAddress(plan),spend:structuredClone(spend),snapshot:observed};
 return {...core,id:'aurora-swap:'+digest(core),fees:[],authorization:{label:'Confirm private swap'},privacyDisclosure:AURORA_INTENT_PRIVACY,recoveryDisclosure:'The backed-up receiving account controls the result and any refund. Keep the original request if completion is unknown.'};
}
export function checkAuroraSwapReview(review,selection=review,{now=Date.now(),allowExpired=false}={}){
 check(exact(review,['type','action','source','destination','deadline','privacy','routeId','plan','vault','spend','snapshot','id','fees','authorization','privacyDisclosure','recoveryDisclosure']),'The retained private swap review changed.');
 const chosen={action:selection.action,source:selection.source,destination:selection.destination,deadline:selection.deadline,privacy:selection.privacy};
 checkAuroraSwapSelection(chosen,{now,allowExpired});
 const expected=buildAuroraSwapReview(chosen,review.spend,{snapshot:review.snapshot,salt:review.plan?.salt,now,allowExpired:true});
 check(sameAuroraSwapValue(review,expected),'The retained private swap terms changed.');return expected;
}
export function auroraSwapSignals(review){return [review.spend.root,review.spend.nullifierHash,review.vault,review.plan.relayer,review.plan.relayerFee,'0'].map(v=>BigInt(v).toString());}
export function buildAuroraSwapAuthorization(review,result){
 checkAuroraSwapReview(review,review,{allowExpired:true});
 const proof=result?.solidity?.proof,signals=result?.solidity?.publicSignals?.map(v=>BigInt(v).toString());
 check(typeof proof==='string'&&/^0x[0-9a-f]{512}$/.test(proof)&&sameAuroraSwapValue(signals,auroraSwapSignals(review))&&sameAuroraSwapValue(result.publicSignals?.map(v=>BigInt(v).toString()),signals),'The local original proof authorized different public signals.');
 return {intentId:review.id,artifactId:'aurora-proof:'+digest({intentId:review.id,proof,publicSignals:signals}),proof,publicSignals:signals};
}
export function checkAuroraSwapAuthorization(value,review){
 check(exact(value,['intentId','artifactId','proof','publicSignals'])&&value.intentId===review.id,'The original private proof belongs to another request.');
 const expected=buildAuroraSwapAuthorization(review,{solidity:{proof:value.proof,publicSignals:value.publicSignals},publicSignals:value.publicSignals});
 check(sameAuroraSwapValue(value,expected),'The original private proof changed.');return expected;
}
export function auroraSwapPublicRequest(attempt){
 const review=checkAuroraSwapReview(attempt.review,attempt.review,{allowExpired:true}),authorization=checkAuroraSwapAuthorization(attempt.authorization,review);
 return {id:review.id,artifactId:authorization.artifactId,plan:review.plan,vault:review.vault,root:review.spend.root,nullifierHash:review.spend.nullifierHash,proof:authorization.proof,publicSignals:authorization.publicSignals};
}
