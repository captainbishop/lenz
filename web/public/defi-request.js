import { CHAT_DOMAIN, assert, bytes, digest, keysAre, signValue, verifyValue, validateProfile, sealMessage, openMessage } from './peer-crypto.js';
import { compressed } from './near-protocol.js';
import { checkRheaConfig, checkRheaPacket } from './rhea-protocol.js';
import { checkDepositRequest, refundSource } from './near-deposit.js';

export const DEFI_REQUEST = 'lenz/defi-request/v1';
export const DEFI_RECEIPT = 'lenz/defi-inbox-receipt/v1';
export const DEFI_OBSERVATION = 'lenz/defi-observation/v1';
// Explicit consent: executor sees terms/ancestry; NEAR is public; carriers see routing metadata.
export const PUBLIC_TESTNET_DISCLOSURE = 'lenz/disclosure/public-near-executor/v1';
export const MAX_REQUEST_BYTES = 48000;
const MAX_AGE = 86400000;
const configKeys = ['network','adapter','reserve','exchange','poolId','tokenOut'];
const time = n => Number.isSafeInteger(n) && n >= 0;
const terms = r => [DEFI_REQUEST, r.sender, r.executor, r.createdAt, r.expiresAt, r.disclosure, r.operation];
export const carrierSenderProfile = sender => ({type:CHAT_DOMAIN, name:'Sender', ...sender});

async function checkOperation(config, operation, sender) {
  checkRheaConfig(config);
  assert(operation?.kind === 'rhea-swap' || operation?.kind === 'rhea-refund-return', 'Unsupported DeFi action');
  assert(keysAre(operation, operation.kind === 'rhea-swap' ? ['kind','packet'] : ['kind','packet','deposit']), 'Invalid DeFi action');
  const p = operation.packet;
  assert(keysAre(p?.config, configKeys), 'Unexpected adapter configuration');
  await checkRheaPacket(config, p);
  assert(p.instruction.owner === compressed(sender.signingPublic), 'DeFi request signer does not own this action');
  if (operation.kind === 'rhea-refund-return') {
    const d = await checkDepositRequest(operation.deposit), i = p.instruction;
    assert(d.contract === config.reserve && d.payer === i.receiver_id && d.owner === i.owner && d.amount === i.amount
      && d.source === await refundSource(config.adapter, p.id), 'Refund request differs from the signed order');
  }
}

export async function checkDefiRequest(config, senderProfile, executorProfile, input, now = Date.now()) {
  // Snapshot before asynchronous validation, so the checked bytes are the returned bytes.
  const r = structuredClone(input), c = structuredClone(config);
  const sender = await validateProfile(senderProfile), executor = await validateProfile(executorProfile);
  assert(bytes(r).length <= MAX_REQUEST_BYTES && keysAre(r, ['type','id','sender','executor','createdAt','expiresAt','disclosure','operation','signature'])
    && r.type === DEFI_REQUEST, 'Invalid DeFi request');
  assert(r.sender === sender.id && r.executor === executor.id && r.sender !== r.executor, 'Wrong DeFi request owner or executor');
  assert(r.disclosure === PUBLIC_TESTNET_DISCLOSURE, 'This route requires explicit public-testnet disclosure consent');
  assert(time(now) && time(r.createdAt) && time(r.expiresAt) && r.createdAt <= now + 60000 && r.expiresAt > now
    && r.expiresAt > r.createdAt && r.expiresAt - r.createdAt <= MAX_AGE, 'DeFi request expired or has invalid timing');
  await checkOperation(c, r.operation, sender);
  if (r.operation.kind === 'rhea-swap') assert(r.expiresAt <= Number(r.operation.packet.instruction.deadline_ms), 'Request exceeds the swap deadline');
  assert(r.id === await digest(terms(r)), 'DeFi request id differs from its authorization');
  assert(await verifyValue(sender.signingPublic, terms(r), r.signature), 'DeFi authorization signature rejected');
  return r;
}

export async function createDefiRequest(identity, executor, config, operation, {disclosure, expiresAt}, now = Date.now()) {
  const r = {type:DEFI_REQUEST, id:'', sender:identity.profile.id, executor:executor.id,
    createdAt:now, expiresAt, disclosure, operation:structuredClone(operation), signature:''};
  r.id = await digest(terms(r)); r.signature = await signValue(identity, terms(r));
  return checkDefiRequest(config, identity.profile, executor, r, now);
}

export async function sealDefiRequest(identity, executor, config, request, now = Date.now()) {
  const r = await checkDefiRequest(config, identity.profile, executor, request, now);
  // The caller must commit the wallet reservation and request before publishing this packet.
  return sealMessage(identity, executor, r);
}

export async function openDefiRequest(identity, sender, config, packet, now = Date.now()) {
  const p = structuredClone(packet);
  assert(p.from === sender.id && p.to === identity.profile.id, 'Wrong DeFi packet direction');
  const r = await openMessage(identity, sender, p);
  return checkDefiRequest(config, sender, identity.profile, r, now);
}

// Bind a local conflict slot to the economic input, not to randomized signature/ciphertext bytes.
export const defiConflictId = r => digest([DEFI_REQUEST, 'input', r.operation.packet.instruction.owner, r.operation.kind,
  r.operation.packet.config.reserve, r.operation.kind === 'rhea-swap'
    ? r.operation.packet.instruction.input : r.operation.deposit.id]);

export async function openDefiReceipt(identity, executor, packet, request) {
  const p = structuredClone(packet), r = structuredClone(request);
  assert(p.from === executor.id && p.to === identity.profile.id && r.sender === identity.profile.id && r.executor === executor.id, 'Wrong DeFi receipt direction');
  const receipt = await openMessage(identity, executor, p);
  assert(keysAre(receipt, ['type','requestId','state','storedAt']) && receipt.type === DEFI_RECEIPT
    && receipt.requestId === r.id && receipt.state === 'stored' && time(receipt.storedAt)
    && receipt.storedAt >= r.createdAt - 60000 && receipt.storedAt < r.expiresAt, 'Invalid DeFi storage receipt');
  // Deliberately returns no settlement status, new note, balance or reservation update.
  return receipt;
}

// Authentication establishes who sent an update, not whether its chain claims are true.
export async function openDefiObservation(identity, executor, packet, request, now = Date.now()) {
  const p=structuredClone(packet),r=structuredClone(request);
  assert(p.from===executor.id && p.to===identity.profile.id && r.sender===identity.profile.id && r.executor===executor.id,'Wrong DeFi result direction');
  const report=await openMessage(identity,executor,p);
  assert(bytes(report).length<=100000 && keysAre(report,['type','requestId','checkedAt','state','observation','transaction'])
    && report.type===DEFI_OBSERVATION && report.requestId===r.id,'Different DeFi result request');
  assert(time(now) && time(report.checkedAt) && report.checkedAt>=r.createdAt && report.checkedAt<=now+60000,'Invalid DeFi result time');
  assert(['observed','pending','unavailable','expired','needs_review','conflicted','ready'].includes(report.state),'Invalid DeFi result state');
  return report;
}
