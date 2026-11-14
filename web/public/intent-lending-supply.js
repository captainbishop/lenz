import { keccak256 } from './evm-vendor/offline-budget.js';
import { LENDING_TESTNET, LENDING_PRIVACY } from './intent-lending-config.js';
import { PRIVATE_SUPPLY_VAULT_CREATION_CODE } from './intent-lending-supply-code.js';

const check = (value, reason) => { if (!value) throw Error(reason); };
const exact = (value, keys) => value && Object.getPrototypeOf(value) === Object.prototype && Object.keys(value).sort().join() === keys.slice().sort().join();
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0{40}$/.test(value);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0{64}$/.test(value);
const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const scalar = value => hash(value) && BigInt(value) < field;
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 2n ** 256n;
const owner = value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value);
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
export const sameLendingSupplyValue = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));
const digest = value => keccak256(new TextEncoder().encode(JSON.stringify(ordered(value)))).slice(2);
const word = value => BigInt(value).toString(16).padStart(64, '0');
export const LENDING_SUPPLY_ZERO = '0x' + '0'.repeat(40);

function configured(config) {
  config = { ...config,supplyVaultCreationCode:config.supplyVaultCreationCode ?? PRIVATE_SUPPLY_VAULT_CREATION_CODE };
  check(config.chainId === 11155111 && config.chain === LENDING_TESTNET.chain && config.denomination === LENDING_TESTNET.denomination, 'The private Supply network or denomination changed.');
  for (const key of ['pool', 'link', 'usdc', 'aLink', 'variableDebt']) check(config[key] === LENDING_TESTNET[key] && hash(config.codeHashes?.[key]), 'The fixed lending route is not pinned.');
  for (const key of ['lendingFactory', 'privacyPool', 'supplyFactory', 'verifier', 'hasher']) check(address(config[key]) && hash(config.codeHashes?.[key]), 'The original private Supply deployment is not pinned.');
  check(typeof config.supplyVaultCreationCode === 'string' && /^0x(?:[0-9a-f]{2})+$/.test(config.supplyVaultCreationCode) && config.supplyVaultCreationCode.length <= 50000, 'The reviewed Supply vault creation code is unavailable.');
  return config;
}
export function checkLendingSupplyPlan(value) {
  check(exact(value, ['beneficiary', 'refundRecipient', 'minScaledCredit', 'deadline', 'salt']) && address(value.beneficiary) && value.refundRecipient === value.beneficiary, 'Use the same recoverable lending account for Supply and refund.');
  check(uint(value.minScaledCredit) && BigInt(value.minScaledCredit) > 0n && BigInt(value.minScaledCredit) <= BigInt(LENDING_TESTNET.denomination) && uint(value.deadline) && BigInt(value.deadline) > 0n && BigInt(value.deadline) <= BigInt(Number.MAX_SAFE_INTEGER) && hash(value.salt), 'The exact Supply minimum, deadline or salt changed.');
  return structuredClone(value);
}
export function lendingSupplyVaultAddress(value, { config = LENDING_TESTNET } = {}) {
  const plan = checkLendingSupplyPlan(value), d = configured(config);
  const terms = [d.link, d.pool, d.aLink, d.denomination, plan.minScaledCredit, plan.deadline, plan.beneficiary, plan.refundRecipient, d.chainId, plan.salt, d.codeHashes.link, d.codeHashes.pool, d.codeHashes.aLink];
  const initHash = keccak256(d.supplyVaultCreationCode + terms.map(word).join(''));
  const salt = keccak256('0x' + [d.chainId, plan.beneficiary, plan.refundRecipient, plan.minScaledCredit, plan.deadline, plan.salt].map(word).join(''));
  return '0x' + keccak256('0xff' + d.supplyFactory.slice(2) + salt.slice(2) + initHash.slice(2)).slice(-40);
}
export function lendingSupplySelection(row, { recipient, minimum, deadline, now = Date.now(), allowExpired = false, config = LENDING_TESTNET } = {}) {
  configured(config);
  check(row?.chainId === config.chain && row.asset === config.link && owner(row.accountId) && scalar(row.commitment) && (row.units ?? row.amount) === config.denomination, 'Choose one complete original private LINK note.');
  check(address(recipient) && uint(minimum) && BigInt(minimum) > 0n && BigInt(minimum) <= BigInt(config.denomination), 'Choose your durable lending account and minimum scaled aLINK credit.');
  check(Number.isSafeInteger(deadline) && deadline > 0 && deadline % 1000 === 0 && (allowExpired || deadline > now && deadline <= now + 300000), 'Review an active Supply deadline within five minutes.');
  return { action: 'supply', source: { chainId: config.chain, asset: config.link, accountId: row.accountId, amount: config.denomination, commitment: row.commitment }, destination: { chainId: config.chain, asset: config.aLink, accountId: recipient, minAmount: minimum }, deadline, privacy: 'private' };
}
function selection(value, options) {
  check(exact(value, ['action', 'source', 'destination', 'deadline', 'privacy']) && exact(value.source, ['chainId', 'asset', 'accountId', 'amount', 'commitment']) && exact(value.destination, ['chainId', 'asset', 'accountId', 'minAmount']), 'The private Supply selection changed.');
  const expected = lendingSupplySelection(value.source, { ...options, recipient: value.destination.accountId, minimum: value.destination.minAmount, deadline: value.deadline });
  check(sameLendingSupplyValue(value, expected), 'The exact private Supply asset or amount changed.'); return expected;
}
function accountSnapshot(snapshot, identity, config, now, allowExpired) {
  const a = snapshot?.account, block = snapshot?.block;
  check(snapshot?.chainId === config.chain && snapshot.routeVerified === true && snapshot.trust?.codePinsVerified === true && snapshot.trust.implementationPinsVerified === true && snapshot.trust.executionPinsVerified === true && Number.isSafeInteger(snapshot.observedAt) && (allowExpired || Math.abs(now - snapshot.observedAt) <= 120000) && block?.finality === 'finalized' && block.requireCanonical === true && uint(block.number) && hash(block.hash), 'The finalized pinned Supply route is unavailable.');
  check(identity?.chainId === config.chain && owner(identity.lenzIdentity) && identity.deployed === true && identity.accountId === identity.account && address(identity.account) && address(identity.ownerAddress) && a?.status === 'verified' && a.address === identity.account && a.owner === identity.ownerAddress && hash(a.codeHash) && sameLendingSupplyValue(a.route, identity.route), 'Use the original verified durable lending owner and account.');
  check(identity.route?.factory === config.lendingFactory && identity.route.chainId === config.chain, 'The original lending account factory changed.');
  for (const key of ['pool', 'link', 'usdc', 'aLink', 'variableDebt']) check(identity.route[key] === config[key] && identity.route[key + 'CodeHash'] === config.codeHashes[key], 'The durable lending route changed.');
  const reserve = snapshot.reserves?.LINK;
  check(allowExpired || reserve?.active === true && reserve.frozen === false && reserve.paused === false && reserve.oneNoteSupplyPossible === true, 'The LINK reserve cannot accept the original note.');
  const pool = snapshot.privatePool;
  check(pool?.address === config.privacyPool && scalar(pool.root) && Number.isSafeInteger(pool.nextIndex) && pool.nextIndex > 0 && pool.nextIndex <= 4096 && Array.isArray(pool.commitments) && pool.commitments.length === pool.nextIndex && new Set(pool.commitments).size === pool.nextIndex && pool.commitments.every(scalar) && Array.isArray(pool.withdrawals) && pool.withdrawals.length <= 4096 && pool.withdrawals.every(row => scalar(row.nullifierHash)), 'The complete finalized original pool history is unavailable.');
}
export function buildLendingSupplyReview(value, spend, { snapshot, identity, salt, config = LENDING_TESTNET, now = Date.now(), allowExpired = false } = {}) {
  const chosen = selection(value, { now, allowExpired, config }); accountSnapshot(snapshot, identity, config, now, allowExpired);
  check(chosen.destination.accountId === identity.account && spend?.commitment === chosen.source.commitment && scalar(spend.nullifierHash) && spend.root === snapshot.privatePool.root && snapshot.privatePool.commitments.includes(spend.commitment) && !snapshot.privatePool.withdrawals.some(row => row.nullifierHash === spend.nullifierHash), 'The original note, lending beneficiary or unspent proof path changed.');
  check(exact(spend, ['commitment', 'nullifierHash', 'root', 'pathElements', 'pathIndices']) && Array.isArray(spend.pathElements) && spend.pathElements.length === 20 && spend.pathElements.every(value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && BigInt(value) < field) && Array.isArray(spend.pathIndices) && spend.pathIndices.length === 20 && spend.pathIndices.every(value => value === 0 || value === 1), 'The original 20-level private note path is incomplete.');
  const plan = checkLendingSupplyPlan({ beneficiary: identity.account, refundRecipient: identity.account, minScaledCredit: chosen.destination.minAmount, deadline: String(chosen.deadline / 1000), salt });
  const core = { ownerAddress: identity.ownerAddress, plan, vault: lendingSupplyVaultAddress(plan, { config }), root: spend.root, nullifierHash: spend.nullifierHash };
  return { type: 'lenz/private-lending-supply/v1', ...chosen, id: 'lending-supply:' + digest(core), owner: identity.lenzIdentity, ownerAddress: identity.ownerAddress, identity: structuredClone(identity), plan, vault: core.vault, spend: structuredClone(spend), snapshot: structuredClone(snapshot), fees: [], authorization: { label: 'Confirm private Supply' }, privacyDisclosure: LENDING_PRIVACY, recoveryDisclosure: 'Keep the original Supply request. After expiry, its LINK refund belongs to this same backed-up lending account.' };
}
export function checkLendingSupplyReview(value, { config = LENDING_TESTNET, now = Date.now(), allowExpired = false } = {}) {
  check(exact(value, ['type','action','source','destination','deadline','privacy','id','owner','ownerAddress','identity','plan','vault','spend','snapshot','fees','authorization','privacyDisclosure','recoveryDisclosure']), 'The retained original Supply review changed.');
  const chosen = selection({ action:value.action,source:value.source,destination:value.destination,deadline:value.deadline,privacy:value.privacy }, { now, allowExpired, config });
  const expected = buildLendingSupplyReview(chosen, value.spend, { snapshot:value.snapshot,identity:value.identity,salt:value.plan?.salt,config,now,allowExpired });
  check(sameLendingSupplyValue(value, expected), 'The retained original Supply review changed.'); return expected;
}
export function checkLendingSupplyPreparation(value, { config = LENDING_TESTNET } = {}) {
  check(exact(value, ['id','ownerAddress','plan','vault','root','nullifierHash']) && address(value.ownerAddress), 'The public original Supply preparation changed.');
  const plan = checkLendingSupplyPlan(value.plan);
  check(value.vault === lendingSupplyVaultAddress(plan, { config }) && scalar(value.root) && scalar(value.nullifierHash), 'The original Supply vault or proof root changed.');
  const core = { ownerAddress:value.ownerAddress,plan,vault:value.vault,root:value.root,nullifierHash:value.nullifierHash };
  check(value.id === 'lending-supply:' + digest(core), 'The original Supply identity changed.'); return { id:value.id,...core };
}
export function buildLendingSupplyPreparation(value, { config = LENDING_TESTNET } = {}) {
  check(exact(value, ['ownerAddress','plan','root','nullifierHash']), 'The public Supply preparation changed.');
  const core = { ownerAddress:value.ownerAddress,plan:checkLendingSupplyPlan(value.plan),vault:lendingSupplyVaultAddress(value.plan, { config }),root:value.root,nullifierHash:value.nullifierHash };
  return checkLendingSupplyPreparation({ id:'lending-supply:' + digest(core),...core }, { config });
}
export function lendingSupplyPreparation(review, { config = LENDING_TESTNET } = {}) {
  const checked = checkLendingSupplyReview(review, { config, allowExpired:true });
  return checkLendingSupplyPreparation({ id:checked.id,ownerAddress:checked.ownerAddress,plan:checked.plan,vault:checked.vault,root:checked.spend.root,nullifierHash:checked.spend.nullifierHash }, { config });
}
export function lendingSupplySignals(review) { return [review.spend?.root ?? review.root, review.spend?.nullifierHash ?? review.nullifierHash, review.vault, '0', '0', '0'].map(value => BigInt(value).toString()); }
export function buildLendingSupplyAuthorization(review, result, { config = LENDING_TESTNET } = {}) {
  const preparation = lendingSupplyPreparation(review, { config }), proof = result?.solidity?.proof, signals = lendingSupplySignals(preparation);
  const normalize = values => Array.isArray(values) && values.length === 6 && values.every(value => typeof value === 'string' && /^(?:0|[1-9][0-9]*|0x[0-9a-f]+)$/.test(value)) ? values.map(value => BigInt(value).toString()) : null;
  check(typeof proof === 'string' && /^0x[0-9a-f]{512}$/.test(proof) && sameLendingSupplyValue(normalize(result.solidity.publicSignals), signals) && sameLendingSupplyValue(normalize(result.publicSignals), signals), 'The original proof authorized different public signals.');
  return { intentId:preparation.id,artifactId:'lending-supply-proof:' + digest({ intentId:preparation.id,proof,publicSignals:signals }),proof,publicSignals:signals };
}
export function checkLendingSupplyAuthorization(value, review, { config = LENDING_TESTNET } = {}) {
  check(exact(value, ['intentId','artifactId','proof','publicSignals']) && value.intentId === review.id, 'The retained private proof belongs to another Supply request.');
  const expected = buildLendingSupplyAuthorization(review, { solidity:{proof:value.proof,publicSignals:value.publicSignals},publicSignals:value.publicSignals }, { config });
  check(sameLendingSupplyValue(value, expected), 'The original private Supply proof changed.'); return expected;
}
export function checkLendingSupplyPublicRequest(value, { config = LENDING_TESTNET } = {}) {
  check(exact(value, ['id','artifactId','ownerAddress','plan','vault','root','nullifierHash','proof','publicSignals']), 'The public original Supply request changed.');
  const preparation = checkLendingSupplyPreparation({ id:value.id,ownerAddress:value.ownerAddress,plan:value.plan,vault:value.vault,root:value.root,nullifierHash:value.nullifierHash }, { config }), signals = lendingSupplySignals(preparation);
  check(typeof value.proof === 'string' && /^0x[0-9a-f]{512}$/.test(value.proof) && sameLendingSupplyValue(value.publicSignals, signals), 'The original proof authorized different public signals.');
  check(value.artifactId === 'lending-supply-proof:' + digest({ intentId:value.id,proof:value.proof,publicSignals:signals }), 'The original private proof artifact changed.'); return structuredClone(value);
}
export function lendingSupplyPublicRequest(attempt, { config = LENDING_TESTNET } = {}) {
  const preparation = lendingSupplyPreparation(attempt.review, { config }), authorization = checkLendingSupplyAuthorization(attempt.authorization, attempt.review, { config });
  return checkLendingSupplyPublicRequest({ ...preparation,artifactId:authorization.artifactId,proof:authorization.proof,publicSignals:authorization.publicSignals }, { config });
}
