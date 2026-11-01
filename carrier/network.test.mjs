import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname,resolve} from 'node:path';
import net from 'node:net';
import {createIdentity,sealMessage,openMessage,signValue,digest} from '../web/public/peer-crypto.js';
import {wrapForCarrier,validateEnvelope,inboxRequest,validateInbox,carrierPost,CARRIER_DOMAIN,MAX_LIFETIME,carrierConfig} from '../web/public/carrier-protocol.js';
import {createCarrier} from './server.mjs';
import {CarrierStore} from './store.mjs';
const fixture=async()=>{const a=await createIdentity('Amina'),b=await createIdentity('Bola'),p=await sealMessage(a,b.profile,{kind:'chat',text:'Private route test'});return {a,b,p,e:await wrapForCarrier(a,p)};};
const unused=async()=>{const s=net.createServer();await new Promise(r=>s.listen(0,'127.0.0.1',r));const p=s.address().port;await new Promise(r=>s.close(r));return 'http://127.0.0.1:'+p;};
test('retention, identity, contents and both signatures are bound',async()=>{
  const {a,e}=await fixture();await validateEnvelope(e);
  for(const mutate of [x=>x.expiresAt++,x=>x.createdAt++,x=>x.sender.id='a'.repeat(64),x=>x.packet.to='b'.repeat(64),x=>x.packet.ciphertext='00'.repeat(20),x=>x.packet.signature='0'.repeat(128),x=>x.signature='0'.repeat(128),x=>x.extra=true]){
    const bad=structuredClone(e);mutate(bad);await assert.rejects(validateEnvelope(bad));
  }
  await assert.rejects(validateEnvelope(e,e.expiresAt));
  const corrupt=structuredClone(e);corrupt.packet.signature='0'.repeat(128);corrupt.id=await digest(corrupt.packet);
  corrupt.signature=await signValue(a,[CARRIER_DOMAIN,'store',corrupt.id,corrupt.sender.id,corrupt.createdAt,corrupt.expiresAt]);
  await assert.rejects(validateEnvelope(corrupt),/Packet signature rejected/);
  assert.equal(e.expiresAt-e.createdAt,MAX_LIFETIME);
});
test('mailbox reads require the recipient signature, audience and current timestamp',async()=>{
  const {a,b}=await fixture(),origin='https://carrier.example';
  const q=await inboxRequest(b,origin);await validateInbox(q,origin);
  await assert.rejects(validateInbox({...q,recipient:{...q.recipient,id:a.profile.id}},origin));
  await assert.rejects(validateInbox(q,'https://elsewhere.example'));
  await assert.rejects(validateInbox({...q,after:'a'.repeat(64)},origin));
  await assert.rejects(validateInbox(q,origin,q.at+60001));
});
test('configuration rejects unsafe origins and duplicate peers',()=>{
  for(const origin of ['http://example.com','https://example.com/path','https://example.com/','https://u:p@example.com','https://example.com;script-src *'])assert.throws(()=>carrierConfig({version:1,carriers:[origin]}));
  assert.throws(()=>carrierConfig({version:1,carriers:['https://a.example','https://a.example']}));
});
test('durable custody deduplicates, rejects changed retention and preserves live files at quota',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lenz-carrier-')), {a,b,e}=await fixture();let store;
  try{
    store=new CarrierStore(directory,{maxMessages:1});assert.equal(store.put(e),true);assert.equal(store.put(e),false);store.close();
    store=new CarrierStore(directory,{maxMessages:1});assert.deepEqual(store.all(),[e]);
    const changed=structuredClone(e);changed.expiresAt--;changed.signature=await signValue(a,[CARRIER_DOMAIN,'store',changed.id,changed.sender.id,changed.createdAt,changed.expiresAt]);
    await validateEnvelope(changed);assert.throws(()=>store.put(changed),/Conflicting/);
    const e2=await wrapForCarrier(a,await sealMessage(a,b.profile,{kind:'chat',text:'second'}));assert.throws(()=>store.put(e2),/quota/);
    assert.deepEqual(store.all(),[e]);assert.deepEqual(store.all(e.expiresAt),[]);
  }finally{store?.close();assert.equal(dirname(directory),resolve(tmpdir()));await rm(directory,{recursive:true,force:true});}
});
test('three independent HTTP carriers forward, survive a middle restart, and restrict inbox reads',async()=>{
  const directory=await mkdtemp(join(tmpdir(),'lenz-carrier-network-')),origins=await Promise.all([unused(),unused(),unused()]);
  const nodes=[],{a,b,e}=await fixture();
  const options=i=>({origin:origins[i],directory:join(directory,String(i)),peers:i<2?[origins[i+1]]:[],interval:25});
  try{
    for(let i=0;i<3;i++){nodes[i]=createCarrier(options(i));await nodes[i].listen();}
    await nodes[1].close();nodes[1]=null;
    assert.equal((await carrierPost(origins[0],'/v1/store',e)).status,'stored');
    assert.deepEqual((await carrierPost(origins[2],'/v1/inbox',await inboxRequest(b,origins[2]))).envelopes,[]);
    nodes[1]=createCarrier(options(1));await nodes[1].listen();
    let received;
    for(let i=0;i<150;i++){received=(await carrierPost(origins[2],'/v1/inbox',await inboxRequest(b,origins[2]))).envelopes;if(received.length)break;await new Promise(r=>setTimeout(r,40));}
    assert.deepEqual(received,[e]);assert.equal((await openMessage(b,a.profile,received[0].packet)).text,'Private route test');
    await carrierPost(origins[0],'/v1/store',e);assert.equal(nodes[0].store.all().length,1);
    const outsider=await createIdentity('Outsider');assert.deepEqual((await carrierPost(origins[2],'/v1/inbox',await inboxRequest(outsider,origins[2]))).envelopes,[]);
    const bad=await inboxRequest(b,origins[2]);bad.signature='0'.repeat(128);await assert.rejects(carrierPost(origins[2],'/v1/inbox',bad));
    const forbidden=await fetch(origins[2]+'/v1/store',{method:'POST',headers:{Origin:'https://untrusted.example','Content-Type':'application/json'},body:JSON.stringify(e)});assert.equal(forbidden.status,400);
    await assert.rejects(carrierPost(origins[2],'/v1/store',{...e,signature:'0'.repeat(128)}));
    await nodes[2].close();nodes[2]=createCarrier(options(2));await nodes[2].listen();assert.deepEqual(nodes[2].store.all(),[e]);
  }finally{for(const node of nodes)await node?.close();assert.equal(dirname(directory),resolve(tmpdir()));await rm(directory,{recursive:true,force:true});}
});
test('bounded replies reject an oversized or unfinished HTTP response',async()=>{
  const http=await import('node:http'),s=http.createServer((req,res)=>{res.writeHead(200);if(req.url==='/v1/store'){res.end('x'.repeat(2048));}else res.write('{');});
  await new Promise(r=>s.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+s.address().port;
  try{await assert.rejects(carrierPost(origin,'/v1/store',{}, {limit:1024}),/too large/);await assert.rejects(carrierPost(origin,'/v1/inbox',{}, {timeout:100}));}
  finally{s.closeAllConnections();await new Promise(r=>s.close(r));}
});
