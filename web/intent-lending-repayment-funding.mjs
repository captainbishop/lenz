import { Interface, Transaction, keccak256, toUtf8Bytes } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { LENDING_DEPLOYMENT } from './public/intent-lending-deployment.js';

const check = (ok, reason) => { if (!ok) throw Error(reason); };
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value);
const quantity = value => typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const amount = '1000000', zero = '0x' + '0'.repeat(40);
export const LENDING_REPAYMENT_FUNDING_ABI = new Interface(['function mint(address asset,address recipient,uint256 amount) returns(uint256)', 'function isPermissioned() view returns(bool)', 'event Transfer(address indexed from,address indexed to,uint256 value)']);
export const emptyLendingRepaymentFundingJournal = () => ({ version: 1, requests: {}, pending: null });
export function checkLendingRepaymentFundingRequest(value) {
  check(plain(value) && Object.keys(value).sort().join() === 'account,owner,ownerAddress' && typeof value.owner === 'string' && /^[0-9a-f]{64}$/.test(value.owner) && address(value.ownerAddress) && address(value.account), 'Keep the original Repay funding account and owner.');
  return { owner: value.owner, ownerAddress: value.ownerAddress, account: value.account };
}
export const lendingRepaymentFundingId = value => 'lending-repayment:' + keccak256(toUtf8Bytes(JSON.stringify(checkLendingRepaymentFundingRequest(value)))).slice(2);
export function lendingRepaymentFundingCall(value, config = LENDING_TESTNET) {
  const input = checkLendingRepaymentFundingRequest(value);
  return { to: config.faucet, data: LENDING_REPAYMENT_FUNDING_ABI.encodeFunctionData('mint', [config.usdc, input.account, amount]), value: '0' };
}

export function createLendingRepaymentFundingService({ config, rpc, signer, journal, sponsorAddress, serialize, sponsorFence, maxGas = '1000000', maxFeePerGas = '6250000000', maxGrants = 20, now = Date.now } = {}) {
  check(config?.chainId === 11155111 && config.chain === LENDING_TESTNET.chain && config.faucet === LENDING_TESTNET.faucet && config.usdc === LENDING_TESTNET.usdc && config.codeHashes?.faucet === LENDING_DEPLOYMENT.codeHashes.faucet && config.codeHashes.usdc === LENDING_DEPLOYMENT.codeHashes.usdc && address(config.lendingFactory) && rpc && signer && journal && address(sponsorAddress), 'The pinned Aave test-USDC Repay grant is unavailable.');
  check(uint(maxGas) && BigInt(maxGas) >= 21000n && BigInt(maxGas) <= 100000000n && uint(maxFeePerGas) && BigInt(maxFeePerGas) > 0n && BigInt(maxGas) * BigInt(maxFeePerGas) <= 6250000000000000n && Number.isSafeInteger(maxGrants) && maxGrants > 0 && maxGrants <= 20, 'The Repay grant exceeds the test sponsor cap.');
  let queue = Promise.resolve(); const serial = serialize ?? (work => { const task = queue.then(work); queue = task.catch(() => {}); return task; });
  const terminal = row => ['funded', 'failed'].includes(row.status);
  const result = row => structuredClone(row.outcome ?? { grantId: lendingRepaymentFundingId(row.input), ...row.input, status: row.status === 'pending' ? 'pending' : 'unknown', verified: false, resubmissionSafe: row.resubmissionSafe === true, ...(row.transaction ? { transaction: row.transaction.hash } : {}) });
  function transaction(raw, call, gas) {
    check(typeof raw === 'string' && /^0x(?:[0-9a-f]{2})+$/.test(raw) && raw.length <= 4096, 'Keep the original signed Repay funding transaction.');
    const tx = Transaction.from(raw);
    check(tx.isSigned() && tx.type === 2 && tx.chainId === 11155111n && tx.from.toLowerCase() === sponsorAddress && tx.to?.toLowerCase() === call.to && tx.data.toLowerCase() === call.data.toLowerCase() && tx.value === 0n && tx.gasLimit === BigInt(maxGas) && tx.maxFeePerGas > 0n && tx.maxFeePerGas <= BigInt(maxFeePerGas) && tx.maxPriorityFeePerGas >= 0n && tx.maxPriorityFeePerGas <= tx.maxFeePerGas && (tx.accessList?.length ?? 0) === 0 && tx.hash === keccak256(raw), 'The sponsor signed another Repay grant or gas authority.');
    if (gas) check(BigInt(tx.nonce) === BigInt(gas.nonce) && tx.maxFeePerGas === BigInt(gas.maxFeePerGas) && tx.maxPriorityFeePerGas === BigInt(gas.maxPriorityFeePerGas), 'The original Repay grant sponsor nonce or fee changed.');
    return { raw: tx.serialized, hash: tx.hash };
  }
  function witness(row, receipt) {
    check(receipt?.transactionHash === row.transaction?.hash && receipt.from?.toLowerCase() === sponsorAddress && receipt.to?.toLowerCase() === config.faucet && ['0x0', '0x1'].includes(receipt.status) && hash(receipt.blockHash) && quantity(receipt.blockNumber) && Array.isArray(receipt.logs), 'The original Repay funding receipt changed.');
    if (receipt.status === '0x1') {
      const transfers = receipt.logs.filter(log => log.address?.toLowerCase() === config.usdc).map(log => { try { return LENDING_REPAYMENT_FUNDING_ABI.parseLog(log); } catch { return null; } }).filter(log => log?.name === 'Transfer' && log.args.from.toLowerCase() === zero && log.args.to.toLowerCase() === row.input.account);
      check(transfers.length === 1 && transfers[0].args.value === 1000000n, 'The exact fixed test-USDC mint is missing or short.');
    }
    return { transactionHash: row.transaction.hash, blockNumber: BigInt(receipt.blockNumber).toString(), blockHash: receipt.blockHash };
  }
  function checkedJournal(state) {
    check(plain(state) && state.version === 1 && plain(state.requests) && Object.keys(state.requests).length <= maxGrants && JSON.stringify(state).length <= 400000 && (state.pending === null || typeof state.pending === 'string'), 'The retained Repay grant journal is invalid.');
    const owners = new Set(), addresses = new Set(), accounts = new Set();
    for (const [id, row] of Object.entries(state.requests)) {
      const input = checkLendingRepaymentFundingRequest(row.input);
      check(id === lendingRepaymentFundingId(input) && ['signing-unresolved', 'pending', 'unknown', 'funded', 'failed'].includes(row.status) && same(row.call, lendingRepaymentFundingCall(input, config)) && uint(row.before?.balance) && hash(row.before?.accountCodeHash) && uint(row.before?.aLinkScaled) && uint(row.before?.variableDebtScaled), 'The original Repay grant input or balance changed.');
      check(!owners.has(input.owner) && !addresses.has(input.ownerAddress) && !accounts.has(input.account), 'A Repay grant owner or account received another grant.'); owners.add(input.owner); addresses.add(input.ownerAddress); accounts.add(input.account);
      check(terminal(row) ? state.pending !== id : state.pending === id, 'The original Repay grant lost its sponsor reservation.');
      if (row.transaction) check(same(transaction(row.transaction.raw, row.call), row.transaction), 'The retained Repay funding transaction changed.');
      if (row.receipt) witness(row, row.receipt);
      if (terminal(row)) {
        check(row.outcome && row.outcome.grantId === id && Object.entries(input).every(([key, value]) => row.outcome[key] === value) && row.outcome.status === row.status && row.outcome.verified === (row.status === 'funded') && row.receipt, 'The retained Repay grant result changed.');
        if (row.status === 'funded') { const e = row.outcome.evidence; check(row.receipt.status === '0x1' && e?.chainId === config.chain && e.asset === config.usdc && e.amount === amount && e.sponsor === sponsorAddress && e.faucet === config.faucet && Object.entries(witness(row, row.receipt)).every(([key, value]) => e[key] === value) && uint(e.balance) && BigInt(e.balance) >= BigInt(row.before.balance) + 1000000n && uint(e.checkedBlockNumber) && hash(e.checkedBlockHash), 'The retained fixed Repay grant evidence changed.'); }
        else check(row.receipt.status === '0x0', 'The original Repay grant failure receipt changed.');
      } else check(!row.outcome, 'An unresolved Repay grant cannot have a final result.');
    }
    check(state.pending === null || state.requests[state.pending] && !terminal(state.requests[state.pending]), 'The retained Repay grant fence is invalid.'); return state;
  }
  async function save(state) { checkedJournal(state); await journal.write(structuredClone(state)); check(same(await journal.read(), state), 'The original Repay funding transaction was not durably saved.'); }
  async function observe(input, options = {}) {
    const observed = await rpc.repaymentSnapshot(input, options), s = observed?.snapshot, a = s?.account, b = s?.block;
    check(s?.chainId === config.chain && s.routeVerified === true && s.trust?.codePinsVerified === true && s.trust.implementationPinsVerified === true && s.trust.executionPinsVerified === true && Number.isSafeInteger(s.observedAt) && Math.abs(now() - s.observedAt) <= 120000 && b?.finality === (options.blockTag ?? 'finalized') && b.requireCanonical === true && uint(b.number) && hash(b.hash), 'The canonical Repay funding route is unavailable.');
    check(a?.status === 'verified' && a.address === input.account && a.owner === input.ownerAddress && hash(a.codeHash) && a.route?.chainId === config.chain && a.route.factory === config.lendingFactory, 'Use the original deployed lending account for Repay funding.');
    for (const key of ['pool', 'link', 'usdc', 'aLink', 'variableDebt']) check(a.route[key] === config[key] && a.route[key + 'CodeHash'] === config.codeHashes[key], 'The original Repay funding lending route changed.');
    for (const key of ['faucet', 'usdc']) check(s.codes?.[key]?.address === config[key] && s.codes[key].codeHash === config.codeHashes[key] && s.codes[key].pinned === true, 'The fixed Repay funding faucet or token code changed.');
    check(typeof observed.permissioned === 'boolean' && (!options.requirePermission || observed.permissioned === false) && ['freeUsdcBaseUnits', 'variableDebtBaseUnits', 'aLinkScaled', 'variableDebtScaled'].every(key => uint(a.position?.[key])), 'The Repay funding permission or independent position is unavailable.');
    if (options.requireDebt) check(BigInt(a.position.variableDebtBaseUnits) > 0n, 'An original new Repay grant requires outstanding debt in the lending account.');
    if (options.blockRef) check(b.number === BigInt(options.blockRef.number).toString() && b.hash === options.blockRef.hash, 'The original Repay mint position block changed.');
    return s;
  }
  function available(state, input) { return state.pending === null && Object.keys(state.requests).length < maxGrants && (!input || !Object.values(state.requests).some(row => row.input.owner === input.owner || row.input.ownerAddress === input.ownerAddress || row.input.account === input.account)); }
  async function canGrant(state, input) { let ok = available(state, input); if (ok) try { await sponsorFence?.assertAvailable(); } catch { ok = false; } return ok; }
  function funds(row, s) { const a = s.account, p = a.position; check(a.codeHash === row.before.accountCodeHash && p.aLinkScaled === row.before.aLinkScaled && p.variableDebtScaled === row.before.variableDebtScaled && BigInt(p.freeUsdcBaseUnits) >= BigInt(row.before.balance) + 1000000n, 'The fixed Repay mint or unchanged original position is not independently visible.'); return p.freeUsdcBaseUnits; }
  async function finish(state, row) {
    const id = lendingRepaymentFundingId(row.input); if (terminal(row)) { await sponsorFence?.release(id); return result(row); }
    row.resubmissionSafe = false;
    if (!row.transaction) return result(row);
    const receipt = await rpc.receipt(row.transaction.hash); if (!receipt) return result(row);
    const w = witness(row, receipt), finalized = await observe(row.input);
    if (BigInt(finalized.block.number) < BigInt(receipt.blockNumber)) return result(row);
    const block = await rpc.block(receipt.blockNumber); check(block?.hash === receipt.blockHash && BigInt(block.number) === BigInt(receipt.blockNumber), 'The original Repay funding receipt is no longer canonical.');
    let checked = finalized, balance;
    if (receipt.status === '0x1') {
      try { balance = funds(row, checked); }
      catch (error) { if (typeof rpc.repaymentSnapshot !== 'function') throw error; checked = await observe(row.input, { blockRef: { number: receipt.blockNumber, hash: receipt.blockHash } }); balance = funds(row, checked); }
    }
    row.receipt = structuredClone(receipt); row.status = receipt.status === '0x1' ? 'funded' : 'failed';
    row.outcome = { grantId: id, ...row.input, status: row.status, verified: row.status === 'funded', ...(balance ? { evidence: { chainId: config.chain, asset: config.usdc, amount, sponsor: sponsorAddress, faucet: config.faucet, ...w, balance, checkedBlockNumber: checked.block.number, checkedBlockHash: checked.block.hash } } : { reason: 'The original test-USDC grant failed.' }) };
    state.pending = null; await save(state); await sponsorFence?.release(id); return result(row);
  }
  async function configuration() { return serial(async () => { const state = checkedJournal(await journal.read()), execute = await canGrant(state); return { available: execute, execute, chainId: config.chain, asset: config.usdc, amount, onePerAccount: true }; }); }
  async function submit(value, options = {}) { return serial(async () => {
    const input = checkLendingRepaymentFundingRequest(value), id = lendingRepaymentFundingId(input), state = checkedJournal(await journal.read());
    if (state.requests[id]) { check(same(state.requests[id].input, input), 'The original Repay funding body changed.'); return finish(state, state.requests[id]); }
    check(await canGrant(state, input), 'This owner or lending account already has its original Repay grant, or a sponsor transaction is pending.');
    const snapshot = await observe(input, { requirePermission: true, requireDebt: true }); await observe(input, { blockTag: 'latest', requirePermission: true, requireDebt: true });
    const gas = await rpc.sponsorState(); check(gas?.chainId === '11155111' && gas.address === sponsorAddress && ['nonce', 'balance', 'maxFeePerGas', 'maxPriorityFeePerGas'].every(key => uint(gas[key])) && BigInt(gas.nonce) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(gas.maxFeePerGas) > 0n && BigInt(gas.maxFeePerGas) <= BigInt(maxFeePerGas) && BigInt(gas.maxPriorityFeePerGas) <= BigInt(gas.maxFeePerGas) && BigInt(gas.balance) >= BigInt(maxGas) * BigInt(gas.maxFeePerGas), 'The bounded Repay grant sponsor fee is unavailable.');
    const call = lendingRepaymentFundingCall(input, config); check(await rpc.simulateRepaymentFunding({ from: sponsorAddress, ...call }) === true, 'The exact fixed Repay grant did not simulate.');
    options.signal?.throwIfAborted(); await sponsorFence?.reserve(id);
    const p = snapshot.account.position, row = { input, call, status: 'signing-unresolved', transaction: null, before: { balance: p.freeUsdcBaseUnits, aLinkScaled: p.aLinkScaled, variableDebtScaled: p.variableDebtScaled, accountCodeHash: snapshot.account.codeHash }, resubmissionSafe: false };
    state.requests[id] = row; state.pending = id; await save(state);
    options.signal?.throwIfAborted();
    row.transaction = transaction(await signer.signTransaction({ chainId: 11155111, type: 2, ...call, nonce: gas.nonce, gasLimit: maxGas, maxFeePerGas: gas.maxFeePerGas, maxPriorityFeePerGas: gas.maxPriorityFeePerGas }), call, gas); row.status = 'pending'; await save(state);
    try { check(await rpc.send(row.transaction.raw) === row.transaction.hash, 'The Repay grant network returned another transaction.'); } catch { row.status = 'unknown'; await save(state); } return result(row);
  }); }
  async function reconcile(value) { return serial(async () => {
    const input = checkLendingRepaymentFundingRequest(value), id = lendingRepaymentFundingId(input), state = checkedJournal(await journal.read()), row = state.requests[id];
    if (!row) return { grantId: id, ...input, status: 'not-requested', verified: false, available: await canGrant(state, input) };
    check(same(row.input, input), 'The original Repay funding body changed.'); await finish(state, row);
    if (!terminal(row)) { row.resubmissionSafe = Boolean(row.transaction && await rpc.transaction(row.transaction.hash) === null); await save(state); } return result(row);
  }); }
  async function resume(value) { return serial(async () => {
    const input = checkLendingRepaymentFundingRequest(value), id = lendingRepaymentFundingId(input), state = checkedJournal(await journal.read()), row = state.requests[id]; check(row && same(row.input, input), 'Keep the original Repay funding request.');
    await finish(state, row); if (terminal(row)) return result(row); await sponsorFence?.assertAvailable(id); check(row.transaction, 'The original Repay grant signature is unresolved.');
    const known = await rpc.transaction(row.transaction.hash);
    if (known !== null) { check(known.hash === row.transaction.hash && known.from?.toLowerCase() === sponsorAddress && known.to?.toLowerCase() === row.call.to && known.input?.toLowerCase() === row.call.data.toLowerCase() && known.value === '0x0', 'The known original Repay grant transaction changed.'); return result(row); }
    await observe(input, { blockTag: 'latest' }); check(await rpc.simulateRepaymentFunding({ from: sponsorAddress, ...row.call }) === true, 'The original Repay grant no longer simulates.'); row.resubmissionSafe = false;
    try { check(await rpc.send(row.transaction.raw) === row.transaction.hash, 'The original Repay grant replay returned another transaction.'); row.status = 'pending'; } catch { row.status = 'unknown'; } await save(state); return result(row);
  }); }
  return Object.freeze({ configuration, submit, reconcile, resume });
}
