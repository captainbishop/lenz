import {decodeTornadoWithdrawal} from '../aurora/tornado-codec.mjs';
import {immutable} from '../web/public/defi-catalog.js';

const field=21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const check=(ok,message)=>{if(!ok)throw Error(message);};
function record(value,keys){check(value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...keys].sort().join(','),'Unexpected withdrawal fields');}
function address(value,zero=false){check(typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&(zero||value!=='0x'+'0'.repeat(40)),'Invalid withdrawal address');}
function hash(value){check(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value),'Invalid withdrawal hash');}
function units(value){check(typeof value==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n,'Invalid withdrawal amount');return BigInt(value);}
const time=value=>Number.isSafeInteger(value)&&value>=0;

// A local comparison of public terms, not verification of a SNARK, deployment,
// chain state, user approval or settlement. Do not send a spend note to this API.
// The caller's pin, approval and observation must all come from independent checks.
export function reviewTornadoWithdrawal(pin,approval,transaction,observation,{now=Date.now()}={}){
  record(pin,['chainId','pool','denomination','verifier','codeHash']);
  check(/^eip155:[1-9][0-9]{0,14}$/.test(pin.chainId),'Invalid withdrawal chain');
  address(pin.pool);address(pin.verifier);hash(pin.codeHash);
  const denomination=units(pin.denomination);check(denomination>0n,'Invalid pool denomination');
  record(approval,['chainId','pool','recipient','relayer','fee','refund','root','nullifierHash','proofHash','minReceive','expiresAt','disclosure']);
  check(approval.chainId===pin.chainId&&approval.pool===pin.pool,'Withdrawal pool changed');
  address(approval.recipient);address(approval.relayer,true);
  for(const name of ['root','nullifierHash','proofHash'])hash(approval[name]);
  check(BigInt(approval.root)<field&&BigInt(approval.nullifierHash)<field,'Invalid proof public input');
  const fee=units(approval.fee),minimum=units(approval.minReceive);
  check(minimum>0n&&fee<denomination&&denomination-fee>=minimum,'Withdrawal falls below the received minimum');
  check(fee===0n||approval.relayer!=='0x'+'0'.repeat(40),'A withdrawal fee needs a relayer');
  check(approval.refund==='0','Native withdrawals cannot request a refund');
  check(approval.disclosure==='tornado-classic-public-withdrawal-v1','Public withdrawal disclosure required');
  check(time(now)&&time(approval.expiresAt)&&approval.expiresAt>now&&approval.expiresAt<=now+86400000,'Withdrawal review expired or too far ahead');
  record(transaction,['chainId','to','value','data']);
  check(transaction.chainId===pin.chainId&&transaction.to===pin.pool,'Withdrawal transaction destination changed');
  check(transaction.value==='0','Native withdrawal must not send new funds');
  check(typeof transaction.data==='string'&&/^0x[0-9a-f]{1032}$/.test(transaction.data),'Invalid withdrawal calldata');
  const decoded=decodeTornadoWithdrawal(transaction.data);
  check(/^0x[0-9a-f]{512}$/.test(decoded.proof),'Invalid withdrawal proof encoding');
  for(const name of ['root','nullifierHash','recipient','relayer','fee','refund','proofHash'])check(decoded[name]===approval[name],'Withdrawal proof or terms changed');
  record(observation,['chainId','pool','denomination','verifier','codeHash','blockHash','observedAt','root','knownRoot','nullifierHash','spent']);
  for(const name of ['chainId','pool','denomination','verifier','codeHash'])check(observation[name]===pin[name],'Withdrawal pool observation changed');
  hash(observation.blockHash);
  check(time(observation.observedAt)&&observation.observedAt<=now&&observation.observedAt>=now-30000,'Withdrawal state needs refreshing');
  check(observation.root===approval.root&&observation.knownRoot===true,'Withdrawal root is not available');
  check(observation.nullifierHash===approval.nullifierHash&&observation.spent===false,'Withdrawal note is spent or unknown');
  return immutable({kind:'tornado-withdrawal-review',chainId:pin.chainId,pool:pin.pool,recipient:approval.recipient,
    amount:(denomination-fee).toString(),fee:approval.fee,checkedAt:now,expiresAt:Math.min(approval.expiresAt,observation.observedAt+30000),
    termsMatch:true,executable:false,proofVerified:false,settled:false,
    publicFields:['pool','recipient','relayer','denomination','fee','nullifierHash'],
    unverified:['deployment-and-verifier','snark-proof','canonical-chain-state','network-fees','independent-approval','submission-and-recovery']});
}
