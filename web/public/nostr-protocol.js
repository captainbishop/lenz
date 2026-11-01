import { assert, bytes, digest, unhex, keysAre, signValue, verifyValue, validateProfile } from './peer-crypto.js';
import { MAX_ENVELOPE_BYTES, MAX_LIFETIME, wrapForCarrier, validateEnvelope } from './carrier-protocol.js';
import { generateSecretKey, getPublicKey, wrapEvent, unwrapEvent, verifyEvent, getEventHash } from './nostr-vendor/nostr.js';

export const NOSTR_DOMAIN = 'lenz/nostr-envelope/v1';
export const FRAGMENT_SIZE = 8192, MAX_PARTS = 25, MAX_EVENT_BYTES = 32768;
export const RUMOR_KIND = 30078;
const hex64 = v => typeof v === 'string' && /^[0-9a-f]{64}$/.test(v);
export function relayOrigin(value) {
  assert(typeof value === 'string' && value.length <= 256, 'Invalid relay address.');
  const u = new URL(value);
  assert(u.origin === value && !u.username && !u.password &&
    (u.protocol === 'wss:' || (u.protocol === 'ws:' && u.hostname === '127.0.0.1')), 'Use a secure relay; plain WebSocket is only allowed on loopback.');
  return value;
}
export function nostrConfig(config) {
  assert(keysAre(config, ['version','relays']) && config.version === 1 && Array.isArray(config.relays) && config.relays.length <= 4, 'Invalid relay configuration.');
  const relays = config.relays.map(relayOrigin);
  assert(new Set(relays).size === relays.length, 'Duplicate relay address.');
  return relays;
}
// Both peers derive the same directional mailbox. No financial key is exported.
export async function mailboxKey(identity, contact, senderId) {
  await validateProfile(contact);
  const own = identity.profile.id;
  assert(contact.id !== own && [own, contact.id].includes(senderId), 'Invalid mailbox participants.');
  const recipientId = senderId === own ? contact.id : own;
  const publicKey = await crypto.subtle.importKey('raw', unhex(contact.boxPublic), {name:'ECDH',namedCurve:'P-256'}, false, []);
  const shared = new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:publicKey}, identity.boxPrivate, 256));
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveBits']);
  shared.fill(0);
  for (let counter = 0; counter < 16; counter++) {
    const secret = new Uint8Array(await crypto.subtle.deriveBits({name:'HKDF',hash:'SHA-256',salt:bytes(NOSTR_DOMAIN),
      info:bytes(['mailbox',senderId,recipientId,counter])}, material, 256));
    try { return {secret,publicKey:getPublicKey(secret)}; } catch { secret.fill(0); }
  }
  throw Error('Could not derive mailbox key.');
}
const terms = f => [NOSTR_DOMAIN,f.hash,f.from,f.to,f.createdAt,f.expiresAt,f.index,f.count,f.chunk];
export async function packEnvelope(identity, contact, packet, now = Date.now()) {
  assert(packet.to === contact.id, 'Wrong relay recipient.');
  const envelope = await wrapForCarrier(identity, packet, now), text = JSON.stringify(envelope);
  assert(/^[\x20-\x7e]+$/.test(text), 'Relay envelope must be ASCII.');
  const hash = await digest(envelope), count = Math.ceil(text.length / FRAGMENT_SIZE);
  assert(count <= MAX_PARTS, 'Relay file is too large.');
  const mailbox = await mailboxKey(identity, contact, identity.profile.id), events = [];
  try {
    for (let index = 0; index < count; index++) {
      const f = {type:NOSTR_DOMAIN,hash,from:packet.from,to:packet.to,createdAt:envelope.createdAt,expiresAt:envelope.expiresAt,index,count,chunk:text.slice(index*FRAGMENT_SIZE,(index+1)*FRAGMENT_SIZE)};
      f.signature = await signValue(identity, terms(f));
      const sender = generateSecretKey();
      try {
        const event = wrapEvent({kind:RUMOR_KIND,created_at:Math.floor(now/1000),tags:[['d',NOSTR_DOMAIN]],content:JSON.stringify(f)}, sender, mailbox.publicKey);
        assert(bytes(event).length <= MAX_EVENT_BYTES, 'Relay event is too large.');
        events.push(event);
      } finally { sender.fill(0); }
    }
  } finally { mailbox.secret.fill(0); }
  return {packetId:packet.id,to:packet.to,hash,expiresAt:envelope.expiresAt,events,storedBy:[]};
}
export async function openFragment(raw, mailbox, contact, recipientId, now = Date.now()) {
  assert(bytes(raw).length <= MAX_EVENT_BYTES, 'Relay event is too large.');
  // Remove library verification memoization, including from locally mutated objects.
  const event = JSON.parse(JSON.stringify(raw));
  assert(keysAre(event,['id','pubkey','created_at','kind','tags','content','sig']) && event.kind === 1059 &&
    Number.isSafeInteger(event.created_at) && event.created_at >= Math.floor((now-MAX_LIFETIME)/1000)-172800-60 &&
    event.created_at <= Math.floor(now/1000)+60 && JSON.stringify(event.tags) === JSON.stringify([['p',mailbox.publicKey]]) &&
    verifyEvent(event), 'Invalid signed relay wrapper.');
  const rumor = unwrapEvent(event, mailbox.secret);
  assert(keysAre(rumor,['id','pubkey','created_at','kind','tags','content']) && rumor.kind === RUMOR_KIND &&
    rumor.id === getEventHash(rumor) && JSON.stringify(rumor.tags) === JSON.stringify([['d',NOSTR_DOMAIN]]) &&
    typeof rumor.content === 'string' && rumor.content.length <= FRAGMENT_SIZE+2048, 'Invalid Lenz relay content.');
  const f = JSON.parse(rumor.content);
  assert(keysAre(f,['type','hash','from','to','createdAt','expiresAt','index','count','chunk','signature']) && f.type === NOSTR_DOMAIN &&
    hex64(f.hash) && f.from === contact.id && f.to === recipientId &&
    Number.isSafeInteger(f.createdAt) && Number.isSafeInteger(f.expiresAt) && f.createdAt >= 0 && f.createdAt <= now+60000 &&
    f.expiresAt > now && f.expiresAt > f.createdAt && f.expiresAt-f.createdAt <= MAX_LIFETIME &&
    rumor.created_at === Math.floor(f.createdAt/1000) &&
    Number.isSafeInteger(f.count) && f.count > 0 && f.count <= MAX_PARTS && Number.isSafeInteger(f.index) &&
    f.index >= 0 && f.index < f.count && typeof f.chunk === 'string' && /^[\x20-\x7e]+$/.test(f.chunk) &&
    f.chunk.length <= FRAGMENT_SIZE && (f.index === f.count-1 || f.chunk.length === FRAGMENT_SIZE), 'Invalid relay fragment.');
  assert(await verifyValue(contact.signingPublic, terms(f), f.signature), 'Relay fragment sender signature rejected.');
  return f;
}
export function createReassembler() {
  const pending = new Map(); let retained = 0;
  const remove = key => { retained -= pending.get(key).size; pending.delete(key); };
  return {
    get size() { return pending.size; },
    get bytes() { return retained; },
    clear() { pending.clear(); retained = 0; },
    async accept(event, mailbox, contact, recipientId, now = Date.now()) {
      for (const [key,entry] of pending) if (entry.expiresAt <= now) remove(key);
      const f = await openFragment(event,mailbox,contact,recipientId,now);
      const key = f.from+':'+f.hash;
      let entry = pending.get(key);
      if (!entry) {
        assert(pending.size < 32 && retained+f.chunk.length <= 2*MAX_ENVELOPE_BYTES, 'Relay reassembly capacity reached.');
        entry = {...f,parts:new Map(),size:0}; pending.set(key,entry);
      }
      assert(entry.count === f.count && entry.to === f.to && entry.createdAt === f.createdAt && entry.expiresAt === f.expiresAt, 'Conflicting relay fragment metadata.');
      if (entry.parts.has(f.index)) {
        assert(entry.parts.get(f.index) === f.chunk, 'Conflicting relay fragment.');
        return null;
      }
      assert(entry.size+f.chunk.length <= MAX_ENVELOPE_BYTES && retained+f.chunk.length <= 2*MAX_ENVELOPE_BYTES, 'Relay reassembly capacity reached.');
      entry.parts.set(f.index,f.chunk); entry.size += f.chunk.length; retained += f.chunk.length;
      if (entry.parts.size !== entry.count) return null;
      const text = Array.from({length:entry.count},(_,i)=>entry.parts.get(i)).join('');
      remove(key);
      const envelope = JSON.parse(text);
      assert(await digest(envelope) === f.hash && envelope.createdAt === f.createdAt && envelope.expiresAt === f.expiresAt &&
        envelope.packet.from === f.from && envelope.packet.to === f.to, 'Relay envelope hash mismatch.');
      await validateEnvelope(envelope,now);
      return envelope;
    },
  };
}
