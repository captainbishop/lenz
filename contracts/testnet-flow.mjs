// Real testnet integration. Uses fresh, disposable browser-style signing keys.
// Does not open or read the user's browser, identity, contacts or funds.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {createIdentity,signValue,randomId,digest} from '../web/public/peer-crypto.js';
import {fundingRequest,emptyNearVault,makeNearPayment,acceptNearPayment,nearLedger,transferTerms,compressed} from '../web/public/near-protocol.js';
import {configuration,relayAccount,call,view} from './client.mjs';
const config=await configuration();assert(config.ready&&config.network==='testnet');
const contract=config.contract,relay=await relayAccount(),transactions=[],checks=[];
async function check(name,fn){await fn();checks.push(name);console.log('PASS '+name);}
const [a,b,c,d]=await Promise.all(['Integration A','Integration B','Integration C','Integration D'].map(createIdentity));
let root,ab,bc,vc,settled;
await check('tUSD grant is minted and reserved in final NEAR state',async()=>{
  const f=await fundingRequest(a,contract);const {id,...args}=f;
  const tx=await call(relay,contract,'fund_test',args,'0.03');transactions.push({action:'fund',...tx});
  root=await view(contract,'get_root',{id});assert.deepEqual(root,{id,owner:f.owner,amount:'100000000'});
});
await check('A → B → C signatures and onward ownership are produced without RPC calls',async()=>{
  const va=emptyNearVault(contract);va.roots.push(root);
  ab=await makeNearPayment(va,a,b.profile,'20');
  const vb=(await acceptNearPayment(emptyNearVault(contract),b,a.profile,ab.payload)).vault;
  bc=await makeNearPayment(vb,b,c.profile,'8');
  vc=(await acceptNearPayment(emptyNearVault(contract),c,b.profile,bc.payload)).vault;
  assert.equal(bc.payload.path.length,2);
  assert.equal((await nearLedger(vc)).available.find(n=>n.owner===compressed(c.profile.signingPublic)).amount,'8000000');
});
await check('NEAR verifies the browser path and records both transfers',async()=>{
  settled=await call(relay,contract,'settle',{path:bc.payload.path});transactions.push({action:'settle',...settled});
  for(let i=0;i<2;i++){const id=await digest(transferTerms(contract,bc.payload.path[i]));assert.equal(settled.value[i].id,id);assert.equal((await view(contract,'get_receipt',{id})).id,id);}
  const note=settled.value[1].outputs[0];assert.equal(note.amount,'8000000');assert.equal(note.owner,compressed(c.profile.signingPublic));
});
await check('replaying the same path does not create extra value',async()=>{
  const before=await view(contract,'reserved_balance',{});const again=await call(relay,contract,'settle',{path:bc.payload.path});transactions.push({action:'retry',...again});
  assert.deepEqual(again.value,settled.value);assert.equal(await view(contract,'reserved_balance',{}),before);
});
await check('a competing spend is rejected by NEAR',async()=>{
  const va=emptyNearVault(contract);va.roots.push(root);const fork=await makeNearPayment(va,a,d.profile,'30');
  await assert.rejects(call(relay,contract,'settle',{path:fork.payload.path}),/Conflicting spend/);
  assert.equal(await view(contract,'spent_by',{id:root.id}),settled.value[0].id);
});
await check('a failed second signature rolls back the whole path',async()=>{
  const f=await fundingRequest(d,contract,'5');const{id,...args}=f;
  const grant=await call(relay,contract,'fund_test',args,'0.03');transactions.push({action:'rollback-fixture-fund',...grant});
  const vd=emptyNearVault(contract);vd.roots.push({id,owner:f.owner,amount:f.amount});const da=await makeNearPayment(vd,d,a.profile,'2');
  const va=(await acceptNearPayment(emptyNearVault(contract),a,d.profile,da.payload)).vault;
  const ac=await makeNearPayment(va,a,c.profile,'1');ac.payload.path[1].signature='0'.repeat(128);
  await assert.rejects(call(relay,contract,'settle',{path:ac.payload.path}),/Signature rejected/);
  assert.equal(await view(contract,'spent_by',{id}),null);
});
await check('recipient redeems the settled note into an actual NEP-141 balance',async()=>{
  const registration=await call(relay,contract,'storage_deposit',{account_id:relay.accountId,registration_only:true},'0.02');transactions.push({action:'register-redemption',...registration});
  const input=settled.value[1].outputs[0].id,nonce=randomId();
  const signature=await signValue(c,['lenz/near-redeem/v1','testnet',contract,input,relay.accountId,nonce]);
  const before=BigInt(await view(contract,'ft_balance_of',{account_id:relay.accountId}));
  const tx=await call(relay,contract,'redeem',{input,receiver_id:relay.accountId,nonce,signature},'0.01');transactions.push({action:'redeem',...tx});
  assert.equal(BigInt(await view(contract,'ft_balance_of',{account_id:relay.accountId}))-before,8000000n);
});
const result={network:'testnet',contract,checkedAt:new Date().toISOString(),passed:checks.length,checks,transactions,
  scope:'Real NEAR testnet funding, P-256 signatures, atomic settlement, duplicate/conflict rejection and NEP-141 redemption. Offline phase uses the browser protocol module in Node; separate Edge tests cover actual offline browser handover.'};
await writeFile(new URL('./testnet-results.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log('Evidence saved to contracts/testnet-results.json');
