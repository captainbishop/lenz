# Security verification and failures

## November 2: dependency cleanup and recipient verification

The [latest dependency report](dependency-cleanup-2026-11-02.md) supersedes the
earlier advisory counts below. The empty-authentication helper now has one
dependency and zero advisories; proof tooling has 15 low entries. Both NEAR locks
retain crypto-bigint, lru and two maintenance warnings after zstd patches.
Verification passes 26 authentication/quote/route/receipt tests, seven new auth
alterations, 28 proof/provenance/dependency/worker tests and 16/26 native contract
tests. Both Wasm builds pass. Twelve saved browser/metadata file hashes and seven
original proof artifact hashes match. The report preserves the initial glob
failure and the unexplained difference from older cached Wasm targets.

The [read-only recipient module](../../carrier/defi-results.md) checks encrypted
executor reports against original approvals and independent final-block reads.
The combined suite passes 21 tests with 18 detected alterations. Its initial
missing test import and mutation-runner diagnostic mismatch are recorded.
No wallet activation, deployment, live authentication or financial action ran.
The earlier sections retain their historical scope and counts.

## November 2: executor and broad component review

The [current security review](review-2026-11-02.md) records three reproduced
executor/intake defects, a relay cancellation race and their checked local fixes.
Intake passes 18 tests with 13 detected guard alterations; executor passes 18 with
11 detected alterations. The relay cancellation regression fails without its
new guard. App cache v41 preserves identity, encrypted vault and reservations
through failed and successful updates. Seven preview playback checks pass.

The [dependency advisory snapshot](dependency-audit-2026-11-02.json) records 52
affected-package entries in the experimental Intents SDK tree and 24 in proof
tooling. Six other trees report zero advisories. All eight installation-policy
checks pass after adding the missing relay-tools policy file. These claims have
different scopes; no dependency versions or locks changed in that initial scan.
The later [proof-tooling remediation](proof-dependency-refresh-2026-11-02.md)
updates only `ws` and `underscore`. Its current lock has 20 affected-package
entries (15 low, five moderate, zero high or critical); Intents remains unresolved.
The later [Intents protobuf update](intents-protobuf-refresh-2026-11-02.md)
removes that tree's critical entry while preserving SDK 0.93.0. Its current lock
has 50 entries (22 low, ten moderate, 18 high), with 25 local compatibility and
quote/route tests passing. The reproduced dependency injection fails its safety
assertion before the update and passes afterward. Product signing remains held.

The twelve Solidity specialty passes and eight preparation areas are now reviewed;
two verifier investigation leads remain without a demonstrated exploit. Saved
Slither output and its provenance limits are recorded separately. RustSec scans
find the same four advisory IDs in both NEAR locks and none in the tracked Zcash
inspector lock. The packages behind those four NEAR matches are absent from the Wasm
normal/build trees; native-test exposure and separate maintenance/unsound warnings
remain unresolved. See the [Rust snapshot](rust-dependency-audit-2026-11-02.json).

Native Rust, local EVM, browser protocol/policy and Zcash review evidence is
listed by component in the review. The default 105 Aurora tests are separate
from the explicit Solidity proof check. The combined Zcash/security run's npm
cache failure, the 100-ms relay test timeout and the repeated 90-second offline
proof timeout are retained with their later passing checks. The proof timeout
remains unexplained. No live financial action or publication occurred.

## October 31: shared offline social payments

The ordinary chat payment/import path now uses the tUSD wallet and saves encrypted history with the same atomic balance update. [Scope and failure record](../offline-social-money.md), [source/report hashes](../offline-social-verification.json). Fresh checks: 54 Node tests, 50 browser checks and 41 static routes. Tests cover contract/participant/signature binding, duplicate/competing payments, existing swap reservations, failed commits, earlier wallet imports and offline onward transfer. The integrated three-profile browser scenario records zero API calls with fixture initial backing; no new chain or real-fund action occurred.

The initial browser startup failed on a shadowed function name, then passed after the rename. Two test assumptions were adjusted: one selector matched a preview and a message, and the legacy suite needed to open Earlier prototype before reading its hidden balances. No security or solvency conclusion follows from the UI work. Existing release/key, recovery, privacy and device requirements and the original proof timeout remain open.

## October 31: configured recovery release

The unchanged recovery candidate is deployed to `lenz-rhea-1792987934062.testnet`. One final deploy-only transaction preserved **all 13 entries**, including six existing terminal orders. No new funding, token movement, initializer or key change was submitted. [Release review](../../contracts/adapter/redemption-recovery/rollout-review.md), [full receipt/state journal](../../contracts/adapter/redemption-recovery/rollout.json), [five deployment/follow-up checks](../../contracts/adapter/redemption-recovery/rollout-verification.json).

Fresh verification: **42 Node tests**, **11 disposable Edge wallet checks**, **three refund-return browser checks**, **four receipt guard mutations**, **four upgrade guard mutations**, **39 static cache routes**, and **three live HTTP checks**. The HTTP test uses one existing refunded order; the new recovery route returns its unchanged final status without signing. Browser recovery/funding/RPC data are fixtures. Actual missing-callback recovery was exercised in the earlier isolated rehearsal, not injected into the configured adapter. [Checkpoint hashes and commands](../../contracts/adapter/redemption-recovery/rollout-checkpoint.json).

The extra upgrade retry regression first failed: a saved nonfinal response prevented a fresh status query. Resume now rechecks that saved hash without signing again, and the regression/mutation pass. The first upgrade mutation harness expected the wrong diagnostic for an artifact guard removal; the test correctly detected that it reached the signer. Corrected only the harness diagnostic.

Initial planning reads failed before saving a plan or transaction. A later bounded retry succeeded. A server reload attempt failed with EADDRINUSE; the recorded restart error is retained separately. The subsequent HTTP checks passed.

This is a same-workspace testnet release review. Independent release approval, protected signing/upgrade authority, other missing-callback stages, account recovery, Zcash/privacy, external signer/provider availability and Intents access remain open. The original offline-proof timeout file remains unchanged and unexplained.

## October 31: isolated live callback and upgrade rehearsal

The exact candidate passed **27 rehearsal checks across 28 final testnet transactions** on fresh reserve/adapter accounts. All **seven** old adapter state entries survived the code-only upgrade. An actual 1-tUSD reserve transfer survived an explicitly injected callback failure; overlapping recovery and original-callback races could not double-credit it. Refunds reached the signed recipient once. A constructed original-callback replay after payout and forged callback were rejected. [Full scope, receipts and failure history](../../contracts/adapter/redemption-recovery/rehearsal-notes.md).

Five additional [offline receipt checks](../../contracts/adapter/redemption-recovery/rehearsal-verification.json) found exactly three redemptions and three refunds, each 1 tUSD, with no transfers during recovery/replay/retries. Six failed execution receipts were intentional test controls. Final recipient balance and supply both equal 3 tUSD; adapter and reserve balances and reserved liability are zero. The candidate itself did not change, so earlier native/mutation suites were not rerun.

The test fixture's first compile failed on an unnecessary Rust conversion; restricted network access then blocked the initial RPC request. Two script errors were corrected after preserving progress: JSON serialization of SDK `BigInt` values and an SDK action-name mismatch. Funding and deployments were reused rather than repeated. This isolated rehearsal did not change the configured Lenz contracts, public config or user profile. The subsequent configured rollout is recorded above; other callback stages and the original offline-proof timeout remain open.

## October 31: missing redemption callback candidate

The [local adapter candidate](../../contracts/adapter/redemption-recovery/README.md) adds a reserve-record query and private callback for orders stuck at `redeeming`. It restores `funded` only when the record exactly matches the signed input/receiver/nonce and the current stage is still `redeeming`; recovery sends no token movement. Fresh checks: **26 adapter tests**, **16 reserve tests**, **six detected guard changes** and the **locked Wasm build** passed. [Verification and source/artifact hashes](../../contracts/adapter/redemption-recovery/verification.json).

The first new test harness did not compile because the SDK's `PromiseResult` is not cloneable. Corrected fixtures then produced three expected behavioral failures against nonfunctional recovery stubs before the implementation passed. Failure logs are retained. NEAR's cross-contract docs were retrieved; the SDK docs page was inaccessible, so the pinned local source supplied that API evidence. No contract deployment, chain transaction or live/browser check ran. The candidate preserves state declarations but has not undergone an actual upgrade/state-preservation rehearsal. The current wallet/configuration remains pinned to the old deployed adapter; broader missing-callback recovery stays open.

## October 31: offline timeout diagnostics

The [timeout investigation](proof-timeout.md) verifies the test-only diagnostic instrumentation. Fresh evidence: **25 offline browser checks** passed in **26.241 seconds** under the original 90-second limit; **nine worker/build tests**, **two detected worker mutations**, **44 static cache routes** and both test-file syntax checks passed. A deliberately shortened 10-second run exited with failure and preserved the unfinished proof and diagnostic samples. This is an expected failure-report control, not a reproduced 90-second timeout.

Three earlier diagnostic runs also passed in 56.911, 49.866 and 41.354 seconds. These are recorded runs. The [review record](proof-timeout-review.json) records report/source hashes and scope. **The original intermittent timeout remains unexplained and its failure file is unchanged.** No product-code fix or performance guarantee follows from these runs. No wallet, signer, chain, deployment or funding checks were repeated.

## October 30: browser policy and security model

October 30, 2026. The worker regression checks and browser policy were verified. External wallet integration and an external security audit remain incomplete.

## Recorded checks

| Check | Observed result | What it establishes |
| --- | --- | --- |
| Nine targeted Node suites | 66 passed, zero failed | Dependency-metadata guards and design counterexamples; worker-build behavior and existing worker error handling; popup identity checks; signed return/reservation and receipt validation. |
| Real npm installation control | 1 passed after approved cache access | A harmless local package's lifecycle marker is absent under the project policy and appears when that policy is deliberately disabled. No registry package or malware is installed by the test. |
| Browser build | `node build.mjs` in `web/` exited zero | Existing test-only circuit artifacts passed their recorded hash checks; browser assets and the external worker were generated. No new proof parameters were created. |
| Static checks | 44 proof-cache routes; 39 chat-cache routes | Referenced files/imports and icons exist. The proof subworker must be cached. |
| [Browser policy](../../web/security-browser-results.json) | 3 passed | Foreign framing and inline-script/unapproved-connection probes are blocked; a disposable identity survives offline reload. |
| [Cache upgrade](../../web/security-upgrade-results.json) | 4 passed | A deliberately failed root-worker update preserves the old offline copy; retry refreshes cached policies and worker assets, retaining identity and earlier demo storage. |
| [Standalone tUSD wallet](../../web/near-wallet-browser-results.json) | 8 passed under the policy | Zero initial balance, offline A → B → C, duplicate/tamper rejection, failed storage commit, encrypted vault and view changes. Funding and RPC are fixtures. |
| [External signer lab](../../web/near-signer-browser-results.json) | 8 passed under the policy | Exact bounded action, saved request before signing, cancellation, wrong account, forged callback, final-backing-only credit and offline reload. Meteor, RPC and chain responses are fixtures. |
| [Online proof checks](../../web/security-proof-results.json) | 23 passed in 38.689 seconds | Actual test-only PLONK proofs and onward transfer under the security policy; zero policy violations. |
| [Offline proof checks](../../web/security-proof-offline-results.json) | 25 passed in 39.949 seconds on the diagnostic rerun | Cached document policy, actual proofs, onward transfer and rejected uncached requests before/after proving, with Edge network emulation. Two proofs took 20.022 and 19.527 seconds. |
| Dependency inventory | Seven lockfiles passed [metadata checks](dependency-check.json) | No match for this checker's reported malicious packages/versions or source/integrity/pinning rules. It is not a package-code audit or host scan. |

There are 67 targeted Node tests including the npm experiment. Browser policy, upgrade, wallet, signer and offline proof suites total 48 checks; the separate online proof run repeats 23 of those proof assertions. Counts are not security coverage percentages. All browser runs used disposable Windows Edge 156.0.4314.50 profiles. No physical phone, Safari, BLE, live external signer, new chain transaction, deployment or real-fund action ran.

## Failures retained and their meaning

- The earlier policy change blocked the pinned ffjavascript library's `data:` worker. The prior control without CSP passed. The build now extracts the same worker implementation into a same-origin file, without broadening script evaluation. Tests compare its bytes with the pinned dependency and reject missing, duplicate or changed declaration layouts.
- The first two build-test assertions were incorrect. One altered an unrelated function occurrence; the other stopped at the semicolon inside a data URL. The tests were corrected to target the worker declaration and preserve complete source text. All three build checks then passed. These were test bugs, not silent passes.
- The first offline proof run exceeded 90 seconds during the second proof, after its first proof and receipt checks passed. [Failure record](../../web/security-proof-offline-timeout.json). There were no recorded CSP violations. The online comparison passed in 38.689 seconds. A diagnostic offline rerun allowed 180 seconds, recorded failing request URLs, and passed in 39.949 seconds without product-code changes. **The original intermittent timeout is unexplained.** A longer allowance is not a demonstrated performance fix; retain this regression case for latency investigation.
- Failed uncached `server-probe` requests in the successful offline report are required evidence of emulated network unavailability. The existing favicon 404 is cosmetic and remains in diagnostics. No unexpected page exception or proof-policy violation occurred in the successful runs.
- The npm test first failed with `EPERM` creating the global npm cache directory. The approved rerun passed. The initial command's exit status was one, not a successful security check.
- The browser build is invoked directly from `web/`; that directory has no `package.json`.

## Reproduce

Run from the project root unless specified:

```powershell
node --test web/build-proof-worker.test.mjs web/proof-worker.test.mjs web/meteor-popup.test.mjs web/near-signer.test.mjs web/near-deposit.test.mjs web/rhea-protocol.test.mjs contracts/adapter-recovery.test.mjs research/security/check-dependencies.test.mjs research/security/composition-model.test.mjs
node --test research/security/install-policy.test.mjs
node research/security/check-dependencies.mjs
node web/verify-static.mjs
node web/verify-chat-static.mjs
# Set NODE_PATH to your local test-tools node_modules directory.
node web/security-browser.test.cjs
node web/security-upgrade.test.cjs
node web/near-signer-browser.test.cjs
$env:LENZ_LIVE_TESTNET='0'
node web/near-wallet-browser.test.cjs
node web/security-proof.test.cjs
$env:LENZ_PROOF_TEST_TIMEOUT_MS='180000'
node web/security-proof.test.cjs --offline
```

Run `node build.mjs` from `web/` to rebuild. The policy and proof browser suites expect the existing local Lenz server at `http://127.0.0.1:4173`; the other browser suites create their own local fixture server. The offline proof switch disables browser networking after cache preparation; it does not shut down the server or physically disconnect the host. `--without-csp` is a diagnostic control only and cannot be combined with `--offline`.

The [behavior and safety boundaries](../../docs/behavior.md) document open release, custody, recovery and privacy requirements. No comparative security ranking or complete security coverage follows from these tests.
