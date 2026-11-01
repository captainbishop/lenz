import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, sealMessage, signValue } from './public/peer-crypto.js';
import { packEnvelope, mailboxKey, openFragment, createReassembler, NOSTR_DOMAIN, RUMOR_KIND, nostrConfig } from './public/nostr-protocol.js';
import { generateSecretKey } from './nostr-tools/node_modules/nostr-tools/lib/esm/pure.js';
import { wrapEvent, unwrapEvent } from './nostr-tools/node_modules/nostr-tools/lib/esm/nip59.js';
import { readMailbox } from './public/nostr-socket.js';

const a=await createIdentity('Alice'),b=await createIdentity('Bola'),c=await createIdentity('Chidi'),now=Date.now();
const packet=await sealMessage(a,b.profile,{kind:'chat',text:'Private message '.repeat(1800)});
const packed=await packEnvelope(a,b.profile,packet,now),mailbox=await mailboxKey(b,a.profile,a.profile.id);
const clone=x=>JSON.parse(JSON.stringify(x));
const inner=unwrapEvent(packed.events[0],mailbox.secret);
const fragment=JSON.parse(inner.content);
const forged=f=>wrapEvent({kind:RUMOR_KIND,created_at:Math.floor(f.createdAt/1000),tags:[['d',NOSTR_DOMAIN]],content:JSON.stringify(f)},generateSecretKey(),mailbox.publicKey);

test('existing contacts derive matching, directional and contact-specific mailboxes',async()=>{
  assert.deepEqual((await mailboxKey(a,b.profile,a.profile.id)).secret,mailbox.secret);
  assert.notEqual((await mailboxKey(a,b.profile,b.profile.id)).publicKey,mailbox.publicKey);
  assert.notEqual((await mailboxKey(a,c.profile,a.profile.id)).publicKey,mailbox.publicKey);
  assert.equal(a.boxPrivate.extractable,false);
});
test('independent nostr-tools decodes standard NIP-59 wrapping without exposing Lenz routing',async()=>{
  assert.equal(inner.kind,RUMOR_KIND);assert.equal(fragment.from,a.profile.id);
  assert(packed.events.length>1);
  for(const event of packed.events){const text=JSON.stringify(event);assert(!text.includes(a.profile.id));assert(!text.includes(b.profile.id));assert(!text.includes('Private message'));}
});
test('reordered and duplicate fragments assemble once with original envelope validation',async()=>{
  const receiver=createReassembler();
  assert.equal(await receiver.accept(packed.events.at(-1),mailbox,a.profile,b.profile.id,now),null);
  assert.equal(await receiver.accept(packed.events.at(-1),mailbox,a.profile,b.profile.id,now),null);
  let envelope;
  for(const e of packed.events.slice(0,-1).reverse())envelope=await receiver.accept(e,mailbox,a.profile,b.profile.id,now);
  assert.deepEqual(envelope.packet,packet);assert.equal(receiver.bytes,0);assert.equal(receiver.size,0);
});
test('missing fragments never deliver; unverified signatures retain no bytes',async()=>{
  const receiver=createReassembler();
  await receiver.accept(packed.events[0],mailbox,a.profile,b.profile.id,now);assert.equal(receiver.size,1);
  const bad={...fragment,hash:'0'.repeat(64)};
  await assert.rejects(receiver.accept(forged(bad),mailbox,a.profile,b.profile.id,now),/signature/);
  assert.equal(receiver.bytes,fragment.chunk.length);
});
test('outer signature, wrong mailbox, expiry and event size are rejected before assembly',async()=>{
  const bad=clone(packed.events[0]);bad.sig='0'.repeat(128);
  await assert.rejects(openFragment(bad,mailbox,a.profile,b.profile.id,now),/wrapper/);
  await assert.rejects(openFragment(packed.events[0],await mailboxKey(b,a.profile,b.profile.id),a.profile,b.profile.id,now),/wrapper/);
  await assert.rejects(openFragment(packed.events[0],mailbox,a.profile,b.profile.id,now+86400001),/fragment/);
  await assert.rejects(openFragment({...bad,content:'x'.repeat(32769)},mailbox,a.profile,b.profile.id,now),/too large/);
});
test('authenticated conflicting fragments cannot replace accepted bytes',async()=>{
  const receiver=createReassembler();await receiver.accept(packed.events[0],mailbox,a.profile,b.profile.id,now);
  const f={...fragment,chunk:'x'.repeat(fragment.chunk.length)};
  f.signature=await signValue(a,[NOSTR_DOMAIN,f.hash,f.from,f.to,f.createdAt,f.expiresAt,f.index,f.count,f.chunk]);
  await assert.rejects(receiver.accept(forged(f),mailbox,a.profile,b.profile.id,now),/Conflicting/);
});
test('relay config restricts schemes, credentials, paths, duplicates and count',()=>{
  for(const relays of [['https://relay.example'],['wss://user:pass@relay.example'],['wss://relay.example/path'],['ws://remote.example'],['wss://relay.example','wss://relay.example'],Array(5).fill('wss://relay.example')])assert.throws(()=>nostrConfig({version:1,relays}));
  assert.deepEqual(nostrConfig({version:1,relays:['ws://127.0.0.1:1234']}),['ws://127.0.0.1:1234']);
});
test('pagination revisits timestamp boundary and expands ties rather than skipping',async()=>{
  const time=Math.floor(now/1000),all=Array.from({length:180},(_,i)=>({id:String(i),created_at:time})),seen=new Set(),queries=[];
  const relay={read:async filter=>{queries.push(filter);return all.filter(e=>e.created_at<=filter.until).slice(0,filter.limit);}};
  let cursor=await readMailbox(relay,'a'.repeat(64),null,e=>seen.add(e.id),now);
  while(cursor)cursor=await readMailbox(relay,'a'.repeat(64),cursor,e=>seen.add(e.id),now);
  assert.equal(seen.size,180);assert(queries.some(q=>q.limit===256));
});
test('saturated timestamp fails explicitly; malformed or duplicate pages reject',async()=>{
  const time=Math.floor(now/1000)+60;
  const relay={read:async f=>Array.from({length:f.limit},(_,i)=>({id:String(i),created_at:time}))};
  const cursor=await readMailbox(relay,'a'.repeat(64),null,()=>{},now);
  await assert.rejects(readMailbox(relay,'a'.repeat(64),cursor,()=>{},now),/saturated/);
  await assert.rejects(readMailbox({read:async()=>[{id:'x',created_at:time},{id:'x',created_at:time}]},'a'.repeat(64),null,()=>{},now),/duplicates/);
});

test('independent NIP-59 seals reject a changed rumor hash and invalid inner signature',async()=>{
  const {createRumor,createSeal,createWrap}=await import('./nostr-tools/node_modules/nostr-tools/lib/esm/nip59.js');
  const key=generateSecretKey(),rumor=createRumor({kind:RUMOR_KIND,created_at:Math.floor(now/1000),tags:[['d',NOSTR_DOMAIN]],content:JSON.stringify(fragment)},key);
  rumor.id='0'.repeat(64);
  await assert.rejects(openFragment(createWrap(createSeal(rumor,key,mailbox.publicKey),mailbox.publicKey),mailbox,a.profile,b.profile.id,now),/content/);
  const seal=createSeal({...rumor,id:inner.id},key,mailbox.publicKey);seal.sig='0'.repeat(128);
  await assert.rejects(openFragment(createWrap(seal,mailbox.publicKey),mailbox,a.profile,b.profile.id,now),/seal signature/);
});
test('expired incomplete assemblies release memory and oversized authenticated floods are bounded',async()=>{
  const receiver=createReassembler();
  for(let i=0;i<32;i++){
    const f={...fragment,hash:i.toString(16).padStart(64,'0')};
    f.signature=await signValue(a,[NOSTR_DOMAIN,f.hash,f.from,f.to,f.createdAt,f.expiresAt,f.index,f.count,f.chunk]);
    await receiver.accept(forged(f),mailbox,a.profile,b.profile.id,now);
  }
  const f={...fragment,hash:'f'.repeat(64)};
  f.signature=await signValue(a,[NOSTR_DOMAIN,f.hash,f.from,f.to,f.createdAt,f.expiresAt,f.index,f.count,f.chunk]);
  await assert.rejects(receiver.accept(forged(f),mailbox,a.profile,b.profile.id,now),/capacity/);
  assert.equal(receiver.size,32);
  await assert.rejects(receiver.accept(packed.events[0],mailbox,a.profile,b.profile.id,now+86400001),/fragment/);
  assert.equal(receiver.size,0);assert.equal(receiver.bytes,0);
});
test('removing the fragment-authentication guard admits the forged control',async()=>{
  const {readFile}=await import('node:fs/promises');
  let source=await readFile(new URL('./public/nostr-protocol.js',import.meta.url),'utf8');
  const guard="assert(await verifyValue(contact.signingPublic, terms(f), f.signature), 'Relay fragment sender signature rejected.');";
  assert(source.includes(guard));
  source=source.replace(guard,'').replaceAll(/from '([^']+)'/g,(_,s)=>"from '"+new URL(s,new URL('./public/nostr-protocol.js',import.meta.url)).href+"'");
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  const invalid={...fragment,signature:'0'.repeat(128)};
  await assert.rejects(openFragment(forged(invalid),mailbox,a.profile,b.profile.id,now),/signature/);
  assert.equal((await mutant.openFragment(forged(invalid),mailbox,a.profile,b.profile.id,now)).signature,invalid.signature);
});
