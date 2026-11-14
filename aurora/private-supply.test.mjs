import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { Interface, AbiCoder, keccak256 } from 'ethers';
import { createBlock } from '@ethereumjs/block';
import { createAddressFromString, hexToBytes } from '@ethereumjs/util';
import { createCustomCommon, Hardfork, Mainnet } from '@ethereumjs/common';
import { paramsEVM } from '@ethereumjs/evm';
import { compileSource } from './compiler.mjs';
import { createLocalEvm } from './local-evm.mjs';

const source = await readFile(process.env.LENZ_SUPPLY_CONTRACT_SOURCE || new URL('./contracts/PrivateSupply.sol', import.meta.url), 'utf8');
// External protocol fixtures execute honest transfers and indexed receipt math.
// The proof fixture binds public withdrawal arguments; it is not a zk verifier.
const fixtureSource = `// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
contract LinkFixture {
 mapping(address => uint256) public balanceOf;
 mapping(address => mapping(address => uint256)) public allowance;
 uint256 public debitShortfall;
 bool public ignoreClear;
 bool public preserveAllowance;
 function mint(address to, uint256 amount) external { balanceOf[to] += amount; }
 function configure(uint256 shortfall, bool ignoresClear) external { debitShortfall = shortfall; ignoreClear = ignoresClear; }
 function setPreserveAllowance(bool value) external { preserveAllowance = value; }
 function approve(address spender, uint256 amount) external returns (bool) { if (amount != 0 || !ignoreClear) allowance[msg.sender][spender] = amount; return true; }
 function transfer(address to, uint256 amount) external returns (bool) { balanceOf[msg.sender] -= amount; balanceOf[to] += amount; return true; }
 function transferFrom(address from, address to, uint256 amount) external returns (bool) { if (!preserveAllowance) allowance[from][msg.sender] -= amount - debitShortfall; balanceOf[from] -= amount - debitShortfall; balanceOf[to] += amount - debitShortfall; return true; }
}
contract ALinkFixture {
 address public POOL;
 address public UNDERLYING_ASSET_ADDRESS;
 uint256 public index = 1200000000000000000000000000;
 mapping(address => uint256) public scaledBalanceOf;
 constructor(address link) { UNDERLYING_ASSET_ADDRESS = link; }
 function setPool(address pool) external { POOL = pool; }
 function setUnderlying(address link) external { UNDERLYING_ASSET_ADDRESS = link; }
 function setIndex(uint256 value) external { index = value; }
 function balanceOf(address owner) external view returns (uint256) { return (scaledBalanceOf[owner] * index + 5e26) / 1e27; }
 function mint(address owner, uint256 amount) external { require(msg.sender == POOL); scaledBalanceOf[owner] += (amount * 1e27 + index / 2) / index; }
}
contract AavePoolFixture {
 LinkFixture public immutable link;
 ALinkFixture public immutable aLink;
 uint256 public creditShortfall;
 address public callbackTarget;
 bytes public callbackData;
 bool public callbackSucceeded;
 bytes public lastCalldata;
 constructor(address token, address receipt) { link = LinkFixture(token); aLink = ALinkFixture(receipt); }
 function configure(uint256 shortfall) external { creditShortfall = shortfall; }
 function attack(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
 function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external {
  require(asset == address(link) && referralCode == 0);
  lastCalldata = msg.data;
  link.transferFrom(msg.sender, address(aLink), amount);
  if (callbackTarget != address(0)) { (callbackSucceeded,) = callbackTarget.call(callbackData); }
  aLink.mint(onBehalfOf, amount - creditShortfall);
 }
}
contract ProofDependencyFixture {}
contract OriginalRelationPoolFixture {
 address public token;
 uint256 public denomination;
 uint32 public levels = 20;
 address public verifier;
 address public hasher;
 uint256 public payoutShortfall;
 address public callbackTarget;
 bytes public callbackData;
 bool public callbackSucceeded;
 mapping(bytes32 => bool) public nullifierHashes;
 constructor(address asset, uint256 value, address v, address h) { token = asset; denomination = value; verifier = v; hasher = h; }
 function configure(address asset, uint32 depth, address v, address h) external { token = asset; levels = depth; verifier = v; hasher = h; }
 function setPayoutShortfall(uint256 amount) external { payoutShortfall = amount; }
 function attack(address target, bytes calldata data) external { callbackTarget = target; callbackData = data; }
 function withdraw(bytes calldata proof, bytes32 root, bytes32 nullifierHash, address payable recipient, address payable relayer, uint256 fee, uint256 refund) external payable {
  require(!nullifierHashes[nullifierHash], "Note already spent");
  require(keccak256(proof) == keccak256(abi.encode(root, nullifierHash, recipient, relayer, fee, refund)), "Wrong proof relation");
  require(msg.value == 0 && relayer == address(0) && fee == 0 && refund == 0, "Unsupported payment");
  nullifierHashes[nullifierHash] = true;
  LinkFixture(token).transfer(recipient, denomination - payoutShortfall);
  if (callbackTarget != address(0)) { (callbackSucceeded,) = callbackTarget.call(callbackData); }
 }
}`;
const artifacts = Object.fromEntries(['PrivateSupplyVault', 'PrivateSupplyFactory'].map(name => [name, compileSource('PrivateSupply.sol', source, name)]));
for (const name of ['LinkFixture', 'ALinkFixture', 'AavePoolFixture', 'ProofDependencyFixture', 'OriginalRelationPoolFixture']) {
  artifacts[name] = compileSource('SupplyFixtures.sol', fixtureSource, name);
}
const coder = AbiCoder.defaultAbiCoder();
const ZERO = '0x0000000000000000000000000000000000000000';
const ROOT = '0x' + '11'.repeat(32), NULLIFIER = '0x' + '22'.repeat(32);

async function fixture() {
  const evm = await createLocalEvm();
  function contract(name, address) {
    const iface = new Interface(artifacts[name].abi), target = createAddressFromString(address.toString());
    return { address: target.toString(), iface,
      send: (method, values = []) => evm.send(iface.encodeFunctionData(method, values), target),
      read: async (method, values = []) => iface.decodeFunctionResult(method, await evm.call(iface.encodeFunctionData(method, values), target)) };
  }
  async function deploy(name, args = []) {
    const iface = new Interface(artifacts[name].abi);
    const result = await evm.send('0x' + artifacts[name].evm.bytecode.object + iface.encodeDeploy(args).slice(2));
    return contract(name, result.createdAddress);
  }
  async function atTime(target, method, args, timestamp) {
    const result = await evm.vm.evm.runCall({ caller: evm.sender, to: createAddressFromString(target.address), data: hexToBytes(target.iface.encodeFunctionData(method, args)), gasLimit: 10000000n,
      block: createBlock({ header: { timestamp, gasLimit: 30000000n } }, { common: evm.vm.common }) });
    assert(!result.execResult.exceptionError, result.execResult.exceptionError?.error);
    return result;
  }
  const link = await deploy('LinkFixture'), aLink = await deploy('ALinkFixture', [link.address]);
  const aave = await deploy('AavePoolFixture', [link.address, aLink.address]);
  await aLink.send('setPool', [aave.address]);
  const verifier = await deploy('ProofDependencyFixture'), hasher = await deploy('ProofDependencyFixture');
  const original = await deploy('OriginalRelationPoolFixture', [link.address, 1000000000000000000n, verifier.address, hasher.address]);
  const factory = await deploy('PrivateSupplyFactory', [original.address, aave.address, aLink.address, 31337n]);
  const beneficiary = '0x000000000000000000000000000000000000beef', refundRecipient = '0x000000000000000000000000000000000000cafe';
  // At a 1.2 ray index, one LINK mints 833333333333333333 scaled units.
  const plan = [beneficiary, refundRecipient, 833333333333333333n, 1000n, '0x' + '33'.repeat(32)];
  const predicted = (await factory.read('vaultAddress', [plan]))[0];
  const vault = contract('PrivateSupplyVault', predicted);
  const proof = (recipient = predicted, relayer = ZERO, fee = 0n, refund = 0n) => coder.encode(['bytes32', 'bytes32', 'address', 'address', 'uint256', 'uint256'], [ROOT, NULLIFIER, recipient, relayer, fee, refund]);
  await link.send('mint', [original.address, 1000000000000000000n]);
  return { evm, deploy, contract, atTime, link, aLink, aave, verifier, hasher, original, factory, plan, vault, proof, beneficiary, refundRecipient };
}

test('original proof-funded Supply credits indexed aLINK directly to the recoverable owner once', async () => {
  const f = await fixture();
  await f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 833333333333333333n);
  assert.equal((await f.aLink.read('balanceOf', [f.beneficiary]))[0], 1000000000000000000n);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.vault.address]))[0], 0n);
  assert.equal((await f.link.read('balanceOf', [f.aLink.address]))[0], 1000000000000000000n);
  assert.equal((await f.link.read('balanceOf', [f.vault.address]))[0], 0n);
  assert.equal((await f.link.read('allowance', [f.vault.address, f.aave.address]))[0], 0n);
  assert.equal((await f.vault.read('status'))[0], 2n);
  assert.equal((await f.aave.read('lastCalldata'))[0], f.aave.iface.encodeFunctionData('supply', [f.link.address, 1000000000000000000n, f.beneficiary, 0]));
  await assert.rejects(f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]), /revert/);
  await assert.rejects(f.vault.send('execute'), /revert/);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 833333333333333333n);
});

test('a direct original-pool withdrawal recovers the same active vault and preserves the position owner', async () => {
  const f = await fixture();
  await f.original.send('withdraw', [f.proof(), ROOT, NULLIFIER, f.vault.address, ZERO, 0n, 0n]);
  assert.equal((await f.link.read('balanceOf', [f.vault.address]))[0], 1000000000000000000n);
  await f.atTime(f.factory, 'recover', [f.plan], 1000n);
  assert.equal((await f.vault.read('status'))[0], 2n);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 833333333333333333n);
  assert.equal((await f.link.read('balanceOf', [f.refundRecipient]))[0], 0n);
});

test('expiry returns unconsumed original LINK and donations without creating or refunding collateral', async () => {
  const f = await fixture();
  await f.original.send('withdraw', [f.proof(), ROOT, NULLIFIER, f.vault.address, ZERO, 0n, 0n]);
  await f.link.send('mint', [f.vault.address, 7n]);
  await f.atTime(f.factory, 'recover', [f.plan], 1001n);
  assert.equal((await f.link.read('balanceOf', [f.refundRecipient]))[0], 1000000000000000007n);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 0n);
  assert.equal((await f.vault.read('status'))[0], 3n);
  await assert.rejects(f.vault.send('execute'), /revert/);
  await f.link.send('mint', [f.vault.address, 9n]);
  await f.vault.send('recoverExtras');
  assert.equal((await f.link.read('balanceOf', [f.refundRecipient]))[0], 1000000000000000016n);
  assert.equal((await f.vault.read('status'))[0], 3n);
});

test('an expired unspent note withdraws only to its original plan and fixed refund recipient', async () => {
  const f = await fixture();
  await assert.rejects(f.factory.send('withdrawRefund', [f.plan, f.proof(), ROOT, NULLIFIER]), /revert/);
  await assert.rejects(f.atTime(f.factory, 'fulfill', [f.plan, f.proof(), ROOT, NULLIFIER], 1001n), /revert/);
  assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
  await f.atTime(f.factory, 'withdrawRefund', [f.plan, f.proof(), ROOT, NULLIFIER], 1001n);
  assert.equal((await f.link.read('balanceOf', [f.refundRecipient]))[0], 1000000000000000000n);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 0n);
  assert.equal((await f.vault.read('status'))[0], 3n);
  await assert.rejects(f.atTime(f.factory, 'withdrawRefund', [f.plan, f.proof(), ROOT, NULLIFIER], 1001n), /revert/);
});

test('every reviewed plan field changes the original proof recipient and rejects the old proof', async () => {
  const f = await fixture();
  const replacements = [f.refundRecipient, f.beneficiary, 833333333333333332n, 999n, '0x' + '44'.repeat(32)];
  for (let index = 0; index < f.plan.length; index++) {
    const changed = [...f.plan]; changed[index] = replacements[index];
    assert.notEqual((await f.factory.read('vaultAddress', [changed]))[0].toLowerCase(), f.vault.address.toLowerCase());
    await assert.rejects(f.factory.send('fulfill', [changed, f.proof(), ROOT, NULLIFIER]), /revert/);
    assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
  }
  for (const invalidProof of [f.proof(f.vault.address, f.refundRecipient), f.proof(f.vault.address, ZERO, 1n), f.proof(f.vault.address, ZERO, 0n, 1n)]) {
    await assert.rejects(f.factory.send('fulfill', [f.plan, invalidProof, ROOT, NULLIFIER]), /revert/);
  }
  await f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 833333333333333333n);
});

test('scaled credit is the new supply delta even when the owner has an existing interest-bearing position', async () => {
  const f = await fixture();
  await f.link.send('mint', [f.evm.sender.toString(), 600000000000000000n]);
  await f.link.send('approve', [f.aave.address, 600000000000000000n]);
  await f.aave.send('supply', [f.link.address, 600000000000000000n, f.beneficiary, 0]);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 500000000000000000n);
  await f.aave.send('configure', [2n]);
  await assert.rejects(f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]), /revert/);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 500000000000000000n);
  assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
  await f.aave.send('configure', [0n]);
  await f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 1333333333333333333n);
  await f.aLink.send('setIndex', [1300000000000000000000000000n]);
  assert.equal((await f.aLink.read('balanceOf', [f.beneficiary]))[0], 1733333333333333333n);
  await assert.rejects(f.atTime(f.vault, 'refund', [], 1001n), /revert/);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 1333333333333333333n);
});

test('short input consumption and uncleared allowances revert the entire note withdrawal', async () => {
  for (const uncleared of [false, true]) {
    const f = await fixture();
    await f.factory.send('deploy', [f.plan]);
    await f.link.send('configure', [uncleared ? 0n : 1n, uncleared]);
    await f.link.send('setPreserveAllowance', [uncleared]);
    await assert.rejects(f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]), /revert/);
    assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
    assert.equal((await f.link.read('balanceOf', [f.original.address]))[0], 1000000000000000000n);
    assert.equal((await f.link.read('balanceOf', [f.aLink.address]))[0], 0n);
    assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 0n);
    assert.equal((await f.vault.read('status'))[0], 0n);
    assert.equal((await f.link.read('allowance', [f.vault.address, f.aave.address]))[0], 0n);
  }
});

test('existing LINK donations cannot mask a short original-pool withdrawal', async () => {
  const f = await fixture();
  await f.factory.send('deploy', [f.plan]);
  await f.link.send('mint', [f.vault.address, 100n]);
  await f.original.send('setPayoutShortfall', [1n]);
  await assert.rejects(f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]), /revert/);
  assert.equal((await f.link.read('balanceOf', [f.vault.address]))[0], 100n);
  assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
  await assert.rejects(f.atTime(f.factory, 'withdrawRefund', [f.plan, f.proof(), ROOT, NULLIFIER], 1001n), /revert/);
  assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
});

test('only original LINK donations are returned and supplied status never reactivates', async () => {
  const f = await fixture();
  await f.link.send('mint', [f.vault.address, 17n]);
  await assert.rejects(f.factory.send('recover', [f.plan]), /revert/);
  await f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]);
  assert.equal((await f.link.read('balanceOf', [f.refundRecipient]))[0], 17n);
  await f.link.send('mint', [f.vault.address, 19n]);
  await f.vault.send('recoverExtras');
  assert.equal((await f.link.read('balanceOf', [f.refundRecipient]))[0], 36n);
  assert.equal((await f.vault.read('status'))[0], 2n);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 833333333333333333n);
  await assert.rejects(f.factory.send('recover', [f.plan]), /revert/);
  await assert.rejects(f.atTime(f.vault, 'refund', [], 1001n), /revert/);
});

test('Aave callbacks cannot resolve or replay a vault while it is processing', async () => {
  for (const targetName of ['vault', 'factory']) {
    const f = await fixture();
    const target = f[targetName];
    await f.aave.send('attack', [target.address, target.iface.encodeFunctionData(targetName === 'vault' ? 'execute' : 'recover', targetName === 'vault' ? [] : [f.plan])]);
    await f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]);
    assert.equal((await f.aave.read('callbackSucceeded'))[0], false);
    assert.equal((await f.vault.read('status'))[0], 2n);
    assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 833333333333333333n);
  }
});

test('changed receipt identities reject Supply while unconsumed LINK remains refundable after expiry', async () => {
  for (const identity of ['setPool', 'setUnderlying']) {
    const f = await fixture();
    await f.aLink.send(identity, [f.refundRecipient]);
    await assert.rejects(f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]), /revert/);
    assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
    await f.original.send('withdraw', [f.proof(), ROOT, NULLIFIER, f.vault.address, ZERO, 0n, 0n]);
    await f.atTime(f.factory, 'recover', [f.plan], 1001n);
    assert.equal((await f.vault.read('status'))[0], 3n);
    assert.equal((await f.link.read('balanceOf', [f.refundRecipient]))[0], 1000000000000000000n);
  }
});

test('changed route bytecode and network reject execution and preserve the funded original vault', async () => {
  const f = await fixture();
  await f.factory.send('deploy', [f.plan]);
  await f.original.send('withdraw', [f.proof(), ROOT, NULLIFIER, f.vault.address, ZERO, 0n, 0n]);
  for (const target of [f.link, f.aave, f.aLink]) {
    const address = createAddressFromString(target.address), code = await f.evm.vm.stateManager.getCode(address);
    await f.evm.vm.stateManager.putCode(address, new Uint8Array([0x00]));
    await assert.rejects(f.vault.send('execute'), /revert/);
    await f.evm.vm.stateManager.putCode(address, code);
  }
  const common = f.evm.vm.evm.common;
  f.evm.vm.evm.common = createCustomCommon({ chainId: 11155111 }, Mainnet, { hardfork: Hardfork.Paris, params: paramsEVM });
  try { await assert.rejects(f.atTime(f.vault, 'execute', [], 0n), /revert/); }
  finally { f.evm.vm.evm.common = common; }
  assert.equal((await f.vault.read('status'))[0], 0n);
  assert.equal((await f.link.read('balanceOf', [f.vault.address]))[0], 1000000000000000000n);
  await f.vault.send('execute');
  assert.equal((await f.vault.read('status'))[0], 2n);
});

test('factory rejects substituted original proof dependencies, depth, chain and receipt route', async () => {
  const f = await fixture();
  await assert.rejects(f.deploy('PrivateSupplyFactory', [f.original.address, f.aave.address, f.aLink.address, 11155111n]), /revert/);
  for (const config of [[f.refundRecipient, 20, f.verifier.address, f.hasher.address], [f.link.address, 19, f.verifier.address, f.hasher.address], [f.link.address, 20, f.hasher.address, f.verifier.address]]) {
    await f.original.send('configure', config);
    await assert.rejects(f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]), /revert/);
    assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
  }
  await f.original.send('configure', [f.link.address, 19, f.verifier.address, f.hasher.address]);
  await assert.rejects(f.deploy('PrivateSupplyFactory', [f.original.address, f.aave.address, f.aLink.address, 31337n]), /revert/);
  await f.original.send('configure', [f.link.address, 20, f.verifier.address, f.hasher.address]);
  await f.aLink.send('setUnderlying', [f.refundRecipient]);
  await assert.rejects(f.deploy('PrivateSupplyFactory', [f.original.address, f.aave.address, f.aLink.address, 31337n]), /revert/);
});

test('unchanged runtime hashes do not freeze downstream governance or indexed accounting', async () => {
  const f = await fixture();
  const beforeHash = keccak256(await f.evm.vm.stateManager.getCode(createAddressFromString(f.aLink.address)));
  await f.aLink.send('setIndex', [1500000000000000000000000000n]);
  assert.equal(keccak256(await f.evm.vm.stateManager.getCode(createAddressFromString(f.aLink.address))), beforeHash);
  await assert.rejects(f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]), /revert/);
  assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
  const adjustedPlan = [...f.plan]; adjustedPlan[2] = 666666666666666667n;
  const adjustedAddress = (await f.factory.read('vaultAddress', [adjustedPlan]))[0];
  await f.factory.send('fulfill', [adjustedPlan, f.proof(adjustedAddress), ROOT, NULLIFIER]);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 666666666666666667n);
  assert.equal((await f.aLink.read('balanceOf', [f.beneficiary]))[0], 1000000000000000001n);
});

test('expiry and resolution reject another Supply even when enough LINK is donated later', async () => {
  const f = await fixture();
  await f.factory.send('deploy', [f.plan]);
  await assert.rejects(f.vault.send('execute'), /revert/);
  await assert.rejects(f.atTime(f.vault, 'refund', [], 1001n), /revert/);
  await assert.rejects(f.vault.send('recoverExtras'), /revert/);
  await f.original.send('withdraw', [f.proof(), ROOT, NULLIFIER, f.vault.address, ZERO, 0n, 0n]);
  await assert.rejects(f.atTime(f.vault, 'refund', [], 1000n), /revert/);
  await assert.rejects(f.atTime(f.vault, 'execute', [], 1001n), /revert/);
  await f.vault.send('execute');
  await f.link.send('mint', [f.vault.address, 1000000000000000000n]);
  await assert.rejects(f.vault.send('execute'), /revert/);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 833333333333333333n);
  await f.vault.send('recoverExtras');
  assert.equal((await f.link.read('balanceOf', [f.refundRecipient]))[0], 1000000000000000000n);
  assert.equal((await f.vault.read('status'))[0], 2n);
});

test('Aave bytecode changes cannot strand an expired original note or a directly funded vault', async () => {
  for (const directFunding of [false, true]) {
    const f = await fixture();
    await f.evm.vm.stateManager.putCode(createAddressFromString(f.aave.address), new Uint8Array([0x00]));
    if (directFunding) {
      await f.original.send('withdraw', [f.proof(), ROOT, NULLIFIER, f.vault.address, ZERO, 0n, 0n]);
      await f.atTime(f.factory, 'recover', [f.plan], 1001n);
    } else await f.atTime(f.factory, 'withdrawRefund', [f.plan, f.proof(), ROOT, NULLIFIER], 1001n);
    assert.equal((await f.link.read('balanceOf', [f.refundRecipient]))[0], 1000000000000000000n);
    assert.equal((await f.vault.read('status'))[0], 3n);
  }
});

test('the original pool and cryptographic dependency code hashes are enforced before note spending', async () => {
  for (const name of ['original', 'verifier', 'hasher']) {
    const f = await fixture();
    const address = createAddressFromString(f[name].address), originalCode = await f.evm.vm.stateManager.getCode(address);
    await f.evm.vm.stateManager.putCode(address, new Uint8Array([0x00]));
    await assert.rejects(f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]), /revert/);
    await assert.rejects(f.atTime(f.factory, 'withdrawRefund', [f.plan, f.proof(), ROOT, NULLIFIER], 1001n), /revert/);
    await f.evm.vm.stateManager.putCode(address, originalCode);
    assert.equal((await f.original.read('nullifierHashes', [NULLIFIER]))[0], false);
    assert.equal((await f.link.read('balanceOf', [f.original.address]))[0], 1000000000000000000n);
  }
});

test('funding callbacks cannot execute the vault before atomic withdrawal validation', async () => {
  const f = await fixture();
  await f.original.send('attack', [f.factory.address, f.factory.iface.encodeFunctionData('recover', [f.plan])]);
  await f.factory.send('fulfill', [f.plan, f.proof(), ROOT, NULLIFIER]);
  assert.equal((await f.original.read('callbackSucceeded'))[0], false);
  assert.equal((await f.vault.read('status'))[0], 2n);
  assert.equal((await f.aLink.read('scaledBalanceOf', [f.beneficiary]))[0], 833333333333333333n);
});
