# Rhea receipt recovery

2026-10-30. The relay saves each transaction's public reference before broadcasting it. After a lost response, **Check status** reads that reference and the adapter's current final order. No receipt lookup submits a transaction, pays a refund or releases an offline reservation.

The receipt journal, relay route and wallet storage are checked against the recorded October 27 live evidence. Contradictory receipt summaries are rejected.

## What is checked

`contracts/adapter-client.mjs` uses the pinned near-api-js 7.4.0 signer to obtain the exact transaction hash. Its public journal write must finish before broadcast; a failed write prevents submission. Files contain the network, adapter, order, sender, method, hash and timestamp. They contain no private key or signed transaction payload. The journal is under ignored `contracts/.testnet/adapter-transactions/`.

`contracts/adapter-recovery.mjs` requires `FINAL`, the expected sender and adapter, one exact bounded action, and the saved order ID or signed instruction. It checks the complete receipt graph, rejects cycles and unresolved or contradictory statuses, follows `SuccessReceiptId` links, and requires the summary to equal the final returned outcome. A successful returned order must come from the adapter and match the signed instruction. Caught exchange failures may coexist with a successful callback, so failed receipts remain in the diagnostic evidence.

The current final `get_order` result supplies wallet status. An older transaction's returned stage cannot overwrite a newer order stage. The wallet checks the instruction again before saving status to its encrypted vault. Tests cover identity preservation, reload, storage failure, conflicting replies and retained reservations. Ordinary screens show plain status messages; raw failures stay out of the interface.

This trusts the configured RPC and pinned test contracts. It does not verify NEAR consensus or Merkle inclusion proofs. [NEAR's transaction documentation](https://docs.near.org/api/rpc/transactions), checked October 30, defines `FINAL` as including finalized refund receipts.

## Tested recovery safeguards

The receipt validator and wallet tests cover these failure cases:

| Failure path | Required safeguard | Owner and verification gate |
| --- | --- | --- |
| A success summary contradicted its callback receipt. | Follow the return path and compare its terminal result with the summary. Reject cyclic and malformed evidence. | Receipt validator: regression test failed before the fix, then passed; removing the summary guard must fail the test. |
| The relay broadcast before saving the hash, then retried after losing the response. | Persist the actual signed hash first. Status lookup must never open a signing account. | Relay: real SDK ordering test, failed-write test and route test; historical testnet lost-response rehearsal. |
| Old evidence or an expired deadline made reserved value available again. | Keep the current final order separate from transaction history; retain every signed reservation. | Wallet: Node reservation tests and isolated Edge failure/reload checks. No contract recovery operation is enabled by this work. |

These gates apply to the implemented read-only recovery. They do not authorize an administrative payout from a shared balance.

## Evidence and reproduction

- [Verification record](../contracts/adapter/recovery-verification.json): commands, current counts, source hashes and evidence scope.
- [October 27 live history](../contracts/adapter/recovery-live-2026-10-27.json): eight saved transaction graphs covering success, slippage/refund and payout failure/retry. Replaying them locally is distinct from a fresh RPC query.
- [Lost-response rehearsal](../contracts/adapter/recovery-rehearsal.json): one historical testnet `advance` on an already complete order, with the reply deliberately dropped. The saved hash recovered the result, and checked token balances stayed unchanged. The rehearsal is historical evidence.
- [Latest live attempt](../contracts/adapter/recovery-live-attempt.json): records failure as well as success. [Last successful live check](../contracts/adapter/recovery-live-results.json) is preserved when a new attempt fails.

```powershell
node --test contracts/adapter-recovery.test.mjs contracts/client.test.mjs contracts/refund-return.test.mjs web/rhea-relay.test.mjs web/rhea-protocol.test.mjs web/near-protocol.test.mjs web/near-deposit.test.mjs web/near-signer.test.mjs
node contracts/adapter-recovery-mutations.mjs
# Set NODE_PATH to your local test-tools node_modules directory.
node web/rhea-wallet-browser.test.cjs
node web/near-deposit-browser.test.cjs
node web/verify-chat-static.mjs
node contracts/adapter-recovery-live.mjs
```

The live script reads existing transactions only. Historical queries use `https://archival-rpc.testnet.near.org`, listed in the [official providers documentation](https://docs.near.org/api/rpc/providers) checked October 30. Archive requests have a 15-second timeout. The ordinary node reported an earliest retained block on October 29, after these transactions; the original unbounded live check was stopped without broadcasting anything.

## Contract recovery and remaining work

October 31: a [contract candidate](../contracts/adapter/redemption-recovery/README.md) now reconciles only `redeeming`, by querying the reserve's exact consumption identifier through a private callback. Its 26 adapter/16 reserve tests, six mutation checks and Wasm build pass. A subsequent [isolated testnet rehearsal](../contracts/adapter/redemption-recovery/rehearsal-notes.md) passed 27 checks, including state preservation, actual transfers with injected callback failure and exact refunds. The same candidate was subsequently [deployed to the configured adapter](../contracts/adapter/redemption-recovery/rollout-review.md), preserving all 13 stored entries. The wallet exposes a separate explicit recovery action. This read-only receipt checker does not invoke it.

An adapter left in `attention` or another in-flight stage after a missing callback still needs a reviewed recovery mechanism. Observing a successful token movement off-chain does not authorize calling a private callback, inferring ownership from shared balances or issuing another payout. Old orders without a local journal can still read final contract status, but this implementation does not discover arbitrary external-carrier transaction hashes.

External wallet approval remains blocked by the last recorded Meteor provider result. Intents partner access, browser Zcash signing and its DeFi route, private settlement and safe account recovery remain active in [development status](../docs/status.md).
