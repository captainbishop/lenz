// In-memory contract-test fixture. No RPC endpoint, persisted key or user wallet.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { createCustomCommon, Hardfork, Mainnet } from '@ethereumjs/common';
import { createLegacyTx } from '@ethereumjs/tx';
import { createAccount, createAddressFromPrivateKey, hexToBytes } from '@ethereumjs/util';
import { createVM, runTx } from '@ethereumjs/vm';

export async function createLocalEvm() {
  const common = createCustomCommon({ chainId: 31337 }, Mainnet, { hardfork: Hardfork.Paris });
  const vm = await createVM({ common });
  const key = randomBytes(32), sender = createAddressFromPrivateKey(key);
  await vm.stateManager.putAccount(sender, createAccount({ balance: 10n ** 20n }));
  return {
    vm, sender,
    async send(data, to, gasLimit = 10_000_000n) {
      const account = await vm.stateManager.getAccount(sender);
      const tx = createLegacyTx({ nonce: account.nonce, gasPrice: 1_000_000_000n,
        gasLimit, to, data: hexToBytes(data) }, { common }).sign(key);
      const result = await runTx(vm, { tx });
      assert(!result.execResult.exceptionError, result.execResult.exceptionError?.error);
      assert.equal(result.receipt.status, 1, 'Local transaction failed');
      return result;
    },
    async call(data, to) {
      // runCall can change the sender nonce even for a static call. Discard all
      // temporary state, including on revert, as an eth_call-style read requires.
      await vm.stateManager.checkpoint();
      try {
        const result = await vm.evm.runCall({ caller: sender, to, data: hexToBytes(data),
          gasLimit: 10_000_000n, isStatic: true });
        assert(!result.execResult.exceptionError, result.execResult.exceptionError?.error);
        return result.execResult.returnValue;
      } finally {
        await vm.stateManager.revert();
      }
    },
  };
}
