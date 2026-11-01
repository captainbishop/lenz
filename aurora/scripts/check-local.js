import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { Interface, hexlify } from 'ethers';
import { compileContract } from '../compiler.mjs';
import { createLocalEvm } from '../local-evm.mjs';

const compiled = await compileContract('ToolchainProbe.sol', 'ToolchainProbe');
const iface = new Interface(compiled.abi), evm = await createLocalEvm();
const deployment = await evm.send('0x' + compiled.evm.bytecode.object);
const address = deployment.createdAddress;
assert(address);
assert.equal(hexlify(await evm.vm.stateManager.getCode(address)), '0x' + compiled.evm.deployedBytecode.object);
const receipt = await evm.send(iface.encodeFunctionData('record', [42n]), address);
assert.equal(receipt.receipt.status, 1);
assert.equal(iface.decodeFunctionResult('value', await evm.call(iface.encodeFunctionData('value'), address))[0], 42n);
const event = receipt.receipt.logs.map(([, topics, data]) =>
  iface.parseLog({ topics: topics.map(hexlify), data: hexlify(data) })).find(log => log?.name === 'Recorded');
assert.equal(event.args.value, 42n);
const lockBytes = await readFile(new URL('../package-lock.json', import.meta.url));
const lock = JSON.parse(lockBytes);
const evidence = {
  checkedAt: new Date().toISOString(),
  node: process.version,
  platform: process.platform,
  packages: Object.fromEntries(['@ethereumjs/vm', '@ethereumjs/common', '@ethereumjs/tx', '@ethereumjs/util', 'ethers', 'solc'].map(name => [name, lock.packages[`node_modules/${name}`].version])),
  lockSha256: createHash('sha256').update(lockBytes).digest('hex'),
  checks: ['local deployment and exact runtime bytecode', 'successful receipt', 'state equals 42', 'Recorded event equals 42'],
  scope: 'In-memory EthereumJS EVM, chain 31337, Paris rules. No Aurora deployment or Lenz integration.',
};
await writeFile(new URL('../local-results.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log('PASS: pinned compiler, local EVM deployment, state write/read and receipt event.');
console.log(evidence.scope);
