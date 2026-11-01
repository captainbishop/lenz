import { assert, bytes, digest, keysAre, randomId, signValue, validateProfile, verifyValue } from './peer-crypto.js';

export const NEARBY = 'lenz/nearby/v1';
export const MAX_PACKET = 205000, CHUNK = 8192, PAIRING_MS = 3 * 60 * 1000;
const PREFIX = 'lenz-nearby1_';
const terms = s => [s.domain,s.kind,s.session,s.from,s.to,s.createdAt,s.expiresAt,s.offerHash,s.sdp];
export function checkSdp(sdp) {
  assert(typeof sdp === 'string' && sdp.length <= 8192 && !sdp.includes('\0'), 'Invalid nearby connection.');
  const lines=sdp.split(/\r?\n/), media=lines.filter(l=>l.startsWith('m='));
  assert(media.length===1 && /^m=application \d+ UDP\/DTLS\/SCTP webrtc-datachannel$/.test(media[0]), 'Only a data connection is allowed.');
  assert(lines.filter(l=>/^a=fingerprint:sha-256 (?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/i.test(l)).length===1, 'A signed connection fingerprint is required.');
  const candidates=lines.filter(l=>l.startsWith('a=candidate:'));
  assert(candidates.length>0 && candidates.length<=8 && candidates.every(l=>/ typ host(?: |$)/.test(l)), 'A direct host connection is required. No relay candidates are allowed.');
  return sdp;
}
export async function makeSignal(identity, contact, kind, sdp, offer=null, now=Date.now()) {
  await validateProfile(contact); checkSdp(sdp);
  assert(['offer','answer'].includes(kind) && (kind==='answer')===!!offer, 'Invalid pairing step.');
  const s={domain:NEARBY,kind,session:offer?.session??randomId(),from:identity.profile.id,to:contact.id,
    createdAt:now,expiresAt:offer?.expiresAt??now+PAIRING_MS,offerHash:offer?await digest(offer):null,sdp};
  assert(s.to!==s.from && s.expiresAt>now,'Pairing expired. Start again.');
  return {...s,signature:await signValue(identity,terms(s))};
}
export async function checkSignal(s, identity, contact, offer=null, now=Date.now()) {
  assert(bytes(s).length<=12000 && keysAre(s,['domain','kind','session','from','to','createdAt','expiresAt','offerHash','sdp','signature']), 'Invalid pairing code.');
  assert(s.domain===NEARBY && s.kind===(offer?'answer':'offer') && /^[0-9a-f]{32}$/.test(s.session), 'Wrong pairing step.');
  await validateProfile(contact);
  assert(s.from===contact.id && s.to===identity.profile.id && s.from!==s.to, 'This code belongs to a different contact.');
  assert(Number.isSafeInteger(s.createdAt) && Number.isSafeInteger(s.expiresAt) && s.createdAt>=0 && s.createdAt<=now+30000 && s.expiresAt>now && s.expiresAt>s.createdAt && s.expiresAt-s.createdAt<=PAIRING_MS, 'Pairing code expired. Start again.');
  assert(offer ? s.session===offer.session && s.offerHash===await digest(offer) && s.expiresAt===offer.expiresAt : s.offerHash===null, 'The reply belongs to another connection.');
  checkSdp(s.sdp);
  assert(await verifyValue(contact.signingPublic,terms(s),s.signature), 'Pairing signature rejected.');
  return s;
}
async function bounded(stream, limit) {
  const reader=stream.getReader(), chunks=[];let size=0;
  try { while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;assert(size<=limit,'Pairing code is too large.');chunks.push(value);} }
  finally {await reader.cancel().catch(()=>{});}
  const out=new Uint8Array(size);let offset=0;for(const c of chunks){out.set(c,offset);offset+=c.length;}return out;
}
export async function encodeSignal(signal) {
  const raw=bytes(signal);assert(raw.length<=12000,'Pairing code is too large.');
  const data=await bounded(new Blob([raw]).stream().pipeThrough(new CompressionStream('gzip')),4500);
  return PREFIX+btoa(String.fromCharCode(...data)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
}
export async function decodeSignal(code) {
  assert(typeof code==='string' && code.length<=PREFIX.length+6000,'Pairing code is too large.');
  const value=code.trim();assert(value.startsWith(PREFIX),'Use a nearby pairing code.');
  const text=value.slice(PREFIX.length);assert(/^[A-Za-z0-9_-]+$/.test(text),'Invalid pairing encoding.');
  const raw=Uint8Array.from(atob(text.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
  assert(btoa(String.fromCharCode(...raw)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'')===text,'Invalid pairing encoding.');
  const data=await bounded(new Blob([raw]).stream().pipeThrough(new DecompressionStream('gzip')),12000);
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}
// One ordered assembly per authenticated connection. No state reaches the wallet until complete.
export function createAssembly(now=Date.now) {
  let current=null;
  return {
    clear(){current=null;},
    async accept(frame) {
      assert(frame && typeof frame==='object','Invalid nearby frame.');
      if(frame.kind==='start') {
        assert(!current && keysAre(frame,['kind','hash','size']) && /^[0-9a-f]{64}$/.test(frame.hash) && Number.isSafeInteger(frame.size) && frame.size>0 && frame.size<=MAX_PACKET,'Invalid nearby packet size.');
        current={hash:frame.hash,size:frame.size,text:'',index:0,deadline:now()+10000};return null;
      }
      assert(current && current.deadline>now() && keysAre(frame,['kind','hash','index','data']) && frame.kind==='part' && frame.hash===current.hash && frame.index===current.index && typeof frame.data==='string' && frame.data.length>0 && frame.data.length<=CHUNK && /^[\x20-\x7e]+$/.test(frame.data),'Invalid or interrupted nearby packet.');
      assert(current.text.length+frame.data.length<=current.size,'Nearby packet exceeds its declared size.');
      current.text+=frame.data;current.index++;current.deadline=now()+10000;
      if(current.text.length<current.size)return null;
      const packet=JSON.parse(current.text),hash=current.hash;current=null;
      assert(await digest(packet)===hash,'Nearby packet content changed.');return {packet,hash};
    },
  };
}
