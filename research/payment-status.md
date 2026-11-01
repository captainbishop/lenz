# Check and confirm payments in chat

## Live interruption and conflicting onward payments

November 1, 2026. A bounded exercise used the existing funded test wallets to send
**0.01 tUSD from A to B**. NEAR finalized the payment, then the test withheld that
successful response with HTTP 502 and made the immediate recovery read unavailable
with HTTP 503. The encrypted pending record survived chat and wallet reloads.
An explicit status check recovered the actual final receipt without another
settlement request.

The harness also deliberately signed an alternative payment from the same A input
to C, using an in-memory copy without restoring any saved wallet. C received that
branch offline and passed its exact output to a new, unfunded disposable receiver
D. These are real signatures over existing testnet backing; the competing spend
is a test control outside the ordinary UI. Once the winner settled, actual NEAR
status reads excluded the losing payment and its descendant. Neither losing path
was submitted by the browser.

The live check found a wallet display error: after a conflicting payment had been
passed onward, its outgoing file still said **Ready to share**. The wallet now
shows **Payment could not be confirmed** and removes that file's download button.
Chat already identified the conflict. A browser regression reproduced the error
before the fix and passed afterward, including narrow layouts in both themes.

Seven live checkpoints passed, followed by four saved-evidence checks and four
rejected alterations of signatures, receipt amounts, submission count and credited
value. The captured transaction is
[`6YLxNN2ESvwJMHts9sjEvoTYYPse2ecfVxcSHLCinHEv`](https://testnet.nearblocks.io/txns/6YLxNN2ESvwJMHts9sjEvoTYYPse2ecfVxcSHLCinHEv).
Final allocations are **A 2.99 / B 2.01 / C 4 / D 0 tUSD**; existing reserve
backing, supply, identities, history and swap reservations were preserved.
No funding grant or deployment was performed.

[Live evidence](../web/near-payment-failure-live-results.json),
[saved-evidence verification](../web/near-payment-failure-verification.json), and
the outgoing conflict view in [light](../web/evidence/conflicted-outgoing-light.png)
and [dark](../web/evidence/conflicted-outgoing-dark.png) themes. The screenshots use
fixture state; the live report records the actual chain/browser exercise.

The first two attempts stopped before submission because the local relay returned
`fetch failed`, although direct RPC reads succeeded. Restarting that server restored
the route; the original process's network failure was not diagnosed further. The
third attempt passed interruption/recovery and exposed the outgoing display error.
After the fix, the runner resumed with read-only checks and retained that successful
transaction. The report preserves these failed attempts.

The HTTP failures are injected transport faults, and the on-chain result is real.
This does not simulate a physical disconnect, prove transaction inclusion with a
browser light client, or provide guaranteed redemption for money accepted offline.
Private settlement, safe restoration, broader failure coverage and physical-device
testing remain open. Cache version: `proof-u-chat-v28-conflicted-outgoing`.

Run `node web/verify-near-payment-failure.mjs` to check saved evidence without network
or signing. `node web/near-payment-failure-live.cjs --inspect` inspects the dedicated
profiles before a run. Its `--run` mode is a transaction-producing, single-use
exercise: it journals the exact path before forwarding one settlement and refuses
to repeat a completed run. An ambiguous submission requires investigation, not a
new payment or an automatic retry.

## Pending confirmation after an interruption

November 1, 2026. Before submitting a received payment for settlement, Lenz saves a
confirmation-attempt record in its encrypted vault. Chat and wallet retain a
**Confirmation pending** state across reloads until validated final evidence
confirms the payment or identifies a conflicting spend.

Checking status sends only a read request. Reloading or reconnecting sends no
confirmation request. A repeated service call defaults to checking an existing
attempt; **Retry confirmation** explicitly resends the same signed history. It
does not create a new payment or signature. Contract idempotency remains necessary
because browser/network retries can occur below the application layer.

Saving the attempt must succeed before submission. Status checks preserve newer
onward payments, existing identities and swap reservations. A pending confirmation
does not prevent onward use of locally valid money; offline acceptance remains
provisional. This record is not a backup, a transaction-finality proof or a durable
server-side transaction journal.

Verification: 25 Node tests, 12 fixture browser checks and two cache-upgrade checks
passed. The browser checks cover reload in chat and wallet, read-only recovery,
explicit identical-path retry, failed persistence before submission, offline
controls, concurrent tabs and conflicting ancestors. Removing either the default
read guard or the pre-submission save caused the browser suite to fail in isolated
copies. The first mutation harness expected an assertion error where the removed
guard instead caused an unexpected submission and an uncertainty error; its
diagnostic expectation was corrected before both negative controls passed.

The cache test upgrades from the published initial commit and checks both a failed
update and successful recovery, preserving the identity, encrypted vault and an
expired swap reservation. [Browser results](../web/near-payment-status-browser-results.json),
[cache results](../web/near-payment-cache-results.json), and pending views in
[light](../web/evidence/pending-confirmation-light.png) and
[dark](../web/evidence/pending-confirmation-dark.png) themes. These are fixture
responses with actual browser cryptography/storage. That implementation check did
not perform a funding or chain transaction; the separate live exercise above adds
conflict and interrupted-submission evidence.

## October 31 implementation and evidence

October 31, 2026. Incoming tUSD cards now offer **Check status** and, when eligible, **Confirm payment**. Chat and the standalone wallet share final-response validation and encrypted storage updates. Offline onward transfer remains available; reconnecting enables controls without submitting anything.

## Behavior

- Check status reads final NEAR state. Confirmation checks the saved payment first, then submits its existing signed ancestry only if it is still pending, owned, available and unreserved.
- Receipts must match the signed input and every output's ID, recipient and integer amount, including change. Checks require the complete requested set and reject duplicate/foreign rows, inconsistent consumption records and attempts to erase a saved final spend. A missing root rejects verification.
- Network work happens outside the storage lock. Results are validated again against the latest vault before one atomic write, preserving newer payments, history and saved swap reservations. Expiry alone never releases a reservation.
- Confirmation uses a shared Web Lock across tabs. A failed submission triggers one read-only reconciliation attempt. An unresolved result stays uncertain and asks for a status check. Both errors remain in developer diagnostics.
- Feedback stays with the card. A conflicting ancestor excludes descendants from the available balance. Confirmed outgoing records do not claim file delivery. Settlement amounts and accounts remain public on NEAR testnet.
- The app cache is `proof-u-chat-v26-payment-status`, including the new shared module. Updated light/dark videos show disabled controls during offline scenes. Presentation replay uses already recorded payments and preserves all three test accounts.

The browser/transport can retry an identical request below the application layer. The reserve's idempotent receipt lookup remains necessary; Web Locks are not an exactly-once network guarantee. Finality still relies on the configured relay/RPC, not a browser light client.

## Verification

- **25 Node tests:** shared payment service, status validation, NEAR ledger and Rhea reservations. Tampered amounts/recipients/inputs/change, missing/duplicate/foreign rows, nonfinal results, conflicts, rollback attempts and cross-batch contradictions reject without mutating the original vault.
- **9 new Edge checks:** malformed receipt rejection; chat/wallet synchronization; lost-response recovery; concurrent tabs; uncertain recovery with both diagnostics; card-local errors; delayed reads preserving newer activity/reservations; shared conflict display; offline controls without automatic submission. [Report](../web/near-payment-status-browser-results.json).
- **2 cache checks:** the previous app survives an unavailable new module; a successful update loads it offline and preserves identity, encrypted vault and an actual signed, expired swap reservation. [Report](../web/near-payment-cache-results.json).
- **17 existing Edge checks:** nine offline-social and eight wallet checks pass, including offline A → B → C. Backing and RPC responses remain explicitly fixtures.
- **13 homepage checks:** five layout/interaction/offline, five playback/account-preservation and three response/theme/reduced-motion groups. Six clips total 2.23 MB; source, capture and media hashes verify.
- **47 cache routes:** all imports are local and cached; cryptographic scenario modules have no network APIs.
- **Live read-only validation:** six existing notes and their three-transfer ancestry match final NEAR state and the saved signed path. One check request; no funding, signing, settlement or saved-account change. [Report](../web/near-payment-status-live-results.json).

The October 31 conflict/interruption checks are fixture evidence. The separate live exercise above adds browser conflict display and interrupted-submission coverage. These checks do not establish phone/Safari/BLE support, private NEAR settlement, recovery, Intents execution, an Aurora adapter or Zcash signing.

## Failures retained

The initial browser regression reproduced the old wallet saving a final status for a receipt with the correct ID but an incorrect recipient. The same assertion passes after the shared validator is used.

An initial socket-drop fixture produced seven HTTP submissions because Chromium retried below the app layer. The test now returns HTTP 502 after fixture execution to isolate application recovery. It verifies one application submission and read-only reconciliation; transport retries still require contract idempotency.

The first live-check script assumed the two transfers highlighted in the preview were the full ancestry. The validator rejected the incomplete response. The corrected read-only script retrieves all three ancestors and six notes, validating the full path and the saved preview receipts. Neither run sent a transaction.

The first cache fixture lacked the amount and other fields needed to render a saved swap, causing its status wait to time out. It now creates an actual signed test order. A subsequent test assumed a root service-worker scope; Lenz uses separate page scopes. The test now updates `/chat.html`. Both checks then passed.

The recorded encoder startup failed with `ENOENT` under the restricted host environment; encoding completed when the existing executable was accessible. This is a tooling failure, separate from the unexplained proof timeout and integration results.

## Reproduce

```powershell
node --test web/near-payment-status.test.mjs web/near-payment-service.test.mjs web/near-protocol.test.mjs web/rhea-protocol.test.mjs
node web/near-payment-status-browser.test.cjs
node web/near-payment-cache.test.cjs
node web/offline-social-browser.test.cjs
node web/near-wallet-browser.test.cjs
node web/verify-chat-static.mjs
node web/video-previews.test.cjs
node web/home-screen-response.test.cjs
node web/home-browser.test.cjs
```

Browser commands need the installed Playwright runtime. Keep `LENZ_LIVE_TESTNET=0` for the wallet regression. The explicitly read-only `node web/near-payment-status-live.cjs` needs the existing disposable preview profile and local server, and refuses other API routes. It is separate from transaction-producing runners.
