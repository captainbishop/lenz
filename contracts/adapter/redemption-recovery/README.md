# Missing redemption callback recovery

2026-10-31. The adapter can recover an order stuck at `redeeming` by checking the reserve's exact consumption record. It never retries redemption or sends a token during recovery. After local tests and a [27-check isolated rehearsal](rehearsal-notes.md), the unchanged candidate was [deployed to the configured testnet adapter](rollout.json), preserving all 13 existing storage entries. The wallet and relay now expose the bounded **Resume swap** action. [Release review, tests and limits](rollout-review.md); [live verification](rollout-verification.json).

## Authority and transitions

The existing reserve's `redeem` method transfers a note's full amount to the signed NEAR account and stores its consumption identifier in the same receipt. The identifier is SHA-256 over this JSON array:

```text
["lenz/near-redeem/v1", "testnet", reserve, input, adapter, nonce]
```

The adapter already verified the note owner and amount, both signatures, and exclusive input assignment before entering `redeeming`. Its new `recover_redemption(id)` sends a zero-deposit `spent_by(input)` query to its configured reserve, followed by a private `on_redemption_status(id)` callback. This is a gas-paid chain transaction that can update adapter state, distinct from the existing read-only RPC receipt checker.

Only an exact identifier match changes `redeeming` to `funded`. Null, failed, oversized, malformed or unrelated responses leave the order unchanged and unavailable. Other stages do not dispatch a recovery query. The callback requires the adapter as predecessor, exactly one promise result and the `redeeming` stage. A late query or original callback is rejected after either one has advanced the order. No new timeout, administrator, attestation key or stored field is introduced.

The method does not automatically advance a recovered order. A later call to the existing `advance` method deposits it or, if its deadline has passed, follows the existing refund path to the signed receiver. Its old offline input stays consumed/reserved. Recovery does not create a new offline note.

The record proves a historical transfer, not current solvency. While the order is still `redeeming`, the adapter has not dispatched that order's next token movement. This stage restriction is essential: reusing the same permanent record after a deposit or payout could spend a sibling order's balance. A reserve test deliberately moves the credited tokens afterward and confirms that the identifier persists; the adapter's stage tests reject recovery after advancement.

## Scope of remaining recovery work

| Stuck stage | Current authority available | Candidate behavior |
| --- | --- | --- |
| `checking` | A repeat note lookup is possible, but needs its own callback-race design. | No recovery added. |
| `redeeming` | Exact consumption identifier from the configured reserve; note amount was validated before dispatch. | Restore `funded` only on an exact match. Unknown evidence stays locked. |
| `depositing` | A transfer-call resolver may already have moved or refunded funds. | No retry or balance-delta credit. |
| `swapping` | The exchange's shared deposits do not identify an individual lost result. | No retry or inferred output. |
| `withdrawing_output` / `withdrawing_refund` | A withdrawal may have completed before the callback failed. | No retry or inferred available balance. |
| `paying_output` / `paying_refund` | A payout may already have reached the signed recipient. | No retry without the existing authenticated failure callback. |
| `attention`, rejected or terminal stages | Some stages discard the operation phase; the reason string is not recovery authority. | No generic reset or payout. |

Broader recovery needs an operation-specific durable outcome that the contract can authenticate, or a separately reviewed receipt-proof mechanism. A local journal, RPC success, time limit or pooled balance cannot replace that authority. Preserving phase and attempt identifiers would help future recovery, but would require a separately reviewed state change. Those mechanisms are not implemented here.

## Trust and release requirements

The reserve, adapter and token/exchange code must honor their accounting rules. A reserve upgrade can change `spent_by`; a compromised adapter full-access key can change code or move tokens outside the order machine. This candidate does not protect against those authorities or certify aggregate solvency. Independent release review and separation of deployment keys remain required by the [behavior and safety boundaries](../../../docs/behavior.md).

The [isolated rehearsal](rehearsal-notes.md) verifies code-only upgrade/state preservation, an actual redemption with an injected callback failure, overlapping recovery, an original-callback race and a constructed callback replay after payout. It also checks conservation and exact signed refunds. The [configured rollout](rollout-review.md) adds the client/relay boundary, exact deployment receipt and storage checks. Same-host review does not satisfy independent release approval or key separation for production use.

## Verification

- 26 adapter tests passed, including seven new recovery tests. They exercise exact query target/arguments, zero attached deposits, repeated queries, expired refunds, all other stages, callback identity/count, both callback arrival orders and sibling-order separation.
- 16 reserve tests passed, including a new check linking the exact consumption identifier to the actual reserve transfer and showing that the identifier remains after later token movement.
- Six targeted guard changes were detected in separate crate copies: callback sender, swap signature, output minimum, recovery identifier, callback stage and changing the recovery query into a redemption call.
- The locked Wasm build passed. `candidate.wasm` is 309,632 bytes, SHA-256 `53b9b2ebb270ceb643aae7f07fcb4ab852ca47882bd17375b27db04d45bc4a80`. It adds `recover_redemption` and `on_redemption_status` exports and retains existing exports.
- Comparing [the previous source](lib-before.rs) with the current source shows only the two recovery methods added. State types, Borsh field order, storage prefixes and enum variants are unchanged. The isolated rehearsal preserved seven entries; the configured rollout preserved all 13 entries.

[Verification record](verification.json) contains counts derived from command output, hashes and commands. The historical deployed-Wasm hash is retained in deployment metadata. Archived binaries are local verification prerequisites and are not distributed here. A new build must not be substituted for the historical artifact without checking the recorded hash.

The initial native test harness failed to compile because `PromiseResult` is not cloneable. After replacing those fixture copies, nonfunctional recovery stubs failed three behavioral assertions, as intended. Both [the compile failure](test-harness-compile-failure.txt) and [the pre-implementation failures](test-before-implementation.txt) are retained. The final implementation passed the full suites. That local checkpoint made no chain transaction. The later [live rehearsal](rehearsal-notes.md) separately records its test funding, deployments, actual receipts and harness failures.

The [NEAR cross-contract documentation](https://docs.near.org/smart-contracts/anatomy/crosscontract), retrieved October 31, confirms independent asynchronous call/callback execution. The SDK documentation URL was inaccessible through the web tool; the implementation uses the inspected local `near-sdk 5.29.1` source and its bounded `promise_result_checked` API. No SDK version or endpoint changed.

Run from the project root:

```powershell
./tooling/build-near.ps1 -Contract adapter -Action test -Offline
./tooling/build-near.ps1 -Contract reserve -Action test -Offline
./tooling/build-near.ps1 -Contract adapter -Action wasm -Offline
./tooling/check-adapter-mutations.ps1
```
