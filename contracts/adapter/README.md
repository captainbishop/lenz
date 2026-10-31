# Signed Rhea testnet adapter

October 31 release: [missing redemption callback recovery](redemption-recovery/README.md) is now enabled on the configured adapter and in the wallet. The unchanged rehearsed candidate was deployed code-only, preserving **all 13 existing storage entries**. [Release review](redemption-recovery/rollout-review.md), [receipt and state](redemption-recovery/rollout.json), [follow-up verification](redemption-recovery/rollout-verification.json). The wallet's **Resume swap** performs one bounded recovery call; **Check status** remains read-only. Other missing callbacks and `attention` states remain unsupported. The prior 26 adapter/16 reserve tests, six mutations and 27-check isolated rehearsal remain separate evidence.

Verified 2026-10-26. The wallet can sign a tUSD swap offline, reserve its input in encrypted storage, export the signed file and execute it through a connected carrier. Rhea swaps the redeemed input for wrapped test NEAR. Output and refunds go to the NEAR account bound by the user's signature.

- Adapter: `lenz-rhea-1792987934062.testnet`
- Existing reserve, unchanged: `tusd.lenz-dev-1792984696547.testnet`
- Exchange: `ref-finance-101.testnet`; pool 2870; output `wrap.testnet`
- Current deployed Wasm: 309,632 bytes; SHA-256 `53b9b2ebb270ceb643aae7f07fcb4ab852ca47882bd17375b27db04d45bc4a80`. [deployment.json](deployment.json) retains the original 301,539-byte deployment; [rollout](redemption-recovery/rollout.json) records the code-only upgrade.
- Local server: `http://127.0.0.1:4173/money.html`; **Swap with Rhea**.

## Evidence

| Check | Result |
| --- | --- |
| [Native contract tests](test-results.json) | Current candidate: 26 passed, including the original 19 cases and seven recovery cases. Callback responses are native SDK fixtures; the browser-signature fixture was generated in Edge. |
| [Wasm build](wasm-results.json) | Passed with pinned Rust/SDK and NEAR target flags. |
| [Guard mutations](mutation-results.json) | Current candidate: six changes detected, covering caller, swap signature, output minimum, recovery evidence, stage and query target. Separate copied crates prevent Cargo from reusing the wrong binary. |
| [Live adapter flow](live-results.json) | Five checks passed: successful output after early carrier redemption, minimum-output refund, expired-order refund, unregistered recipient payout/retry, duplicates without a second payout. |
| [Live wallet](../../web/rhea-wallet-live-results.json) | Four Windows Edge checks passed: actual funding/quote, offline signing/reload, lost-response recovery and exact output delivery. |
| [Offline browser/storage](../../web/rhea-wallet-browser-results.json) | Five checks passed with fixture funding, actual offline cryptography, aborted storage commit, concurrent tabs and responsive layout. |

The affected Node protocol/relay/quote/receipt suites pass 33 tests. The existing offline tUSD browser suite was rerun: eight checks passed. Tests use disposable identities. No user wallet was reset and no real funds were used.

## Reproduce

From the project root:

```powershell
./tooling/build-near.ps1 -Contract adapter -Action test -Offline
./tooling/build-near.ps1 -Contract adapter -Action wasm -Offline
./tooling/check-adapter-mutations.ps1
node --test web/rhea-relay.test.mjs web/rhea-protocol.test.mjs web/near-protocol.test.mjs contracts/client.test.mjs integrations/quotes.test.mjs web/defi-relay.test.mjs
# Set NODE_PATH to your local test-tools node_modules directory.
node web/rhea-wallet-browser.test.cjs
```

The isolated browser test writes a public Edge signature fixture used by Rust. It never exports private keys. `node contracts/adapter-flow.mjs` resumes the recorded testnet cases; it queries chain state before advancing and skips completed cases. Preserve its evidence and disposable keys. `node web/rhea-wallet-live.test.cjs` runs a new disposable browser flow against the running local server and consumes a new test grant.

`node contracts/adapter-deploy.mjs` deploys only the dedicated disposable adapter. It rejects changed Wasm or unrecorded existing code. It does not upgrade the reserve. Full-access test deployment keys remain in ignored `contracts/.testnet/`; this is an explicit upgrade/custody trust boundary, not a production key policy.

NEAR's old `rpc.testnet.near.org` endpoint returned a deprecation/429 error mid-run. The shared client now uses `https://test.rpc.fastnear.com`, from the [official provider list](https://docs.near.org/api/rpc/providers). The resumed run used the existing order and preserved the failed attempt in its evidence.

## Limits and next requirements

- October 30: [receipt recovery](../../research/rhea-receipt-recovery.md) now journals the exact signed hash before broadcast and checks final receipt graphs through the read-only status route. A reproduced contradictory-summary bug was fixed. [Verification](recovery-verification.json) records 43 Node tests, 11 browser checks, four detected guard removals and eight fresh historical RPC checks. This does not repair missing contract callbacks or unlock reservations.
- All swap terms are public on NEAR. This adapter is not private settlement or native shielded Zcash.
- The deadline limits swap dispatch. The existing reserve redemption signature has no expiry, so a local timer never releases its input. A late order is redeemed and refunded to its signed receiving account.
- Refunds are ordinary NEP-141 tUSD at that account. The [backed-deposit flow](../upgrade/README.md) can now return them to a fresh offline root for the local test receiver. Other receiving accounts require their own NEAR signer; the old swap note is never restored.
- Malformed, oversized or ambiguous deposit/withdrawal results enter `attention`. Missing callbacks may leave an in-flight stage. The deployed adapter recovers only `redeeming` using the reserve's exact record; all other missing-callback/`attention` cases remain locked. A balance difference or off-chain receipt alone cannot authorize a payment.
- A failed final payout remains retryable after the receiving account accepts the token. Rhea's account/exchange code hashes are checked by the local relay.
- The server carries signed actions and sponsors bounded testnet calls. It is local-only with host/origin validation, not a public relay service.
- Full NEAR/Rust security review, safe recovery, phones and production keys remain open. These checks are not an audit.

See [authorization/accounting](../../research/rhea-authorization.md) and [development status](../../docs/status.md).
