// Byte-level adapter for the existing research capsule. Does not parse payment
// contents, exchange keys, verify payment proofs or establish settlement.
export const VERSION = 'proof-u/witness-capsule/v1';
export const MAX_BYTES = 65536;
const rule = (ok, why) => { if (!ok) throw new Error(why); };
export const hex = bytes => Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
export function unhex(text) {
  rule(typeof text === 'string' && /^(?:[0-9a-f]{2})*$/.test(text), 'invalid-hex');
  return Uint8Array.from(text.match(/../g) ?? [], b => parseInt(b, 16));
}
export function aadBytes(domain, handoff) {
  // Narrow native profile: no language-dependent JSON escaping in AAD.
  rule(typeof domain === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(domain), 'unsupported-domain');
  rule(typeof handoff === 'string' && /^[0-9a-f]{32}$/.test(handoff), 'invalid-handoff');
  return new TextEncoder().encode(JSON.stringify([VERSION, domain, handoff]));
}
function checkKey(key) {
  rule(key instanceof Uint8Array && key.length === 32, 'invalid-key');
}
export async function sealBytes(plaintext, key, domain, handoff) {
  checkKey(key);
  rule(plaintext instanceof Uint8Array && plaintext.length > 0 && plaintext.length <= MAX_BYTES, 'invalid-plaintext-size');
  const additionalData = aadBytes(domain, handoff);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const imported = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['encrypt']);
  const sealed = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, additionalData, tagLength: 128 }, imported, plaintext));
  return { version: VERSION, domain, handoff, nonce: hex(nonce), ciphertext: hex(sealed.subarray(0, -16)), authTag: hex(sealed.subarray(-16)) };
}
export async function openBytes(envelope, key, expectedDomain, expectedHandoff) {
  checkKey(key);
  rule(envelope && Object.keys(envelope).sort().join(',') === 'authTag,ciphertext,domain,handoff,nonce,version', 'invalid-envelope');
  rule(envelope.version === VERSION && envelope.domain === expectedDomain && envelope.handoff === expectedHandoff, 'wrong-envelope-context');
  const additionalData = aadBytes(expectedDomain, expectedHandoff);
  rule(typeof envelope.nonce === 'string' && /^[0-9a-f]{24}$/.test(envelope.nonce), 'invalid-nonce');
  rule(typeof envelope.authTag === 'string' && /^[0-9a-f]{32}$/.test(envelope.authTag), 'invalid-tag');
  rule(typeof envelope.ciphertext === 'string' && envelope.ciphertext.length > 0 && envelope.ciphertext.length <= MAX_BYTES * 2, 'invalid-ciphertext-size');
  const ciphertext = unhex(envelope.ciphertext);
  const combined = new Uint8Array(ciphertext.length + 16);
  combined.set(ciphertext);
  combined.set(unhex(envelope.authTag), ciphertext.length);
  const imported = await crypto.subtle.importKey('raw', key, 'AES-GCM', false, ['decrypt']);
  // No plaintext is returned until the complete authentication tag verifies.
  return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(envelope.nonce), additionalData, tagLength: 128 }, imported, combined));
}
