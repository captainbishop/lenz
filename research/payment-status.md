# Check and confirm payments in chat

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

Conflict/interruption coverage added here is fixture evidence. Live browser conflict display and interrupted submission still require a bounded test. This change does not establish phone/Safari/BLE support, private NEAR settlement, recovery, Intents execution, an Aurora adapter or Zcash signing.

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
