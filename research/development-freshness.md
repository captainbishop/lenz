# Development freshness review

November 1 Aurora dependency review: pinned EthereumJS replaces the local Hardhat
runner and removes Zod from the clean installation and lockfile. The fresh npm
audit has zero findings. Fourteen Node tests, three VM guard-removal controls,
both contract compilations, the local state/event probe and the existing proof
checks pass. Proof gas, calldata length, runtime size, verifier and circuit hashes
match the recorded measurement. [Verification](../aurora/dependency-resolution.md).
No Solidity, browser, cache or preview source changed, and no deployment, funding
or network transaction ran. The remaining Aurora adapter/asset-route work and all
other integration, privacy, recovery and device requirements remain open. The
older audit observations below describe the dependency tree at those checkpoints.

November 1 Aurora network-reader review: the two read-only network queries now
enforce a streamed 16-KiB reply limit, a deadline through the response body,
matching JSON-RPC IDs and canonical integer results. Seven tests and three removed
guard controls passed; an actual read-only request returned the expected testnet
ID. [Reader evidence and limits](../aurora/rpc-validation.md). The initial sandbox
network failure remains distinguished from the authorized successful read.
The dependency audit still reports four high findings; a compatible patched
Hardhat/Zod combination has not been established. Package versions and locks,
contracts, web sources, caches and preview media are unchanged. This check does
not extend offline payment, privacy, Zcash, Rhea or Intents execution evidence.

November 1 offline delivery review: chat and wallet can generate, reopen and verify
an encrypted acknowledgement of an exact saved file. Delivery status remains
separate from money confirmation; receipt handling leaves vault bytes unchanged.
Chat now removes the download action on a conflicted payment card, matching the
wallet. [Receipt behavior and evidence](../docs/delivery-receipts.md) records 55 Node
tests, eight new browser checks and four rejected guard removals. Existing social,
confirmation and wallet checks passed (9, 13 and 8 respectively), plus two cache
upgrades. The new module is cached in `proof-u-chat-v30-delivery-receipts`.

Both themes and narrow/landscape layouts were checked. Receipt, pending-confirmation
and confirmed-payment captures were visually reviewed. The existing recorded flow
was replayed through current renderers with all three stored accounts unchanged.
All six videos were rendered; 22 sampled frames were reviewed. Five playback,
three screen-response and five homepage checks passed. All 48 app cache routes
resolve, and the recording/source hashes match the updated homepage cache.
NEAR contracts, Rhea, Intents, Aurora, Zcash and proof code are unchanged; their
partner-access, signing, recovery, private-settlement and device gates remain open.
Receipt tests use fixture backing and no financial requests. They do not extend
the earlier live settlement evidence or prove automatic mesh delivery.

November 1 unsigned Zcash output review: the developer page now verifies recipient,
amount, fee, commitments and owned change through the pinned read-only native
inspector. Seven actual Edge checkpoints and final native controls inspected one
unsigned test request; output verification passed and the separate network result
was expired. The request was discarded. Both native balances and transaction
histories match pre-feature evidence. [Output verification](../zcash/payment-effects.md)
records the dummy-signature, fixture-value, report-format and dependency failures.

Forty Node tests, three Rust tests, ten fixture browser checks, six removed output
guards and four expiry guards passed. Light/dark result cards were visually reviewed;
layout checks cover narrow and desktop widths. Dark button borders remain visible. Two cache
upgrade checks preserve identity, vault and reservations with
`proof-u-chat-v29-zcash-output-review`. All 47 static routes resolve, and the six
homepage preview source/video/poster hashes still match: this developer page is
outside those recordings. No preview recapture or financial replay was needed.

NEAR, Rhea, Intents, Aurora and proof code are unchanged. The current component
status retains partner access, external signing, private settlement, recovery and
device gates. Zcash input availability, current witnesses, complete note-encryption
validation, signing approval and submission recovery remain open. Older dated
reviews below retain their original observations.

November 1 live payment-failure review: seven live checkpoints verified actual
NEAR response-loss recovery and a deliberately conflicting offline branch passed
onward. The wallet now identifies its conflicted outgoing file and removes its
download button. [Evidence and limits](payment-status.md) include the original
display failure, pre-submission relay failures, final transaction and unchanged
backing. Four saved-evidence checks and four altered-record controls passed.

Regression checks passed: 25 Node tests, 13 payment-status browser checks, two
cache-upgrade checks, eight wallet checks and nine offline-social checks. The new
outgoing-state assertion failed before the fix. Light/dark conflict cards fit at
375 and 1280 pixels. App cache `proof-u-chat-v28-conflicted-outgoing` preserves
existing storage namespaces, identities and swap reservations.

All six previews were rendered from the saved flow with no financial requests;
the replay preserved the three existing accounts. Twenty-two sampled composition
frames and both new conflict screenshots were visually reviewed. Five playback,
three screen-response and five homepage checks passed; 47 static cache routes
resolve. The encoder initially returned `ENOENT` in the restricted environment,
then rendered successfully with access to the installed executable.

NEAR contracts, Rhea, NEAR Intents, Aurora, Zcash and proof implementations are
unchanged. Their private-settlement, signing, partner-access, recovery and device
requirements remain open. This review closes the bounded live conflict/interruption
evidence gap, not those wider integration requirements. Older dated reviews below
retain the evidence available at their respective checkpoints.

November 1 pending-confirmation review: chat and wallet persist an attempt before
submission, display it after reload, and separate status reads from an explicit
retry of the same signed payment. [Behavior, checks and limits](payment-status.md)
cover 25 Node tests, 12 fixture browser checks, two removed-guard controls and two
cache-upgrade checks. The app cache is `proof-u-chat-v27-pending-confirmation`.
This does not complete live conflict/interruption evidence, recovery or private
settlement. NEAR contracts, Rhea, Intents, Aurora and Zcash implementations are
unchanged; their open gates below still apply.

The offline wallet's eight browser checks and nine social-flow checks passed.
All six previews were rendered again from the recorded flow without financial
requests; the replay preserved all three stored test accounts. Five playback checks,
three screen-response checks and five homepage checks passed. Twenty-two sampled
composition frames and the new pending-state screenshots were visually reviewed in
both themes. The preview refresh initially stopped because the local server was
unavailable; it completed after the server was started.

November 1 documentation review: component summaries distinguish the confirmed native Zcash transfer, unsigned browser review, configured Rhea recovery and remaining integration work. Dated reports retain their original test results and failure evidence. Application, contract and circuit code and recorded media are unchanged by this documentation review.

October 31 payment-status review: chat and wallet now share receipt validation, status checks and confirmation. [Evidence and retained failures](payment-status.md) cover 25 Node tests, 41 grouped Edge checks, cache preservation and a read-only check of six live notes. The new cache includes the shared status module. Six light/dark previews were refreshed by presentation replay with all three stored test accounts unchanged. Live browser conflict/interruption evidence remains open; no contract, Rhea, Intents, Aurora, Zcash, proof or recovery implementation changed in this pass.

Reviewed October 31, 2026. NEAR, Rhea, NEAR Intents, Aurora, Zcash, private settlement and recovery remain active requirements. Progress in one does not complete or defer the others. [Development status](../docs/status.md) records scope and missing prerequisites.

| Area | Evidence checked against the implementation | Remaining gate |
| --- | --- | --- |
| Chat and wallet | Current renderers share identity and tUSD state. [Live social evidence](offline-social-live.md) records funded offline/onward payments and NEAR settlement. Homepage videos now replay a separately verified, existing-funded offline/onward flow and private message handover through current renderers in both themes. Profile clips use fresh zero-balance accounts; see [preview evidence](preview-motion.md). | Recovery, target-device behavior and the broader privacy guarantees remain open. |
| NEAR reserve | [Deposit upgrade](../contracts/upgrade/README.md) preserved 74 existing state entries. Current reserve/config and saved social evidence agree on the testnet contract. | Public settlement still exposes amounts and ancestry. External wallet signing remains unverified after Meteor's recorded 403. |
| Rhea | [Configured recovery rollout](../contracts/adapter/redemption-recovery/rollout-review.md) matches the configured adapter/code hash. Signed swaps, refunds and backed return have testnet evidence. | Other callback stages, external refund signing, aggregate liabilities and independent release approval. |
| NEAR Intents | Installed SDK, authenticated empty payload and fixture quote-signature checks are separate from the [failed confidential quote](../integrations/README.md). | Partner key, supported funded route, live provider signature, signed confidentiality binding and execution/refunds. Testnet tUSD is not a mainnet route. |
| Aurora | [Local EVM and verifier evidence](../aurora/README.md), configured chain ID and package locks exist. The EthereumJS toolchain removes Zod and passes a zero-finding npm audit. | No Lenz Aurora deployment, asset/execution adapter or separate Aurora Intents connection. |
| Zcash | [Native shielded transfer](../zcash/pczt.md) is confirmed. [Unsigned browser review and expiry check](../zcash/payment-freshness.md) are separate; the checked saved payment was expired. | Browser signing approval, current witnesses, safe recovery, ambiguous submission and the shielded ZEC/DeFi route. |
| Private settlement and recovery | [Behavior and safety boundaries](../docs/behavior.md) and existing local proof evidence retain their limited scope. | Full graph-hiding settlement, recipient-controlled authority, durable recovery/reconciliation and actual device measurements. |

This review corrected obsolete funding/integration claims in the homepage, chat About panel, earlier proof page, integration overview and research notes. Historical experiments are labelled by scope, not rewritten to imply capabilities they lacked. Failed requests, the proof timeout and build provenance retain their recorded outcomes. Financial flows were not repeated to make evidence look recent.

## Apply this to every development phase

1. Read the active acceptance criteria and prerequisites for **all** affected components. Inspect source/config and the evidence behind a status claim; a passing fixture, installed SDK or screenshot is not live execution.
2. Update current UI copy, component documentation, development status where behavior or a blocker changed. Keep historical results dated and linked. List unverified paths explicitly.
3. Refresh affected recordings after UI/module changes. Run the relevant behavioral checks, cache checks and video playback/theme checks. Change the appropriate service worker when cached content changes; verify an existing cache can update without altering identity or reservations.
4. Run `node tooling/check-freshness.mjs`. It detects changes across the tracked component sources, configs, tests, JSON evidence and documentation since this review. Inspect the changed areas and update this review before using `--record` to acknowledge them. Recording hashes does not run tests or establish correctness.
5. Before committing, review the exact staged paths/diff. The pre-commit hook checks the staged freshness record and preview provenance in addition to the existing publication/secret scan. Commit real product work and supporting evidence under the author's configured identity. Keep installed dependencies, private accounts, assistant tooling and local administration out of Git.

The automated gate detects content drift, including less-visible components. The publication check also scans saved prompt fields, embedded binary strings and partially redacted machine paths; its regression tests cover staged bytes, committed history and reporting without exposing matched credentials. These checks cannot decide whether a statement is true, detect new upstream vulnerabilities or certify a changing provider/deployment. Those still need targeted inspection and dated evidence. Never refresh evidence by repeating funding, deployment or a completed financial flow without a new scoped reason.

## Video previews

`node web/record-preview-videos.cjs` renders six silent 600 × 660, 30-fps H.264 clips. Chat and payments use the [verified source flow and read-only presentation replay](preview-motion.md); profile editing uses fresh zero-balance accounts. Rendering sends no financial request. Original captures, edited frames and receipts are distinct in the evidence. The installed encoder, private checkpoints and intermediate media remain ignored. Use `--frames` to review the compositions before encoding.

The homepage loops the matching video for its theme and selected panel. It has one small pause/play button per video, pauses videos when off-screen or hidden, and respects reduced motion. A viewer's account is never opened by playback. There is no embedded wallet or broadened framing permission.

`node web/verify-preview-videos.mjs` checks video/poster hashes against the recorded source snapshot and checks the homepage's cache revision. After recording or changing homepage code, `--update-cache` updates the worker marker only after these media/source checks pass. The staged freshness gate checks the same source and media provenance. It cannot replace visual review: watch the clips and inspect both themes before publishing. The freshness gate now includes source PNGs, so an altered capture also requires review.

`node web/video-previews.test.cjs` checks actual decoding/playback, theme/tab switching, pause behavior, narrow layouts, offline playback and unchanged existing account data. [Recording evidence](../web/preview-recording.json) and [browser checks](../web/video-preview-results.json). Windows Edge coverage is not evidence of Safari/iPhone or Android behavior.

The October 31 preview correction restores pointer tilt on a stable parent region and keeps controls outside the transformed surface. It fixes the actual app’s dark payment-state contrast and advances the app worker cache version. New browser coverage checks six viewport sizes in both themes, stationary controls and reduced motion. Read `preview-motion.md` for the source run, replay boundary and retained capture failures. No contract, Intents, Aurora, Zcash, proof or recovery code changed in this pass; their gates above remain open.
