import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Interface, AbiCoder } from 'ethers';
import { compileSource } from './compiler.mjs';
import { createLocalEvm } from './local-evm.mjs';

const source = await readFile(new URL('./contracts/PrivateIntent.sol', import.meta.url), 'utf8');
const tokenSource = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
contract TestAsset {
 mapping(address => uint256) public balanceOf;
 mapping(address => mapping(address => uint256)) public allowance;
 function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
 function approve(address spender, uint256 amount) external returns (bool) { allowance[msg.sender][spender] = amount; return true; }
 function transfer(address to, uint256 amount) external returns (bool) { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
 function transferFrom(address from, address to, uint256 amount) external returns (bool) { allowance[from][msg.sender] -= amount; balanceOf[from] -= amount; balanceOf[to] += amount; return true; }
}`;
const artifacts = Object.fromEntries(['PrivateIntentVault', 'FixedRateIntentAdapter'].map(name => [name, compileSource('PrivateIntent.sol', source, name)]));
artifacts.TestAsset = compileSource('TestAsset.sol', tokenSource, 'TestAsset');
const coder = AbiCoder.defaultAbiCoder();

async function fixture() {
  const evm = await createLocalEvm();
  async function deploy(name, args = [], types = []) {
    const compiled = artifacts[name];
    const result = await evm.send('0x' + compiled.evm.bytecode.object + coder.encode(types, args).slice(2));
    const address = result.createdAddress;
    const iface = new Interface(compiled.abi);
    return { address, iface, send: (method, values) => evm.send(iface.encodeFunctionData(method, values), address),
      read: async (method, values = []) => iface.decodeFunctionResult(method, await evm.call(iface.encodeFunctionData(method, values), address)) };
  }
  const input = await deploy('TestAsset'), output = await deploy('TestAsset');
  const adapter = await deploy('FixedRateIntentAdapter', [input.address.toString(), output.address.toString(), 2n, 1n], ['address', 'address', 'uint256', 'uint256']);
  const beneficiary = '0x000000000000000000000000000000000000beef';
  const refundRecipient = '0x000000000000000000000000000000000000cafe';
  const params = [input.address.toString(), output.address.toString(), adapter.address.toString(), 100n, 190n, 1000n, beneficiary, refundRecipient, 31337n];
  const vault = await deploy('PrivateIntentVault', [params], ['tuple(address inputToken,address outputToken,address adapter,uint256 inputAmount,uint256 minOutput,uint256 deadline,address beneficiary,address refundRecipient,uint256 chainId)']);
  await input.send('mint', [vault.address.toString(), 100n]);
  await output.send('mint', [adapter.address.toString(), 500n]);
  return { evm, deploy, input, output, adapter, vault, beneficiary, refundRecipient };
}

test('funded immutable intent pays the reviewed beneficiary and consumes authority once', async () => {
  const { vault, input, output, adapter, beneficiary } = await fixture();
  await vault.send('execute', []);
  assert.equal((await output.read('balanceOf', [beneficiary]))[0], 200n);
  assert.equal((await input.read('balanceOf', [adapter.address.toString()]))[0], 100n);
  assert.equal((await input.read('allowance', [vault.address.toString(), adapter.address.toString()]))[0], 0n);
  assert.equal((await vault.read('status'))[0], 2n);
  await assert.rejects(vault.send('execute', []), /revert/);
  assert.equal((await output.read('balanceOf', [beneficiary]))[0], 200n);
});
