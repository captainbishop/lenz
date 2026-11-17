# Current implementation

Source review date: November 17, 2026. This page describes the current working implementation. Historical execution dates and current implementation hashes are separated in the [transaction evidence](evidence/README.md).

The current static package at [the live prototype](https://lenz-prototype.vercel.app) was checked on November 17. Static deployment does not establish a new financial execution or physical Bluetooth result.

| Capability | Mounted implementation and checks | Verified scope | Unfinished or unverified |
| --- | --- | --- | --- |
| Signed encrypted conversations | [Chat UI](../web/public/chat.js), [WebCrypto protocol](../web/public/peer-crypto.js), [shared delivery policy](../web/public/delivery-packets.js), [saved intake and receipt preparation](../web/public/receive-packet.js), [recipient receipt protocol](../web/public/delivery-receipts.js) | Actual browser UI with disposable keys and retained encrypted originals; signature, account-change, storage and retry checks | Forward secrecy; compromised/unlocked-device protection; broader browser/device coverage |
| Automatic message requests | [Contact entry](../web/public/contact-ui.js), [request/decision protocol](../web/public/contact-requests.js), [request UI](../web/public/contact-request-ui.js), [Nostr discovery](../web/public/nostr-protocol.js) | Add → unknown recipient request → Accept/Decline; no reciprocal manual add; bounded previews, exact terminal decisions and payment denial before acceptance | Public relay request availability and physical phone acceptance require separate checks; discovery routing IDs/public keys are visible |
| Encrypted account recovery | [Account snapshots](../web/public/account-backup.js), [request validation](../web/public/contact-request-backup.js), [archive recovery](../web/public/identity-recovery.js), [account sync](../web/public/account-sync.js) | Same-owner requests/decisions and queued originals survive restore; a successor keeps declined identities without inheriting old request authority | Native wallet spending keys and production custody recovery are separate |
| Offline app continuity | [Cache access](../web/public/offline-access.js), [chat worker](../web/public/chat-sw.js), [app worker](../web/public/sw.js), [encrypted store](../web/public/chat-store.js) | Prepared app opens after browser restart with its server unavailable; saved messages, drafts, market modules and requests remain available | Never-online first use; fresh blockchain state and settlement without a connected participant |
| Android BLE transport | [Origin-bound host](../native/android/src/app/lenz/nearby/MainActivity.java), [GATT transport](../native/android/src/app/lenz/nearby/BluetoothMesh.java), [fragmentation](../native/android/src/app/lenz/nearby/MeshCore.java), [browser bridge](../web/public/bluetooth-client.js) | Compiled and signed APK; JVM and bridge simulations; [physical Samsung ↔ Xiaomi delivery](evidence/android-ble-20261117.json), with A → B shown once and reverse retry delivery reported at about 20 seconds | Multi-hop, interrupted transfers, process-restart radio recovery, iOS and background radio delivery; no embedded financial API backend |
| NEAR tUSD reserve and Rhea | [Reserve contract](../contracts/README.md), [adapter](../contracts/adapter/README.md), [payment preparation](../web/public/near-payment-service.js), [confirmation](../web/public/near-payment-status.js), [signed sponsor route](../web/rhea-signed-relay.mjs) | Recorded funded settlement, conflict rejection and backed onward transfer; [November 17 hosted protocol run](evidence/near-payment-rhea-20261117.json) funded 2 tUSD, settled 1 tUSD and swapped that 1 tUSD to exact wrapped NEAR output | Hosted swap reached its daily sponsor limit; three operator advances completed the same order. This run did not verify Android financial UI or BLE money delivery. Offline acceptance, global competing claims, private settlement and production recovery remain open |
| Original NEAR Intents verifier | [Wallet controller](../web/public/intent-near-ui.js), [NEP-413 plan](../web/public/intent-near-plan.js), [relay/result checks](../web/intent-near-relay.mjs), [upstream pin](../contracts/intents-testnet/source-lock.json) | Recorded final testnet 1 LTS → 2 LTT; exact signed nonce/token changes and destination checks | Operator-funded test solver/assets; public settlement; 1Click partner execution is a different unverified route |
| Aurora proof-funded swap | [Funding](../web/intent-aurora-funding.mjs), [swap execution](../web/intent-aurora-swap.mjs), [sponsor](../web/intent-aurora-sponsor.mjs), [contracts](../aurora/contracts/PrivateIntent.sol) | Recorded final proof-funded fixed-rate Wallet swap and exact beneficiary credit; bounded owner-signed preparation and durable original requests | Broader venues/assets, live interrupted-submission recovery and independently verified private settlement; test-pool anonymity is limited |
| Aave lending | [Mounted Wallet entry](../web/public/wallet-lending.js), [service](../web/intent-lending-service.mjs), [bounded account](../aurora/contracts/LendingAccount.sol), [position reads](../web/intent-lending-read.mjs) | Recorded Sepolia Supply/Borrow/Repay/Withdraw and transfer outcomes; final debt/free balances and residual indexed collateral identified | General lending markets, production risk/recovery and independent operators |
| Native shielded Zcash Send | [Wallet Send](../web/public/intent-zcash-send.js), [route](../web/public/intent-zcash-route.js), [review](../zcash/payment-review.mjs), [native execution](../zcash/native-payment-execution.mjs) | Recorded shielded testnet transfer, exact payment effects in both canonical native wallet scans, retained Activity | Fresh public confirmation was unavailable for the historical summary; native key restore/rescan and broader failure coverage |
| Market data and wider DeFi | [Markets](../web/public/markets.js), [section loader](../web/public/market-workspace-loader.js), [Hyperliquid UI](../web/public/hyperliquid-ui.js) | Public catalogue/chart/market reads and cached snapshots; pending data is distinct from owned positions | Funded Hyperliquid trading, general LP/yield/staking/claims execution and arbitrary private offline DeFi |

## Reproduce the nonfinancial checks

After the [locked setup](../README.md#local-setup), run:

```sh
npm run check
npm run check:offline
npm run test:browser
npm run test:requests
node --test web/contact-request-backup.test.mjs web/identity-recovery.test.mjs web/legacy-recovery.test.mjs web/account-backup.test.mjs web/chat-restore.test.mjs
node --test integrations/intent-testnet/swap.test.mjs web/intent-near-relay.test.mjs web/intent-aurora-swap.test.mjs web/intent-lending-read.test.mjs web/intent-zcash-relay.test.mjs
```

Browser tests require Microsoft Edge. Node fixture suites simulate external RPC/native boundaries and do not submit a transaction. Android JVM checks use `node native/android/test.mjs --output-dir <external-directory>`; a successful build or simulation does not prove a working radio.

## Android and hosted execution

The Android host serves packaged GET assets and connects Chat to native BLE. Wallet funding, payment confirmation and Rhea execution call relative financial POST routes, which the native asset host returns as unavailable. Those routes run through the configured hosted web gateway. The two-phone message test did not establish a working Android payment or swap journey.

Ordinary Chat Send queues direct encrypted delivery without a message export action. Wallet payment and swap file controls still exist, as do contact cards and account backups. Native transport does not remove those separate controls.

## Execution and privacy boundaries

A saved approval is not an executed trade. A carrier/GATT acknowledgement is not a signed recipient receipt. A signed recipient receipt is not blockchain finality. Each financial route preserves its original authority and checks its separate canonical outcome.

Chat uses static ECDH without forward secrecy. BLE presence, routing IDs, sizes and timing remain observable. Request discovery uses a public relay inbox; its profile and message stay encrypted. Public NEAR/EVM execution exposes transaction details even when its request is encrypted. Native Zcash custody has a separate signer and observer boundary. See [testnet integration scope](testnet-integrations.md), [nearby delivery](nearby-delivery.md) and [financial recovery](financial-recovery.md).

The [evidence source map](evidence/SOURCE-MAP.md) connects real historical transactions to the current call paths. Existing [development reports](status.md) retain their original dates and narrower scopes; earlier candidate descriptions do not override this current table.

Older screenshots and file-handover reports show their recorded interfaces. Ordinary Chat Send now requests direct delivery and has no message export action; contact cards and account backups remain separate.
