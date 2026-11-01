import assert from 'node:assert/strict';
import test from 'node:test';
import { Interface, hexlify } from 'ethers';
import { compileSource, compileContract } from './compiler.mjs';
import { createLocalEvm } from './local-evm.mjs';

const compiled = await compileContract('ToolchainProbe.sol', 'ToolchainProbe');
const iface = new Interface(compiled.abi);
async function fixture() {
  const evm = await createLocalEvm();
  const deployment = await evm.send('0x' + compiled.evm.bytecode.object);
  const address = deployment.createdAddress;
  assert(address);
  const value = async () => iface.decodeFunctionResult('value', await evm.call(iface.encodeFunctionData('value'), address))[0];
  return { evm, address, value };
}

test('compiler rejects invalid source and missing contract names', () => {
  assert.throws(() => compileSource('Broken.sol', 'not Solidity', 'Broken'), /ParserError/);
  assert.throws(() => compileSource('Empty.sol', 'pragma solidity 0.8.38; contract Empty {}', 'Missing'), /Missing deployable/);
});

test('local deployment executes exact compiled bytecode and isolates each fixture', async () => {
  const a = await fixture(), b = await fixture();
  assert.equal(a.evm.vm.common.hardfork(), 'paris');
  assert.equal(a.evm.vm.common.chainId(), 31337n);
  assert.equal(hexlify(await a.evm.vm.stateManager.getCode(a.address)), '0x' + compiled.evm.deployedBytecode.object);
  assert.equal(await a.value(), 0n);
  const result = await a.evm.send(iface.encodeFunctionData('record', [42n]), a.address);
  assert.equal(result.receipt.status, 1);
  assert.equal(await a.value(), 42n);
  assert.equal(await b.value(), 0n);
  const [[emitter, topics, data]] = result.receipt.logs;
  assert.equal(hexlify(emitter), a.address.toString());
  assert.equal(iface.parseLog({ topics: topics.map(hexlify), data: hexlify(data) }).args.value, 42n);
});

test('static reads preserve the full state root, and reject writes', async () => {
  const { evm, address, value } = await fixture();
  const before = await evm.vm.stateManager.getStateRoot();
  assert.equal(await value(), 0n);
  assert.equal(await value(), 0n);
  await assert.rejects(evm.call(iface.encodeFunctionData('record', [99n]), address), /static state change/);
  assert.deepEqual(await evm.vm.stateManager.getStateRoot(), before);
  await evm.send(iface.encodeFunctionData('record', [7n]), address);
  assert.equal(await value(), 7n);
});

test('reverted and out-of-gas transactions fail visibly without changing contract storage', async () => {
  const { evm, address, value } = await fixture();
  await evm.send(iface.encodeFunctionData('record', [42n]), address);
  await assert.rejects(evm.send('0xdeadbeef', address), /revert/);
  await assert.rejects(evm.send(iface.encodeFunctionData('record', [99n]), address, 22_000n), /out of gas/);
  assert.equal(await value(), 42n);
  await evm.send(iface.encodeFunctionData('record', [7n]), address);
  assert.equal(await value(), 7n);
});

test('fixture enforces transaction balance validation', async () => {
  const { evm, address } = await fixture();
  const account = await evm.vm.stateManager.getAccount(evm.sender);
  account.balance = 0n;
  await evm.vm.stateManager.putAccount(evm.sender, account);
  await assert.rejects(evm.send(iface.encodeFunctionData('record', [42n]), address), /enough funds/);
});
