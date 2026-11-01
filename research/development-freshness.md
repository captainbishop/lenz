# Development freshness review

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
| Aurora | [Local EVM and verifier evidence](../aurora/README.md), configured chain ID and package locks exist. | No Lenz Aurora deployment, asset/execution adapter or separate Aurora Intents connection. Dependency findings remain unresolved. |
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
