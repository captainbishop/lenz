import { readFile, realpath, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Wallet, Transaction, Interface } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { outsideRepository } from '../integrations/intent-testnet/private-path.mjs';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { LENDING_DEPLOYMENT } from './public/intent-lending-deployment.js';
import { createLendingReader } from './intent-lending-read.mjs';
import { LENDING_EXECUTION_ABI } from './intent-lending-service.mjs';
import { LENDING_SUPPLY_ABI } from './intent-lending-supply.mjs';
import { createLendingSupplyReader } from './intent-lending-supply-read.mjs';
import { createLendingFundingReader } from './intent-lending-funding-read.mjs';
import { LENDING_REPAYMENT_FUNDING_ABI, checkLendingRepaymentFundingRequest } from './intent-lending-repayment-funding.mjs';
import { openLendingRuntime } from './intent-lending-runtime.mjs';

const repository = fileURLToPath(new URL('..', import.meta.url));
const check = (ok, message) => { if (!ok) throw Error(message); };
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value);
const decimal = value => typeof value === 'string' && /^(?:0|[1-9][0-9]{0,77})$/.test(value);
const setupAbi = new Interface(['function deploy(address owner) returns(address account)']);
const fundingAbi = new Interface(['function approve(address spender,uint256 amount) returns(bool)', 'function deposit(bytes32 commitment)']);

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

export function createLendingExecutionRpc({ sponsorAddress, deployment = {}, fetchImpl = fetch, maxFeePerGas = '6250000000', maxGas = '1000000', timeoutMs = 60000 } = {}) {
  check(address(sponsorAddress) && decimal(maxFeePerGas) && BigInt(maxFeePerGas) > 0n && BigInt(maxFeePerGas) <= 6250000000n, 'Pin the dedicated lending sponsor and test gas cap.');
  check(decimal(maxGas) && BigInt(maxGas) >= 21000n && BigInt(maxGas) <= 100000000n && BigInt(maxGas) * BigInt(maxFeePerGas) <= 6250000000000000n, 'Invalid lending sponsor gas budget.');
  check(Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60000, 'Invalid lending network timeout.');
  const reader = createLendingReader({ deployment, fetchImpl });
  let sequence = 0;
  async function rpc(method, params) {
    const id = ++sequence, signal = AbortSignal.timeout(timeoutMs);
    const fetching = Promise.resolve(fetchImpl(LENDING_TESTNET.rpc, { method: 'POST', headers: { 'Content-Type': 'application/json' }, redirect: 'error', signal, body: JSON.stringify({ jsonrpc: '2.0', id, method, params }) })).then(response => {
      if (signal.aborted) response.body?.cancel().catch(() => {});
      return response;
    });
    const response = await abortable(fetching, signal);
    check(response.ok && !response.redirected && response.body, 'The lending network is unavailable.');
    const stream = response.body.getReader(), chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await abortable(stream.read(), signal); if (done) break;
        size += value.length; check(size <= 1048576, 'The lending network response exceeds its limit.'); chunks.push(value);
      }
    } finally { stream.cancel().catch(() => {}); stream.releaseLock(); }
    let body;
    try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
    catch { throw Error('The lending network response is invalid.'); }
    check(body?.jsonrpc === '2.0' && body.id === id && !Object.hasOwn(body, 'error') && Object.hasOwn(body, 'result'), 'The lending network evidence is invalid.');
    return body.result;
  }
  async function chain() { check(await rpc('eth_chainId', []) === LENDING_TESTNET.chainHex, 'The lending network changed.'); }
  async function sponsorState() {
    await chain();
    const [block, nonce, balance, tip] = await Promise.all([
      rpc('eth_getBlockByNumber', ['latest', false]), rpc('eth_getTransactionCount', [sponsorAddress, 'pending']),
      rpc('eth_getBalance', [sponsorAddress, 'pending']), rpc('eth_maxPriorityFeePerGas', []),
    ]);
    check(quantity(block?.baseFeePerGas) && quantity(nonce) && quantity(balance) && quantity(tip), 'The lending sponsor fee or nonce is invalid.');
    const fee = BigInt(block.baseFeePerGas) * 2n + BigInt(tip);
    check(fee > 0n && fee <= BigInt(maxFeePerGas), 'The current lending fee exceeds the test sponsor cap.');
    return { chainId: '11155111', address: sponsorAddress, nonce: BigInt(nonce).toString(), balance: BigInt(balance).toString(), maxFeePerGas: fee.toString(), maxPriorityFeePerGas: BigInt(tip).toString() };
  }
  function validateCall(call) {
    check(call && Object.keys(call).length === 4 && call.from === sponsorAddress && address(call.to) && /^0x(?:[0-9a-f]{2})+$/.test(call.data) && call.value === '0', 'The lending simulation changed its exact sender or value.');
  }
  async function simulateBounded(call) {
    await chain();
    const bounded = { ...call, value: '0x0', gas: '0x' + BigInt(maxGas).toString(16) };
    const estimate = await rpc('eth_estimateGas', [bounded]);
    check(quantity(estimate) && BigInt(estimate) <= BigInt(maxGas), 'The lending operation exceeds its sponsor gas limit.');
    return rpc('eth_call', [bounded, 'latest']);
  }
  async function simulate(call) {
    validateCall(call);
    const operation = LENDING_EXECUTION_ABI.parseTransaction({ data: call.data });
    check(operation && ['execute', 'cancel', 'transferFunds'].includes(operation.name), 'The lending operation is unsupported.');
    const result = await simulateBounded(call);
    if (operation.name === 'execute') {
      check(typeof result === 'string' && /^0x[0-9a-f]{64}$/.test(result), 'The lending operation simulation returned unexpected data.');
      const amount = BigInt(result), order = operation.args[0];
      check(amount >= order.minResult && amount <= order.amount, 'The simulated result missed the approved lending bound.');
    } else check(result === '0x', 'The lending operation simulation returned unexpected data.');
    return true;
  }
  async function simulateSetup(call) {
    validateCall(call);
    const operation = setupAbi.parseTransaction({ data: call.data });
    check(call.to === deployment.lendingFactory && operation?.name === 'deploy' && address(operation.args.owner.toLowerCase()) && setupAbi.encodeFunctionData('deploy', operation.args) === call.data, 'The account setup changed its pinned factory or owner.');
    const result = await simulateBounded(call);
    check(typeof result === 'string' && /^0x0{24}[0-9a-f]{40}$/.test(result), 'The account setup returned an invalid address.');
    const account = setupAbi.decodeFunctionResult('deploy', result).account.toLowerCase();
    check(address(account), 'The account setup returned an invalid address.');
    return account;
  }
  async function simulateSupply(call) {
    validateCall(call);
    const operation = LENDING_SUPPLY_ABI.parseTransaction({ data: call.data });
    check(call.to === deployment.supplyFactory && operation && ['fulfill', 'recover', 'withdrawRefund'].includes(operation.name) && LENDING_SUPPLY_ABI.encodeFunctionData(operation.name, operation.args) === call.data, 'The original Supply changed its pinned factory or operation.');
    check(await simulateBounded(call) === '0x', 'The original Supply simulation returned unexpected data.');
    return true;
  }
  async function simulateFunding(call) {
    validateCall(call);
    const operation = fundingAbi.parseTransaction({ data: call.data });
    check(operation && fundingAbi.encodeFunctionData(operation.name, operation.args) === call.data, 'The original funding call changed.');
    if (operation.name === 'approve') {
      check(call.to === LENDING_TESTNET.link && operation.args.spender.toLowerCase() === deployment.privacyPool && (operation.args.amount === 0n || operation.args.amount === BigInt(LENDING_TESTNET.denomination)), 'The test LINK approval changed its pool or one-note amount.');
    } else {
      check(operation.name === 'deposit' && call.to === deployment.privacyPool && BigInt(operation.args.commitment) > 0n && BigInt(operation.args.commitment) < 21888242871839275222246405745257275088548364400416034343698204186575808495617n, 'The original funding commitment or private pool changed.');
    }
    const result = await simulateBounded(call);
    check(result === (operation.name === 'approve' ? fundingAbi.encodeFunctionResult('approve', [true]) : '0x'), 'The original funding approval or deposit simulation failed.');
    return true;
  }
  async function send(raw) {
    check(typeof raw === 'string' && /^0x(?:[0-9a-f]{2})+$/.test(raw) && raw.length <= 32768, 'The original lending transaction is invalid.');
    const tx = Transaction.from(raw);
    check(tx.from?.toLowerCase() === sponsorAddress && tx.chainId === 11155111n && tx.type === 2 && tx.value === 0n && tx.maxFeePerGas <= BigInt(maxFeePerGas), 'The original transaction exceeds the lending sponsor authority.');
    await chain(); const result = await rpc('eth_sendRawTransaction', [raw]);
    check(result === tx.hash, 'The lending network returned another transaction.'); return result;
  }
  async function simulateRepaymentFunding(call) {
    validateCall(call);
    const operation = LENDING_REPAYMENT_FUNDING_ABI.parseTransaction({ data: call.data });
    check(call.to === LENDING_TESTNET.faucet && operation?.name === 'mint' && operation.args.asset.toLowerCase() === LENDING_TESTNET.usdc && address(operation.args.recipient.toLowerCase()) && operation.args.amount === 1000000n && LENDING_REPAYMENT_FUNDING_ABI.encodeFunctionData('mint', operation.args) === call.data, 'The fixed Repay test-USDC grant changed.');
    const result = await simulateBounded(call);
    check(result === LENDING_REPAYMENT_FUNDING_ABI.encodeFunctionResult('mint', [1000000n]), 'The fixed Repay test-USDC mint simulation returned a shortfall.'); return true;
  }
  async function repaymentSnapshot(value, options = {}) {
    const input = checkLendingRepaymentFundingRequest(value), snapshot = await reader.snapshot({ owner: input.ownerAddress, account: input.account }, { blockTag: options.blockTag ?? 'finalized', ...(options.blockRef ? { blockRef: options.blockRef } : {}) });
    const ref = { blockHash: snapshot.block.hash, requireCanonical: true }, data = LENDING_REPAYMENT_FUNDING_ABI.encodeFunctionData('isPermissioned');
    const result = await rpc('eth_call', [{ to: LENDING_TESTNET.faucet, data }, ref]);
    check(result === LENDING_REPAYMENT_FUNDING_ABI.encodeFunctionResult('isPermissioned', [true]) || result === LENDING_REPAYMENT_FUNDING_ABI.encodeFunctionResult('isPermissioned', [false]), 'The Repay faucet permission response is invalid.');
    const canonical = await rpc('eth_getBlockByNumber', ['0x' + BigInt(snapshot.block.number).toString(16), false]); check(canonical?.hash === snapshot.block.hash && BigInt(canonical.number) === BigInt(snapshot.block.number), 'The Repay funding snapshot is no longer canonical.');
    return { snapshot, permissioned: LENDING_REPAYMENT_FUNDING_ABI.decodeFunctionResult('isPermissioned', result)[0] };
  }
  return Object.freeze({ snapshot: reader.snapshot, observeAccount: reader.observeAccount, sponsorState, simulate, simulateSetup, simulateSupply, simulateFunding, simulateRepaymentFunding, repaymentSnapshot, send,
    snapshotAt: (selection, blockRef) => reader.snapshot(selection, { blockRef }),
    async receipt(txHash) { check(hash(txHash), 'Invalid original lending transaction.'); await chain(); return rpc('eth_getTransactionReceipt', [txHash]); },
    async transaction(txHash) { check(hash(txHash), 'Invalid original lending transaction.'); await chain(); return rpc('eth_getTransactionByHash', [txHash]); },
    async block(number) { check(quantity(number), 'Invalid lending block.'); await chain(); return rpc('eth_getBlockByNumber', [number, false]); },
  });
}

export async function openLendingService({ stateDir, keyFile, deployment = LENDING_DEPLOYMENT, fetchImpl = fetch, maxFeePerGas = '5000000', maxGas = '50000000' } = {}) {
  check(typeof stateDir === 'string' && typeof keyFile === 'string' && outsideRepository(repository, resolve(stateDir)) && outsideRepository(repository, resolve(keyFile)), 'Keep the dedicated lending sponsor and journal outside the repository.');
  const config = { ...LENDING_TESTNET, ...deployment };
  check(['lendingFactory', 'privacyPool', 'supplyFactory', 'verifier', 'hasher'].every(name => address(config[name])), 'The lending deployment is unavailable.');
  check(decimal(maxGas) && BigInt(maxGas) >= 21000n && BigInt(maxGas) <= 100000000n && decimal(maxFeePerGas) && BigInt(maxGas) * BigInt(maxFeePerGas) <= 6250000000000000n, 'Invalid lending gas cap.');
  const readerDeployment = Object.fromEntries(['lendingFactory', 'privacyPool', 'supplyFactory', 'verifier', 'hasher', 'codeHashes', 'implementationPins'].map(name => [name, config[name]]));
  const verified = await createLendingReader({ deployment: readerDeployment, fetchImpl }).snapshot();
  check(verified.routeVerified === true && verified.trust?.executionPinsVerified === true, 'The deployed lending route is not verified.');
  const file = await realpath(resolve(keyFile));
  check(outsideRepository(repository, file) && (await stat(file)).size <= 4096, 'The dedicated lending key file is invalid.');
  const key = JSON.parse(await readFile(file, 'utf8'));
  check(key.version === 1 && key.environment === 'testnet' && key.purpose === 'lenz-lending-testnet-only' && key.chainId === 11155111 && address(key.address) && typeof key.privateKey === 'string' && /^0x[0-9a-f]{64}$/.test(key.privateKey), 'The key is not a dedicated Sepolia lending sponsor.');
  const wallet = new Wallet(key.privateKey); key.privateKey = undefined;
  check(wallet.address.toLowerCase() === key.address, 'The dedicated lending sponsor changed.');
    const rpc = createLendingExecutionRpc({ sponsorAddress: key.address, deployment: readerDeployment, fetchImpl, maxFeePerGas, maxGas });
    const supplyReader = createLendingSupplyReader({ deployment, fetchImpl, readSnapshot: rpc.snapshot });
    const fundingReader = createLendingFundingReader({ deployment, sponsorAddress: key.address, fetchImpl, readSnapshot: rpc.snapshot });
    const signer = { async signTransaction(call) {
      check(call.chainId === 11155111 && call.type === 2 && call.value === '0' && address(call.to) && BigInt(call.gasLimit) <= BigInt(maxGas) && BigInt(call.maxFeePerGas) <= BigInt(maxFeePerGas), 'The lending sponsor call exceeds its test authority.');
      return wallet.signTransaction({ ...call, nonce: Number(call.nonce) });
    } };
    return openLendingRuntime({ stateDir, config, rpc, supplyRpc: { ...rpc, ...supplyReader, simulate: rpc.simulateSupply }, fundingRpc: { ...rpc, ...fundingReader }, signer, sponsorAddress: key.address, maxFeePerGas, maxGas });
}
