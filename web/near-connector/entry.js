import { actions, createTransaction, encodeTransaction, KeyPair, baseDecode } from 'near-api-js';
import { createPopupTransport } from './meteor-popup.js';

export const ACCOUNT_KEY = 'lenz-meteor-testnet-v1:accountId';
const account = id => typeof id === 'string' && id.length <= 64 && /^[a-z0-9]+(?:[._-][a-z0-9]+)*\.testnet$/.test(id);
export function createMeteorWallet(host = window) {
  const transport = createPopupTransport(host);
  let revision = 0;
  const getAccounts = async () => {
    const accountId = host.localStorage.getItem(ACCOUNT_KEY);
    return account(accountId) ? [{ accountId }] : [];
  };
  return {
    getAccounts,
    async signIn() {
      const started = revision;
      const payload = await transport.request('login', async () => ({ methods: [] }));
      if (started !== revision) throw new Error('Approval was cancelled.');
      if (!account(payload?.accountId)) throw new Error('Invalid account. Choose a named NEAR testnet account.');
      host.localStorage.setItem(ACCOUNT_KEY, payload.accountId);
      return [{ accountId: payload.accountId }];
    },
    disconnect() {
      revision++; transport.cancel();
      host.localStorage.removeItem(ACCOUNT_KEY);
    },
    signAndSendTransaction(transaction) {
      // Copy before asynchronous preparation; the review cannot change in flight.
      const tx = structuredClone(transaction), call = tx.actions?.[0];
      if (tx.network !== 'testnet' || !account(tx.signerId) || !account(tx.receiverId) ||
          tx.signerId !== host.localStorage.getItem(ACCOUNT_KEY) || tx.actions?.length !== 1 ||
          call.type !== 'FunctionCall' || call.params?.methodName !== 'deposit_offline' ||
          call.params.gas !== '50000000000000' || call.params.deposit !== '30000000000000000000000') {
        throw new Error('Invalid refund transaction or selected wallet.');
      }
      return transport.request('sign', async signal => {
        const response = await host.fetch('https://test.rpc.fastnear.com', { method: 'POST',
          headers: { 'Content-Type': 'application/json' }, signal,
          body: JSON.stringify({ jsonrpc: '2.0', id: 'lenz-wallet-block', method: 'block', params: { finality: 'final' } }) });
        if (!response.ok) throw new Error('Network could not prepare the refund.');
        const block = await response.json();
        if (block.error || typeof block.result?.header?.hash !== 'string') throw new Error('Invalid network block.');
        const hash = baseDecode(block.result.header.hash);
        if (hash.length !== 32) throw new Error('Invalid network block hash.');
        // Meteor replaces this unsigned placeholder key and nonce with its wallet key.
        const placeholder = KeyPair.fromRandom('ed25519').getPublicKey(), p = call.params;
        const encoded = encodeTransaction(createTransaction(tx.signerId, placeholder, tx.receiverId, 0n,
          [actions.functionCall(p.methodName, p.args, BigInt(p.gas), BigInt(p.deposit))], hash));
        return { transactions: host.btoa(String.fromCharCode(...encoded)) };
      });
    },
  };
}
