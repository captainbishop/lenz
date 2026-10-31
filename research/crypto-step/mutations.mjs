// Targeted source-constraint removals. This is not a circuit security audit.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'node:fs';
import * as snarkjs from 'snarkjs';
import { compileCircuit } from './compile-circuit.mjs';
import { FR, createOwner, ownerKey, note, makeStep, hash, closeCurve } from './step.mjs';

const source = readFileSync('step.circom', 'utf8');
// snarkjs 0.7.6 calls logger.warn unconditionally on an invalid R1CS witness.
const logger = { info() {}, debug() {}, warn: console.warn, error: console.error };
const a = createOwner();
const b = createOwner();
const root = note(a.publicKey, 100n);
const outputs = [note(b.publicKey, 40n), note(a.publicKey, 60n)];
const honest = makeStep(root, a.secret, outputs);
const retie = input => ({ ...input, transferDigest: hash([104n, input.context, input.inputCommitment, input.nullifier, ...input.outputCommitments, input.nonce]) });
const equal = note(b.publicKey, 50n);
const mutants = [
  ['ownership', 'inputNote.out === inputCommitment;', '', makeStep(root, b.secret, outputs)],
  ['conservation', 'inputValue === outputValues[0] + outputValues[1];', '', makeStep(root, a.secret, [note(b.publicKey, 41n), outputs[1]])],
  ['nullifier', 'spent.out === nullifier;', '', retie({ ...honest, nullifier: (honest.nullifier + 1n) % FR })],
  ['output-binding', 'outputNotes[j].out === outputCommitments[j];', '', { ...honest, outputOwners: [a.publicKey, a.publicKey] }],
  ['transcript', 'transcript.out === transferDigest;', '', { ...honest, transferDigest: (honest.transferDigest + 1n) % FR }],
  ['output-range', 'outputRanges[i].in <== outputValues[i];', 'outputRanges[i].in <== 0;', makeStep(root, a.secret, [note(b.publicKey, FR - 1n), note(a.publicKey, 101n)])],
  ['input-range', 'inputRange.in <== inputValue;', 'inputRange.in <== 0;', makeStep(note(a.publicKey, 1n << 64n), a.secret, [note(b.publicKey, (1n << 64n) - 1n), note(a.publicKey, 1n)])],
  ['nonzero-secret', 'secretZero.out === 0;', '', makeStep(note(ownerKey(0n), 100n), 0n, outputs)],
  ['nonzero-input', 'inputZero.out === 0;', '', makeStep(note(a.publicKey, 0n), a.secret, [note(a.publicKey, 0n), note(b.publicKey, 0n)])],
  ['distinct-outputs', 'equalOutputs.out === 0;', '', makeStep(root, a.secret, [equal, equal])],
];

async function witnessFor(files, input) {
  const witness = { type: 'mem' };
  await snarkjs.wtns.calculate(input, files.wasm, witness, { sanityCheck: true });
  return witness;
}

// Generate the adversarial witness with the mutant, then evaluate that same
// witness against BOTH R1CS files. O0 preserves wire layout; assert the exact
// symbol mapping matches before comparing. No runtime assertion is bypassed.
const temporarySource = `.step-mutation-${process.pid}.circom`;
mkdirSync('build/mutations', { recursive: true });
try {
  writeFileSync(temporarySource, source);
  const baseline = compileCircuit(temporarySource, 'build/mutations/baseline');
  const symbols = readFileSync(baseline.r1cs.replace(/\.r1cs$/, '.sym'), 'utf8');
  assert.equal(await snarkjs.wtns.check(baseline.r1cs, await witnessFor(baseline, honest), logger), true, 'baseline honest witness');
  const results = [];
  for (const [name, before, after, malicious] of mutants) {
    assert.equal(source.split(before).length, 2, `${name}: expected exactly one source guard`);
    writeFileSync(temporarySource, source.replace(before, after));
    const modified = compileCircuit(temporarySource, `build/mutations/${name}`);
    assert.equal(readFileSync(modified.r1cs.replace(/\.r1cs$/, '.sym'), 'utf8'), symbols, `${name}: witness wire layout must match`);
    const witness = await witnessFor(modified, malicious);
    assert.equal(await snarkjs.wtns.check(baseline.r1cs, witness, logger), false, `${name}: original R1CS must reject`);
    assert.equal(await snarkjs.wtns.check(modified.r1cs, witness, logger), true, `${name}: removed guard must admit the attack`);
    results.push({ name, originalRejects: true, removedGuardAccepts: true });
    console.log(`Constraint mutation demonstrated: ${name}`);
  }
  writeFileSync('mutation-results.json', JSON.stringify({ kind: 'targeted-R1CS-guard-experiments', cases: results }, null, 2));
} finally {
  unlinkSync(temporarySource);
  await closeCurve();
}
