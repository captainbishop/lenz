import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readVectors, envelopeFor } from './vectors.mjs';
import { aadBytes, unhex, hex, sealBytes, openBytes } from './crypto-web.mjs';
import { openCapsule } from '../witness-delivery.mjs';
import { verifyEdge, closeCurve } from '../crypto-step/step.mjs';

after(closeCurve);
const vectors = readVectors();
const base = vectors[0];
const key = unhex(base.key);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

test('saved vectors and real proof sample match their recorded hashes', () => {
  const manifest = JSON.parse(readFileSync('vectors-manifest.json', 'utf8'));
  assert.equal(sha(readFileSync('vectors.tsv')), manifest.vectorsSha256);
  assert.equal(sha(readFileSync('../crypto-step/proof-example.json')), manifest.proofSampleSha256);
  assert.deepEqual(vectors.map(({ id, expect }) => ({ id, expect })), manifest.cases);
  assert.equal(vectors.filter(v => v.expect === 'accept').length, 3);
});

for (const v of vectors) test(`WebCrypto vector: ${v.id} (${v.expect})`, async () => {
  const operation = () => openBytes(envelopeFor(v), unhex(v.key), v.domain, v.handoff);
  if (v.expect === 'reject-auth') {
    await assert.rejects(operation, error => error.name === 'OperationError');
  } else if (v.expect === 'reject-format') {
    await assert.rejects(operation, /invalid-|unsupported-domain/);
  } else {
    assert.equal(hex(aadBytes(v.domain, v.handoff)), v.aad);
    assert.equal(hex(await operation()), v.plaintext);
    const original = JSON.parse(Buffer.from(v.plaintext, 'hex').toString('utf8'));
    assert.deepEqual(openCapsule(envelopeFor(v), Buffer.from(v.key, 'hex'), v.domain, v.handoff), original);
    const portable = await sealBytes(unhex(v.plaintext), unhex(v.key), v.domain, v.handoff);
    assert.deepEqual(openCapsule(portable, Buffer.from(v.key, 'hex'), v.domain, v.handoff), original);
  }
});

test('exact ciphertext retries preserve bytes; new encryption uses a fresh nonce', async () => {
  const envelope = envelopeFor(base);
  assert.equal(hex(await openBytes(envelope, key, base.domain, base.handoff)), base.plaintext);
  assert.equal(hex(await openBytes(structuredClone(envelope), key, base.domain, base.handoff)), base.plaintext);
  const one = await sealBytes(unhex(base.plaintext), key, base.domain, base.handoff);
  const two = await sealBytes(unhex(base.plaintext), key, base.domain, base.handoff);
  assert.notEqual(one.nonce, two.nonce);
});

test('outer-header substitution, unexpected fields and malformed hex fail closed', async () => {
  const envelope = envelopeFor(base);
  for (const change of [{ domain: `${base.domain}/other` }, { handoff: '0'.repeat(32) }, { version: 'v0' }]) {
    await assert.rejects(() => openBytes({ ...envelope, ...change }, key, base.domain, base.handoff), /wrong-envelope-context/);
  }
  await assert.rejects(() => openBytes({ ...envelope, debug: true }, key, base.domain, base.handoff), /invalid-envelope/);
  for (const ciphertext of ['a', 'GG', 'AA']) await assert.rejects(() => openBytes({ ...envelope, ciphertext }, key, base.domain, base.handoff), /invalid-hex/);
});

test('key sizes, plaintext byte limits and the native domain profile are explicit', async () => {
  await assert.rejects(() => sealBytes(new Uint8Array(0), key, base.domain, base.handoff), /invalid-plaintext-size/);
  await assert.rejects(() => sealBytes(new Uint8Array(65537), key, base.domain, base.handoff), /invalid-plaintext-size/);
  await assert.rejects(() => sealBytes(unhex(base.plaintext), key.subarray(0, 16), base.domain, base.handoff), /invalid-key/);
  assert.throws(() => aadBytes('a'.repeat(129), base.handoff), /unsupported-domain/);
  assert.throws(() => aadBytes('pool/💸', base.handoff), /unsupported-domain/);
  assert.equal(aadBytes('a'.repeat(128), base.handoff).length > 128, true);
  assert.equal(unhex(vectors.find(v => v.id === 'maximum-payload').plaintext).length, 65536);
});

test('the real-step vector retains a valid PLONK proof through both crypto APIs', async () => {
  const sample = JSON.parse(readFileSync('../crypto-step/proof-example.json', 'utf8'));
  const capsule = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await openBytes(envelopeFor(base), key, base.domain, base.handoff)));
  assert.equal(await verifyEdge(capsule.edges[0], capsule.domain, sample.verificationKey), true);
});

test('Java 8 API adapter compiles and passes the identical vector corpus on this JVM', () => {
  const compile = spawnSync('javac', ['--release', '8', '-d', 'build/java', 'CapsuleCrypto.java', 'CapsuleVectors.java'], { encoding: 'utf8' });
  assert.ifError(compile.error);
  assert.equal(compile.status, 0, compile.stderr);
  const run = spawnSync('java', ['-cp', 'build/java', 'CapsuleVectors', 'vectors.tsv'], { encoding: 'utf8' });
  assert.ifError(run.error);
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout.trim(), `JVM vectors passed: ${vectors.length}`);
});
