// Research sparse Merkle map. Real SHA-256 paths; no hiding or consensus claim.
import { createHash } from 'node:crypto';

export const isDigest = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
export const digest = (...parts) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const rule = (ok, message) => { if (!ok) throw new Error(message); };
const branch = (domain, left, right) => digest('witness-map/branch/v1', domain, left, right);
const indexOf = (domain, key) => BigInt(`0x${digest('witness-map/key/v1', domain, key)}`);
const leaf = (domain, key, value) => value === null
  ? digest('witness-map/empty/v1', domain)
  : digest('witness-map/leaf/v1', domain, key, value);

export function rootFromPath(domain, key, value, siblings) {
  rule(typeof domain === 'string' && domain.length > 0, 'invalid-domain');
  rule(isDigest(key) && (value === null || isDigest(value)), 'invalid-map-leaf');
  rule(Array.isArray(siblings) && siblings.length === 256 && siblings.every(isDigest), 'invalid-map-path');
  let index = indexOf(domain, key);
  let hash = leaf(domain, key, value);
  for (const sibling of siblings) {
    hash = (index & 1n) === 0n ? branch(domain, hash, sibling) : branch(domain, sibling, hash);
    index >>= 1n;
  }
  return hash;
}

export function verifyPath(domain, root, proof) {
  try {
    return isDigest(root) && rootFromPath(domain, proof.key, proof.value, proof.siblings) === root;
  } catch {
    return false;
  }
}

export class WitnessMap {
  constructor(domain, entries = []) {
    rule(typeof domain === 'string' && domain.length > 0, 'invalid-domain');
    rule(Array.isArray(entries) && entries.length <= 2048, 'snapshot-entry-limit');
    this.domain = domain;
    this.values = new Map();
    for (const pair of entries) {
      rule(Array.isArray(pair) && pair.length === 2 && pair.every(isDigest), 'invalid-map-entry');
      rule(!this.values.has(pair[0]), 'duplicate-map-key');
      this.values.set(...pair);
    }
    this.rebuild();
  }

  rebuild() {
    this.defaults = [leaf(this.domain, '', null)];
    for (let depth = 0; depth < 256; depth++) {
      this.defaults.push(branch(this.domain, this.defaults[depth], this.defaults[depth]));
    }
    this.layers = [new Map()];
    for (const [key, value] of this.values) {
      const index = indexOf(this.domain, key);
      rule(!this.layers[0].has(index), 'map-key-hash-collision');
      this.layers[0].set(index, leaf(this.domain, key, value));
    }
    for (let depth = 0; depth < 256; depth++) {
      const below = this.layers[depth];
      const above = new Map();
      for (const child of below.keys()) {
        const parent = child >> 1n;
        if (above.has(parent)) continue;
        const left = below.get(parent << 1n) ?? this.defaults[depth];
        const right = below.get((parent << 1n) | 1n) ?? this.defaults[depth];
        above.set(parent, branch(this.domain, left, right));
      }
      this.layers.push(above);
    }
    this.root = this.layers[256].get(0n) ?? this.defaults[256];
  }

  get(key) { return this.values.get(key) ?? null; }
  entries() { return [...this.values].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0); }

  path(key) {
    rule(isDigest(key), 'invalid-map-key');
    let index = indexOf(this.domain, key);
    const siblings = [];
    for (let depth = 0; depth < 256; depth++) {
      siblings.push(this.layers[depth].get(index ^ 1n) ?? this.defaults[depth]);
      index >>= 1n;
    }
    return { key, value: this.get(key), siblings };
  }

  set(key, value) {
    rule(isDigest(key) && isDigest(value), 'invalid-map-entry');
    rule(this.values.has(key) || this.values.size < 2048, 'snapshot-entry-limit');
    this.values.set(key, value);
    this.rebuild();
  }
}
