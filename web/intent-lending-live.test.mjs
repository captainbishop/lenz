import test from 'node:test';
import assert from 'node:assert/strict';
import { createLendingExecutionRpc } from './intent-lending-live.mjs';
import { LENDING_EXECUTION_ABI } from './intent-lending-service.mjs';
import { Interface } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_SUPPLY_ABI } from './intent-lending-supply.mjs';

const sponsor = '0x' + '12'.repeat(20);
function fixture(override = {}) {
  const calls = [];
  const values = { eth_chainId: '0xaa36a7', eth_getBlockByNumber: { number: '0x64', hash: '0x' + 'aa'.repeat(32), baseFeePerGas: '0x3b9aca00' }, eth_getTransactionCount: '0x7', eth_getBalance: '0xde0b6b3a7640000', eth_maxPriorityFeePerGas: '0x3b9aca00', eth_estimateGas: '0x50000', eth_call: '0x', eth_sendRawTransaction: '0x' + 'bb'.repeat(32), eth_getTransactionReceipt: null, ...override };
  const fetchImpl = async (url, options) => {
    const request = JSON.parse(options.body); calls.push({ url, options, request });
    return Response.json({ jsonrpc: '2.0', id: request.id, result: values[request.method] });
  };
  return { calls, fetchImpl };
}
test('the lending sponsor reads Sepolia nonce and a bounded fee without sending', async () => {
  const f = fixture(), rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl: f.fetchImpl });
  assert.deepEqual(await rpc.sponsorState(), { chainId: '11155111', address: sponsor, nonce: '7', balance: '1000000000000000000', maxFeePerGas: '3000000000', maxPriorityFeePerGas: '1000000000' });
  assert.ok(f.calls.every(x => x.url === 'https://ethereum-sepolia-rpc.publicnode.com' && x.options.redirect === 'error'));
  assert.ok(!f.calls.some(x => x.request.method === 'eth_sendRawTransaction'));
});

test('the execution adapter exposes a receipt-block read and rejects unfinalized history before state reads',async()=>{
  const f=fixture({eth_getBlockByNumber:{number:'0x64',hash:'0x'+'aa'.repeat(32),timestamp:'0x6ad68000'}}),rpc=createLendingExecutionRpc({sponsorAddress:sponsor,fetchImpl:f.fetchImpl});
  await assert.rejects(rpc.snapshotAt({account:'0x'+'34'.repeat(20)},{number:'0x65',hash:'0x'+'bb'.repeat(32)}),/not finalized/);
  assert.deepEqual(f.calls.map(call=>call.request.method),['eth_chainId','eth_getBlockByNumber']);
  assert.equal(f.calls[1].request.params[0],'finalized');
});
test('wrong networks and fees above the sponsor cap reject before signing', async () => {
  for (const values of [{ eth_chainId: '0x1' }, { eth_getBlockByNumber: { baseFeePerGas: '0x2540be400' } }, { eth_getTransactionCount: '0x07' }]) {
    const f = fixture(values), rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl: f.fetchImpl });
    await assert.rejects(rpc.sponsorState());
    assert.ok(!f.calls.some(x => x.request.method === 'eth_sendRawTransaction'));
  }
});
test('simulation binds the sponsor and zero native value while receipt checks cannot send', async () => {
  const f = fixture(), rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl: f.fetchImpl });
  const data = LENDING_EXECUTION_ABI.encodeFunctionData('cancel', ['0', '1800000000', '0x' + '11'.repeat(65)]);
  assert.equal(await rpc.simulate({ from: sponsor, to: '0x' + '34'.repeat(20), data, value: '0' }), true);
  assert.deepEqual(f.calls.find(x => x.request.method === 'eth_call').request.params, [{ from: sponsor, to: '0x' + '34'.repeat(20), data, value: '0x0', gas: '0xf4240' }, 'latest']);
  await assert.rejects(rpc.simulate({ from: sponsor, to: '0x' + '34'.repeat(20), data: '0x12345678', value: '1' }));
  assert.equal(await rpc.receipt('0x' + 'bb'.repeat(32)), null);
  await rpc.block('0x64');
  assert.ok(!f.calls.some(x => x.request.method === 'eth_sendRawTransaction'));
});
test('malformed, redirected and oversized network evidence is rejected', async () => {
  for (const fetchImpl of [async () => Response.json({ jsonrpc: '2.0', id: 999, result: '0xaa36a7' }), async () => new Response('x'.repeat(1_048_577)), async () => ({ ok: true, redirected: true })]) {
    const rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl });
    await assert.rejects(rpc.sponsorState());
  }
});

test('a stalled lending RPC response body is cancelled at its deadline', async () => {
  let cancelled = false;
  const fetchImpl = async () => new Response(new ReadableStream({ cancel() { cancelled = true; } }));
  const rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl, timeoutMs: 30 });
  const expired = new Promise((_, reject) => setTimeout(() => reject(Error('RPC exceeded the response deadline')), 500));
  await assert.rejects(Promise.race([rpc.sponsorState(), expired]), error => error.name === 'TimeoutError');
  assert.equal(cancelled, true);
});

test('an overdue lending RPC connection cannot keep running and its late response is discarded', async () => {
  const response = Promise.withResolvers(), cancelled = Promise.withResolvers();
  const rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl: () => response.promise, timeoutMs: 30 });
  const expired = new Promise((_, reject) => setTimeout(() => reject(Error('RPC exceeded the connection deadline')), 500));
  await assert.rejects(Promise.race([rpc.sponsorState(), expired]), error => error.name === 'TimeoutError');
  response.resolve(new Response(new ReadableStream({ cancel() { cancelled.resolve(true); } })));
  assert.equal(await Promise.race([cancelled.promise, expired]), true);
});

test('lending RPC timeouts remain bounded', () => {
  for (const timeoutMs of [0, 60001, Infinity, 1.5]) assert.throws(() => createLendingExecutionRpc({ sponsorAddress: sponsor, timeoutMs }), /timeout/);
});

test('lending estimates the exact gas-capped call and refuses an insufficient sponsor limit', async () => {
  const data = LENDING_EXECUTION_ABI.encodeFunctionData('cancel', ['0', '1800000000', '0x' + '11'.repeat(65)]);
  const call = { from: sponsor, to: '0x' + '34'.repeat(20), data, value: '0' };
  const tooMuch = fixture({ eth_estimateGas: '0xf4241' }), rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl: tooMuch.fetchImpl });
  await assert.rejects(rpc.simulate(call), /gas/);
  assert.ok(!tooMuch.calls.some(x => ['eth_call', 'eth_sendRawTransaction'].includes(x.request.method)));
  const enough = fixture(), ready = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl: enough.fetchImpl, maxGas: '50000000', maxFeePerGas: '5000000' });
  assert.equal(await ready.simulate(call), true);
  assert.deepEqual(enough.calls.find(x => x.request.method === 'eth_estimateGas').request.params, [{ ...call, value: '0x0', gas: '0x2faf080' }]);
  assert.throws(() => createLendingExecutionRpc({ sponsorAddress: sponsor, maxGas: '50000000' }), /gas/);
});

test('setup simulation only accepts the pinned factory deployment and returns its exact account', async () => {
  const abi = new Interface(['function deploy(address owner) returns(address account)']), factory = '0x' + '34'.repeat(20), owner = '0x' + '56'.repeat(20), account = '0x' + '78'.repeat(20);
  const f = fixture({ eth_call: abi.encodeFunctionResult('deploy', [account]) });
  const rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, deployment: { lendingFactory: factory }, fetchImpl: f.fetchImpl });
  const call = { from: sponsor, to: factory, data: abi.encodeFunctionData('deploy', [owner]), value: '0' };
  assert.equal(await rpc.simulateSetup(call), account);
  assert.deepEqual(f.calls.find(x => x.request.method === 'eth_estimateGas').request.params, [{ ...call, value: '0x0', gas: '0xf4240' }]);
  const count = f.calls.length;
  await assert.rejects(rpc.simulateSetup({ ...call, to: owner }));
  await assert.rejects(rpc.simulateSetup({ ...call, data: call.data + '00' }));
  await assert.rejects(rpc.simulateSetup({ ...call, value: '1' }));
  assert.equal(f.calls.length, count);
});

test('original transaction presence checks are read-only and validate their hash before network use', async () => {
  const txHash = '0x' + 'bb'.repeat(32), original = { hash: txHash, blockNumber: null };
  const f = fixture({ eth_getTransactionByHash: original }), rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl: f.fetchImpl });
  assert.deepEqual(await rpc.transaction(txHash), original);
  await assert.rejects(rpc.transaction('not-a-hash'));
  assert.deepEqual(f.calls.map(x => x.request.method), ['eth_chainId', 'eth_getTransactionByHash']);
});

test('private Supply simulation only accepts the pinned factory and the exact original operation', async () => {
  const factory = '0x' + '34'.repeat(20), f = fixture();
  const deployment = { supplyFactory: factory, privacyPool: '0x' + '45'.repeat(20), verifier: '0x' + '56'.repeat(20), hasher: '0x' + '67'.repeat(20) };
  const rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, deployment, fetchImpl: f.fetchImpl });
  const plan = { beneficiary: sponsor, refundRecipient: sponsor, minScaledCredit: 1, deadline: 1800000300, salt: '0x' + '11'.repeat(32) };
  const call = { from: sponsor, to: factory, data: LENDING_SUPPLY_ABI.encodeFunctionData('recover', [plan]), value: '0' };
  assert.equal(await rpc.simulateSupply(call), true);
  const count = f.calls.length;
  await assert.rejects(rpc.simulateSupply({ ...call, to: sponsor }));
  await assert.rejects(rpc.simulateSupply({ ...call, data: call.data + '00' }));
  assert.equal(f.calls.length, count);
  const invalid = fixture({ eth_call: '0x00' });
  await assert.rejects(createLendingExecutionRpc({ sponsorAddress: sponsor, deployment, fetchImpl: invalid.fetchImpl }).simulateSupply(call), /unexpected/);
});

test('funding simulation limits one-note approval and deposit to the pinned LINK pool', async () => {
  const abi = new Interface(['function approve(address spender,uint256 amount) returns(bool)', 'function deposit(bytes32 commitment)']);
  const deployment = { supplyFactory: '0x' + '34'.repeat(20), privacyPool: '0x' + '45'.repeat(20), verifier: '0x' + '56'.repeat(20), hasher: '0x' + '67'.repeat(20) };
  const link = (await import('./public/intent-lending-config.js')).LENDING_TESTNET.link;
  const f = fixture({ eth_call: abi.encodeFunctionResult('approve', [true]) });
  const rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, deployment, fetchImpl: f.fetchImpl });
  const approve = { from: sponsor, to: link, data: abi.encodeFunctionData('approve', [deployment.privacyPool, 1000000000000000000n]), value: '0' };
  assert.equal(await rpc.simulateFunding(approve), true);
  assert.equal(await rpc.simulateFunding({ ...approve, data: abi.encodeFunctionData('approve', [deployment.privacyPool, 0]) }), true);
  const count = f.calls.length;
  for (const changed of [{ to: sponsor }, { data: abi.encodeFunctionData('approve', [sponsor, 1000000000000000000n]) }, { data: abi.encodeFunctionData('approve', [deployment.privacyPool, 1000000000000000001n]) }]) await assert.rejects(rpc.simulateFunding({ ...approve, ...changed }));
  assert.equal(f.calls.length, count);
  const deposit = { from: sponsor, to: deployment.privacyPool, data: abi.encodeFunctionData('deposit', ['0x' + '0'.repeat(63) + '1']), value: '0' };
  const ready = createLendingExecutionRpc({ sponsorAddress: sponsor, deployment, fetchImpl: fixture().fetchImpl });
  assert.equal(await ready.simulateFunding(deposit), true);
  await assert.rejects(ready.simulateFunding({ ...deposit, data: abi.encodeFunctionData('deposit', ['0x' + '0'.repeat(64)]) }));
  const denied = createLendingExecutionRpc({ sponsorAddress: sponsor, deployment, fetchImpl: fixture({ eth_call: abi.encodeFunctionResult('approve', [false]) }).fetchImpl });
  await assert.rejects(denied.simulateFunding(approve), /approval/);
});

test('Repay faucet simulation accepts exactly one Aave test USDC and rejects other assets, amounts and shortfalls', async () => {
  const { LENDING_TESTNET: config } = await import('./public/intent-lending-config.js');
  const abi = new Interface(['function mint(address asset,address recipient,uint256 amount) returns(uint256)']);
  const account = '0x' + '34'.repeat(20), f = fixture({ eth_call: abi.encodeFunctionResult('mint', [1000000]) });
  const rpc = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl: f.fetchImpl });
  const call = { from: sponsor, to: config.faucet, data: abi.encodeFunctionData('mint', [config.usdc, account, 1000000]), value: '0' };
  assert.equal(await rpc.simulateRepaymentFunding(call), true); const count = f.calls.length;
  for (const change of [{ to: account }, { value: '1' }, { data: abi.encodeFunctionData('mint', [config.link, account, 1000000]) }, { data: abi.encodeFunctionData('mint', [config.usdc, account, 1000001]) }, { data: call.data + '00' }]) await assert.rejects(rpc.simulateRepaymentFunding({ ...call, ...change }));
  assert.equal(f.calls.length, count);
  const short = createLendingExecutionRpc({ sponsorAddress: sponsor, fetchImpl: fixture({ eth_call: abi.encodeFunctionResult('mint', [999999]) }).fetchImpl });
  await assert.rejects(short.simulateRepaymentFunding(call), /shortfall/);
  assert.ok(!f.calls.some(row => row.request.method === 'eth_sendRawTransaction'));
});
