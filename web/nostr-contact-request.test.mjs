import test from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity, sealMessage, openMessage} from './public/peer-crypto.js';
import {packContactRequest, createContactRequestReassembler, MAX_REQUEST_BYTES} from './public/nostr-protocol.js';
import {readContactRequestInbox} from './public/nostr-socket.js';
import {finalizeEvent,generateSecretKey,verifyEvent} from './nostr-tools/node_modules/nostr-tools/lib/esm/pure.js';

const copy=value=>JSON.parse(JSON.stringify(value));
const signedChange=(event,change)=>{
  const value=copy(event),fragment=JSON.parse(value.content);change(fragment,value);
  value.content=JSON.stringify(fragment);return finalizeEvent({kind:value.kind,tags:value.tags,created_at:value.created_at,content:value.content},generateSecretKey());
};

test('a recipient discovers an encrypted contact request without having the sender in contacts',async()=>{
  const sender=await createIdentity('Amina'),recipient=await createIdentity('Bola'),now=Date.now();
  const packet=await sealMessage(sender,recipient.profile,{kind:'lenz-contact-request-v1',profile:sender.profile});
  const packed=await packContactRequest(sender,recipient.profile,packet,now);
  const receiver=createContactRequestReassembler();let envelope;
  for(const event of packed.events){
    assert(verifyEvent(JSON.parse(JSON.stringify(event))));
    assert(!event.content.includes('Amina'));
    assert(!event.content.includes('lenz-contact-request-v1'));
    envelope=await receiver.accept(event,recipient.profile.id,now);
  }
  assert.deepEqual(envelope.packet,packet);
  const payload=await openMessage(recipient,sender.profile,envelope.packet);
  assert.equal(payload.profile.name,'Amina');
  assert.equal(receiver.size,0);assert.equal(receiver.bytes,0);
});

test('large request fragments arrive out of order and duplicate fragments do not replace original bytes',async()=>{
  const sender=await createIdentity('Amina'),recipient=await createIdentity('Bola'),now=Date.now();
  const packet=await sealMessage(sender,recipient.profile,{kind:'lenz-contact-request-v1',profile:sender.profile,text:'Encrypted introduction. '.repeat(1100)});
  const packed=await packContactRequest(sender,recipient.profile,packet,now),receiver=createContactRequestReassembler();
  assert(packed.events.length>1);
  assert.equal(await receiver.accept(packed.events.at(-1),recipient.profile.id,now),null);
  assert.equal(await receiver.accept(packed.events.at(-1),recipient.profile.id,now),null);
  let envelope;for(const event of packed.events.slice(0,-1).reverse())envelope=await receiver.accept(event,recipient.profile.id,now);
  assert.deepEqual(envelope.packet,packet);assert.equal(receiver.size,0);assert.equal(receiver.bytes,0);
});

test('forged sender signatures, changed recipients, expiry and oversized request events retain no bytes',async()=>{
  const sender=await createIdentity('Amina'),recipient=await createIdentity('Bola'),now=Date.now();
  const packet=await sealMessage(sender,recipient.profile,{kind:'lenz-contact-request-v1',profile:sender.profile});
  const packed=await packContactRequest(sender,recipient.profile,packet,now),receiver=createContactRequestReassembler(),event=packed.events[0];
  const forged=signedChange(event,f=>{f.signature='0'.repeat(128);});
  await assert.rejects(receiver.accept(forged,recipient.profile.id,now),/sender signature/);
  await assert.rejects(receiver.accept(event,sender.profile.id,now),/fragment/);
  await assert.rejects(receiver.accept(event,recipient.profile.id,now+86400001),/event|fragment/);
  await assert.rejects(receiver.accept({...event,content:'x'.repeat(32769)},recipient.profile.id,now),/event/);
  assert.equal(receiver.size,0);assert.equal(receiver.bytes,0);
  const huge=await sealMessage(sender,recipient.profile,{kind:'lenz-contact-request-v1',text:'x'.repeat(MAX_REQUEST_BYTES)});
  await assert.rejects(packContactRequest(sender,recipient.profile,huge,now),/too large/);
});

test('incomplete requests are bounded per sender and expire without waiting for signed retention',async()=>{
  const sender=await createIdentity('Amina'),recipient=await createIdentity('Bola'),now=Date.now(),packed=[];
  for(let i=0;i<3;i++)packed.push(await packContactRequest(sender,recipient.profile,await sealMessage(sender,recipient.profile,{kind:'lenz-contact-request-v1',text:String(i)+'x'.repeat(9000)}),now));
  const receiver=createContactRequestReassembler();
  await receiver.accept(packed[0].events[0],recipient.profile.id,now);await receiver.accept(packed[1].events[0],recipient.profile.id,now);
  await assert.rejects(receiver.accept(packed[2].events[0],recipient.profile.id,now),/capacity/);
  assert.equal(receiver.size,2);
  await receiver.accept(packed[2].events[0],recipient.profile.id,now+30001);assert.equal(receiver.size,1);
  receiver.clear();assert.equal(receiver.size,0);assert.equal(receiver.bytes,0);
});

test('discovery inbox bounds timestamp ties and rejects duplicate or oversized pages',async()=>{
  const now=Date.now(),time=Math.floor(now/1000)+60,recipient='a'.repeat(64),queries=[];
  const flooded={read:async filter=>{queries.push(filter);return Array.from({length:filter.limit},(_,i)=>({id:String(i),created_at:time}));}};
  await assert.rejects(readContactRequestInbox(flooded,recipient,null,()=>{},now),/saturated/);
  assert.deepEqual(queries.map(q=>q.limit),[64,128]);assert(queries.every(q=>q.kinds[0]===30078&&q['#p'][0]===recipient));
  await assert.rejects(readContactRequestInbox({read:async()=>[{id:'x',created_at:time},{id:'x',created_at:time}]},recipient,null,()=>{},now),/duplicates/);
  await assert.rejects(readContactRequestInbox({read:async()=>Array(65).fill({id:'x',created_at:time})},recipient,null,()=>{},now),/limit/);
});

test('removing request-fragment sender authentication admits the forged control',async()=>{
  const sender=await createIdentity('Amina'),recipient=await createIdentity('Bola'),now=Date.now();
  const packet=await sealMessage(sender,recipient.profile,{kind:'lenz-contact-request-v1',profile:sender.profile});
  const packed=await packContactRequest(sender,recipient.profile,packet,now),forged=signedChange(packed.events[0],f=>{f.signature='0'.repeat(128);});
  const {readFile}=await import('node:fs/promises'),moduleUrl=new URL('./public/nostr-protocol.js',import.meta.url);
  let source=await readFile(moduleUrl,'utf8');
  const guard="assert(await verifyValue(f.sender.signingPublic,requestTerms(f),f.signature),'Contact request sender signature rejected.');";
  assert(source.includes(guard));source=source.replace(guard,'').replaceAll(/from '([^']+)'/g,(_,s)=>"from '"+new URL(s,moduleUrl).href+"'");
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  await assert.rejects(createContactRequestReassembler().accept(forged,recipient.profile.id,now),/sender signature/);
  assert.deepEqual((await mutant.createContactRequestReassembler().accept(forged,recipient.profile.id,now)).packet,packet);
});
