import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { createCipheriv, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import * as original from './crypto-web.mjs';
import { readVectors, envelopeFor } from './vectors.mjs';

const base = readVectors()[0];
const source = readFileSync('crypto-web.mjs', 'utf8');
const key = Buffer.from(base.key, 'hex');
const plaintext = Buffer.from(base.plaintext, 'hex');
function validCipher(bytes, secret, id) {
  const nonce = createHash('sha256').update(`PUBLIC MUTATION NONCE/${id}`).digest().subarray(0, 12);
  const cipher = createCipheriv(secret.length === 16 ? 'aes-128-gcm' : 'aes-256-gcm', secret, nonce);
  cipher.setAAD(original.aadBytes(base.domain, base.handoff));
  const ciphertext = Buffer.concat([cipher.update(bytes), cipher.final()]);
  return { ...envelopeFor(base), nonce: nonce.toString('hex'), ciphertext: ciphertext.toString('hex'), authTag: cipher.getAuthTag().toString('hex') };
}
const over = Buffer.alloc(65537, 65);
const cases = [
  ['context', 'envelope.domain === expectedDomain && envelope.handoff === expectedHandoff', 'true', { ...envelopeFor(base), domain: `${base.domain}/substituted` }, key, plaintext, /wrong-envelope-context/],
  ['key-size', 'key.length === 32', '[16, 32].includes(key.length)', validCipher(plaintext, key.subarray(0, 16), 'key'), key.subarray(0, 16), plaintext, /invalid-key/],
  ['payload-limit', 'envelope.ciphertext.length <= MAX_BYTES * 2', 'true', validCipher(over, key, 'size'), key, over, /invalid-ciphertext-size/],
];
const outcomes = [];
for (const [name, before, after, envelope, secret, expected, reason] of cases) {
  await assert.rejects(() => original.openBytes(envelope, secret, base.domain, base.handoff), reason);
  assert.equal(source.split(before).length, 2, `${name}: unique guard`);
  const path = resolve(`.crypto-mutant-${process.pid}-${name}.mjs`);
  try {
    writeFileSync(path, source.replace(before, after));
    const mutated = await import(pathToFileURL(path).href);
    assert.deepEqual(Buffer.from(await mutated.openBytes(envelope, secret, base.domain, base.handoff)), expected);
    outcomes.push({ name, originalRejects: true, mutantAccepts: true });
    console.log(`Handover guard mutation demonstrated: ${name}`);
  } finally { unlinkSync(path); }
}
writeFileSync('mutation-results.json', JSON.stringify({ kind: 'targeted-handover-guard-checks', sourceSha256: createHash('sha256').update(source).digest('hex'), outcomes }, null, 2));
