import test from 'node:test';
import assert from 'node:assert/strict';
import { createIdentity, sealMessage, digest } from './public/peer-crypto.js';
import { makeSignal, checkSignal, encodeSignal, decodeSignal, checkSdp, createAssembly, CHUNK, MAX_PACKET } from './public/nearby-protocol.js';
const [a,b,c]=await Promise.all(['Amina','Bola','Chidi'].map(createIdentity));
const sdp='v=0\r\nm=application 9 UDP/DTLS/SCTP webrtc-datachannel\r\na=fingerprint:sha-256 '+Array(32).fill('AA').join(':')+'\r\na=candidate:1 1 udp 1 device.local 50000 typ host\r\n';
const now=1000000,offer=await makeSignal(a,b.profile,'offer',sdp,null,now),answer=await makeSignal(b,a.profile,'answer',sdp,offer,now+1000);
test('pairing binds both verified identities and the exact offer/answer',async()=>{
  assert.deepEqual(await checkSignal(offer,b,a.profile,null,now),offer);
  assert.deepEqual(await checkSignal(answer,a,b.profile,offer,now+1000),answer);
  await assert.rejects(checkSignal(offer,c,a.profile,null,now),/different contact/);
  await assert.rejects(checkSignal(answer,a,b.profile,{...offer,session:'0'.repeat(32)},now+1000),/another connection/);
});
test('changed fingerprint and expired pairing cannot authorize a connection',async()=>{
  await assert.rejects(checkSignal({...offer,sdp:sdp.replaceAll('AA','AB')},b,a.profile,null,now),/signature rejected/);
  await assert.rejects(checkSignal(offer,b,a.profile,null,offer.expiresAt),/expired/);
  await assert.rejects(checkSignal({...offer,extra:true},b,a.profile,null,now),/Invalid pairing/);
});
test('only bounded direct data channels are accepted',()=>{
  assert.throws(()=>checkSdp(sdp.replace('typ host','typ relay')),/direct host/);
  assert.throws(()=>checkSdp(sdp+'m=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'),/data connection/);
  assert.throws(()=>checkSdp(sdp.repeat(100)),/Invalid nearby/);
});
test('compressed pairing QR roundtrip has bounded, canonical decoding',async()=>{
  const code=await encodeSignal(offer);assert(code.length<1800);
  assert.deepEqual(await decodeSignal(code),offer);
  await assert.rejects(decodeSignal(code+'='),/encoding/);
  const bomb=await new Response(new Blob(['a'.repeat(20000)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer();
  const text=btoa(String.fromCharCode(...new Uint8Array(bomb))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  await assert.rejects(decodeSignal('lenz-nearby1_'+text),/too large/);
});
const packet=await sealMessage(a,b.profile,{kind:'chat',text:'Offline nearby message. '.repeat(500)}),text=JSON.stringify(packet),hash=await digest(packet);
async function begin(assembly){await assembly.accept({kind:'start',hash,size:text.length});}
const part=(index,data=text.slice(index*CHUNK,(index+1)*CHUNK))=>({kind:'part',hash,index,data});
test('fragmented ciphertext becomes a packet only when complete',async()=>{
  const assembly=createAssembly();await begin(assembly);let result;
  for(let i=0;i<Math.ceil(text.length/CHUNK);i++){result=await assembly.accept(part(i));if(i<Math.ceil(text.length/CHUNK)-1)assert.equal(result,null);}
  assert.deepEqual(result,{packet,hash});
});
test('interruption, missing/reordered and duplicate fragments never finish a packet',async()=>{
  for(const index of [1,2]){const assembly=createAssembly();await begin(assembly);await assert.rejects(assembly.accept(part(index)),/interrupted/);}
  const assembly=createAssembly();await begin(assembly);await assembly.accept(part(0));await assert.rejects(assembly.accept(part(0)),/interrupted/);
  assembly.clear();await assert.rejects(assembly.accept(part(1)),/interrupted/);
});
test('assembly size, expiry and changed content are rejected',async()=>{
  const tooLarge=createAssembly();await assert.rejects(tooLarge.accept({kind:'start',hash,size:MAX_PACKET+1}),/size/);
  let clock=0;const expired=createAssembly(()=>clock);await begin(expired);clock=10001;await assert.rejects(expired.accept(part(0)),/interrupted/);
  const changed=createAssembly();await begin(changed);const corrupted=text.replace(packet.id,'0'.repeat(32));
  await assert.rejects(async()=>{for(let i=0;i<Math.ceil(corrupted.length/CHUNK);i++)await changed.accept(part(i,corrupted.slice(i*CHUNK,(i+1)*CHUNK)));},/content changed/);
});

test('removing the signature guard admits a forged connection fingerprint',async()=>{
  const {readFile}=await import('node:fs/promises');
  const source=await readFile(new URL('./public/nearby-protocol.js',import.meta.url),'utf8');
  const guard="  assert(await verifyValue(contact.signingPublic,terms(s),s.signature), 'Pairing signature rejected.');";
  assert(source.includes(guard));
  const altered=source.replace(guard,'').replace("'./peer-crypto.js'",JSON.stringify(new URL('./public/peer-crypto.js',import.meta.url).href));
  const mutant=await import('data:text/javascript;base64,'+Buffer.from(altered).toString('base64'));
  const forged={...offer,sdp:sdp.replaceAll('AA','AB')};
  await assert.rejects(checkSignal(forged,b,a.profile,null,now),/signature rejected/);
  assert.deepEqual(await mutant.checkSignal(forged,b,a.profile,null,now),forged);
});
