import { Interface, Transaction, keccak256 } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
const abi = new Interface(['function deploy(address owner) returns(address)']);
const check = (value, message) => { if (!value) throw Error(message); };
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value);
export const emptyLendingSetupJournal = () => ({ version: 1, requests: {}, pending: null });
export function checkLendingSetupRequest(input) {
  check(input && Object.getPrototypeOf(input) === Object.prototype && Object.keys(input).sort().join() === 'account,owner' && address(input.owner) && address(input.account), 'Choose the original lending owner and predicted account.');
  return { owner: input.owner, account: input.account };
}
export function createLendingSetupService({ config = LENDING_TESTNET, rpc, signer, journal, sponsorAddress, serialize, sponsorFence, maxGas = '50000000', maxFeePerGas = '5000000', maxRequests = 20, now = Date.now } = {}) {
  check(rpc && signer && journal && address(sponsorAddress) && address(config.lendingFactory) && hash(config.codeHashes?.lendingFactory) && config.chainId === 11155111 && uint(maxGas) && BigInt(maxGas) <= 100000000n && BigInt(maxGas) >= 21000n && uint(maxFeePerGas) && BigInt(maxFeePerGas) > 0n && BigInt(maxGas) * BigInt(maxFeePerGas) <= 6250000000000000n && Number.isSafeInteger(maxRequests) && maxRequests > 0 && maxRequests <= 50, 'The bounded account setup sponsor is unavailable.');
  let queue = Promise.resolve();
  const serial = serialize ?? (work => { const result = queue.then(work); queue = result.catch(() => {}); return result; });
  const callFor = input => ({ to: config.lendingFactory, data: abi.encodeFunctionData('deploy', [input.owner]), value: '0' });
  function checkTx(raw, input) {
    check(typeof raw === 'string' && raw.length <= 4096, 'The original setup transaction is invalid.');
    const tx = Transaction.from(raw), call = callFor(input);
    check(tx.isSigned() && tx.chainId === 11155111n && tx.type === 2 && tx.from.toLowerCase() === sponsorAddress && tx.to?.toLowerCase() === call.to && tx.value === 0n && tx.data.toLowerCase() === call.data.toLowerCase() && tx.gasLimit === BigInt(maxGas) && tx.maxFeePerGas > 0n && tx.maxFeePerGas <= BigInt(maxFeePerGas) && tx.maxPriorityFeePerGas <= tx.maxFeePerGas && tx.accessList.length === 0 && tx.hash === keccak256(raw), 'The original setup transaction changed its owner or gas authority.');
    return tx;
  }
  async function state() {
    const value = await journal.read();
    check(value?.version === 1 && value.requests && Object.getPrototypeOf(value.requests) === Object.prototype && Object.keys(value.requests).length <= maxRequests && (value.pending === null || address(value.pending)), 'The account setup journal is invalid.');
    for (const [id, row] of Object.entries(value.requests)) {
      const input = checkLendingSetupRequest(row.input);
      check(id === input.account && ['signing-unresolved', 'pending', 'verified', 'failed'].includes(row.status), 'The original account setup changed.');
      if (row.raw) check(checkTx(row.raw, input).hash === row.hash, 'The original setup transaction hash changed.');
      if (!['verified', 'failed'].includes(row.status)) check(value.pending === id, 'The original account setup lost its sponsor reservation.');
    }
    check(value.pending === null || value.requests[value.pending], 'The setup sponsor reservation is invalid.'); return value;
  }
  async function save(value) { await journal.write(structuredClone(value)); check(JSON.stringify(await journal.read()) === JSON.stringify(value), 'The original account setup was not saved.'); }
  async function observe(input) {
    const value = await rpc.snapshot(input), account = value?.account;
    check(value?.chainId === config.chain && value.routeVerified === true && value.trust?.executionPinsVerified === true && value.block?.finality === 'finalized' && value.block.requireCanonical === true && uint(value.block.number) && hash(value.block.hash) && Number.isSafeInteger(value.observedAt) && Math.abs(now() - value.observedAt) <= 120000, 'The finalized account setup route is unavailable.');
    check(account?.address === input.account && account.owner === input.owner && ['undeployed', 'verified'].includes(account.status) && account.route?.factory === config.lendingFactory, 'The lending owner or predicted account changed.');
    return value;
  }
  const outcome = row => ({ owner: row.input.owner, account: row.input.account, status: row.status === 'verified' ? 'verified' : row.status === 'failed' ? 'failed' : 'pending', verified: row.status === 'verified', ...(row.hash ? { transaction: row.hash } : {}) });
  async function reconcileRow(current, row) {
    if (['verified', 'failed'].includes(row.status)) { await sponsorFence?.release(row.input.account); return outcome(row); }
    if (!row.raw) return outcome(row);
    const receipt = await rpc.receipt(row.hash); if (!receipt) return outcome(row);
    check(receipt.transactionHash === row.hash && receipt.from?.toLowerCase() === sponsorAddress && receipt.to?.toLowerCase() === config.lendingFactory && hash(receipt.blockHash) && /^0x[0-9a-f]+$/.test(receipt.blockNumber) && ['0x0', '0x1'].includes(receipt.status), 'The account setup receipt changed.');
    const observed = await observe(row.input);
    if (BigInt(observed.block.number) < BigInt(receipt.blockNumber)) return outcome(row);
    const block = await rpc.block(receipt.blockNumber); check(block?.hash === receipt.blockHash && BigInt(block.number) === BigInt(receipt.blockNumber), 'The account setup receipt is not canonical.');
    if (receipt.status === '0x1') check(observed.account.status === 'verified' && hash(observed.account.codeHash), 'The original lending account is not deployed.');
    row.status = receipt.status === '0x1' ? 'verified' : 'failed'; row.receipt = { blockNumber: receipt.blockNumber, blockHash: receipt.blockHash, status: receipt.status }; current.pending = null;
    await save(current); await sponsorFence?.release(row.input.account); return outcome(row);
  }
  async function setup(value) { return serial(async () => {
    const input = checkLendingSetupRequest(value), current = await state(), existing = current.requests[input.account];
    if (existing) { check(existing.input.owner === input.owner, 'The original setup owner changed.'); return reconcileRow(current, existing); }
    check(!current.pending && Object.keys(current.requests).length < maxRequests, 'Check the original setup before creating another account.');
    await sponsorFence?.assertAvailable(); const observed = await observe(input);
    if (observed.account.status === 'verified') return { ...input, status: 'verified', verified: true };
    const call = callFor(input); check(await rpc.simulateSetup({ from: sponsorAddress, ...call }) === input.account, 'The exact account setup simulation failed.');
    const sponsor = await rpc.sponsorState();
    check(sponsor?.chainId === '11155111' && sponsor.address === sponsorAddress && ['nonce', 'balance', 'maxFeePerGas', 'maxPriorityFeePerGas'].every(key => uint(sponsor[key])) && BigInt(sponsor.nonce) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(sponsor.maxFeePerGas) > 0n && BigInt(sponsor.maxFeePerGas) <= BigInt(maxFeePerGas) && BigInt(sponsor.maxPriorityFeePerGas) <= BigInt(sponsor.maxFeePerGas) && BigInt(sponsor.balance) >= BigInt(maxGas) * BigInt(sponsor.maxFeePerGas), 'The bounded setup gas sponsor is unavailable.');
    await sponsorFence?.reserve(input.account);
    const row = { input, status: 'signing-unresolved', raw: null, hash: null }; current.requests[input.account] = row; current.pending = input.account; await save(current);
    const raw = await signer.signTransaction({ chainId: 11155111, type: 2, ...call, nonce: sponsor.nonce, gasLimit: maxGas, maxFeePerGas: sponsor.maxFeePerGas, maxPriorityFeePerGas: sponsor.maxPriorityFeePerGas });
    const tx = checkTx(raw, input); check(BigInt(tx.nonce) === BigInt(sponsor.nonce) && tx.maxFeePerGas === BigInt(sponsor.maxFeePerGas) && tx.maxPriorityFeePerGas === BigInt(sponsor.maxPriorityFeePerGas), 'The setup sponsor nonce or fee changed.');
    row.raw = raw; row.hash = tx.hash; row.status = 'pending'; await save(current);
    try { check(await rpc.send(raw) === row.hash, 'The network returned another setup transaction.'); } catch { return outcome(row); }
    return reconcileRow(current, row);
  }); }
  async function reconcile(value) { return serial(async () => { const input = checkLendingSetupRequest(value), current = await state(), row = current.requests[input.account]; check(row && row.input.owner === input.owner, 'The original setup request is missing.'); return reconcileRow(current, row); }); }
  return Object.freeze({ setup, reconcile });
}
