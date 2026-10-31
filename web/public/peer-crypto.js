// Research protocol, version 1. WebCrypto only; no network access or dependencies.
// Static ECDH does not provide forward secrecy. Routing identities remain visible.
import { AVATARS, validPhoto } from './profile-display.js';
export const CHAT_DOMAIN = 'proof-u/private-conversation/v1';
const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
export const assert = (ok, reason) => { if (!ok) throw new Error(reason); };
export const hex = bytes => Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('');
export const unhex = text => {
  assert(typeof text === 'string' && text.length % 2 === 0 && /^[0-9a-f]+$/.test(text), 'Invalid byte encoding');
  return Uint8Array.from(text.match(/../g), b => parseInt(b, 16));
};
export const bytes = value => enc.encode(JSON.stringify(value));
export const digest = async value => hex(await crypto.subtle.digest('SHA-256', bytes(value)));
export const randomId = () => hex(crypto.getRandomValues(new Uint8Array(16)));
export const keysAre = (value, keys) => value && !Array.isArray(value) && typeof value === 'object'
  && Object.keys(value).sort().join(',') === [...keys].sort().join(',');
export const isPublicKey = key => typeof key === 'string' && /^04[0-9a-f]{128}$/.test(key);
const importPublic = (key, name, uses) => crypto.subtle.importKey('raw', unhex(key), { name, namedCurve: 'P-256' }, true, uses);

export async function createIdentity(name) {
  assert(typeof name === 'string' && name.trim().length > 0 && name.length <= 48, 'Choose a name of 1–48 characters');
  const signing = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
  const box = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
  const signingPublic = hex(await crypto.subtle.exportKey('raw', signing.publicKey));
  const boxPublic = hex(await crypto.subtle.exportKey('raw', box.publicKey));
  const id = await digest([CHAT_DOMAIN, signingPublic, boxPublic]);
  return { profile: { type: CHAT_DOMAIN, id, name: name.trim(), signingPublic, boxPublic }, signingPrivate: signing.privateKey, boxPrivate: box.privateKey };
}

export async function validateProfile(profile) {
  const p = structuredClone(profile);
  const fields = ['type', 'id', 'name', 'signingPublic', 'boxPublic'];
  if (p && Object.hasOwn(p, 'avatar')) fields.push('avatar');
  if (p && Object.hasOwn(p, 'photo')) fields.push('photo');
  assert(keysAre(p, fields) && p.type === CHAT_DOMAIN, 'Invalid contact card');
  assert(!Object.hasOwn(p, 'avatar') || AVATARS.includes(p.avatar), 'Invalid profile avatar');
  assert(!Object.hasOwn(p, 'photo') || validPhoto(p.photo), 'Invalid profile photo');
  assert(typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 48, 'Invalid contact name');
  assert(isPublicKey(p.signingPublic) && isPublicKey(p.boxPublic), 'Invalid contact key');
  assert(p.id === await digest([CHAT_DOMAIN, p.signingPublic, p.boxPublic]), 'Contact fingerprint does not match its keys');
  await importPublic(p.signingPublic, 'ECDSA', ['verify']);
  await importPublic(p.boxPublic, 'ECDH', []);
  return p;
}

export async function signValue(identity, value) {
  return hex(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.signingPrivate, bytes(value)));
}
export async function verifyValue(publicKey, value, signature) {
  assert(isPublicKey(publicKey) && typeof signature === 'string' && /^[0-9a-f]{128}$/.test(signature), 'Invalid signature encoding');
  const key = await importPublic(publicKey, 'ECDSA', ['verify']);
  return crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unhex(signature), bytes(value));
}

function header(packet) { return [packet.type, packet.id, packet.from, packet.to, packet.iv]; }
async function sharedKey(identity, peer, packet) {
  const pub = await importPublic(peer.boxPublic, 'ECDH', []);
  const shared = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, identity.boxPrivate, 256);
  const material = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: unhex(packet.id), info: bytes(header(packet)) }, material,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
}

export async function sealMessage(identity, contact, payload) {
  const peer = await validateProfile(contact);
  assert(peer.id !== identity.profile.id, 'Choose another person');
  const plaintext = bytes(payload);
  assert(plaintext.length > 0 && plaintext.length <= 100000, 'Message is too large');
  const packet = { type: CHAT_DOMAIN, id: randomId(), from: identity.profile.id, to: peer.id,
    iv: hex(crypto.getRandomValues(new Uint8Array(12))), ciphertext: '', signature: '' };
  const key = await sharedKey(identity, peer, packet);
  packet.ciphertext = hex(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: unhex(packet.iv), additionalData: bytes(header(packet)), tagLength: 128 }, key, plaintext));
  packet.signature = await signValue(identity, [...header(packet), packet.ciphertext]);
  return packet;
}

export async function openMessage(identity, contact, input) {
  const packet = structuredClone(input);
  const peer = await validateProfile(contact);
  assert(keysAre(packet, ['type', 'id', 'from', 'to', 'iv', 'ciphertext', 'signature']) && packet.type === CHAT_DOMAIN, 'Invalid message format');
  assert(/^[0-9a-f]{32}$/.test(packet.id) && /^[0-9a-f]{24}$/.test(packet.iv), 'Invalid message header');
  const incoming = packet.from === peer.id && packet.to === identity.profile.id;
  const outgoing = packet.from === identity.profile.id && packet.to === peer.id;
  assert(incoming || outgoing, 'This message belongs to a different conversation');
  assert(typeof packet.ciphertext === 'string' && packet.ciphertext.length >= 32 && packet.ciphertext.length <= 200032, 'Invalid message size');
  assert(await verifyValue(incoming ? peer.signingPublic : identity.profile.signingPublic, [...header(packet), packet.ciphertext], packet.signature), 'Message signature was rejected');
  const key = await sharedKey(identity, peer, packet);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(packet.iv), additionalData: bytes(header(packet)), tagLength: 128 }, key, unhex(packet.ciphertext));
  return JSON.parse(dec.decode(plaintext));
}
