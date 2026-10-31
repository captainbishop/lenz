// Contract-side feasibility measurement of the existing TEST-ONLY payment step.
// The generated verifier fixes its verification key; proof files cannot supply it.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import solc from 'solc';
import { network } from 'hardhat';
import { ContractFactory } from 'ethers';
import { context, fromHex, field, closeCurve } from '../../research/crypto-step/step.mjs';

const source = await readFile(new URL('../contracts/PaymentStepVerifier.sol', import.meta.url), 'utf8');
const sample = JSON.parse(await readFile(new URL('../../research/crypto-step/proof-example.json', import.meta.url), 'utf8'));
const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'PaymentStepVerifier.sol': { content: source } },
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } } })));
assert.deepEqual((output.errors ?? []).filter(e => e.severity === 'error'), []);
const compiled = output.contracts['PaymentStepVerifier.sol'].PlonkVerifier;
const { proof, nonce } = JSON.parse(sample.edge.proof);
assert.equal(proof.protocol, 'plonk'); assert.equal(proof.curve, 'bn128');
// snarkjs 0.7.6 plonk_exportsoliditycalldata.js order; all coordinates are public.
const words = ['A', 'B', 'C', 'Z', 'T1', 'T2', 'T3', 'Wxi', 'Wxiw'].flatMap(k => proof[k].slice(0, 2))
  .concat(['eval_a', 'eval_b', 'eval_c', 'eval_s1', 'eval_s2', 'eval_zw'].map(k => proof[k])).map(BigInt);
const signals = [context(sample.domain), fromHex(sample.edge.input), fromHex(sample.edge.nf), ...sample.edge.outputs.map(fromHex), field(nonce), fromHex(sample.edge.id)];
const connection = await network.create('local');
try {
  const [signer] = await connection.ethers.getSigners();
  const verifier = await new ContractFactory(compiled.abi, compiled.evm.bytecode.object, signer).deploy();
  await verifier.waitForDeployment();
  assert.equal(await verifier.verifyProof(words, signals), true, 'Valid payment proof rejected');
  for (let i = 0; i < signals.length; i++) {
    const changed = [...signals]; changed[i] += 1n;
    assert.equal(await verifier.verifyProof(words, changed), false, `Public field ${i} is not bound`);
  }
  const changedProof = [...words]; changedProof[18] += 1n;
  assert.equal(await verifier.verifyProof(changedProof, signals), false, 'Changed proof accepted');
  const data = verifier.interface.encodeFunctionData('verifyProof', [words, signals]);
  const receipt = await (await signer.sendTransaction({ to: await verifier.getAddress(), data })).wait();
  assert.equal(receipt.status, 1);
  const result = { checkedAt: new Date().toISOString(), compiler: solc.version(), evm: 'local Hardhat', evmTarget: 'paris',
    verifierSha256: createHash('sha256').update(source).digest('hex'), circuitHash: sample.circuitHash,
    validProofAccepted: true, alteredPublicInputsRejected: signals.length, alteredProofRejected: true,
    gasUsed: receipt.gasUsed.toString(), calldataBytes: (data.length - 2) / 2,
    deployedBytecodeBytes: compiled.evm.deployedBytecode.object.length / 2,
    scope: 'TEST-ONLY setup. Existing ownership/nullifier/conservation step; seven public inputs expose commitment graph. Local EVM gas is not NEAR gas or Aurora execution evidence. No private settlement wrapper or Zcash transaction.' };
  await writeFile(new URL('../proof-results.json', import.meta.url), `${JSON.stringify(result, null, 2)}\n`);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await connection.close();
  await closeCurve();
}
