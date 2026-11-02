# Development freshness review

## Wallet display controls, November 2, 2026

The shared Lenz ID dialog uses accessible share, copy and download icons. The
wallet eye button masks balances, payment amounts and saved-swap amounts, with a
browser-local preference that survives tabs and offline reloads. Transaction inputs
and approval amounts remain visible. This changes display privacy, not chain
visibility, payment authorizations or storage encryption. Readiness notices clear
after 3.5 seconds; subsequent errors cancel that timer and remain visible.

[Five visibility checks](../web/wallet-visibility-browser-results.json),
[three ID checks](../web/lenz-id-browser-results.json),
[five wallet checks](../web/money-browser-results.json),
[eight offline payment checks](../web/near-wallet-browser-results.json) and
[two cache-upgrade checks](../web/near-payment-cache-results.json) pass in disposable
Windows Edge contexts. The local swap fixture uses integer base units. Keys,
encrypted vault bytes and outstanding reservations are preserved. Funding responses
in the handover suite are fixtures; no live funding or settlement ran.

The app cache advances to v40. All six Hyperframes composition checks and decoded
video checks pass; seven homepage playback checks cover both themes, gestures,
keyboard, reduced motion and offline use. The ID preview uses the same three symbols.
The saved flow replay preserves its three test accounts and original payment
receipts. The regenerated videos bind 53 presentation sources. Reviewed screenshots
show the icon row and masked wallet in both themes. Backend, contract, Aurora and
dependency-lock sources are unchanged.


## Aurora token-transfer receipts — November 2, 2026

A read-only developer checker binds independent token/from/to/amount expectations
to exact direct-transfer calldata, final successful receipts, canonical true return
and one matching Transfer event. False, absent, malformed and mismatched evidence
cannot become a reported transfer. It changes no journal state or wallet balance.

The full suite passes 105 Aurora tests and one independent SDK check. Eleven new
transfer guard alterations are detected, alongside the existing 24 submission and
receipt controls. Fourteen transfer checks include actual local Solidity/EVM
execution and balance reads. A deliberately dishonest token reports the matching
event without moving balances; [verification and limits](../aurora/engine-transfers.md)
retain that counterexample. Matching events require token/code trust before any
settlement decision. The surrounding NEAR receipts are synthetic, and no live
transaction or funding ran. App, contract, carrier, dependency-lock and preview
sources remain unchanged; their recorded preview provenance remains applicable.


## Aurora access-key preflight — November 2, 2026

The submission journal now checks the exact signed account/key at finality before
broadcast. Restricted receiver/method, nonce bounds, exhausted allowance and
invalid or unavailable evidence stop dispatch without replacing the saved call.
Receipt recovery remains available after revocation. A reproduced reporting race
now gives a concurrent final receipt priority over a failed key check.

The full Aurora suite passes 91 tests plus one independent SDK check. Sixteen
submission and eight receipt guard removals are detected. [Access-key evidence](../aurora/engine-access.md)
records the local and loopback HTTP scope, fixture corrections and remaining
permission/approval boundaries. Verification rejects input changes during a run.
No live transaction, key change, funding or wallet operation ran. Web, preview,
contract, carrier and dependency lockfile sources remain unchanged; their existing
preview provenance remains applicable. User approval binding and funded Aurora
execution remain open.


## Aurora submission recovery — November 1, 2026

The developer journal validates a signed Engine call and commits it before
broadcast. Restart recovery checks the original hash; explicit retry can resend
only the original bytes after checking status. Two reproduced resend regressions
now pass. The complete Aurora suite passes 79 tests, with one additional pinned
NEAR SDK interoperability test. Nine submission and eight receipt guard removals
are detected. [Reproduction and limits](../aurora/engine-submissions.md) and
[source-bound results](../aurora/engine-submission-results.json) describe SQLite
write failures, child-process termination, concurrent access, CLI checks and real
loopback HTTP alongside synthetic receipts.

Aurora status and setup documentation reflect this developer-only capability.
Account authorization, deployment, a funded route and payment-effect verification
remain open. There was no live chain submission, funding or wallet-state change.
Web, contract, dependency lockfile, carrier and preview sources are unchanged;
existing preview provenance remains applicable. This step adds no UI controls.


## Recipient-specific delivery status — November 1, 2026

Chat and wallet show nearby delivery only for the paired recipient. Changing
contacts, refreshing the wallet or disconnecting updates the controls. An active
nearby route stays visible when the browser reports no internet. Carrier and
public-relay consent and send-time checks are unchanged; payment confirmation
remains separate.

The new regression failed on the previous implementation: selecting an unpaired
contact displayed Send. After the fix, eight nearby browser checks and eight
protocol tests pass. Eleven carrier and ten public-relay browser checks pass.
Both cache-upgrade checks preserve identity, encrypted vault and a pending
reservation; the first run exposed a stale expected cache version in the test,
which was corrected before the passing run. The app worker is
`proof-u-chat-v39-delivery-status`, with 68 cached routes and all static module
dependencies present. The optional Meteor adapter loads only for internet-gated
wallet actions.

Six checked preview compositions were exported and visually reviewed in both
themes. Their 3.02 MB of videos match 53 recorded source files. Seven video and
five homepage checks pass, including offline seeking, direct gestures, theme
changes, reduced motion and narrow layouts. The saved payment replay preserves
all three stored accounts and makes no financial request.

These checks use disposable Windows Edge profiles and fixture-backed payments.
No physical-phone test, new live settlement, funding or deployment ran.

November 1 conversation delivery review: chat Send, chat Pay and wallet Send
request automatic delivery after saving their encrypted packet when the existing
carrier preference is enabled. They retain manual file sharing when it is off.
Eleven local carrier browser checks cover the send actions, offline reload,
recipient acknowledgements and cross-tab opt-out. Fifty-five payment, receipt,
message and legacy protocol Node tests pass; the separate freshness regression
also passes. Five browser compatibility checks preserve existing demo records
while rejecting new imports, including when testnet configuration is unavailable.

The app removes demo funding/trading controls and adds a local conversation
wallpaper in both themes. Existing identities, vaults and archived messages remain
intact. Thirty page/theme/viewport combinations, enlarged text and keyboard
navigation pass. Two cache-upgrade checks preserve an encrypted vault and pending
reservation through failed and successful upgrades. The current worker is
`proof-u-chat-v34-conversations`, with 58 cached routes. SVG files now participate
in source freshness checks and preview provenance. Contract execution, private
settlement and recovery capabilities are unchanged. The six light/dark preview videos
and their posters were visually reviewed against 59 recorded sources. The replay
preserved all three saved accounts and made no financial request.


November 1 naming and interface review: ENS Aurora-record lookup and native NEAR
account reads use final blocks and fixed public RPC endpoints. Verification passes
56 Aurora tests, six name API/display checks and four quote-API regressions. Six
removed guards are detected. Three live read-only naming observations are recorded
separately from nine Edge fixture checks. Both themes and desktop/narrow captures
were visually reviewed. [Name evidence](../aurora/names.md) documents missing and
off-chain records, RPC trust, ownership limits and the mutation controls.

The homepage, wallet, conversations, profile editor and developer pages use shorter
copy and expandable explanations. Payment warnings and carrier metadata disclosures
remain beside their actions. Input labels no longer receive the focus outline
intended for visually hidden file inputs. The app worker is
`proof-u-chat-v33-simpler-flow`. Both cache-upgrade checks preserve identity,
encrypted vault and the pending reservation. The preview captures were replayed
from the existing verified payment records; all three stored accounts were
unchanged and no financial action was repeated. Six light/dark videos and their
posters match 59 recorded sources. Name ownership binding, portable login,
signing and funded Aurora execution remain open.


November 1 Aurora receipt review: the read-only transaction checker matches the
expected call against a complete final receipt graph and decodes the returned
Engine result. Forty-three Aurora tests and twelve existing adapter-recovery
regressions pass. Eight deliberate guard removals are detected; the controls bind
the receipt source, tests and codec by hash. Actual loopback HTTP checks cover
redirect rejection and a stalled body. [Transaction evidence](../aurora/engine-transactions.md)
keeps fixture results separate from live execution and payment settlement.
The malformed-Engine-error classification failure and its regression are recorded.
No wallet, contract, dependency lockfile, cache, preview or carrier runtime changed.
Authorization, funded asset routing and durable payment recovery remain open.

November 1 container review: the carrier image includes the MIT license and pins
the verified Node base-image digest. Eight actual container checks verify its
contents, configured restrictions, encrypted custody, persistence and inbox
authentication. Compose configuration validation passes. [Container evidence](../carrier/container-results.json)
records the exact runtime source hashes. Application, wallet, contract and preview
sources are unchanged. Remote HTTPS, independent operators and load tests remain
open; the build failures are retained in [verification](../carrier/verification.md).

November 1 Aurora Engine review: call/view encodings, token mapping encodings and
bounded version-7 result decoding pass 23 tests with the existing Aurora suite.
Four removed codec guards are detected. The live read-only check reports the
expected chain ID and an empty successful EVM view; the configured tUSD mapping
is absent at the checked final block. [Interface evidence](../aurora/engine-interface.md)
retains the earlier query-shape failure and the source/deployed-code distinction.
No wallet, contract, cache, preview or dependency version changed. Authorization,
funded asset routing and settlement recovery remain open.

November 1 repository configuration review: shared exclusions cover build output,
generated browser assets and private runtime data. Dependency discovery follows
Git's file inventory and local exclusions while still checking tracked files.
The dependency-discovery and freshness regressions pass; all seven project npm
lockfiles pass metadata checks. Freshness now covers `.gitignore`. Application,
contract, cache and preview sources are unchanged in this configuration update.

November 1 carrier network review: opt-in delivery now sends new encrypted messages,
payment files and recipient receipts through configured independent carrier servers.
Six protocol/network tests, seven Edge carrier checks and three detected guard
removals pass. A three-hop route recovers after its middle carrier restarts; offline
onward payments remain available. The 33 affected Node regressions, nine social and
eight wallet browser checks, and two cache-upgrade checks pass. Identities, encrypted
vaults and expired reservations are preserved. [Verification](../carrier/verification.md).

The app worker is `proof-u-chat-v31-carrier-network`, with 52 cached routes. Both
themes and narrow/landscape delivery controls were visually reviewed. The existing
recorded flow was replayed through current renderers without changing any of its
three stored accounts. All six videos were rendered; 22 sampled frames were reviewed.
Five playback, three screen-response and five homepage checks pass. Source, poster
and video hashes match. The sandbox denied the existing encoder; the authorized
run completed. This presentation replay did not execute automatic carrier delivery.

New deployment files have a restricted Docker build context and are included in the
freshness gate. The gate also detects drift in Dockerfile, ignore, Compose, proxy and
example-environment files. Publication/freshness regressions pass. Carrier queues
and operator settings remain private. Remote hosting, ingress controls and device checks are still
required. NEAR, Rhea, Intents, Aurora, Zcash, private settlement and recovery code is
unchanged; no funding, deployment or financial transaction ran in this feature.

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
5. Before committing, review the exact staged paths/diff and run `node tooling/check-freshness.mjs --staged` to check the staged freshness record and preview provenance. Commit product work and supporting evidence under the author's configured identity. Review all outgoing commits for private information before pushing.

The automated gate detects content drift, including less-visible components. It cannot decide whether a statement is true, detect new upstream vulnerabilities or certify a changing provider/deployment. Those still need targeted inspection and dated evidence. Never refresh evidence by repeating funding, deployment or a completed financial flow without a new scoped reason.

## Video previews

`node web/record-preview-videos.cjs` exports six checked 1200 × 1320, 30-fps H.264 compositions. Chat and payments use the [verified source flow and read-only presentation replay](preview-motion.md); Lenz ID scenes use a fresh zero-balance account. [Rendering setup](../web/preview-rendering.md). Rendering sends no financial request. Original captures, edited frames and receipts are distinct in the evidence. The installed encoder, private checkpoints and intermediate media remain ignored. Use `--frames` to review the compositions before encoding.

The homepage loops the matching video for its theme and selected panel. Tap the left/right half of a preview to change scenes; hold to pause. Arrow keys navigate, and Space or Enter toggles playback. There are no separate playback buttons or decorative dotted path. Videos pause when off-screen or hidden and respect reduced motion. A viewer's account is never opened by playback. There is no embedded wallet or broadened framing permission.

`node web/verify-preview-videos.mjs` checks video/poster hashes against the recorded source snapshot and checks the homepage's cache revision. After recording or changing homepage code, `--update-cache` updates the worker marker only after these media/source checks pass. The staged freshness gate checks the same source and media provenance. It cannot replace visual review: watch the clips and inspect both themes before publishing. The freshness gate now includes source PNGs, so an altered capture also requires review.

`node web/video-previews.test.cjs` checks actual decoding/playback, theme/tab switching, pause behavior, narrow layouts, offline playback and unchanged existing account data. [Recording evidence](../web/preview-recording.json) and [browser checks](../web/video-preview-results.json). Windows Edge coverage is not evidence of Safari/iPhone or Android behavior.

The October 31 preview correction restores pointer tilt on a stable parent region and keeps controls outside the transformed surface. It fixes the actual app’s dark payment-state contrast and advances the app worker cache version. New browser coverage checks six viewport sizes in both themes, stationary controls and reduced motion. Read `preview-motion.md` for the source run, replay boundary and retained capture failures. No contract, Intents, Aurora, Zcash, proof or recovery code changed in this pass; their gates above remain open.

## November 1 internet delivery

[Public relay delivery](../docs/internet-delivery.md) adds a separate privacy choice,
standard NIP-59 wrappers around authenticated Lenz fragments, durable exact-event
retries and existing payment/receipt validation. Fifteen protocol/socket checks,
including a guard-removal control, pass. Disposable Edge evidence is separate from
the public relay acceptance/readback check. nos.lol and Primal accepted test
ciphertext; Damus failed to connect and offchain.pub refused it. The two working
services are the defaults. The fresh dependency audit reports zero advisories
after a transient registry DNS failure.

The app worker is `proof-u-chat-v38-nearby` with 68 routes. Failed and
successful upgrades preserve identity, encrypted vault and an expired reservation.
The existing three-carrier suite still passes eleven checks. No financial API,
funding, deployment or existing account migration is part of this transport work.
NEAR, Rhea, Aurora, Intents, Zcash, private settlement and recovery requirements
retain their existing scope. Public transport does not make asset settlement private.

## Lenz ID and product preview verification — November 1, 2026

Sharing now starts with a stable public Lenz ID. Four codec checks and three
browser checks verify both public keys, canonical encoding, typo rejection,
clipboard/paste, contact confirmation and an encrypted message round trip.
Nine existing profile checks and two cache-upgrade checks preserve identities,
encrypted history, vaults and reservations. No account-recovery claim is added.

Six Hyperframes compositions passed runtime, layout and contrast checks. Each
video has three or four distinct product scenes, rendered at 1200 × 1320. The
exporter checks UTF-8 text, decoded motion, scene regions, dimensions and duration.
All 22 decoded scene frames were reviewed in light/dark phone sheets. The six
files total 3.01 MB. Seven browser checks cover playback, exact offline seeking,
left/right taps, hold-to-pause, themes, visibility and unchanged account storage.
Edge touch emulation also checks cancellation and vertical scrolling without
accidental scene changes. Five homepage checks and three responsive-layout groups
cover both themes and six viewport sizes; physical phone testing remains open. The saved flow was replayed without
financial requests or changes to its three test accounts.

Public delivery also passed fifteen Node and ten browser checks with the final
contact UI, plus three browser security checks. Relay acceptance remains distinct
from recipient delivery and financial settlement. The current videos are labelled
as illustrated replays. Private settlement, recovery, native mesh, Aurora execution
and NEAR Intents execution retain their separate open requirements.

Video seeking uses single-byte-range responses from both the local server and
offline cache. The range parser checks open-ended and suffix ranges, rejects
unsatisfiable requests, and returns exact partial bytes. Browser checks assert
the requested time and scene boundary; a seek event alone is insufficient.
Offline scenes use a crossed-out Wi-Fi symbol, and the complete message is typed
before it appears in the sent bubble. The QR panel keeps dark text on white in
both themes.

## Nearby delivery verification — November 1, 2026

[Nearby transfer](../docs/nearby-delivery.md) adds signed, expiring QR pairing and
direct WebRTC host channels to chat and wallet. Eight Node checks and seven Edge
browser checks cover identity/fingerprint binding, QR decoding, bounded fragments,
private messages, signed receipts, explicit old-history consent and onward payments.
A forced receipt-save failure recovers by resending the exact saved payment after
re-pairing; the recipient is not credited twice. Backing is a fixture, HTTP is
blocked, and there are no financial API calls. Physical devices remain untested.

The cache-upgrade checks preserve identity, encrypted vault and expired reservation
when the nearby module is unavailable, then load the complete module set offline
after a successful upgrade. Three browser security checks pass. Eleven carrier checks and ten public-relay checks also pass. Their consent
remains separate from the temporary direct session.
The preview replay and source provenance are refreshed after the app changes.
