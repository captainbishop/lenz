import { CHAT_DOMAIN, assert, bytes, digest, keysAre, verifyValue, signValue } from './peer-crypto.js';

export const CARRIER_DOMAIN = 'lenz/carrier/v1';
export const MAX_ENVELOPE_BYTES = 204800;
export const MAX_LIFETIME = 24 * 60 * 60 * 1000;
export const PAGE_SIZE = 8;
export const MAX_REPLY_BYTES = MAX_ENVELOPE_BYTES * PAGE_SIZE + 4096;
const hex64 = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export function carrierOrigin(value) {
  assert(typeof value === 'string' && value.length <= 256, 'Invalid carrier address.');
  const url = new URL(value);
  assert(url.origin === value && !url.username && !url.password &&
    (url.protocol === 'https:' || (url.protocol === 'http:' && url.hostname === '127.0.0.1')), 'Use an HTTPS carrier origin; HTTP is only allowed on loopback.');
  return value;
}
export function carrierConfig(config) {
  assert(keysAre(config, ['version', 'carriers']) && config.version === 1 && Array.isArray(config.carriers) && config.carriers.length <= 4, 'Invalid carrier configuration.');
  const carriers = config.carriers.map(carrierOrigin);
  assert(new Set(carriers).size === carriers.length, 'Duplicate carrier address.');
  return carriers;
}
export const publicIdentity = identity => ({id:identity.profile.id, signingPublic:identity.profile.signingPublic, boxPublic:identity.profile.boxPublic});
async function checkIdentity(sender) {
  assert(keysAre(sender, ['id', 'signingPublic', 'boxPublic']) && hex64(sender.id) &&
    /^04[0-9a-f]{128}$/.test(sender.signingPublic) && /^04[0-9a-f]{128}$/.test(sender.boxPublic) &&
    sender.id === await digest([CHAT_DOMAIN, sender.signingPublic, sender.boxPublic]), 'Carrier identity does not match its keys.');
}
const envelopeTerms = e => [CARRIER_DOMAIN, 'store', e.id, e.sender.id, e.createdAt, e.expiresAt];
export async function wrapForCarrier(identity, packet, now = Date.now()) {
  const envelope = {type:CARRIER_DOMAIN, id:await digest(packet), sender:publicIdentity(identity), createdAt:now, expiresAt:now+MAX_LIFETIME, packet};
  envelope.signature = await signValue(identity, envelopeTerms(envelope));
  await validateEnvelope(envelope, now);
  return envelope;
}
export async function validateEnvelope(e, now = Date.now()) {
  assert(bytes(e).length <= MAX_ENVELOPE_BYTES && keysAre(e, ['type','id','sender','createdAt','expiresAt','packet','signature']) && e.type === CARRIER_DOMAIN, 'Invalid carrier envelope.');
  assert(Number.isSafeInteger(e.createdAt) && Number.isSafeInteger(e.expiresAt) && e.createdAt >= 0 && e.createdAt <= now+60000 && e.expiresAt > now && e.expiresAt > e.createdAt && e.expiresAt-e.createdAt <= MAX_LIFETIME, 'Carrier envelope expired or has invalid retention.');
  await checkIdentity(e.sender);
  const p = e.packet;
  assert(keysAre(p, ['type','id','from','to','iv','ciphertext','signature']) && p.type === CHAT_DOMAIN &&
    typeof p.id === 'string' && /^[0-9a-f]{32}$/.test(p.id) && p.from === e.sender.id && hex64(p.to) && p.to !== p.from &&
    typeof p.iv === 'string' && /^[0-9a-f]{24}$/.test(p.iv) && typeof p.ciphertext === 'string' &&
    /^[0-9a-f]+$/.test(p.ciphertext) && p.ciphertext.length % 2 === 0 && p.ciphertext.length >= 32 && p.ciphertext.length <= 200032, 'Invalid encrypted carrier packet.');
  assert(hex64(e.id) && e.id === await digest(p), 'Carrier content hash mismatch.');
  assert(await verifyValue(e.sender.signingPublic, [p.type,p.id,p.from,p.to,p.iv,p.ciphertext], p.signature), 'Packet signature rejected.');
  assert(await verifyValue(e.sender.signingPublic, envelopeTerms(e), e.signature), 'Carrier retention signature rejected.');
  return e;
}
const inboxTerms = q => [CARRIER_DOMAIN,'inbox',q.audience,q.recipient.id,q.at,q.after];
export async function inboxRequest(identity, audience, after = '', now = Date.now()) {
  const q = {type:CARRIER_DOMAIN, audience:carrierOrigin(audience), recipient:publicIdentity(identity), at:now, after};
  q.signature = await signValue(identity, inboxTerms(q));
  return q;
}
export async function validateInbox(q, audience, now = Date.now()) {
  assert(keysAre(q, ['type','audience','recipient','at','after','signature']) && q.type === CARRIER_DOMAIN && q.audience === audience &&
    Number.isSafeInteger(q.at) && Math.abs(now-q.at) <= 60000 && (q.after === '' || hex64(q.after)), 'Invalid mailbox request.');
  await checkIdentity(q.recipient);
  assert(await verifyValue(q.recipient.signingPublic, inboxTerms(q), q.signature), 'Mailbox signature rejected.');
  return q;
}
export async function carrierPost(origin, route, body, {signal, timeout = 8000, limit = MAX_REPLY_BYTES} = {}) {
  carrierOrigin(origin);
  assert(route === '/v1/store' || route === '/v1/inbox', 'Unsupported carrier operation.');
  const deadline = AbortSignal.timeout(timeout);
  const response = await fetch(origin+route, {method:'POST', body:JSON.stringify(body), headers:{'Content-Type':'application/json'},
    credentials:'omit', redirect:'error', cache:'no-store', referrerPolicy:'no-referrer', signal:signal ? AbortSignal.any([signal,deadline]) : deadline});
  assert(response.ok, `Carrier unavailable (${response.status}).`);
  const reader = response.body.getReader(), chunks = []; let size = 0;
  try {
    while (true) { const {done,value} = await reader.read(); if(done)break; size += value.byteLength; assert(size <= limit, 'Carrier response too large.'); chunks.push(value); }
  } finally { await reader.cancel().catch(()=>{}); }
  const data = new Uint8Array(size); let offset=0;
  for(const chunk of chunks){data.set(chunk,offset);offset+=chunk.byteLength;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(data));
}
