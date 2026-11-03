import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,keccak256} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {pathToFileURL} from 'node:url';
const {reviewTornadoWithdrawal}=await import(process.env.LENZ_TORNADO_REVIEW_MODULE?pathToFileURL(process.env.LENZ_TORNADO_REVIEW_MODULE):new URL('./tornado-withdrawal.mjs',import.meta.url));
const abi=new Interface(['function withdraw(bytes,bytes32,bytes32,address,address,uint256,uint256)']);
const address=n=>'0x'+n.repeat(40),hash=n=>'0x'+n.repeat(64),now=100000;
function fixture(){
 const pin={chainId:'eip155:1',pool:address('1'),denomination:'100000000000000000',verifier:address('2'),codeHash:hash('3')};
 const proof='0x'+'12'.repeat(256),approval={chainId:pin.chainId,pool:pin.pool,recipient:address('4'),relayer:address('5'),fee:'1000000000000000',refund:'0',root:hash('1'),nullifierHash:hash('2'),proofHash:keccak256(proof),minReceive:'99000000000000000',expiresAt:now+60000,disclosure:'tornado-classic-public-withdrawal-v1'};
 const transaction={chainId:pin.chainId,to:pin.pool,value:'0',data:abi.encodeFunctionData('withdraw',[proof,approval.root,approval.nullifierHash,approval.recipient,approval.relayer,approval.fee,approval.refund])};
 const observation={...pin,blockHash:hash('6'),observedAt:now,root:approval.root,knownRoot:true,nullifierHash:approval.nullifierHash,spent:false};
 return {pin,approval,transaction,observation};
}
const run=f=>reviewTornadoWithdrawal(f.pin,f.approval,f.transaction,f.observation,{now});
test('synthetic calldata matches exact public terms without asserting proof, execution or settlement',()=>{
 const result=run(fixture());assert.equal(result.amount,'99000000000000000');assert.equal(result.termsMatch,true);
 assert.equal(result.proofVerified,false);assert.equal(result.executable,false);assert.equal(result.settled,false);assert(Object.isFrozen(result.publicFields));
 assert(result.publicFields.includes('recipient'));assert(result.unverified.includes('snark-proof'));
});
test('recipient, relayer, fee, refund, root, nullifier and proof substitution fail',()=>{
 for(const [key,value] of Object.entries({recipient:address('7'),relayer:address('7'),fee:'1',refund:'1',root:hash('0'),nullifierHash:hash('0'),proofHash:hash('0')})){
  const f=fixture();f.approval[key]=value;assert.throws(()=>run(f),undefined,key);
 }
});
test('network, pool, value and noncanonical calldata fail',()=>{
 for(const [key,value] of Object.entries({chainId:'eip155:8453',to:address('7'),value:'1'})){const f=fixture();f.transaction[key]=value;assert.throws(()=>run(f));}
 for(const change of [s=>s+'00',s=>s.slice(0,-2),s=>'0x00000000'+s.slice(10)]){const f=fixture();f.transaction.data=change(f.transaction.data);assert.throws(()=>run(f));}
});
test('pool/verifier/code/denomination substitution, stale roots and spent notes fail',()=>{
 for(const [key,value] of Object.entries({chainId:'eip155:8453',pool:address('7'),verifier:address('7'),codeHash:hash('7'),denomination:'1',observedAt:now-30001,root:hash('0'),knownRoot:false,nullifierHash:hash('0'),spent:true})){
  const f=fixture();f.observation[key]=value;assert.throws(()=>run(f),undefined,key);
 }
 const f=fixture();f.observation.observedAt=now+1;assert.throws(()=>run(f));
});
test('expired reviews, private-settlement claims and empty received minimums fail',()=>{
 for(const [key,value] of Object.entries({expiresAt:now,disclosure:'private',minReceive:'0'})){const f=fixture();f.approval[key]=value;assert.throws(()=>run(f));}
 const f=fixture();f.approval.minReceive='99000000000000001';assert.throws(()=>run(f));
});
test('spend secrets, social identifiers and unknown fields are rejected at every boundary',()=>{
 for(const part of ['pin','approval','transaction','observation'])for(const key of ['note','secret','seed','viewingKey','contactId','memo','executable']){
  const f=fixture();f[part][key]='must-stay-local';assert.throws(()=>run(f),/Unexpected withdrawal fields/);
 }
});
