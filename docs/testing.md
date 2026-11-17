# Tests and evidence

Results below apply to the source and conditions recorded on each date. Transaction dates follow their original UTC records. Repeated suites overlap, so their counts are not summed as unique tests. This refresh ran selected affected suites; it did not run every test in the repository.

[Current implementation](implementation-status.md) · [Architecture](architecture.md) · [Transaction and physical evidence](evidence/README.md) · [Source call paths](evidence/SOURCE-MAP.md)

## November 17 application checks

| Campaign | Recorded outcome | What it checks | Limit |
| --- | --- | --- | --- |
| Startup and packaging regressions | `npm run check`: 39 passed, zero failed or skipped | Pinned asset preparation, hosted package behavior and unconfigured local HTTP routes | No funding or chain submission; Node module-detection warnings remain |
| Shared delivery and contact refactor | Same 50 tests passed before and after the refactor | Original-packet eligibility, signed receipts, contact decisions, account changes, storage failure, native bridge simulations and bounded queue draining | Selected fixture/browser suites; simulated radio and external relay boundaries |
| Migrated carrier harness | 11 groups passed after setup migration | Three real loopback HTTP/SQLite carriers, disposable Edge profiles, WebCrypto/IndexedDB, offline reloads, automatic delivery, signed receipts and cross-tab opt-out | tUSD backing is a fixture; no chain, BLE, physical phone or independent remote operator |
| Migrated Nostr harness | Ten groups passed after setup migration, zero page errors | Two real loopback WebSocket relays, one refusing writes; WebCrypto/IndexedDB, offline reloads, authenticated fragments/receipts, retained opt-out and refused dispatch after failed persistence | Payment backing is a fixture; no public-relay availability, chain or native Bluetooth claim |
| Migrated WebRTC Nearby harness | Eight groups passed after setup migration | Three disposable Edge profiles establish real local data channels; signed pairing, fragmented chat, receipts, recipient binding and duplicate/onward payment behavior are checked | HTTP blocked after cache preparation; payment backing is a fixture. No chain or physical Bluetooth test |
| Automatic requests | Nine request-browser tests passed; eight automatic-Send tests passed | Add → unknown request → Accept/Decline, pending-message limits, declined retries, financial refusal before acceptance and durable delivery | These tests overlap the 50-test run; physical request acceptance and public-relay availability are separate |
| Empty People drawer | Focused browser assertion passed after the fix and failed when its guard was removed; `npm run test:browser` recorded nine passing tests including this case | Background refresh keeps the empty contact drawer open | Disposable browser state; overlaps the eight automatic-Send cases |
| Account and request recovery | 69 Node tests passed across seven files | Same-owner restore, original request/decision binding, successor read-only history, retained declines, synchronization and interrupted recovery | Disposable keys and local HTTP/storage; native spending-key restoration and real-fund recovery remain unverified |
| Recovery guard checks | Account backup: 16 baseline tests and 14 detected guard removals. Chat restore: ten baseline tests and 13 detected guard removals. Two additional request-metadata guard removals were detected | Signature/revision binding, replay, lost acknowledgements, cancellation, authority separation and original profile/decision validation | Scoped mutation evidence; counts overlap behavioral suites and do not establish a broad security audit |
| Offline cache graphs | Chat graph: 881 routes. App graph: 880 routes | Local imports and all required cached public assets, including the shared delivery module | Graph validation alone does not prove a cold offline browser restart |
| Cold offline restart | Nine recorded browser checks passed after complete shutdown, stopped server and offline restart | Six market sections, Account/Wallet and encrypted Chat request/acceptance modules reopen from real service-worker storage | Prepared disposable account and previously saved app; no never-online first use or financial execution |
| Market loading and source availability | Retained five-entry live check reached ready state for All, Perpetuals and Spot; Credit and Prices timed out waiting for their rows. Fixture checks also exercise deferred sections and navigation | Selected section startup, cached snapshots, stale replies and unavailable sources | Five-entry record at 08:03 UTC; three ready screens are not a five-screen live pass. Market displays do not establish funded trading |

The startup command runs [asset preparation](../web/prepare-public-assets.test.mjs), [Vercel packaging](../web/build-vercel.test.mjs) and [server integration](../web/server-integration.test.mjs) tests. The exact 50-test command was:

```sh
node --test web/delivery-receipts.test.mjs web/nostr-protocol.test.mjs web/nostr-contact-request.test.mjs web/contact-request-backup.test.mjs web/chat-automatic-send-browser.test.cjs web/contact-requests-browser.test.cjs
```

The browser tests require installed Microsoft Edge and the locked Playwright dependency. They use disposable identities and controlled transport boundaries.

Recovery and static-cache reproduction:

```sh
node --test web/contact-request-backup.test.mjs web/identity-recovery.test.mjs web/legacy-recovery.test.mjs web/account-backup.test.mjs web/chat-restore.test.mjs web/account-sync-lifecycle.test.mjs web/intent-account-recovery.test.mjs
node web/verify-chat-static.mjs
node web/verify-static.mjs
```

The source-present mutation check commands are `node web/verify-account-backup.mjs` and `node web/verify-chat-restore.mjs`. Run report-generating checks in a disposable checkout to preserve retained verification reports. The two additional request-metadata probes and the full stopped-server browser harness are retained local evidence; those harnesses are not distributed in this refresh. Their clone-reproduction commands are therefore unavailable. To repeat the cold-start observation manually, save the app's offline graph, close the browser completely, stop its server, disconnect networking, then reopen the six market sections, Account, Wallet and Chat using disposable data.

Market reproduction commands:

```sh
node web/market-section-loading-browser.test.cjs
node web/market-overview.test.cjs
node web/market-overview-progressive-browser.test.cjs
```

These scripts exercise controlled provider replies, cached observations and stale/offline/paused behavior. A live provider check must separately record its actual availability and observation time.

The five-entry live record on November 17 had zero page exceptions. All displayed 21 rows after 22.384 seconds; Perpetuals and Spot displayed 40 rows each. Credit and Prices reached the 45-second readiness timeout without rows. Those observations describe that run, not a general performance guarantee or a passing current live-source check.

## Android and physical messages

| Campaign | Recorded outcome on November 17 | Scope and limit |
| --- | --- | --- |
| JVM transport core | Nine mesh, nine queue and six receive-permission groups passed | Exact-byte reassembly, corruption, fragments, duplicates, retained ciphertext, account changes and one-use forwarding tokens; no radio |
| Actual GATT implementation under Android API doubles | 12 behavior groups passed; five targeted guard-removal variants were detected | Three-second GATT timeout, ten-second original retry, service invalidation, exact forget/expiry/suspension and the shared three-attempt-per-peer cap. Private deterministic harness; no clone-reproduction command is published |
| Same-peer central/peripheral regression | First retry candidate sent four times and failed; corrected candidate sent at most three times and continued its unrelated backlog | Actual Java implementation under API doubles; this does not prove the unique cause of a physical delay |
| Samsung → Xiaomi | Recipient confirmed the named message exactly once; delivery described as almost instant | Human-confirmed direct foreground message |
| Xiaomi → Samsung | Reverse reply arrived; the retry check took about 20 seconds according to the user | Direction-dependent delay remains; timing was not instrumented |
| APK build and installation | Earlier tested APK was installed on both phones after compilation/dexing/packaging/alignment and APK v2/v3 signature verification. Latest refactored APK is verified and copied to Downloads; phones were disconnected, so it was not installed | Retained development signer and packaged source binding; local debug APK, not a store release |

Public core reproduction requires a JDK:

```sh
node native/android/test.mjs --output-dir /absolute/external/native-test-output
```

Follow the [Android build guide](../native/android/README.md) for its explicit Android SDK, web snapshot and external output arguments. [Physical observations](evidence/android-ble-20261117.json) preserve the human-confirmed outcome and current source fingerprints. Both phones were instructed to remain unlocked with Lenz foreground, Nearby enabled and Wi-Fi/mobile data off. The summary does not claim an independent radio-settings measurement.

Only direct messages on two Android phones were observed. Multi-hop requires a third device and demonstrated direct-link isolation. Background delivery, interrupted radio transfers, process-restart radio recovery and Bluetooth payment delivery remain unverified. The Android host has no financial POST backend.

## Payment and swap checks

| Campaign | Date | Recorded result | Limit |
| --- | --- | --- | --- |
| Payment/status/Rhea regressions | November 17 | 24 tests passed | Real local cryptography with fixture monetary backing and chain clients; no transaction from this command |
| Hosted NEAR reserve and Rhea protocol run | November 17 | 2 tUSD funded; 1 tUSD payment finalized; the received 1 tUSD swapped to 0.003786162812967755559353 wrapped NEAR. All eight transactions independently FINAL with zero failed receipts | Hosted path stopped at HTTP 429 after its sponsor cap. Three authorized operator advances completed only the same signed order |
| Original NEAR Intents Wallet swap | November 13 | 1 LTS → 2 LTT through the original NEP-413 verifier; final transaction and signed nonce/token/destination checks | Operator-funded test assets and solver, public settlement; separate 1Click execution remains unverified |
| Aurora Wallet swap | November 14 | Original proof-funded note → 2 LTT, final receipts and exact beneficiary credit | Funded fixed-rate test venue; limited pool anonymity and public swap terms. Recorder blocked an unrelated background read after financial success |
| Aave V3 Sepolia lending | November 14 | Recorded borrow/cancel/repay/withdraw/free-token exits; zero debt and free balances at the recorded final block | Small indexed aLINK collateral remained; account was not empty. Public testnet positions and actions |
| Native Zcash Wallet Send | November 14 | 0.01 test ZEC, 0.0001 test ZEC fee, ten recorded confirmations and retained Activity | Canonical native-wallet observations; fresh public confirmation unavailable for the historical summary. Browser backup does not restore spending keys |

The fresh hosted protocol run used disposable identities and accepted-contact preconditions. It did not establish the ordinary browser/Android UI journey or money delivery through Bluetooth. Exact payout log, signed recipient, operator-window balance delta and `2 tUSD = 1 redeemed + 1 retained` conservation are in [the public summary](evidence/near-payment-rhea-20261117.json). Historical transactions, their original dates and independent-read limits are in the [evidence index](evidence/README.md).

The first payout verifier expected a standard JSON transfer event, while the deployed legacy wrapped-NEAR token emits a plain `Transfer` log. Execution had already completed. A read-only check then verified that actual log, the linked receipts, signed recipient and balance delta; no transaction was repeated to repair the verifier mismatch.

Safe protocol and relay commands:

```sh
node --test web/near-payment-service.test.mjs web/near-payment-status.test.mjs web/rhea-protocol.test.mjs web/rhea-signed-relay.test.mjs
node --test integrations/intent-testnet/swap.test.mjs web/intent-near-relay.test.mjs web/intent-aurora-swap.test.mjs web/intent-lending-read.test.mjs web/intent-zcash-relay.test.mjs
```

The second command passed 71 fixture tests on November 17. It checks signatures, codecs, exact outcomes, recovery and rejection behavior across simulated external RPC/native boundaries. It does not rerun a funded transaction. Live verification uses read-only transaction/receipt and canonical-wallet observations; repeating a swap is not a health check.

## Builds, deployment and review

November 17 asset preparation verified all eleven approved bootstrap files; its repeat run downloaded none and retained identical bytes. The local startup runner also served Chat, Wallet and Markets when launched from outside the repository. Hosted and Android releases were bound to their explicit input snapshots, and deployed Chat/request/BLE/Wallet/worker/market assets were fetched and compared with the retained release manifest. A READY deployment or an HTTP 200 proves availability of that response, not a payment or a radio result.

The latest source-bound web package initially returned HTTP 502 from its financial API after the Cloudflare tunnel disconnected. The existing gateway/tunnel connection was restored, and the same package revision `2630eba145a4` was redeployed to [the official prototype](https://lenz-prototype.vercel.app). Final read-only verification passed 60 published asset/API checks and 992 source-to-Android-asset comparisons, with the APK digest matching; 30 retained runtime files were unchanged. Testnet status returned 200, anonymous Zcash configuration returned 401 and an invalid signed Rhea submission returned 400. Authenticated gateway status/configuration returned 200 while anonymous gateway access returned 403. No financial action was dispatched by these checks. Availability still depends on this computer's gateway, local services and temporary tunnel.

```sh
npm run prepare:web
npm run check
npm run build:hosted
node tooling/check-freshness.mjs --staged
```

Hosted packaging requires a fresh output directory and does not deploy by itself. Freshness checks compare exact selected source and media bindings. Repository scope, local links, candidate bytes and private-data markers were reviewed separately. Scoped Standards and Spec reviews caught and corrected request-response flooding, terminal request retries and a native shared-attempt-cap regression. These checks are not independent audit certification or production-fund readiness.

Older carrier, Nostr and WebRTC browser harnesses initially failed against removed controls; the same failures reproduced on the pre-refactor source. Their test servers also returned 404 for `/` during offline preparation; serving the existing index page corrected that fixture drift. Final migrated runs passed 11 carrier, ten Nostr and eight WebRTC groups, with zero page errors. Nostr now explicitly checks that opt-out remains saved after reload and opens zero relay connections before re-enabling it. Failed attempts, corrected candidates, Bluetooth latency and sponsor-limit intervention remain part of the verification history.

The migrated harness commands and external-output settings are:

| Command | Recorded status | Output environment variables |
| --- | --- | --- |
| `node web/carrier-browser.test.cjs` | 11 groups passed | `LENZ_CARRIER_REPORT` for the JSON filename; `LENZ_CARRIER_EVIDENCE` for the screenshot directory |
| `node web/nostr-browser.test.cjs` | Ten groups passed | `LENZ_NOSTR_REPORT` for the JSON filename; `LENZ_NOSTR_EVIDENCE` for the screenshot directory |
| `node web/nearby-browser.test.cjs` | Eight groups passed | `LENZ_NEARBY_REPORT_DIR` for the report directory |

Set those variables to absolute paths outside the repository before a rerun. Carrier tests run real local HTTP/SQLite mailboxes, Nostr uses real loopback WebSocket relays, and WebRTC establishes real local data channels. Payment backing is a fixture. These checks do not establish public-relay availability or physical BLE.

## Earlier component records

The [development history](status.md), [protocol verification index](../research/README.md), [security reports](../research/security/README.md), [Aurora guide](../aurora/README.md), [integration guide](../integrations/README.md) and [native Zcash guide](../zcash/README.md) retain earlier protocol-model, proof, signature, reserve, transport, market, authorization and recovery campaigns. Their recorded dates, source hashes, dependency findings and narrower scopes remain intact. Those historical results are not a fresh pass of every current suite.
