import { LENDING_TESTNET, LENDING_PRIVACY } from './public/intent-lending-config.js';
import { checkLendingPermissionReview, checkLendingSignedPermission } from './public/intent-lending-account.js';
import { Interface, Transaction, keccak256 } from '../aurora/node_modules/ethers/lib.esm/index.js';

const check = (value, reason) => { if (!value) throw Error(reason); };
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value);
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const same = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const orderTuple = '(uint8 action,uint256 nonce,uint256 deadline,uint256 amount,address recipient,uint256 minResult,uint256 maxDebt,uint256 minHealthFactor,uint256 maxBorrowRateRay)';
const transferTuple = '(uint8 asset,uint256 nonce,uint256 deadline,uint256 amount,address recipient)';
export const LENDING_EXECUTION_ABI = new Interface([
  `function execute(${orderTuple} order,bytes signature) returns(uint256 result)`, 'function cancel(uint256 nonce,uint256 deadline,bytes signature)', `function transferFunds(${transferTuple} transfer,bytes signature)`,
  'event Executed(uint256 indexed nonce,bytes32 indexed digest,uint8 action,uint256 amount,address recipient,uint256 result)',
  'event Cancelled(uint256 indexed nonce,bytes32 indexed digest)', 'event Transferred(uint256 indexed nonce,bytes32 indexed digest,address token,uint256 amount,address recipient)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
]);
export const emptyLendingJournal = () => ({ version: 1, requests: {}, pending: null });
export function checkLendingPublicRequest(value, config = LENDING_TESTNET) {
  check(value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join() === 'review,signed', 'The original lending request changed.');
  const review = checkLendingPermissionReview(value.review, { allowExpired: true, config });
  return { review, signed: checkLendingSignedPermission(value.signed, review) };
}
export function lendingExecutionCall(value, config = LENDING_TESTNET) {
  const { review, signed } = checkLendingPublicRequest(value, config), terms = review.terms;
  const method = review.kind === 'Order' ? 'execute' : review.kind === 'Cancel' ? 'cancel' : 'transferFunds';
  return { to: review.account, data: LENDING_EXECUTION_ABI.encodeFunctionData(method, review.kind === 'Cancel' ? [terms.nonce, terms.deadline, signed.signature] : [terms, signed.signature]), value: '0' };
}

export function createLendingService({ config = LENDING_TESTNET, rpc, signer, journal, sponsorAddress, maxGas = '1000000', maxFeePerGas = '6250000000', maxRequests = 20, now = Date.now, serialize, sponsorFence } = {}) {
  const unavailable = async () => { throw Error('Lending execution is unavailable.'); };
  if (!rpc || !signer || !journal || !address(config.lendingFactory) || !hash(config.codeHashes?.lendingFactory)) {
    return Object.freeze({ configuration: async () => ({ available: false, execute: false, privacyDisclosure: LENDING_PRIVACY }), prepare: unavailable, submit: unavailable, reconcile: unavailable, resume: unavailable });
  }
  check(config.chainId === 11155111 && config.chain === LENDING_TESTNET.chain && address(sponsorAddress), 'The lending sponsor is restricted to Sepolia.');
  for (const key of ['pool', 'link', 'usdc', 'aLink', 'variableDebt']) check(config[key] === LENDING_TESTNET[key] && hash(config.codeHashes[key]), 'The fixed lending execution dependency is not pinned.');
  check(uint(maxGas) && BigInt(maxGas) >= 21000n && BigInt(maxGas) <= 50000000n && uint(maxFeePerGas) && BigInt(maxFeePerGas) > 0n && Number.isSafeInteger(maxRequests) && maxRequests > 0 && maxRequests <= 50, 'The lending sponsor limits are invalid.');
  let queue = Promise.resolve();
  const serial = serialize ?? (work => { const task = queue.then(work); queue = task.catch(() => {}); return task; });
  const fenceId = row => row.request.review.id;
  const outcome = row => structuredClone(row.outcome ?? { intentId: row.request.review.id, artifactId: row.request.signed.digest, status: row.status === 'pending' ? 'pending' : 'unknown', verified: false, ...(row.transaction ? { transaction: row.transaction.hash } : {}) });
  function transaction(raw, call, sponsor) {
    check(typeof raw === 'string' && /^0x[0-9a-f]+$/i.test(raw) && raw.length <= 24000, 'The original sponsored transaction is invalid.');
    const tx = Transaction.from(raw);
    check(tx.isSigned() && tx.type === 2 && tx.chainId === 11155111n && tx.from.toLowerCase() === sponsorAddress && tx.to?.toLowerCase() === call.to && tx.data.toLowerCase() === call.data.toLowerCase() && tx.value === 0n && tx.gasLimit === BigInt(maxGas) && tx.maxFeePerGas > 0n && tx.maxFeePerGas <= BigInt(maxFeePerGas) && tx.maxPriorityFeePerGas <= tx.maxFeePerGas && (tx.accessList?.length ?? 0) === 0, 'The sponsor signed different lending terms or exceeded its gas limit.');
    if (sponsor) check(BigInt(tx.nonce) === BigInt(sponsor.nonce) && tx.maxFeePerGas === BigInt(sponsor.maxFeePerGas) && tx.maxPriorityFeePerGas === BigInt(sponsor.maxPriorityFeePerGas), 'The original sponsor nonce or gas price changed.');
    check(tx.hash === keccak256(raw), 'The original sponsored transaction hash changed.');
    return { raw: tx.serialized, hash: tx.hash };
  }
  function checkJournal(state) {
    check(state?.version === 1 && state.requests && Object.getPrototypeOf(state.requests) === Object.prototype && Object.keys(state.requests).length <= maxRequests && JSON.stringify(state).length <= 2000000 && (state.pending === null || typeof state.pending === 'string'), 'The lending execution journal is invalid.');
    for (const [id, row] of Object.entries(state.requests)) {
      const request = checkLendingPublicRequest(row.request, config);
      check(id === request.review.id && ['signing-unresolved', 'pending', 'unknown', 'executed', 'failed'].includes(row.status) && row.before && same(row.call, lendingExecutionCall(request, config)), 'The saved lending operation changed.');
      if (row.transaction) check(same(transaction(row.transaction.raw, row.call), row.transaction), 'The retained original lending transaction changed.');
      if (row.status === 'executed') check(row.outcome?.verified === true && row.outcome.intentId === id && row.outcome.artifactId === request.signed.digest, 'The original lending outcome is missing.');
      if (!row.finalized) check(state.pending === id, 'An unresolved lending transaction lost its sponsor fence.');
    }
    check(state.pending === null || state.requests[state.pending] && !state.requests[state.pending].finalized, 'The lending sponsor fence changed.');
    return state;
  }
  async function persist(state) { checkJournal(state); await journal.write(structuredClone(state)); check(same(await journal.read(), state), 'The original lending request was not durably saved.'); }
  async function observed(review, { currentNonce = false, atBlock } = {}) {
    const selection = { owner: review.ownerAddress, account: review.account };
    const value = atBlock ? await rpc.snapshotAt(selection, atBlock) : await rpc.snapshot(selection);
    const a = value?.account, block = value?.block;
    check(value?.chainId === config.chain && value.routeVerified === true && value.trust?.codePinsVerified === true && value.trust.implementationPinsVerified === true && value.trust.executionPinsVerified === true && Number.isSafeInteger(value.observedAt) && Math.abs(now() - value.observedAt) <= 120000 && block?.finality === 'finalized' && block.requireCanonical === true && uint(block.number) && hash(block.hash), 'The finalized pinned lending route is unavailable.');
    if (atBlock) check(BigInt(block.number) === BigInt(atBlock.number) && block.hash === atBlock.hash, 'The original receipt-specific lending position changed its block.');
    check(a?.status === 'verified' && a.address === review.account && a.owner === review.ownerAddress && same(a.route, review.route) && hash(a.codeHash) && uint(a.nonce), 'The original deployed lending account changed.');
    if (currentNonce) check(a.nonce === review.terms.nonce, 'The original lending permission nonce is no longer current.');
    const p = a.position;
    check(p && ['freeLinkBaseUnits', 'freeUsdcBaseUnits', 'aLinkBalanceBaseUnits', 'aLinkScaled', 'variableDebtBaseUnits', 'variableDebtScaled'].every(key => uint(p[key])) && uint(p.accountData?.healthFactorWad), 'The current lending position is unavailable.');
    return value;
  }
  async function preflight(review, request) {
    checkLendingPermissionReview(review, { allowExpired: Boolean(request), now: now(), config });
    check(BigInt(review.terms.deadline) * 1000n > BigInt(now()), 'The original lending permission expired. Check its status.');
    const snapshot = await observed(review, { currentNonce: true });
    if (review.kind === 'Order') {
      const reserve = snapshot.reserves[review.terms.action === 2 ? 'LINK' : 'USDC'];
      check(reserve?.active === true && reserve.paused === false && (review.terms.action !== 0 || !reserve.frozen && reserve.borrowingEnabled && uint(reserve.variableBorrowRateRay) && BigInt(reserve.variableBorrowRateRay) <= BigInt(review.terms.maxBorrowRateRay) && uint(reserve.availableLiquidityBaseUnits) && BigInt(reserve.availableLiquidityBaseUnits) >= BigInt(review.terms.amount)), 'The lending reserve or signed rate bound is unavailable.');
    }
    if (request) check(await rpc.simulate({ from: sponsorAddress, ...lendingExecutionCall(request, config) }) === true, 'The exact original lending transaction simulation failed.');
    return snapshot;
  }
  async function sponsorState() {
    const value = await rpc.sponsorState();
    check(value?.chainId === '11155111' && value.address === sponsorAddress && ['nonce', 'balance', 'maxFeePerGas', 'maxPriorityFeePerGas'].every(key => uint(value[key])) && BigInt(value.nonce) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(value.maxFeePerGas) > 0n && BigInt(value.maxFeePerGas) <= BigInt(maxFeePerGas) && BigInt(value.maxPriorityFeePerGas) <= BigInt(value.maxFeePerGas) && BigInt(value.balance) >= BigInt(maxGas) * BigInt(value.maxFeePerGas), 'The bounded lending sponsor gas or nonce is unavailable.');
    return value;
  }
  function receiptEvent(receipt, row, snapshot) {
    const { review, signed } = row.request, terms = review.terms;
    const matching = receipt.logs.filter(log => log.address?.toLowerCase() === review.account).map(log => { try { return LENDING_EXECUTION_ABI.parseLog(log); } catch { return null; } }).filter(Boolean);
    const name = review.kind === 'Order' ? 'Executed' : review.kind === 'Cancel' ? 'Cancelled' : 'Transferred';
    const list = matching.filter(event => event.name === name);
    check(list.length === 1, 'The original lending execution event is missing.');
    const event = list[0];
    check(event.args.nonce === BigInt(terms.nonce) && event.args.digest === signed.digest, 'The finalized event belongs to another lending permission.');
    if (review.kind !== 'Cancel') {
      check(event.args.amount === BigInt(terms.amount) && event.args.recipient.toLowerCase() === terms.recipient, 'The finalized lending amount or recipient changed.');
      if (review.kind === 'Order') check(event.args.action === BigInt(terms.action) && event.args.result >= BigInt(terms.minResult) && event.args.result <= BigInt(terms.amount), 'The finalized lending result missed the signed bound.');
      else check(event.args.token.toLowerCase() === config[terms.asset === 0 ? 'link' : 'usdc'], 'The finalized free-fund asset changed.');
      const asset = review.kind === 'Order' ? (terms.action === 2 ? config.link : config.usdc) : config[terms.asset === 0 ? 'link' : 'usdc'];
      const transfers = receipt.logs.filter(log => log.address?.toLowerCase() === asset).map(log => { try { return LENDING_EXECUTION_ABI.parseLog(log); } catch { return null; } }).filter(log => log?.name === 'Transfer');
      const moved = (from, to, amount) => check(address(from) && transfers.filter(log => log.args.from.toLowerCase() === from && log.args.to.toLowerCase() === to && log.args.value === amount).length === 1, 'The exact underlying transfer for the original lending request is missing.');
      if (review.kind === 'Order') {
        const reserve = snapshot.reserves[terms.action === 2 ? 'LINK' : 'USDC'].aToken;
        if (terms.action === 1) moved(review.account, reserve, event.args.result);
        else { moved(reserve, review.account, event.args.result); if (terms.recipient !== review.account) moved(review.account, terms.recipient, event.args.result); }
      } else moved(review.account, terms.recipient, BigInt(terms.amount));
    }
    return event;
  }
  function verifiedPosition(receipt, row, snapshot) {
    const { review } = row.request, terms = review.terms, event = receiptEvent(receipt, row, snapshot), position = snapshot.account.position;
    check(snapshot.account.codeHash === row.before.accountCodeHash && BigInt(snapshot.account.nonce) >= BigInt(terms.nonce) + 1n, 'The original account code or finalized lending nonce changed.');
    // Another permission in the same block can move funds again; its closing balance cannot verify this receipt.
    check(BigInt(snapshot.account.nonce) === BigInt(terms.nonce) + 1n, 'Later lending activity needs a receipt-specific position check.');
    if (review.kind === 'Order') {
      check(BigInt(position.variableDebtBaseUnits) <= BigInt(terms.maxDebt), 'The independently read debt exceeds the approved bound.');
      if (terms.action !== 1) check(position.variableDebtBaseUnits === '0' || BigInt(position.accountData.healthFactorWad) >= BigInt(terms.minHealthFactor), 'The independently read health is below the approved bound.');
      if (terms.action === 0) {
        check(BigInt(position.variableDebtScaled) > BigInt(row.before.position.variableDebtScaled), 'The original borrowed debt is not independently visible.');
        if (terms.recipient === review.account) check(BigInt(position.freeUsdcBaseUnits) >= BigInt(row.before.position.freeUsdcBaseUnits) + event.args.result, 'The original borrowed funds are not independently visible.');
      } else if (terms.action === 1) check(BigInt(position.variableDebtScaled) < BigInt(row.before.position.variableDebtScaled) && BigInt(position.freeUsdcBaseUnits) + event.args.result <= BigInt(row.before.position.freeUsdcBaseUnits), 'The original debt repayment is not independently visible.');
      else check(BigInt(position.aLinkScaled) < BigInt(row.before.position.aLinkScaled) && (terms.recipient !== review.account || BigInt(position.freeLinkBaseUnits) >= BigInt(row.before.position.freeLinkBaseUnits) + event.args.result), 'The original collateral withdrawal is not independently visible.');
    } else if (review.kind === 'Transfer') {
      const field = terms.asset === 0 ? 'freeLinkBaseUnits' : 'freeUsdcBaseUnits';
      check(BigInt(position[field]) + BigInt(terms.amount) <= BigInt(row.before.position[field]), 'The original free-fund debit is not independently visible.');
    }
    return { event, position };
  }
  async function finish(state, row) {
    if (row.finalized) { await sponsorFence?.release(fenceId(row)); return outcome(row); }
    if (!row.transaction) return outcome(row);
    const receipt = await rpc.receipt(row.transaction.hash);
    if (!receipt) return outcome(row);
    check(receipt.transactionHash === row.transaction.hash && hash(receipt.blockHash) && /^0x[0-9a-f]+$/.test(receipt.blockNumber) && ['0x0', '0x1'].includes(receipt.status) && receipt.from?.toLowerCase() === sponsorAddress && receipt.to?.toLowerCase() === row.request.review.account && Array.isArray(receipt.logs), 'The original lending receipt changed.');
    const currentSnapshot = await observed(row.request.review);
    if (BigInt(currentSnapshot.block.number) < BigInt(receipt.blockNumber)) return outcome(row);
    const block = await rpc.block(receipt.blockNumber);
    check(block?.hash === receipt.blockHash && BigInt(block.number) === BigInt(receipt.blockNumber), 'The original lending receipt is no longer canonical.');
    const { review, signed } = row.request, terms = review.terms;
    if (receipt.status === '0x0') {
      row.status = 'failed'; row.outcome = { intentId: review.id, artifactId: signed.digest, status: 'unknown', verified: false, transaction: row.transaction.hash, evidence: { description: 'The original lending transaction reverted. No replacement was submitted.' } };
    } else {
      let snapshot = currentSnapshot, verified;
      try { verified = verifiedPosition(receipt, row, snapshot); }
      catch (error) {
        if (typeof rpc.snapshotAt !== 'function') throw error;
        snapshot = await observed(review, { atBlock: { number: receipt.blockNumber, hash: receipt.blockHash } });
        verified = verifiedPosition(receipt, row, snapshot);
      }
      const { event, position } = verified;
      row.status = 'executed'; row.outcome = { intentId: review.id, artifactId: signed.digest, status: 'executed', verified: true, evidence: { network: 'Sepolia testnet', chainId: config.chain, transaction: row.transaction.hash, blockNumber: BigInt(receipt.blockNumber).toString(), blockHash: receipt.blockHash, account: review.account, ownerAddress: review.ownerAddress, nonce: terms.nonce, digest: signed.digest, kind: review.kind, ...(review.kind !== 'Cancel' ? { amount: terms.amount, recipient: terms.recipient, ...(review.kind === 'Order' ? { action: terms.action, result: event.args.result.toString() } : { asset: terms.asset }) } : {}), position: structuredClone(position), positionBlockNumber: snapshot.block.number, positionBlockHash: snapshot.block.hash, description: review.kind === 'Cancel' ? 'The original lending permission was cancelled on Sepolia.' : 'The original lending receipt and checked account position are finalized.' } };
    }
    row.receipt = structuredClone(receipt); row.finalized = true; state.pending = null; await persist(state); await sponsorFence?.release(fenceId(row)); return outcome(row);
  }
  async function configuration() {
    const state = checkJournal(await journal.read());
    let available = state.pending === null && Object.keys(state.requests).length < maxRequests;
    try { await sponsorFence?.assertAvailable(); } catch { available = false; }
    if (available) await sponsorState();
    return { available, execute: available, chainId: config.chain, privacyDisclosure: LENDING_PRIVACY, reason: available ? '' : 'Check the original pending lending request.' };
  }
  async function prepare(value) { return serial(async () => { const review = checkLendingPermissionReview(value, { now: now(), config }), state = checkJournal(await journal.read()); check(state.pending === null && Object.keys(state.requests).length < maxRequests, 'Check the original pending lending request.'); await sponsorFence?.assertAvailable(); await preflight(review); await sponsorState(); return { review, available: true, execute: true, privacyDisclosure: LENDING_PRIVACY }; }); }
  async function submit(value) { return serial(async () => {
    const request = checkLendingPublicRequest(value, config), state = checkJournal(await journal.read()), id = request.review.id;
    if (state.requests[id]) { check(same(state.requests[id].request, request), 'The original lending request changed.'); if (state.requests[id].finalized) await sponsorFence?.release(fenceId(state.requests[id])); return outcome(state.requests[id]); }
    check(state.pending === null && Object.keys(state.requests).length < maxRequests && !Object.values(state.requests).some(row => row.request.review.account === request.review.account && row.request.review.terms.nonce === request.review.terms.nonce && row.request.review.kind !== 'Cancel' && request.review.kind !== 'Cancel'), 'Check the original lending request before another authority.');
    await sponsorFence?.assertAvailable(id);
    const snapshot = await preflight(request.review, request), sponsor = await sponsorState(), call = lendingExecutionCall(request, config);
    const row = { request, call, status: 'signing-unresolved', transaction: null, finalized: false, before: { accountCodeHash: snapshot.account.codeHash, position: snapshot.account.position } };
    await sponsorFence?.reserve(id); state.requests[id] = row; state.pending = id; await persist(state);
    const raw = await signer.signTransaction({ chainId: 11155111, type: 2, ...call, nonce: sponsor.nonce, gasLimit: maxGas, maxFeePerGas: sponsor.maxFeePerGas, maxPriorityFeePerGas: sponsor.maxPriorityFeePerGas });
    row.transaction = transaction(raw, call, sponsor); row.status = 'pending'; await persist(state);
    try { check(await rpc.send(row.transaction.raw) === row.transaction.hash, 'The original lending broadcast hash changed.'); }
    catch { row.status = 'unknown'; await persist(state); }
    return outcome(row);
  }); }
  async function reconcile(value) { return serial(async () => { const request = checkLendingPublicRequest(value, config), state = checkJournal(await journal.read()), row = state.requests[request.review.id]; check(row && same(row.request, request), 'The original lending request is not retained by this sponsor.'); return finish(state, row); }); }
  async function resume(value) { return serial(async () => {
    const request = checkLendingPublicRequest(value, config), state = checkJournal(await journal.read()), row = state.requests[request.review.id];
    check(row && same(row.request, request) && state.pending === request.review.id && row.transaction && !row.finalized, 'Retain and check the original sponsored lending transaction.');
    await sponsorFence?.assertAvailable(fenceId(row));
    const checked = await finish(state, row); if (row.finalized) return checked;
    check(BigInt(request.review.terms.deadline) * 1000n > BigInt(now()), 'The original lending permission expired. Check its status.');
    check(await rpc.receipt(row.transaction.hash) === null, 'Wait for finality of the original lending receipt.');
    try { check(await rpc.send(row.transaction.raw) === row.transaction.hash, 'The original lending broadcast hash changed.'); } catch { row.status = 'unknown'; await persist(state); }
    return outcome(row);
  }); }
  return Object.freeze({ configuration, prepare, submit, reconcile, resume });
}
