import { Interface, Transaction, keccak256 } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET, LENDING_PRIVACY } from './public/intent-lending-config.js';
import { checkLendingSupplyPreparation, checkLendingSupplyPublicRequest, sameLendingSupplyValue as same, LENDING_SUPPLY_ZERO } from './public/intent-lending-supply.js';

const check = (value, reason) => { if (!value) throw Error(reason); };
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && value !== LENDING_SUPPLY_ZERO;
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value);
const tuple = '(address beneficiary,address refundRecipient,uint256 minScaledCredit,uint256 deadline,bytes32 salt)';
export const LENDING_SUPPLY_ABI = new Interface([`function fulfill(${tuple},bytes,bytes32,bytes32)`,`function recover(${tuple})`,`function withdrawRefund(${tuple},bytes,bytes32,bytes32)`,
  'event Supplied(address indexed beneficiary,uint256 inputAmount,uint256 scaledCredit)','event Refunded(address indexed recipient,uint256 inputAmount)',
  'event Withdrawal(address to,bytes32 nullifierHash,address indexed relayer,uint256 fee)','event Transfer(address indexed from,address indexed to,uint256 value)']);
export const emptyLendingSupplyJournal = () => ({ version:1,requests:{},pending:null });
export { checkLendingSupplyPreparation, checkLendingSupplyPublicRequest };
export function lendingSupplyCall(value, operation = 'fulfill', config = LENDING_TESTNET) {
  const request = checkLendingSupplyPublicRequest(value, { config });
  check(['fulfill','recover','withdrawRefund'].includes(operation), 'Choose the exact original Supply operation.');
  return { to:config.supplyFactory,data:LENDING_SUPPLY_ABI.encodeFunctionData(operation, operation === 'recover' ? [request.plan] : [request.plan,request.proof,request.root,request.nullifierHash]),value:'0' };
}

export function createLendingSupplyService({ config = LENDING_TESTNET,rpc,signer,journal,sponsorAddress,maxGas = '1000000',maxFeePerGas = '6250000000',maxRequests = 20,now = Date.now,serialize,sponsorFence } = {}) {
  check(rpc && signer && journal && address(sponsorAddress) && uint(maxGas) && BigInt(maxGas) >= 21000n && BigInt(maxGas) <= 100000000n && uint(maxFeePerGas) && BigInt(maxFeePerGas) > 0n && BigInt(maxFeePerGas) <= 6250000000n && BigInt(maxGas) * BigInt(maxFeePerGas) <= 6250000000000000n && Number.isSafeInteger(maxRequests) && maxRequests > 0 && maxRequests <= 50, 'The bounded private Supply sponsor is unavailable.');
  let queue = Promise.resolve();
  const serial = serialize ?? (work => { const task = queue.then(work); queue = task.catch(() => {}); return task; });
  const outcome = row => structuredClone(row.outcome ?? { intentId:row.request.id,artifactId:row.request.artifactId,status:row.status === 'pending' ? 'pending' : 'unknown',verified:false,...(row.stages.at(-1)?.transaction ? { transaction:row.stages.at(-1).transaction.hash } : {}),...(row.statusCheck ? { recovery:row.statusCheck.operation,resubmissionSafe:row.statusCheck.resubmissionSafe === true && now() >= row.statusCheck.checkedAt && now() - row.statusCheck.checkedAt <= 60000 && (row.stages.at(-1)?.operation !== 'fulfill' || active(row.request)) } : {}) });
  function transaction(raw, call, sponsor) {
    check(typeof raw === 'string' && /^0x[0-9a-f]+$/i.test(raw) && raw.length <= 24000, 'The original sponsored Supply transaction is invalid.');
    const tx = Transaction.from(raw);
    check(tx.isSigned() && tx.type === 2 && tx.chainId === 11155111n && tx.from.toLowerCase() === sponsorAddress && tx.to?.toLowerCase() === call.to && tx.data.toLowerCase() === call.data.toLowerCase() && tx.value === 0n && tx.gasLimit === BigInt(maxGas) && tx.maxFeePerGas > 0n && tx.maxFeePerGas <= BigInt(maxFeePerGas) && tx.maxPriorityFeePerGas >= 0n && tx.maxPriorityFeePerGas <= tx.maxFeePerGas && (tx.accessList?.length ?? 0) === 0, 'The sponsor signed different Supply terms or exceeded the gas limit.');
    if (sponsor) check(BigInt(tx.nonce) === BigInt(sponsor.nonce) && tx.maxFeePerGas === BigInt(sponsor.maxFeePerGas) && tx.maxPriorityFeePerGas === BigInt(sponsor.maxPriorityFeePerGas), 'The original Supply sponsor nonce or fee changed.');
    check(tx.hash === keccak256(raw), 'The original Supply transaction hash changed.'); return {raw:tx.serialized,hash:tx.hash};
  }
  function checkJournal(state) {
    check(state?.version === 1 && state.requests && Object.getPrototypeOf(state.requests) === Object.prototype && Object.keys(state.requests).length <= maxRequests && JSON.stringify(state).length <= 2000000 && (state.pending === null || typeof state.pending === 'object'), 'The retained Supply journal is invalid.');
    for (const [id,row] of Object.entries(state.requests)) {
      const request = checkLendingSupplyPublicRequest(row.request, { config });
      check(id === request.id && ['signing-unresolved','pending','unknown','executed','refunded'].includes(row.status) && Array.isArray(row.stages) && row.stages.length <= 2 && (!row.outcome || row.outcome.intentId === id && row.outcome.artifactId === request.artifactId && row.outcome.verified === true), 'The original Supply journal identity changed.');
      for (const [index,stage] of row.stages.entries()) {
        check(same(stage.call,lendingSupplyCall(request,stage.operation,config)) && stage.before && uint(stage.before.scaledCredit) && uint(stage.before.freeLink) && uint(stage.before.vaultInput) && hash(stage.before.accountCodeHash) && uint(stage.before.accountNonce), 'The original Supply stage changed.');
        if (stage.transaction) check(same(transaction(stage.transaction.raw,stage.call),stage.transaction), 'The retained Supply signed bytes changed.');
        if (!stage.finalized) check(state.pending?.id === id && state.pending.index === index && index === row.stages.length - 1, 'The unresolved Supply lost its sponsor fence.');
        else check(stage.transaction && stage.receipt?.transactionHash === stage.transaction.hash && ['0x0','0x1'].includes(stage.receipt.status), 'The retained Supply final receipt changed.');
      }
      if (row.outcome) {
        const stage = row.stages.at(-1), evidence = row.outcome.evidence;
        check(stage?.finalized && stage.receipt.status === '0x1' && Array.isArray(stage.receipt.logs), 'The retained Supply outcome has no final receipt.');
        const result = logs(stage.receipt,request,stage);
        check(row.status === result.status && row.outcome.status === result.status && evidence?.network === config.network && evidence.chainId === config.chain && evidence.transaction === stage.transaction.hash && evidence.blockHash === stage.receipt.blockHash && evidence.blockNumber === BigInt(stage.receipt.blockNumber).toString() && evidence.beneficiary === request.plan.beneficiary && evidence.ownerAddress === request.ownerAddress && evidence.vault === request.vault && evidence.nullifierHash === request.nullifierHash && evidence.inputAsset === config.link && evidence.inputAmount === config.denomination && evidence.outputAsset === config.aLink && evidence.scaledCredit === result.scaledCredit && evidence.refundRecipient === request.plan.refundRecipient && evidence.refundAsset === config.link && evidence.refundAmount === result.refundAmount && evidence.allowance === '0' && uint(evidence.position?.aLinkScaled) && uint(evidence.position?.freeLinkBaseUnits) && BigInt(evidence.position.aLinkScaled) >= BigInt(stage.before.scaledCredit) + BigInt(result.scaledCredit) && BigInt(evidence.position.freeLinkBaseUnits) >= BigInt(stage.before.freeLink) + BigInt(result.refundAmount), 'The retained Supply outcome changed its finalized credit.');
      } else check(!['executed','refunded'].includes(row.status), 'The finalized original Supply evidence is missing.');
    }
    check(state.pending === null || state.requests[state.pending.id]?.stages[state.pending.index] && !state.requests[state.pending.id].stages[state.pending.index].finalized, 'The original Supply pending fence changed.'); return state;
  }
  async function persist(state) { checkJournal(state); await journal.write(structuredClone(state)); check(same(await journal.read(),state), 'The original Supply request was not durably saved.'); }
  function boundVault(vault, request) {
    check(vault?.address === request.vault && typeof vault.deployed === 'boolean' && uint(vault.inputBalance) && uint(vault.allowance), 'The original Supply vault state is unavailable.');
    if (vault.deployed) {
      const terms = { inputToken:config.link,aavePool:config.pool,aToken:config.aLink,inputAmount:config.denomination,...request.plan,chainId:String(config.chainId),inputCodeHash:config.codeHashes.link,aavePoolCodeHash:config.codeHashes.pool,aTokenCodeHash:config.codeHashes.aLink };
      check(vault.termsVerified === true && [0,2,3].includes(vault.status) && Object.entries(terms).every(([key,value]) => vault[key] === value), 'The original Supply vault immutable terms changed.');
    } else check(vault.status === null && vault.allowance === '0', 'The undeployed Supply vault state changed.');
  }
  async function observe(request) {
    const result = await rpc.supplySnapshot(request), s = result?.snapshot, a = s?.account, block = s?.block;
    check(s?.chainId === config.chain && s.routeVerified === true && s.trust?.codePinsVerified === true && s.trust.implementationPinsVerified === true && s.trust.executionPinsVerified === true && Number.isSafeInteger(s.observedAt) && Math.abs(now() - s.observedAt) <= 120000 && block?.finality === 'finalized' && block.requireCanonical === true && uint(block.number) && hash(block.hash) && uint(block.timestamp), 'The finalized pinned Supply route is unavailable.');
    check(a?.status === 'verified' && a.address === request.plan.beneficiary && a.owner === request.ownerAddress && hash(a.codeHash) && uint(a.nonce) && a.route?.factory === config.lendingFactory && a.route.chainId === config.chain && uint(a.position?.aLinkScaled) && uint(a.position.freeLinkBaseUnits), 'The original durable Supply account changed.');
    for (const key of ['pool','link','usdc','aLink','variableDebt']) check(a.route[key] === config[key] && a.route[key + 'CodeHash'] === config.codeHashes[key], 'The original durable Supply route changed.');
    check(typeof result.knownRoot === 'boolean' && typeof result.spent === 'boolean' && (!request.proof || result.proofValid === true), 'The original Supply proof did not verify.'); boundVault(result.vault,request);
    return result;
  }
  async function sponsorState() {
    const state = await rpc.sponsorState();
    check(state?.chainId === '11155111' && state.address === sponsorAddress && ['nonce','balance','maxFeePerGas','maxPriorityFeePerGas'].every(key => uint(state[key])) && BigInt(state.nonce) <= BigInt(Number.MAX_SAFE_INTEGER) && BigInt(state.maxFeePerGas) > 0n && BigInt(state.maxFeePerGas) <= BigInt(maxFeePerGas) && BigInt(state.maxPriorityFeePerGas) <= BigInt(state.maxFeePerGas) && BigInt(state.balance) >= BigInt(maxGas) * BigInt(state.maxFeePerGas), 'The Supply sponsor nonce or bounded gas is unavailable.'); return state;
  }
  const active = request => BigInt(request.plan.deadline) * 1000n > BigInt(now());
  function originalWithdrawal(observed, request) {
    const w = observed.withdrawal;
    return w?.nullifierHash === request.nullifierHash && w.recipient === request.vault && w.relayer === LENDING_SUPPLY_ZERO && w.fee === '0';
  }
  function recoveryChoice(observed, request) {
    if (observed.vault.allowance !== '0' || ![null,0].includes(observed.vault.status)) return null;
    if (observed.spent && originalWithdrawal(observed,request) && BigInt(observed.vault.inputBalance) >= BigInt(config.denomination)) return 'recover';
    if (!observed.spent && observed.knownRoot && BigInt(observed.snapshot.block.timestamp) > BigInt(request.plan.deadline) && !active(request)) return 'withdrawRefund';
    return null;
  }
  function supplyReady(observed, request) {
    const reserve = observed.snapshot.reserves?.LINK;
    check(active(request) && BigInt(request.plan.deadline) * 1000n <= BigInt(now()) + 300000n && BigInt(observed.snapshot.block.timestamp) <= BigInt(request.plan.deadline) && observed.knownRoot && !observed.spent && [null,0].includes(observed.vault.status) && observed.vault.allowance === '0' && reserve?.active === true && reserve.frozen === false && reserve.paused === false && reserve.oneNoteSupplyPossible === true, 'The original note, deadline or Supply reserve is unavailable.');
  }
  function logs(receipt, request, stage) {
    const parsed = receipt.logs.map(log => { try { return {address:log.address?.toLowerCase(),value:LENDING_SUPPLY_ABI.parseLog(log)}; } catch { return {value:null}; } });
    const matches = (contract,name) => parsed.filter(log => log.address === contract && log.value?.name === name).map(log => log.value.args);
    const moved = (from,to,amount) => check(matches(config.link,'Transfer').filter(log => log.from.toLowerCase() === from && log.to.toLowerCase() === to && log.value === amount).length === 1, 'The exact original Supply LINK transfer is missing.');
    if (stage.operation !== 'recover') {
      const w = matches(config.privacyPool,'Withdrawal');
      check(w.length === 1 && w[0].to.toLowerCase() === request.vault && w[0].nullifierHash === request.nullifierHash && w[0].relayer.toLowerCase() === LENDING_SUPPLY_ZERO && w[0].fee === 0n, 'The final withdrawal belongs to another original note or vault.');
      moved(config.privacyPool,request.vault,BigInt(config.denomination));
    }
    const supplied = matches(request.vault,'Supplied'), refunded = matches(request.vault,'Refunded');
    check(supplied.length + refunded.length === 1, 'The final original Supply outcome event is missing.');
    const funds = BigInt(stage.before.vaultInput) + (stage.operation === 'recover' ? 0n : BigInt(config.denomination));
    if (supplied.length) {
      const event = supplied[0];
      check(stage.operation !== 'withdrawRefund' && event.beneficiary.toLowerCase() === request.plan.beneficiary && event.inputAmount === BigInt(config.denomination) && event.scaledCredit >= BigInt(request.plan.minScaledCredit), 'The final scaled aLINK credit missed its original minimum.');
      moved(request.vault,config.aLink,BigInt(config.denomination));
      if (funds > BigInt(config.denomination)) moved(request.vault,request.plan.refundRecipient,funds - BigInt(config.denomination));
      return {status:'executed',scaledCredit:event.scaledCredit.toString(),refundAmount:(funds - BigInt(config.denomination)).toString()};
    }
    const event = refunded[0];
    check(stage.operation !== 'fulfill' && event.recipient.toLowerCase() === request.plan.refundRecipient && event.inputAmount === funds && funds >= BigInt(config.denomination), 'The final original Supply refund changed.');
    moved(request.vault,request.plan.refundRecipient,funds); return {status:'refunded',scaledCredit:'0',refundAmount:funds.toString()};
  }
  async function finish(state,row) {
    const stage = row.stages.at(-1);
    if (stage?.finalized) { await sponsorFence?.release(row.request.id); return outcome(row); }
    if (!stage || !stage.transaction) return outcome(row);
    const receipt = await rpc.receipt(stage.transaction.hash); if (!receipt) return outcome(row);
    check(receipt.transactionHash === stage.transaction.hash && hash(receipt.blockHash) && /^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(receipt.blockNumber) && ['0x0','0x1'].includes(receipt.status) && receipt.from?.toLowerCase() === sponsorAddress && receipt.to?.toLowerCase() === config.supplyFactory && Array.isArray(receipt.logs), 'The original Supply receipt changed.');
    const observed = await observe(row.request); if (BigInt(observed.snapshot.block.number) < BigInt(receipt.blockNumber)) return outcome(row);
    const block = await rpc.block(receipt.blockNumber);
    check(block?.hash === receipt.blockHash && BigInt(block.number) === BigInt(receipt.blockNumber), 'The original Supply receipt is no longer canonical.');
    if (receipt.status === '0x1') {
      const result = logs(receipt,row.request,stage), a = observed.snapshot.account;
      check(observed.spent && originalWithdrawal(observed,row.request) && observed.vault.deployed && observed.vault.status === (result.status === 'executed' ? 2 : 3) && observed.vault.inputBalance === '0' && observed.vault.allowance === '0', 'The final original Supply vault is unresolved or retains an allowance.');
      check(a.codeHash === stage.before.accountCodeHash && a.nonce === stage.before.accountNonce, 'Later lending activity needs a receipt-specific Supply position check.');
      check(BigInt(a.position.aLinkScaled) >= BigInt(stage.before.scaledCredit) + BigInt(result.scaledCredit) && BigInt(a.position.freeLinkBaseUnits) >= BigInt(stage.before.freeLink) + BigInt(result.refundAmount), 'The finalized original Supply account credit is not independently visible.');
      row.status = result.status;
      row.outcome = {intentId:row.request.id,artifactId:row.request.artifactId,status:result.status,verified:true,evidence:{network:config.network,chainId:config.chain,transaction:stage.transaction.hash,blockNumber:BigInt(receipt.blockNumber).toString(),blockHash:receipt.blockHash,beneficiary:row.request.plan.beneficiary,ownerAddress:row.request.ownerAddress,vault:row.request.vault,nullifierHash:row.request.nullifierHash,inputAsset:config.link,inputAmount:config.denomination,outputAsset:config.aLink,scaledCredit:result.scaledCredit,refundRecipient:row.request.plan.refundRecipient,refundAsset:config.link,refundAmount:result.refundAmount,allowance:'0',position:structuredClone(a.position)}};
    } else row.status = 'unknown';
    stage.finalized = true; stage.receipt = structuredClone(receipt); state.pending = null; await persist(state); await sponsorFence?.release(row.request.id); return outcome(row);
  }
  async function dispatch(state,row,operation,observed) {
    await sponsorFence?.assertAvailable(row.request.id);
    const sponsor = await sponsorState(), call = lendingSupplyCall(row.request,operation,config);
    check(await rpc.simulate({from:sponsorAddress,...call}) === true, 'The exact original Supply simulation failed.');
    const a = observed.snapshot.account;
    const stage = {operation,call,transaction:null,finalized:false,before:{scaledCredit:a.position.aLinkScaled,freeLink:a.position.freeLinkBaseUnits,vaultInput:observed.vault.inputBalance,accountCodeHash:a.codeHash,accountNonce:a.nonce}};
    await sponsorFence?.reserve(row.request.id);
    row.stages.push(stage); row.status = 'signing-unresolved'; row.statusCheck = null; state.pending = {id:row.request.id,index:row.stages.length - 1}; await persist(state);
    const raw = await signer.signTransaction({chainId:11155111,type:2,...call,nonce:sponsor.nonce,gasLimit:maxGas,maxFeePerGas:sponsor.maxFeePerGas,maxPriorityFeePerGas:sponsor.maxPriorityFeePerGas});
    stage.transaction = transaction(raw,call,sponsor); row.status = 'pending'; await persist(state);
    try { check(await rpc.send(stage.transaction.raw) === stage.transaction.hash, 'The Supply broadcast returned a different transaction.'); }
    catch { row.status = 'unknown'; await persist(state); }
    return outcome(row);
  }
  async function configuration() { return serial(async () => {
    const state = checkJournal(await journal.read()); let available = state.pending === null && Object.keys(state.requests).length < maxRequests;
    if (available) { try { await sponsorFence?.assertAvailable(); } catch { available = false; } }
    if (available) await sponsorState();
    return {available,execute:available,chainId:config.chain,privacyDisclosure:LENDING_PRIVACY,...(!available ? {reason:'Check the original pending lending request.'} : {})};
  }); }
  async function prepare(value) { return serial(async () => {
    const request = checkLendingSupplyPreparation(value,{config}), state = checkJournal(await journal.read());
    check(state.pending === null && Object.keys(state.requests).length < maxRequests, 'Check the original pending Supply request.'); await sponsorFence?.assertAvailable(request.id);
    const observed = await observe(request); supplyReady(observed,request); await sponsorState(); return {preparation:request,available:true,execute:true,snapshot:observed.snapshot,privacyDisclosure:LENDING_PRIVACY};
  }); }
  async function submit(value) { return serial(async () => {
    const request = checkLendingSupplyPublicRequest(value,{config}), state = checkJournal(await journal.read());
    const previous = state.requests[request.id]; if (previous) { check(same(previous.request,request), 'The original retained Supply proof changed.'); return previous.stages.at(-1)?.finalized ? finish(state,previous) : outcome(previous); }
    check(state.pending === null && Object.keys(state.requests).length < maxRequests && !Object.values(state.requests).some(row => row.request.nullifierHash === request.nullifierHash), 'Check the original request for this private note.');
    const observed = await observe(request); supplyReady(observed,request);
    const row = {request,status:'unknown',stages:[]}; state.requests[request.id] = row; return dispatch(state,row,'fulfill',observed);
  }); }
  async function reconcile(value) { return serial(async () => {
    const request = checkLendingSupplyPublicRequest(value,{config}), state = checkJournal(await journal.read()); let row = state.requests[request.id];
    if (row) {
      check(same(row.request,request), 'The original retained Supply proof changed.'); await finish(state,row);
      if (row.outcome) return outcome(row);
      if (state.pending) {
        let resubmissionSafe = false; const stage = row.stages.at(-1);
        if (state.pending.id === request.id && stage?.transaction && typeof rpc.transaction === 'function' && await rpc.receipt(stage.transaction.hash) === null && await rpc.transaction(stage.transaction.hash) === null) {
          const observed = await observe(request);
          if (stage.operation === 'fulfill') { try { supplyReady(observed,request); resubmissionSafe = true; } catch {} }
          else resubmissionSafe = recoveryChoice(observed,request) === stage.operation;
        }
        row.statusCheck = {checkedAt:now(),operation:null,resubmissionSafe}; await persist(state); return outcome(row);
      }
    }
    const observed = await observe(request);
    if (!row) { check(Object.keys(state.requests).length < maxRequests && !Object.values(state.requests).some(saved => saved.request.nullifierHash === request.nullifierHash), 'Retain the original Supply request for this note.'); row = {request,status:'unknown',stages:[]}; state.requests[request.id] = row; }
    row.statusCheck = {checkedAt:now(),operation:recoveryChoice(observed,request)}; await persist(state); return outcome(row);
  }); }
  async function recover(value) { return serial(async () => {
    check(value && Object.keys(value).sort().join() === 'operation,request' && ['recover','withdrawRefund'].includes(value.operation), 'Choose an explicit original Supply recovery.');
    const request = checkLendingSupplyPublicRequest(value.request,{config}), state = checkJournal(await journal.read()), row = state.requests[request.id];
    check(row && same(row.request,request), 'Check the original Supply request before recovery.'); if (row.outcome) return finish(state,row);
    const last = row.stages.at(-1);
    check(state.pending === null && row.stages.length < 2 && (!last || last.operation === 'fulfill' && last.finalized && last.receipt.status === '0x0'), 'Check the pending or already recovered Supply transaction.');
    check(row.statusCheck?.operation === value.operation && Number.isSafeInteger(row.statusCheck.checkedAt) && now() >= row.statusCheck.checkedAt && now() - row.statusCheck.checkedAt <= 60000, 'Read the original Supply status before recovery.');
    const observed = await observe(request); check(recoveryChoice(observed,request) === value.operation, 'The original Supply recovery funds or deadline changed.');
    if (value.operation === 'recover' && BigInt(observed.snapshot.block.timestamp) <= BigInt(request.plan.deadline)) check(active(request) && observed.snapshot.reserves?.LINK?.oneNoteSupplyPossible === true, 'The original LINK reserve cannot complete Supply.');
    return dispatch(state,row,value.operation,observed);
  }); }
  async function resume(value) { return serial(async () => {
    const request = checkLendingSupplyPublicRequest(value,{config}), state = checkJournal(await journal.read()), row = state.requests[request.id];
    check(row && same(row.request,request), 'Retain the original sponsored Supply request.');
    const reconciled = await finish(state,row), stage = row.stages.at(-1);
    if (row.outcome || stage?.finalized) return reconciled;
    check(state.pending?.id === request.id && stage?.transaction && typeof rpc.transaction === 'function', 'Check the original unresolved Supply transaction.');
    await sponsorFence?.assertAvailable(request.id);
    if (await rpc.receipt(stage.transaction.hash)) return outcome(row);
    const known = await rpc.transaction(stage.transaction.hash);
    if (known !== null) {
      check(known?.hash === stage.transaction.hash && known.from?.toLowerCase() === sponsorAddress && known.to?.toLowerCase() === config.supplyFactory && known.input?.toLowerCase() === stage.call.data.toLowerCase() && known.value === '0x0', 'The known original Supply transaction changed.');
      return outcome(row);
    }
    const observed = await observe(request);
    if (stage.operation === 'fulfill') supplyReady(observed,request);
    else check(recoveryChoice(observed,request) === stage.operation, 'The original Supply recovery funds or expiry changed.');
    check(await rpc.simulate({from:sponsorAddress,...stage.call}) === true, 'The retained original Supply transaction no longer simulates.');
    row.statusCheck = null;
    try { check(await rpc.send(stage.transaction.raw) === stage.transaction.hash, 'The original Supply replay returned another transaction.'); row.status = 'pending'; }
    catch { row.status = 'unknown'; }
    await persist(state); return outcome(row);
  }); }
  return Object.freeze({configuration,prepare,submit,reconcile,recover,resume});
}
