import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, digest } from './public/peer-crypto.js';
import { emptyNearVault, fundingRequest, makeNearPayment, acceptNearPayment, nearLedger, compressed, transferTerms, units, displayUnits } from './public/near-protocol.js';

const contract = 'reserve.lenz.testnet';
async function fixture() {
  const [a,b,c] = await Promise.all(['Amina','Bola','Chidi'].map(createIdentity));
  const request = await fundingRequest(a, contract);
  const va = emptyNearVault(contract); va.roots.push({ id: request.id, owner: request.owner, amount: request.amount });
  const ab = await makeNearPayment(va, a, b.profile, '20');
  const vb = (await acceptNearPayment(emptyNearVault(contract), b, a.profile, ab.payload)).vault;
  const bc = await makeNearPayment(vb, b, c.profile, '8');
  return {a,b,c,va,ab,vb,bc};
}
test('wallet starts at zero; tUSD precision never uses floating point', async () => {
  assert.equal((await nearLedger(emptyNearVault(contract))).available.length, 0);
  assert.equal(units('0.000001'), '1'); assert.equal(displayUnits('123456789'), '123.456789');
  for (const bad of ['0','1e3','-1','01','1.0000001','Infinity']) assert.throws(()=>units(bad));
});
test('offline A → B → C keeps ancestry and conserves each base unit', async () => {
  const {a,b,c,ab,bc} = await fixture(); assert.equal(bc.payload.path.length, 2);
  const vc = (await acceptNearPayment(emptyNearVault(contract), c, b.profile, bc.payload)).vault;
  const ledger = await nearLedger(vc);
  assert.equal(ledger.available.reduce((n,v)=>n+BigInt(v.amount),0n), 100000000n);
  for (const [who,value] of [[a,'80000000'],[b,'12000000'],[c,'8000000']]) {
    assert.equal(ledger.available.find(n=>n.owner===compressed(who.profile.signingPublic)).amount,value);
  }
  assert.equal((await nearLedger(ab.vault)).available.filter(n=>n.owner===compressed(a.profile.signingPublic)).length,1);
});
test('reimport is idempotent and altered recipients, amounts and signatures fail', async () => {
  const {a,b,c,ab,vb} = await fixture();
  assert.equal((await acceptNearPayment(vb,b,a.profile,ab.payload)).duplicate,true);
  for (const mutate of [p=>p.path[0].amount='21',p=>p.path[0].recipient=compressed(c.profile.signingPublic),p=>p.path[0].signature='00'.repeat(64)]) {
    const p=structuredClone(ab.payload); mutate(p);
    await assert.rejects(acceptNearPayment(emptyNearVault(contract),b,a.profile,p), /signature rejected/i);
  }
});
test('rejects unknown contract, missing ancestry and competing spends', async () => {
  const {a,b,c,va,vb,bc} = await fixture();
  const truncated=structuredClone(bc.payload);truncated.path.shift();
  await assert.rejects(acceptNearPayment(emptyNearVault(contract),c,b.profile,truncated), /missing/);
  await assert.rejects(acceptNearPayment(emptyNearVault('other.testnet'),c,b.profile,bc.payload), /another network/);
  const fork=await makeNearPayment(va,a,b.profile,'30');
  await assert.rejects(acceptNearPayment(vb,b,a.profile,fork.payload), /Conflicting/);
});
test('outer sender and last recipient must match the signed transfer', async () => {
  const {a,b,c,ab} = await fixture();
  await assert.rejects(acceptNearPayment(emptyNearVault(contract),c,a.profile,ab.payload), /another person/);
  await assert.rejects(acceptNearPayment(emptyNearVault(contract),b,c.profile,ab.payload), /sender does not own/);
});
test('a conflicting settled ancestor removes downstream value from availability', async () => {
  const {b,c,bc}=await fixture();const vc=(await acceptNearPayment(emptyNearVault(contract),c,b.profile,bc.payload)).vault;
  vc.chainConsumed={[vc.roots[0].id]:'conflicting-transaction'};
  const ledger=await nearLedger(vc);assert.equal(ledger.available.length,0);assert(ledger.blocked.size>=3);
});
test('root funding id commits to exact grant and network; spend ids exclude malleable signatures', async () => {
  const {a,ab} = await fixture(); const r=await fundingRequest(a,contract,'25');
  assert.equal(r.id,'root:'+await digest(['lenz/near-fund/v1','testnet',contract,r.owner,'25000000',r.nonce]));
  const spend=ab.payload.path[0], before=await digest(transferTerms(contract,spend));
  assert.equal(before,await digest(transferTerms(contract,{...spend,signature:'00'.repeat(64)})));
});
