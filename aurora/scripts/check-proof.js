// Contract-side feasibility measurement of the existing TEST-ONLY payment step.
// The generated verifier fixes its verification key; proof files cannot supply it.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import solc from 'solc';
import { Interface, hexlify } from 'ethers';
import { compileSource } from '../compiler.mjs';
import { createLocalEvm } from '../local-evm.mjs';
import { context, fromHex, field, closeCurve } from '../../research/crypto-step/step.mjs';

const source = await readFile(new URL('../contracts/PaymentStepVerifier.sol', import.meta.url), 'utf8');
const sample = JSON.parse(await readFile(new URL('../../research/crypto-step/proof-example.json', import.meta.url), 'utf8'));
const compiled = compileSource('PaymentStepVerifier.sol', source, 'PlonkVerifier');
const { proof, nonce } = JSON.parse(sample.edge.proof);
assert.equal(proof.protocol, 'plonk'); assert.equal(proof.curve, 'bn128');
// snarkjs 0.7.6 plonk_exportsoliditycalldata.js order; all coordinates are public.
const words = ['A', 'B', 'C', 'Z', 'T1', 'T2', 'T3', 'Wxi', 'Wxiw'].flatMap(k => proof[k].slice(0, 2))
  .concat(['eval_a', 'eval_b', 'eval_c', 'eval_s1', 'eval_s2', 'eval_zw'].map(k => proof[k])).map(BigInt);
const signals = [context(sample.domain), fromHex(sample.edge.input), fromHex(sample.edge.nf), ...sample.edge.outputs.map(fromHex), field(nonce), fromHex(sample.edge.id)];
const evm = await createLocalEvm();
try {
  const deployment = await evm.send('0x' + compiled.evm.bytecode.object);
  const address = deployment.createdAddress, iface = new Interface(compiled.abi);
  assert(address);
  assert.equal(hexlify(await evm.vm.stateManager.getCode(address)), '0x' + compiled.evm.deployedBytecode.object);
  const verify = async (proofWords, publicInputs) => iface.decodeFunctionResult('verifyProof',
    await evm.call(iface.encodeFunctionData('verifyProof', [proofWords, publicInputs]), address))[0];
  assert.equal(await verify(words, signals), true, 'Valid payment proof rejected');
  for (let i = 0; i < signals.length; i++) {
    const changed = [...signals]; changed[i] += 1n;
    assert.equal(await verify(words, changed), false, `Public field ${i} is not bound`);
  }
  const changedProof = [...words]; changedProof[18] += 1n;
  assert.equal(await verify(changedProof, signals), false, 'Changed proof accepted');
  const data = iface.encodeFunctionData('verifyProof', [words, signals]);
  const receipt = await evm.send(data, address);
  assert.equal(receipt.receipt.status, 1);
  const lockBytes = await readFile(new URL('../package-lock.json', import.meta.url));
  const result = { checkedAt: new Date().toISOString(), compiler: solc.version(), evm: 'in-memory EthereumJS 10.1.3', evmTarget: 'paris',
    lockSha256: createHash('sha256').update(lockBytes).digest('hex'),
    verifierSha256: createHash('sha256').update(source).digest('hex'), circuitHash: sample.circuitHash,
    validProofAccepted: true, alteredPublicInputsRejected: signals.length, alteredProofRejected: true,
    gasUsed: receipt.totalGasSpent.toString(), calldataBytes: (data.length - 2) / 2,
    deployedBytecodeBytes: compiled.evm.deployedBytecode.object.length / 2,
    scope: 'TEST-ONLY setup. Existing ownership/nullifier/conservation step; seven public inputs expose commitment graph. Local EVM gas is not NEAR gas or Aurora execution evidence. No private settlement wrapper or Zcash transaction.' };
  await writeFile(new URL('../proof-results.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await closeCurve();
}
