import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {AbiCoder,getCreate2Address,keccak256} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {compileSource} from '../aurora/compiler.mjs';
import {AURORA_INTENT_DEPLOYMENT as d} from './public/intent-aurora-config.js';
import {auroraSwapSelection,auroraVaultAddress,buildAuroraSwapReview,checkAuroraSwapReview,checkAuroraSwapAuthorization,buildAuroraSwapAuthorization,auroraSwapPublicRequest,auroraSwapSignals} from './public/intent-aurora-plan.js';

test('the reviewed private result binds the entire owned note and original factory vault',async()=>{
 const row={chainId:'eip155:1313161555',asset:d.inputToken,accountId:'11'.repeat(32),commitment:'0x'+'12'.repeat(32),units:'1000000'};
 const recipient='0x'+'23'.repeat(20),now=1800000000000;
 const selection=auroraSwapSelection(row,{recipient,minimum:'1900000',deadline:now+300000,now});
 assert.equal(selection.source.amount,'1000000');assert.equal(selection.destination.minAmount,'1900000');assert.equal(selection.privacy,'private');
 const plan={beneficiary:recipient,refundRecipient:recipient,relayer:'0x'+'00'.repeat(20),relayerFee:'0',minOutput:'1900000',deadline:'1800000300',salt:'0x'+'34'.repeat(32)};
 const source=await readFile(new URL('../aurora/contracts/PrivateIntent.sol',import.meta.url),'utf8'),compiled=compileSource('PrivateIntent.sol',source,'PrivateIntentVault'),coder=AbiCoder.defaultAbiCoder();
 const terms=[d.inputToken,d.outputToken,d.adapter,1000000,1900000,1800000300,recipient,recipient,d.chainId];
 const init='0x'+compiled.evm.bytecode.object+coder.encode(['tuple(address,address,address,uint256,uint256,uint256,address,address,uint256)'],[terms]).slice(2);
 const salt=keccak256(coder.encode(['uint256','tuple(address,address,address,uint256,uint256,uint256,bytes32)'],[d.chainId,Object.values(plan)]));
 assert.equal(auroraVaultAddress(plan),getCreate2Address(d.factory,salt,keccak256(init)).toLowerCase());
 assert.throws(()=>auroraSwapSelection({...row,units:'500000'},{recipient,minimum:'1',deadline:now+300000,now}),/whole|1 LTS/);
});

export function privateReviewFixture(){
 const now=1800000000000,commitment='0x'+'12'.repeat(32),nullifierHash='0x'+'13'.repeat(32),root='0x'+'14'.repeat(32),row={chainId:'eip155:1313161555',asset:d.inputToken,accountId:'11'.repeat(32),commitment,units:'1000000'};
 const selection=auroraSwapSelection(row,{recipient:'0x'+'23'.repeat(20),minimum:'1900000',deadline:now+300000,now});
 const snapshot={routeId:d.routeId,network:'testnet',chainId:d.chainHex,codes:structuredClone(d.codeSha256),observedAt:now,block:{number:'0x1',hash:'0x'+'45'.repeat(32),timestamp:now},pool:{address:d.pool,denomination:d.denomination,levels:20,root,nextIndex:1,commitments:[commitment],deposits:[{index:0,commitment}],withdrawals:[]},venue:{address:d.adapter,inputAmount:d.denomination,outputAmount:d.outputAmount,outputBalance:'8000000'}};
 const spend={commitment,nullifierHash,root,pathElements:Array(20).fill('0x'+'0'.repeat(64)),pathIndices:Array(20).fill(0)},review=buildAuroraSwapReview(selection,spend,{snapshot,salt:'0x'+'34'.repeat(32),now});return {selection,snapshot,spend,review,now};
}
test('a retained private plan rejects changed assets, recipients, roots and proof public signals',()=>{
 const {selection,review,now}=privateReviewFixture();assert.deepEqual(checkAuroraSwapReview(review,selection,{now:now+200000}),review);
 for(const change of [r=>r.plan.beneficiary='0x'+'99'.repeat(20),r=>r.source.commitment='0x'+'19'.repeat(32),r=>r.spend.root='0x'+'15'.repeat(32),r=>r.source.chainId='near:testnet',r=>r.plan.relayerFee='1',r=>r.snapshot.codes.factory='00'.repeat(32)]){const altered=structuredClone(review);change(altered);assert.throws(()=>checkAuroraSwapReview(altered,selection,{now}));}
 const publicSignals=auroraSwapSignals(review),proof='0x'+'56'.repeat(256),authorization=buildAuroraSwapAuthorization(review,{solidity:{proof,publicSignals},publicSignals});
 for(let i=0;i<6;i++){const changed=structuredClone(authorization);changed.publicSignals[i]=(BigInt(changed.publicSignals[i])+1n).toString();assert.throws(()=>checkAuroraSwapAuthorization(changed,review));}
 const request=auroraSwapPublicRequest({review,authorization});assert.equal(request.plan.beneficiary,selection.destination.accountId);assert.equal(request.proof,proof);assert(!JSON.stringify(request).includes(selection.source.commitment));assert(!JSON.stringify(request).includes('pathElements'));assert(!JSON.stringify(request).includes(selection.source.accountId));
 assert.throws(()=>checkAuroraSwapReview(review,review,{now:now+300001}),/deadline/);assert.deepEqual(checkAuroraSwapReview(review,review,{now:now+300001,allowExpired:true}),review);
});

test('private approval waits for exact backups and an interrupted dispatch retains the original proof',async()=>{
 const {createAuroraIntentService,createAuroraSwapSource}=await import('./public/intent-aurora-route.js'),{createIntentWorkspace}=await import('./public/intent-workspace.js');
 const {selection,snapshot,spend,now}=privateReviewFixture(),previousOnline=Object.getOwnPropertyDescriptor(navigator,'onLine');Object.defineProperty(navigator,'onLine',{value:true,configurable:true});
 const priorDispatch=globalThis.dispatchEvent;globalThis.dispatchEvent=()=>true;
 let journal={draft:null,review:null,attempts:[]},original=null,proofs=0,sends=0,blockBackup=true,expectedReview;
 const store={read:async()=>structuredClone(journal),update:async(owner,fn)=>{const next=structuredClone(journal);await fn(next);journal=next;return structuredClone(next);}};
 const identity={chainId:d.chainId,accountId:selection.source.accountId,lenzIdentity:'aa'.repeat(32)},source={identity:()=>identity,capture:()=>({identity,assertCurrent(){},requireRecovery:async()=>{},prepareSpend:async()=>structuredClone(spend),originalSpendAuthority:async()=>original,retainSpendAuthority:async(review,authorization)=>{original=structuredClone(authorization);},prove:async(commitment,input)=>{proofs++;assert.equal(commitment,selection.source.commitment);assert.equal(input.recipient,expectedReview.vault);const publicSignals=auroraSwapSignals(expectedReview);return {solidity:{proof:'0x'+'56'.repeat(256),publicSignals},publicSignals};}})};
 const accountIdentity={chainId:'eip155:1313161555',address:selection.destination.accountId,accountId:selection.destination.accountId,lenzIdentity:identity.lenzIdentity},account={capture:()=>({identity:accountIdentity,assertCurrent(){},requireRecovery:async()=>{}})};
 const service=createAuroraIntentService({source,account,store,now:()=>now,backupAction:async(owner,key,id)=>{assert.equal(owner,identity.lenzIdentity);assert.equal(id,journal.review.id);assert(journal.attempts.some(row=>row.id===id));if(blockBackup)throw Error('Exact action backup unavailable');},fetchImpl:async(path,options)=>{
  const body=JSON.parse(options.body);
  if(path.endsWith('/config'))return Response.json({available:true,execute:true});
  if(path.endsWith('/snapshot'))return Response.json(snapshot);
  if(path.endsWith('/prepare'))return Response.json({available:true,execute:true,...body});
  if(path.endsWith('/submit')){sends++;assert.equal(body.proof,original.proof);throw Error('Lost original submission response');}
  if(path.endsWith('/reconcile'))return Response.json({intentId:body.id,artifactId:body.artifactId,status:'pending'});
  throw Error('Unexpected financial path');
 }});
 try{
  const workspace=createIntentWorkspace({service,source:createAuroraSwapSource(source),store,now:()=>now});await workspace.select(selection);await workspace.prepare();expectedReview=workspace.snapshot().review;
  await assert.rejects(()=>workspace.approve(),/backup unavailable/);assert.equal(proofs,0);assert.equal(sends,0);assert.equal(workspace.snapshot().attempts[0].status,'declined');
  blockBackup=false;await workspace.approve();assert.equal(proofs,1);assert.equal(workspace.snapshot().attempts[0].status,'authorized');
  await assert.rejects(()=>workspace.dispatch(expectedReview.id),/Lost original/);assert.equal(sends,1);assert.equal(workspace.snapshot().attempts[0].status,'submission-unresolved');
  await workspace.reconcile(expectedReview.id);assert.equal(sends,1);assert.equal(proofs,1);assert.deepEqual(workspace.snapshot().attempts[0].authorization,original);
  await assert.rejects(()=>workspace.dispatch(expectedReview.id),/existing request/);assert.equal(sends,1);assert.equal(proofs,1);
 }finally{if(previousOnline)Object.defineProperty(navigator,'onLine',previousOnline);else delete navigator.onLine;globalThis.dispatchEvent=priorDispatch;}
});
