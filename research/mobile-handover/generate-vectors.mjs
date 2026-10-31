import { createHash, createCipheriv } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { VERSION, aadBytes } from './crypto-web.mjs';
import { makeCapsule, validateCapsule } from '../witness-delivery.mjs';
import { WitnessMap } from '../witness-map.mjs';
import { noteKey, noteValue } from '../witness-delivery.mjs';

// ALL keys/nonces in these files are public test material, never wallet keys.
const sha = value => createHash('sha256').update(value).digest();
const sample = JSON.parse(readFileSync('../crypto-step/proof-example.json', 'utf8'));
const domain = sample.domain;
const tree = new WitnessMap(domain, [[noteKey(domain, sample.edge.input), noteValue(domain, sample.edge.input)]]);
const base = makeCapsule(domain, { domain, epoch: 0, root: tree.root }, sample.edge.outputs[0], [sample.edge]);
const unicode = structuredClone(base);
unicode.edges[0].proof = 'ENCODING FIXTURE ONLY: café ₦ 💸 "quotes" \\ newline\nnull\u0000';
const maximum = structuredClone(base);
maximum.edges = Array.from({ length: 9 }, () => ({ ...sample.edge, proof: 'p' }));
let remaining = 65536 - Buffer.byteLength(JSON.stringify(maximum));
for (const edge of maximum.edges) {
  const count = Math.min(8191, remaining);
  edge.proof += 'x'.repeat(count);
  remaining -= count;
}
if (remaining !== 0) throw new Error('Could not form exact boundary fixture');
const cases = [];
for (const [id, capsule] of [['real-step', base], ['utf8-payload', unicode], ['maximum-payload', maximum]]) {
  validateCapsule(capsule);
  const key = sha(`PUBLIC TEST KEY/${id}`);
  const nonce = sha(`PUBLIC TEST NONCE/${id}`).subarray(0, 12);
  const handoff = sha(`PUBLIC TEST HANDOFF/${id}`).subarray(0, 16).toString('hex');
  const aad = Buffer.from(aadBytes(domain, handoff));
  const plaintext = Buffer.from(JSON.stringify(capsule));
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  cases.push({ id, expect: 'accept', domain, handoff, key: key.toString('hex'), nonce: nonce.toString('hex'), plaintext: plaintext.toString('hex'), ciphertext: ciphertext.toString('hex'), tag: cipher.getAuthTag().toString('hex'), aad: aad.toString('hex') });
}
const flip = text => `${text[0] === '0' ? '1' : '0'}${text.slice(1)}`;
for (const field of ['key', 'nonce', 'ciphertext', 'tag']) cases.push({ ...cases[0], id: `altered-${field}`, expect: 'reject-auth', [field]: flip(cases[0][field]) });
for (const field of ['domain', 'handoff']) {
  const row = { ...cases[0], id: `altered-${field}`, expect: 'reject-auth', [field]: field === 'domain' ? `${domain}/other` : flip(cases[0].handoff) };
  row.aad = Buffer.from(aadBytes(row.domain, row.handoff)).toString('hex');
  cases.push(row);
}
cases.push({ ...cases[0], id: 'truncated-ciphertext', expect: 'reject-auth', ciphertext: cases[0].ciphertext.slice(0, -2) });
for (const [id, change] of [
  ['short-key', { key: cases[0].key.slice(2) }], ['short-nonce', { nonce: cases[0].nonce.slice(2) }],
  ['short-tag', { tag: cases[0].tag.slice(2) }], ['empty-ciphertext', { ciphertext: '' }],
  ['invalid-domain', { domain: 'pool"escape' }], ['invalid-handoff', { handoff: 'A'.repeat(32) }],
]) cases.push({ ...cases[0], id, expect: 'reject-format', ...change });
const columns = ['id', 'expect', 'domain', 'handoff', 'key', 'nonce', 'plaintext', 'ciphertext', 'tag', 'aad'];
const tsv = [columns.join('\t'), ...cases.map(row => columns.map(k => row[k]).join('\t'))].join('\n') + '\n';
writeFileSync('vectors.tsv', tsv);
writeFileSync('vectors-manifest.json', JSON.stringify({ kind: 'PUBLIC-TEST-KEYS-ONLY', envelopeVersion: VERSION, format: 'UTF-8 tab-separated hex byte fields; LF line endings', cases: cases.map(({ id, expect }) => ({ id, expect })), vectorsSha256: sha(tsv).toString('hex'), proofSampleSha256: sha(readFileSync('../crypto-step/proof-example.json')).toString('hex'), note: 'Only real-step carries a real proof; other positive payloads exercise encoding/size, not payment validity.' }, null, 2));
console.log(`Wrote ${cases.length} public handover vectors`);
