// Rehearses the exact reserve upgrade on an isolated faucet-funded testnet account.
import assert from 'node:assert/strict';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {Account,KeyPair,actions,teraToGas} from 'near-api-js';
import {provider,relayAccount,call,view,finalReceipt} from './client.mjs';
import {createIdentity,signValue,randomId} from '../web/public/peer-crypto.js';
import {emptyNearVault,fundingRequest,makeNearPayment,acceptNearPayment} from '../web/public/near-protocol.js';
import {makeDepositRequest} from '../web/public/near-deposit.js';
const base=new URL('./upgrade/',import.meta.url);await mkdir(base,{recursive:true});
const file=new URL('rehearsal.json',base),keys=new URL('./.testnet/reentry-rehearsal.json',import.meta.url);
const old=await readFile(new URL('./upgrade/reserve-v1.wasm',import.meta.url));
const next=await readFile(new URL('./target/wasm32-unknown-unknown/release/lenz_test_dollar.wasm',import.meta.url));
const sha=b=>createHash('sha256').update(b).digest('hex'),payer=await relayAccount();
let k;try{k=JSON.parse(await readFile(keys,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;const pair=KeyPair.fromRandom('ed25519');k={accountId:`lenz-reentry-${Date.now()}.testnet`,privateKey:pair.toString(),publicKey:pair.getPublicKey().toString()};await writeFile(keys,JSON.stringify(k),{flag:'wx',mode:0o600});}
let ev;try{ev=JSON.parse(await readFile(file,'utf8'));assert.equal(ev.newSha256,sha(next));assert.equal(ev.contract,k.accountId);}catch(e){if(e.code!=='ENOENT')throw e;}
const contract=k.accountId;assert(/^lenz-reentry-[0-9]+\.testnet$/.test(contract));
ev??={contract,payer:payer.accountId,oldSha256:sha(old),newSha256:sha(next),steps:{},checks:[]};
async function save(){ev.checkedAt=new Date().toISOString();await writeFile(file,JSON.stringify(ev,null,2)+'\n',{flush:true});}
async function step(name,fn){if(ev.steps[name])return ev.steps[name];try{const r=await fn();ev.steps[name]=r??true;await save();console.log('PASS '+name);return r;}catch(e){ev.failure={step:name,message:e.message};await save();throw e;}}
async function snapshot(){const r=await provider.sendJsonRpc('query',{request_type:'view_state',finality:'final',account_id:contract,prefix_base64:'',include_proof:false});return r.values.sort((a,b)=>a.key.localeCompare(b.key));}
if(!ev.fixture){
  const [a,b,c]=await Promise.all(['Reentry A','Reentry B','Reentry C'].map(createIdentity));const funding=await fundingRequest(a,contract,'100');
  const v=emptyNearVault(contract);v.roots.push({id:funding.id,owner:funding.owner,amount:funding.amount});
  const ab=await makeNearPayment(v,a,b.profile,'20'), vb=(await acceptNearPayment(emptyNearVault(contract),b,a.profile,ab.payload)).vault;
  const bc=await makeNearPayment(vb,b,c.profile,'8');const {digest}=await import('../web/public/peer-crypto.js');const {transferTerms}=await import('../web/public/near-protocol.js');
  const input=(await digest(transferTerms(contract,bc.payload.path.at(-1))))+':0',nonce=randomId();
  const redemption={input,receiver_id:payer.accountId,nonce,signature:await signValue(c,['lenz/near-redeem/v1','testnet',contract,input,payer.accountId,nonce])};
  const deposit=await makeDepositRequest(a,contract,payer.accountId,'3000000','ab'.repeat(32));
  const dv=emptyNearVault(contract);dv.roots.push({id:deposit.id,owner:deposit.owner,amount:deposit.amount});
  const db=await makeNearPayment(dv,a,b.profile,'2'), dbv=(await acceptNearPayment(emptyNearVault(contract),b,a.profile,db.payload)).vault;
  const dc=await makeNearPayment(dbv,b,c.profile,'1'),finalInput=(await digest(transferTerms(contract,dc.payload.path.at(-1))))+':0',finalNonce=randomId();
  const finalRedemption={input:finalInput,receiver_id:payer.accountId,nonce:finalNonce,signature:await signValue(c,['lenz/near-redeem/v1','testnet',contract,finalInput,payer.accountId,finalNonce])};
  const excessive=await makeDepositRequest(a,contract,payer.accountId,'9000000','bc'.repeat(32)),otherAmount=await makeDepositRequest(a,contract,payer.accountId,'2000000',deposit.source);
  ev.fixture={funding,path:bc.payload.path,redemption,deposit,onward:dc.payload.path,finalRedemption,excessive,otherAmount};await save();
}
let state;try{state=await provider.viewAccount({accountId:contract,blockQuery:{finality:'final'}});}catch(e){if(!/does not exist|UNKNOWN_ACCOUNT/i.test(e.message))throw e;}
if(!state){const r=await fetch('https://helper.testnet.near.org/account',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({newAccountId:contract,newAccountPublicKey:k.publicKey}),signal:AbortSignal.timeout(45000)});assert(r.ok,'Faucet did not create rehearsal account');for(let n=0;n<15;n++){try{state=await provider.viewAccount({accountId:contract,blockQuery:{finality:'final'}});break;}catch(e){if(n===14)throw e;await new Promise(r=>setTimeout(r,2000));}}}
const account=new Account(contract,provider,k.privateKey),f=ev.fixture;
const args=r=>({owner:r.owner,amount:r.amount,source:r.source,signature:r.signature});
await step('deploy original Wasm',async()=>{assert.equal(state.code_hash,'11111111111111111111111111111111','Existing rehearsal code needs reconciliation');return finalReceipt(await account.signAndSendTransaction({receiverId:contract,actions:[actions.deployContract(old),actions.functionCall('new',{},teraToGas('100'),0n)],waitUntil:'FINAL'}));});
await step('fund original reserve',()=>{const {id,...a}=f.funding;return call(payer,contract,'fund_test',a,'0.03');});
await step('settle old offline path',()=>call(payer,contract,'settle',{path:f.path},'0.1'));
await step('register old balance account',()=>call(payer,contract,'storage_deposit',{account_id:payer.accountId,registration_only:true},'0.02'));
await step('redeem old note',()=>call(payer,contract,'redeem',f.redemption,'0.02'));
await step('snapshot old storage',snapshot);
await step('upgrade code without initializer',async()=>finalReceipt(await account.signAndSendTransaction({receiverId:contract,actions:[actions.deployContract(next)],waitUntil:'FINAL'})));
await step('all old state bytes survive upgrade',async()=>{const after=await snapshot();assert.deepEqual(after,ev.steps['snapshot old storage']);assert.deepEqual(await view(contract,'capabilities',{}),['deposit_offline_v1']);return {entries:after.length,sha256:sha(JSON.stringify(after))};});
await step('insufficient balance and storage revert all changes',async()=>{
  const before=await snapshot();const failures=[];
  for(const [r,deposit,pattern] of [[f.excessive,'0.03',/enough balance/],[f.deposit,'0.000000000000000000000001',/Attach enough/]]){
    let failure;try{await call(payer,contract,'deposit_offline',args(r),deposit);}catch(e){assert.match(e.message,pattern);failure=e.message;}assert(failure);failures.push(failure);assert.deepEqual(await snapshot(),before);
  }return failures;
});
await step('deposit existing tUSD into fresh backed note',async()=>{const tx=await call(payer,contract,'deposit_offline',args(f.deposit),'0.03');assert.equal(tx.value.id,f.deposit.id);assert.equal(await view(contract,'ft_total_supply',{}),'100000000');assert.equal(await view(contract,'reserved_balance',{}),'95000000');assert.equal(await view(contract,'ft_balance_of',{account_id:payer.accountId}),'5000000');return tx;});
await step('duplicate deposits and changed-source-terms cannot debit twice',async()=>{const before=await snapshot();const retry=await call(payer,contract,'deposit_offline',args(f.deposit),'0.03');assert.equal(retry.value.id,f.deposit.id);await assert.rejects(call(payer,contract,'deposit_offline',args(f.otherAmount),'0.03'),/source already used/);assert.deepEqual(await snapshot(),before);return retry;});
await step('returned value transfers onward and redeems again',async()=>{const settled=await call(payer,contract,'settle',{path:f.onward},'0.1');const redeemed=await call(payer,contract,'redeem',f.finalRedemption,'0.02');assert.equal(await view(contract,'reserved_balance',{}),'94000000');assert.equal(await view(contract,'ft_balance_of',{account_id:payer.accountId}),'6000000');const before=await snapshot();await call(payer,contract,'deposit_offline',args(f.deposit),'0.03');assert.deepEqual(await snapshot(),before);return {settled,redeemed};});
ev.checks=Object.keys(ev.steps);ev.ok=true;delete ev.failure;await save();console.log('Rehearsal passed; configured reserve was not changed.');
