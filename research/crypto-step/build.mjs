import { mkdirSync, readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { createHash, randomBytes } from 'node:crypto';
import * as snarkjs from 'snarkjs';
import { compileCircuit } from './compile-circuit.mjs';

mkdirSync('build', { recursive: true });
// A failed rebuild must not leave a success marker for mixed/stale artifacts.
if (existsSync('build/build-metadata.json')) unlinkSync('build/build-metadata.json');
compileCircuit('step.circom', 'build');
const info = await snarkjs.r1cs.info('build/step.r1cs');
console.log(JSON.stringify({ stage: 'compiled', constraints: info.nConstraints, publicInputs: info.nPubInputs, wires: info.nVars }));

const logger = { info: console.log, warn: console.warn, error: console.error, debug() {} };
const curve = await snarkjs.curves.getCurveFromName('bn128');
try {
  // Local experimental setup only. Not an independently contributed ceremony.
  // Never reuse these artifacts for real funds. Entropy is not written/logged.
  if (!existsSync('build/local-test-only.ptau')) {
    console.log('Creating local TEST-ONLY powers of tau (2^14)');
    await snarkjs.powersOfTau.newAccumulator(curve, 14, 'build/pot-initial.ptau');
    await snarkjs.powersOfTau.contribute('build/pot-initial.ptau', 'build/pot-contributed.ptau', 'local-test-only', randomBytes(64).toString('hex'));
    console.log('Preparing TEST-ONLY universal parameters');
    await snarkjs.powersOfTau.preparePhase2('build/pot-contributed.ptau', 'build/local-test-only.ptau');
  }
  console.log('Building PLONK proving key');
  const status = await snarkjs.plonk.setup('build/step.r1cs', 'build/local-test-only.ptau', 'build/step.zkey', logger);
  if (status === -1) throw new Error('PLONK setup rejected parameters');
  const verificationKey = await snarkjs.zKey.exportVerificationKey('build/step.zkey');
  writeFileSync('build/verification-key.json', JSON.stringify(verificationKey, null, 2));
  const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex');
  const metadata = {
    kind: 'local-test-only-build', compiler: 'circom2 0.2.23 / Circom 2.2.3', optimization: 'O0', sanityCheck: 'compiler-default',
    scheme: 'snarkjs 0.7.6 PLONK', curve: 'BN254',
    constraints: info.nConstraints, wires: info.nVars, publicInputs: info.nPubInputs,
    setup: 'one local contribution; not a production ceremony',
    hashes: Object.fromEntries(['step.circom', 'package-lock.json', 'node_modules/circom2/circom.wasm', 'build/step.r1cs', 'build/step_js/step.wasm', 'build/local-test-only.ptau', 'build/step.zkey', 'build/verification-key.json'].map(path => [path, sha256(path)])),
  };
  writeFileSync('build/build-metadata.json', JSON.stringify(metadata, null, 2));
  console.log('Local proof artifacts written; TEST-ONLY setup');
} finally {
  await curve.terminate();
}
