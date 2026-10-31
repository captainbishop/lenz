# Zcash browser connection

Later October 31 checkpoint: the [confirmed PCZT transfer](pczt.md) changed A's balance to 0.8999 test ZEC and B's to 0.1, both spendable in Ironwood. Five [additional actual browser checks](../web/zcash-companion-after-pczt-results.json) confirm those balances. The initial funding/read/sync evidence below is preserved; browser signing/sending is still not exposed.

Verified October 31, 2026. The [Zcash test connection](http://127.0.0.1:4173/zcash-lab.html) now reads the actual pinned native developer wallet through the local Lenz server. It is linked from the developer wallet lab and swap tools. The two native test wallets are explicitly separate from the browser's Lenz identity and tUSD balance.

## Implemented boundary

**Read local wallet** runs the existing executable's JSON balance and Orchard-receiver address commands. **Update from Zcash** first checks the server reports the test chain, synchronizes the native wallet, then reads its balance and address. Opening the page, changing accounts and reconnecting the browser never trigger those commands automatically.

The page displays exact eight-decimal test ZEC amounts, spendable/unspendable totals, the receive address and the read time. Pool balances are under details. Before the first successful read it displays no balance; a failed update retains any earlier result with an explicit stale label. An address is not proof of funding. A native wallet's known chain-tip height is not proof that every historical block has been scanned. A completed synchronization command is reported as a network update, not universal finality.

`POST /api/zcash/status` and `POST /api/zcash/refresh` require the exact loopback host/origin and JSON containing only `wallet: "a"` or `wallet: "b"`. The bridge uses fixed subprocess arguments, checks the existing executable/dependency hashes and testnet wallet configuration, bounds native process duration and permits only one browser request at a time. Unknown routes, arbitrary paths/actions and extra parameters are rejected. Errors expose only a fixed operation label and error code; native stderr, wallet paths, seeds and internal metadata are not returned.

The browser route has no initialization, signing, seed-export or send operation. It does not import the Lenz chat store. The existing terminal wrapper gained `--no-save` so browser reads preserve earlier evidence files, and a read-only `transactions` command that returns only transaction IDs and mined heights. That command is not exposed over HTTP.

The recorded companion checkpoint used cache `proof-u-chat-v20-zcash-companion` with **44 routes**. The current app cache also includes later payment-review and shared payment-status modules. Offline page reload gives honest connection guidance and no invented balance. This page does not persist native wallet information in browser storage or make the native account portable.

## Actual funding found

Synchronization discovered a previously unseen received transaction in wallet A:

- Transaction: `3b08a1472e873eb0c665e707cfec37416b230b652d582fd8dddd29ac858b749e`
- Mined height reported by the native wallet: **4,542,640**
- Final recorded total and spendable value: **100,000,000 zatoshis (1 test ZEC)**
- Reported spendable pool: **Ironwood**; Orchard, Sapling and transparent spendable balances are zero.
- Both wallets' final recorded known chain tip: **4,563,183**. Wallet B remains zero.

[Transaction record](transactions-a-results.json) and [actual browser/native results](../web/zcash-companion-live-results.json). During the first partial synchronization, total was already 1 test ZEC but spendable was zero. A completed direct synchronization made it spendable; the final browser update confirmed the same result. Pool evidence comes from the native wallet's balance summary, not inference from the address.

The funding source has not been established. Previous Fauzec and Valar responses reported failure, and those files remain unchanged. No new faucet request or outgoing Zcash transaction was made in this build. At this initial checkpoint, only funding had been observed. The later [PCZT flow](pczt.md) completed receive → spend → receive and local offline proving/signing. The earlier “missing test coins” prerequisite for wallet A is resolved.

## Verification and failures

- **16 Node tests** passed for companion validation, local HTTP restrictions and existing quote routes.
- **Seven browser checks** passed with controlled native-wallet responses, covering exact amounts, stale/error states, duplicate requests, account separation, offline reload and narrow/enlarged-text layouts.
- **Five actual browser/native checks** passed: local read and network update for each wallet, plus no Lenz identity storage or page errors.
- **Nine offline social-payment checks** and **four cache-update checks** passed after the shared cache change. Their financial inputs are fixtures; the earlier live NEAR/Rhea evidence remains separate.
- **Two removed guards** were detected: foreign-origin access and wrong-network synchronization. The origin test was tightened to use otherwise valid requests so payload validation could not mask a missing origin check.

[Verification and source hashes](companion-verification.json), [guard results](companion-mutations.json), [browser fixture report](../web/zcash-browser-results.json), [actual page screenshot](../web/evidence/zcash-companion-live.png).

The first actual run read A locally, then returned HTTP 503 on its update. The second passed A's update and B's local read, then returned HTTP 503 on B's update. Both are preserved: [first failure](../web/zcash-companion-live-first-failure.json), [second failure](../web/zcash-companion-live-second-failure.json). Direct synchronization of the same wallets subsequently succeeded. The original generic errors did not record which native command failed, so their exact cause is unresolved; a later pass does not establish a timeout diagnosis. Sanitized operation/timeout codes are now recorded for any recurrence. No funds were fabricated and no failed update was shown as current.

A diagnostic chain-info command failed with Windows socket error 10013 under restricted network access, then reached testnet when network access was available. Earlier funding/provider failures and the unrelated original offline-proof timeout are preserved.

## Reproduce

```powershell
node --test zcash/companion.test.mjs web/zcash-relay.test.mjs web/defi-relay.test.mjs
node web/check-zcash-mutations.mjs
node web/verify-chat-static.mjs
# Set NODE_PATH to your local test-tools node_modules directory.
node web/zcash-browser.test.cjs
node web/zcash-companion-live.test.cjs
```

The last command reads the actual wallets locally. Add `--refresh` only when intentionally updating them from testnet; it sends no funds. It requires the local Lenz server and existing pinned native wallets. The native executable still has a 60-second command limit; an unavailable or unfinished update stays a failure. No native Android/iPhone or Safari behavior was tested.

The bounded native A-to-B transfer and local proving/signing are now recorded in [pczt.md](pczt.md). [Unsigned browser review and expiry checks](payment-freshness.md) followed. Browser signing approval, full witness validation, submission recovery and safe wallet restore/rescan remain open. This native test companion is not a production wallet or integration of the Zcash account into Lenz's profile. Private NEAR settlement and the NEAR↔Aurora execution/asset route remain distinct active work.
