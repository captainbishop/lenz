import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import net from 'node:net';
import { DatabaseSync } from 'node:sqlite';
import { CHAT_DOMAIN, createIdentity, sealMessage, openMessage, digest, signValue } from '../web/public/peer-crypto.js';
import { emptyNearVault, fundingRequest, nearLedger } from '../web/public/near-protocol.js';
import { prepareRheaSwap } from '../web/public/rhea-protocol.js';
import { makeDepositRequest, refundSource } from '../web/public/near-deposit.js';
import { createDefiRequest, checkDefiRequest, sealDefiRequest, openDefiRequest, openDefiReceipt, defiConflictId,
  DEFI_REQUEST, DEFI_RECEIPT, PUBLIC_TESTNET_DISCLOSURE, MAX_REQUEST_BYTES } from '../web/public/defi-request.js';
import { wrapForCarrier, inboxRequest, carrierPost } from '../web/public/carrier-protocol.js';
import { DefiInbox } from './defi-inbox.mjs';
import { createCarrier } from './server.mjs';

const c = {network:'testnet',adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
const now = 1000000;
const options = {disclosure:PUBLIC_TESTNET_DISCLOSURE,expiresAt:now+60000};
async function fixture(at = now) {
  const owner = await createIdentity('Owner'), executor = await createIdentity('Executor');
  const vault = emptyNearVault(c.reserve), root = await fundingRequest(owner,c.reserve,'10');
  // Synthetic backing only; no faucet, RPC, wallet or signer is opened.
  vault.roots.push({id:root.id,owner:root.owner,amount:root.amount});
  const prepared = await prepareRheaSwap(vault,owner,c,{text:'1',minOutput:'100',receiver:'receiver.testnet',deadlineMs:at+120000},at);
  const operation = {kind:'rhea-swap',packet:prepared.packet};
  const request = await createDefiRequest(owner,executor.profile,c,operation,{...options,expiresAt:at+60000},at);
  const packet = await sealDefiRequest(owner,executor.profile,c,request,at);
  const envelope = await wrapForCarrier(owner,packet,at);
  return {owner,executor,vault,prepared,operation,request,packet,envelope};
}
const check = (f,r,at=now,config=c) => checkDefiRequest(config,f.owner.profile,f.executor.profile,r,at);
const resign = async (identity,r) => {
  const t = [DEFI_REQUEST,r.sender,r.executor,r.createdAt,r.expiresAt,r.disclosure,r.operation];
  r.id = await digest(t); r.signature = await signValue(identity,t); return r;
};
async function temporary(fn) {
  const directory = await mkdtemp(join(tmpdir(),'lenz-defi-inbox-'));
  try { return await fn(directory); }
  finally { assert.equal(dirname(directory),resolve(tmpdir())); await rm(directory,{recursive:true,force:true}); }
}
const setup = (directory,f,extra={}) => new DefiInbox(directory,{identity:f.executor,config:c,now:()=>now,...extra});

test('encrypted handoff binds the chosen executor and preserves all wallet reservations',async()=>{
  const f = await fixture(), before = structuredClone(f.prepared.vault);
  assert.deepEqual(await openDefiRequest(f.executor,f.owner.profile,c,f.packet,now),f.request);
  const outsider = await createIdentity('Outsider');
  await assert.rejects(openDefiRequest(outsider,f.owner.profile,c,f.packet,now),/direction/);
  await assert.rejects(openMessage(outsider,f.owner.profile,f.packet));
  await assert.rejects(openDefiRequest(f.owner,f.executor.profile,c,f.packet,now),/direction/);
  const wire = JSON.stringify(f.envelope);
  for (const secret of ['receiver.testnet',c.reserve,c.adapter,'rhea-swap',f.request.id,f.prepared.packet.instruction.owner,f.prepared.packet.instruction.signature,'Owner']) assert(!wire.includes(secret));
  assert(wire.includes(f.owner.profile.id)); assert(wire.includes(f.executor.profile.id));
  assert.deepEqual(f.prepared.vault,before);
  const ledger = await nearLedger(f.prepared.vault); assert.equal(ledger.reserved.size,1); assert.equal(ledger.available[0].amount,'9000000');
});

test('missing, private-only and changed disclosure consent cannot silently use public execution',async()=>{
  const f = await fixture();
  for (const disclosure of [undefined,null,'shielded','private','']) {
    await assert.rejects(createDefiRequest(f.owner,f.executor.profile,c,f.operation,{...options,disclosure},now),/disclosure/);
    await assert.rejects(check(f,await resign(f.owner,{...f.request,disclosure})),/disclosure/);
  }
});

test('changed owner, executor, network, target, amounts, receiver, signatures and ancestry are rejected',async()=>{
  const f = await fixture();
  const changes = [r=>r.sender='a'.repeat(64),r=>r.executor='b'.repeat(64),r=>r.operation.packet.config.network='mainnet',
    r=>r.operation.packet.config.adapter='evil.testnet',r=>r.operation.packet.instruction.amount='2',
    r=>r.operation.packet.instruction.min_output='1',r=>r.operation.packet.instruction.receiver_id='evil.testnet',
    r=>r.operation.packet.instruction.nonce='0'.repeat(32),r=>r.operation.packet.instruction.redemption_signature='0'.repeat(128),
    r=>r.operation.packet.path=[],r=>r.operation.packet.root.amount='9999999',r=>r.signature='0'.repeat(128),r=>r.id='0'.repeat(64)];
  for (const change of changes) { const r=structuredClone(f.request); change(r); await assert.rejects(check(f,r)); }
  const other = await createIdentity('Other owner');
  const r = await resign(other,{...f.request,sender:other.profile.id});
  await assert.rejects(checkDefiRequest(c,other.profile,f.executor.profile,r,now),/does not own/);
  await assert.rejects(check(f,f.request,now,{...c,poolId:2}));
});

test('outer authorization signature and id are checked independently of the encrypted packet',async()=>{
  const f = await fixture(), r = structuredClone(f.request); r.signature='0'.repeat(128);
  const p = await sealMessage(f.owner,f.executor.profile,r);
  await assert.rejects(openDefiRequest(f.executor,f.owner.profile,c,p,now),/authorization signature/);
  r.signature=f.request.signature;r.expiresAt--;
  await assert.rejects(check(f,r),/id differs/);
  r.id=await digest([DEFI_REQUEST,r.sender,r.executor,r.createdAt,r.expiresAt,r.disclosure,r.operation]);
  await assert.rejects(check(f,r),/authorization signature/);
});

test('unknown actions, fields, oversized packets and extra config cannot reach the inbox',async()=>{
  const f = await fixture();
  for (const change of [r=>r.operation.kind='lending',r=>r.operation.kind='liquidity',r=>r.extra=true,
    r=>r.operation.extra=true,r=>r.operation.packet.config.extra='data',r=>r.operation.packet.root.extra=true,
    r=>r.operation.packet.path[0].extra=true,r=>r.operation.packet.instruction.extra=true,
    r=>r.operation.extra='x'.repeat(MAX_REQUEST_BYTES)]) {
    const r=structuredClone(f.request);change(r);await assert.rejects(check(f,await resign(f.owner,r)));
  }
});

test('request lifetime and signed swap deadline bound acceptance, including authenticated changes',async()=>{
  const f = await fixture();
  for (const at of [f.request.expiresAt,f.request.expiresAt+1,-1,NaN]) await assert.rejects(check(f,f.request,at),/timing/);
  for (const change of [r=>r.createdAt=now+60001,r=>r.expiresAt=now,r=>r.createdAt=-1,
    r=>r.expiresAt=r.createdAt+86400001,r=>r.expiresAt=now+120001,r=>r.expiresAt='1000010']) {
    const r=structuredClone(f.request);change(r);await assert.rejects(check(f,await resign(f.owner,r)));
  }
});

test('refund-return binds its payer, source, amount, reserve and original owner without claiming a refund exists',async()=>{
  const f = await fixture();
  const i = f.operation.packet.instruction;
  const deposit = await makeDepositRequest(f.owner,c.reserve,i.receiver_id,i.amount,await refundSource(c.adapter,f.operation.packet.id));
  const operation = {kind:'rhea-refund-return',packet:f.operation.packet,deposit};
  // Refunds can be returned after a swap deadline; their own approval still expires.
  const r = await createDefiRequest(f.owner,f.executor.profile,c,operation,{...options,expiresAt:now+240000},now+180000);
  assert.deepEqual((await check(f,r,now+180000)).operation.deposit,deposit);
  for (const [contract,payer,amount,source] of [[c.reserve,'other.testnet',i.amount,deposit.source],
    [c.reserve,i.receiver_id,'1',deposit.source],[c.reserve,i.receiver_id,i.amount,'a'.repeat(64)],['other.testnet',i.receiver_id,i.amount,deposit.source]]) {
    const bad = await makeDepositRequest(f.owner,contract,payer,amount,source);
    await assert.rejects(createDefiRequest(f.owner,f.executor.profile,c,{...operation,deposit:bad},options,now),/differs/);
  }
});

test('validation snapshots mutable input before its first asynchronous check',async()=>{
  const f = await fixture(), candidate = structuredClone(f.request), pending = check(f,candidate);
  candidate.operation.packet.instruction.receiver_id='evil.testnet';candidate.executor='0'.repeat(64);
  let checked;
  await assert.doesNotReject(async()=>{checked=await pending;});
  assert.deepEqual(checked,f.request);
});

test('inbox commits only ciphertext, reissues a lost acknowledgement, and survives restart',async()=>temporary(async directory=>{
  const f = await fixture();let inbox=setup(directory,f);
  try {
    const before=structuredClone(f.prepared.vault), first=await inbox.receive(f.envelope);
    assert.equal(first.duplicate,false);assert.deepEqual(inbox.read(f.request.id).envelope,f.envelope);
    const receipt=await openDefiReceipt(f.owner,f.executor.profile,first.receipt,f.request);
    assert.equal(receipt.state,'stored');assert(!Object.hasOwn(receipt,'finality'));
    inbox.close();inbox=setup(directory,f);
    const packet=await sealDefiRequest(f.owner,f.executor.profile,c,f.request,now);
    const again=await inbox.receive(await wrapForCarrier(f.owner,packet,now));
    assert.equal(again.duplicate,true);
    assert.deepEqual(await openDefiReceipt(f.owner,f.executor.profile,again.receipt,f.request),receipt);
    assert.deepEqual(inbox.read(f.request.id).envelope,f.envelope);
    assert.deepEqual(f.prepared.vault,before);assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally { inbox.close(); }
  const disk=await readFile(join(directory,'defi.sqlite'));
  for (const value of ['receiver.testnet','rhea-swap',f.prepared.packet.instruction.owner,f.prepared.packet.instruction.signature]) assert(!disk.includes(Buffer.from(value)));
}));

test('an authenticated carrier packet cannot bypass action or disclosure validation at intake',async()=>temporary(async directory=>{
  const f=await fixture(), inbox=setup(directory,f);
  try {
    for (const change of [r=>r.disclosure='private',r=>r.operation.packet.instruction.receiver_id='evil.testnet',r=>r.executor='a'.repeat(64)]) {
      const r=structuredClone(f.request);change(r);await resign(f.owner,r);
      const e=await wrapForCarrier(f.owner,await sealMessage(f.owner,f.executor.profile,r),now);
      await assert.rejects(inbox.receive(e));assert.equal(inbox.read(r.id),null);
    }
    assert.equal(inbox.read(f.request.id),null);
  } finally {inbox.close();}
}));

test('refund-return is durably accepted through the same inbox without crediting an offline root',async()=>temporary(async directory=>{
  const f=await fixture(), inbox=setup(directory,f), before=structuredClone(f.prepared.vault);
  try {
    const deposit=await makeDepositRequest(f.owner,c.reserve,'receiver.testnet','1000000',await refundSource(c.adapter,f.operation.packet.id));
    const request=await createDefiRequest(f.owner,f.executor.profile,c,{kind:'rhea-refund-return',packet:f.operation.packet,deposit},options,now);
    const envelope=await wrapForCarrier(f.owner,await sealDefiRequest(f.owner,f.executor.profile,c,request,now),now);
    const accepted=await inbox.receive(envelope);
    assert.equal((await openDefiReceipt(f.owner,f.executor.profile,accepted.receipt,request)).state,'stored');
    assert.deepEqual(f.prepared.vault,before);assert(!f.prepared.vault.roots.some(r=>r.id===deposit.id));
    assert.deepEqual(inbox.read(request.id).envelope,envelope);
  } finally {inbox.close();}
}));

test('different signed authorizations for the same input conflict even after the old request expires',async()=>temporary(async directory=>{
  const f=await fixture();let clock=now;const inbox=setup(directory,f,{now:()=>clock});
  try {
    await inbox.receive(f.envelope);clock=now+60001;
    const revised=await createDefiRequest(f.owner,f.executor.profile,c,f.operation,{...options,expiresAt:now+110000},clock);
    const e=await wrapForCarrier(f.owner,await sealDefiRequest(f.owner,f.executor.profile,c,revised,clock),clock);
    await assert.rejects(inbox.receive(e),/Conflicting/);
    const fork=await prepareRheaSwap(f.vault,f.owner,c,{text:'10',minOutput:'1',receiver:'other.testnet',deadlineMs:now+120000},clock);
    // Same reserved input with a newly signed nonce/receiver (copy of its existing ancestry).
    const original=f.operation.packet, p=structuredClone(original);p.instruction.nonce=fork.packet.instruction.nonce;p.instruction.receiver_id='other.testnet';
    const {swapTerms,redemptionTerms}=await import('../web/public/rhea-protocol.js');
    p.instruction.signature=await signValue(f.owner,swapTerms(c,p.instruction));p.instruction.redemption_signature=await signValue(f.owner,redemptionTerms(c,p.instruction));p.id=await digest(swapTerms(c,p.instruction));
    const conflict=await createDefiRequest(f.owner,f.executor.profile,c,{kind:'rhea-swap',packet:p},{...options,expiresAt:now+110000},clock);
    await assert.rejects(inbox.receive(await wrapForCarrier(f.owner,await sealDefiRequest(f.owner,f.executor.profile,c,conflict,clock),clock)),/Conflicting/);
    assert.equal(inbox.read(f.request.id).expired,true);assert.equal(inbox.read(conflict.id),null);
  } finally { inbox.close(); }
}));

test('expiry during verification, a forged envelope and a closed database cannot produce storage receipts',async()=>temporary(async directory=>{
  const f=await fixture();let calls=0;
  const inbox=setup(directory,f,{now:()=>calls++===0?now:f.request.expiresAt});
  try { await assert.rejects(inbox.receive(f.envelope),/expired before storage/);assert.equal(inbox.read(f.request.id),null); }
  finally { inbox.close(); }
  const reopened=setup(directory,f);
  await assert.rejects(reopened.receive({...f.envelope,signature:'0'.repeat(128)}),/signature/);
  reopened.close();await assert.rejects(reopened.receive(f.envelope));
  const final=setup(directory,f);try {assert.equal(final.read(f.request.id),null);} finally {final.close();}
}));

test('global, byte and per-sender quotas reject without evicting existing requests',async()=>temporary(async directory=>{
  const f=await fixture(), second=await fixture();
  for (const [label,limits] of [['global',{maxRequests:1}],['bytes',{maxBytes:Buffer.byteLength(JSON.stringify(f.envelope))+1}],['sender',{perSender:1}]]) {
    const inbox=setup(join(directory,label),f,limits);
    try {
      await inbox.receive(f.envelope);
      const next=label==='sender'?await createDefiRequest(f.owner,f.executor.profile,c,{kind:'rhea-refund-return',packet:f.operation.packet,
        deposit:await makeDepositRequest(f.owner,c.reserve,'receiver.testnet','1000000',await refundSource(c.adapter,f.operation.packet.id))},options,now)
        :await createDefiRequest(second.owner,f.executor.profile,c,second.operation,options,now);
      const sender=label==='sender'?f.owner:second.owner;
      const e=await wrapForCarrier(sender,await sealDefiRequest(sender,f.executor.profile,c,next,now),now);
      await assert.rejects(inbox.receive(e),/quota/);
      assert.deepEqual(inbox.read(f.request.id).envelope,f.envelope);assert.equal(inbox.read(next.id),null);
      assert.equal((await inbox.receive(f.envelope)).duplicate,true);
    } finally { inbox.close(); }
  }
}));

test('concurrent copies produce one durable request; reopening under another executor or route is rejected',async()=>temporary(async directory=>{
  const f=await fixture(), inbox=setup(directory,f);
  try {const results=await Promise.all([inbox.receive(f.envelope),inbox.receive(f.envelope)]);assert.deepEqual(results.map(r=>r.duplicate).sort(),[false,true]);}
  finally {inbox.close();}
  assert.throws(()=>new DefiInbox(directory,{identity:f.owner,config:c}),/another executor/);
  assert.throws(()=>setup(directory,f,{config:{...c,poolId:2}}),/another executor/);
}));

test('storage receipts reject fake settlement, another request, extra fields and a foreign signer',async()=>{
  const f=await fixture(), base={type:DEFI_RECEIPT,requestId:f.request.id,state:'stored',storedAt:now};
  for (const change of [r=>r.state='settled',r=>r.requestId='0'.repeat(64),r=>r.finality='FINAL',r=>r.storedAt=f.request.expiresAt,r=>r.storedAt=-1]) {
    const r=structuredClone(base);change(r);await assert.rejects(openDefiReceipt(f.owner,f.executor.profile,await sealMessage(f.executor,f.owner.profile,r),f.request),/storage receipt/);
  }
  const attacker=await createIdentity('Attacker');
  await assert.rejects(openDefiReceipt(f.owner,f.executor.profile,await sealMessage(attacker,f.owner.profile,base),f.request),/direction/);
});

const unused=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const port=s.address().port;await new Promise(r=>s.close(r));return 'http://127.0.0.1:'+port;};
const delivered=async(origin,identity)=>{
  for(let n=0;n<150;n++) {const list=(await carrierPost(origin,'/v1/inbox',await inboxRequest(identity,origin))).envelopes;if(list.length)return list;await new Promise(r=>setTimeout(r,20));}
  assert.fail('Encrypted request did not arrive');
};
test('real HTTP carriers forward the request and encrypted storage receipt without accessing action plaintext',async()=>temporary(async directory=>{
  const at=Date.now(),f=await fixture(at),origins=await Promise.all([unused(),unused()]),nodes=[];
  const inbox=setup(join(directory,'executor'),f,{now:Date.now});
  try {
    for(let n=0;n<2;n++){nodes[n]=createCarrier({origin:origins[n],directory:join(directory,'carrier-'+n),peers:[origins[1-n]],interval:20});await nodes[n].listen();}
    assert.equal((await carrierPost(origins[0],'/v1/store',f.envelope)).status,'stored');
    const [received]=await delivered(origins[1],f.executor);assert.deepEqual(received,f.envelope);
    const stored=await inbox.receive(received);
    const ack=await wrapForCarrier(f.executor,stored.receipt);await carrierPost(origins[1],'/v1/store',ack);
    const [reply]=await delivered(origins[0],f.owner);
    assert.equal((await openDefiReceipt(f.owner,f.executor.profile,reply.packet,f.request)).state,'stored');
    assert.equal((await inbox.receive(received)).duplicate,true);
    const outsider=await createIdentity('Outsider');assert.deepEqual((await carrierPost(origins[1],'/v1/inbox',await inboxRequest(outsider,origins[1]))).envelopes,[]);
    assert.equal((await nearLedger(f.prepared.vault)).reserved.size,1);
  } finally {inbox.close();for(const node of nodes)await node?.close();}
}));

test('a second messaging identity using the same spending key cannot bypass input conflicts, including older records',async()=>temporary(async directory=>{
  const f=await fixture(),alias=await createIdentity('Alias');
  alias.signingPrivate=f.owner.signingPrivate;alias.profile.signingPublic=f.owner.profile.signingPublic;
  alias.profile.id=await digest([CHAT_DOMAIN,alias.profile.signingPublic,alias.profile.boxPublic]);
  const request=await createDefiRequest(alias,f.executor.profile,c,f.operation,options,now);
  assert.notEqual(request.sender,f.request.sender);
  assert.equal(await defiConflictId(request),await defiConflictId(f.request),
    'Competing input reservations must share one conflict identity across messaging profiles');
  const e=await wrapForCarrier(alias,await sealDefiRequest(alias,f.executor.profile,c,request,now),now);
  const concurrent=setup(join(directory,'concurrent'),f);
  try {
    const arrivals=await Promise.allSettled([concurrent.receive(f.envelope),concurrent.receive(e)]);
    assert.equal(arrivals.filter(r=>r.status==='fulfilled').length,1);
    assert.equal(arrivals.filter(r=>r.status==='rejected').length,1);
  } finally {concurrent.close();}
  for(const legacy of [false,true]) {
    const path=join(directory,String(legacy)),inbox=setup(path,f);
    try {
      await inbox.receive(f.envelope);
      if(legacy) {
        const db=new DatabaseSync(join(path,'defi.sqlite'));
        try {db.prepare('UPDATE requests SET conflict=? WHERE id=?').run(await digest([DEFI_REQUEST,'input',f.request.sender,f.operation.kind,c.reserve,f.operation.packet.instruction.input]),f.request.id);}
        finally {db.close();}
      }
      await assert.rejects(inbox.receive(e),/Conflicting/);assert.equal(inbox.read(request.id),null);
      assert.deepEqual(inbox.read(f.request.id).envelope,f.envelope);
    } finally {inbox.close();}
  }
}));
