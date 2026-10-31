import { assert } from './peer-crypto.js';
import { checkDepositRequest, refundSource } from './near-deposit.js';
import { compressed } from './near-protocol.js';

export const DEPOSIT_GAS = '50000000000000';
export const DEPOSIT_STORAGE = '30000000000000000000000'; // 0.03 test NEAR
const account = value => typeof value === 'string' && value.length <= 64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(value);
let walletPromise;
async function wallet() {
  walletPromise ??= import('./near-vendor/connector.js').then(m => m.createMeteorWallet()).catch(e => { walletPromise = null; throw e; });
  return walletPromise;
}
export async function connectedNearAccount() {
  // Do not load a third-party adapter or start a popup just to render offline UI.
  const id = localStorage.getItem('lenz-meteor-testnet-v1:accountId');
  return account(id) ? id : null;
}
export async function connectNearWallet() {
  assert(navigator.onLine, 'Reconnect to the internet to open Meteor.');
  const accounts = await (await wallet()).signIn({ network: 'testnet' });
  assert(accounts?.length === 1 && account(accounts[0].accountId), 'Choose a named NEAR testnet account in Meteor.');
  return accounts[0].accountId;
}
export async function disconnectNearWallet() {
  // No delegated key is created by this connection. Forget only its local label.
  if (walletPromise) (await walletPromise).disconnect();
  localStorage.removeItem('lenz-meteor-testnet-v1:accountId');
  walletPromise = null;
}
export async function refundDepositTransaction(request, { config, entry, identity }) {
  await checkDepositRequest(request);
  const i = entry.packet.instruction;
  assert(config.network === 'testnet' && config.reserve === request.contract && entry.packet.config.reserve === config.reserve && entry.packet.config.adapter === config.adapter, 'Wrong network or reserve for this refund.');
  assert(entry.status?.stage === 'refunded' && !entry.returnReceipt, 'This refund is not awaiting a return.');
  assert(request.owner === compressed(identity.profile.signingPublic) && request.owner === i.owner, 'This refund belongs to another Lenz profile.');
  assert(request.payer === i.receiver_id && request.amount === i.amount && request.source === await refundSource(config.adapter, entry.packet.id), 'The saved return does not match this refund.');
  return { network: 'testnet', signerId: request.payer, receiverId: request.contract,
    actions: [{ type: 'FunctionCall', params: { methodName: 'deposit_offline',
      args: { owner: request.owner, amount: request.amount, source: request.source, signature: request.signature },
      gas: DEPOSIT_GAS, deposit: DEPOSIT_STORAGE } }] };
}
export async function signRefundDeposit(request, context, signer) {
  assert(navigator.onLine, 'Reconnect to the internet to return this refund.');
  const transaction = await refundDepositTransaction(request, context);
  const selected = signer ?? await wallet();
  const accounts = await selected.getAccounts({ network: 'testnet' });
  assert(accounts?.length === 1 && accounts[0].accountId === request.payer, `Connect ${request.payer} in Meteor before returning this refund.`);
  // The result is a submission hint only. The caller checks the exact final root.
  await selected.signAndSendTransaction(transaction);
}
