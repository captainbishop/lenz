import { readFileSync } from 'node:fs';
export function readVectors() {
  const [header, ...lines] = readFileSync(new URL('vectors.tsv', import.meta.url), 'utf8').trimEnd().split('\n');
  const names = header.split('\t');
  return lines.map(line => {
    const values = line.split('\t');
    if (values.length !== names.length) throw new Error('invalid-vector-columns');
    return Object.fromEntries(names.map((name, i) => [name, values[i]]));
  });
}
export const envelopeFor = row => ({ version: 'proof-u/witness-capsule/v1', domain: row.domain, handoff: row.handoff, nonce: row.nonce, ciphertext: row.ciphertext, authTag: row.tag });
