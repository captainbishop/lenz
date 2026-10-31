import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { network } from 'hardhat';

// Explicitly use the in-process test EVM even if a caller supplies --network.
const connection = await network.create('local');
try {
  const probe = await connection.ethers.deployContract('ToolchainProbe');
  await probe.waitForDeployment();
  const receipt = await (await probe.record(42n)).wait();
  assert.equal(receipt.status, 1);
  assert.equal(await probe.value(), 42n);
  const event = receipt.logs.map(log => probe.interface.parseLog(log)).find(log => log?.name === 'Recorded');
  assert.equal(event.args.value, 42n);
  const lockBytes = await readFile(new URL('../package-lock.json', import.meta.url));
  const lock = JSON.parse(lockBytes);
  const evidence = {
    checkedAt: new Date().toISOString(),
    node: process.version,
    platform: process.platform,
    packages: Object.fromEntries(['hardhat', '@nomicfoundation/hardhat-ethers', 'ethers', 'solc'].map(name => [name, lock.packages[`node_modules/${name}`].version])),
    lockSha256: createHash('sha256').update(lockBytes).digest('hex'),
    checks: ['local deployment', 'successful receipt', 'state equals 42', 'Recorded event equals 42'],
    scope: 'Local Hardhat EVM fixture. No Aurora deployment or Lenz integration.',
  };
  await writeFile(new URL('../local-results.json', import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
  console.log('PASS: pinned compiler, local EVM deployment, state write/read and receipt event.');
  console.log('Scope: local toolchain fixture; no Aurora deployment or Lenz integration.');
} finally {
  await connection.close();
}
