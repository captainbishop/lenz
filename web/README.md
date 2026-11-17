# Lenz web app

The app combines encrypted conversations, Wallet, Markets, Account and retained offline state. The [current implementation](../docs/implementation-status.md) links working capabilities to code and checks. The [architecture guide](../docs/architecture.md) maps browser storage, transport and connected execution.

## Run and host

Follow the [root setup](../README.md#local-setup). Run `npm start` from the repository root, or `node server.mjs` from `web/`. Use the same configured origin for account storage and local execution. The homepage is `/`, Wallet is `/money.html`, Conversations is `/chat.html`, and Markets is `/markets.html`.

[Backend setup](../docs/testnet-integrations.md#backend-setup) describes optional funded services and native custody. The [live prototype](https://lenz-prototype.vercel.app) serves the website and authenticated proxy on Vercel, reaching this computer's gateway and signers through a temporary Cloudflare tunnel. Availability depends on those services. Local signers and journals remain separate from browser keys.

`build-vercel.mjs` creates a static preview with unavailable APIs. `build-hosted-vercel.mjs` adds the authenticated proxy. Root `npm run build:hosted` prepares pinned assets and creates a fresh package; see [hosting](../docs/testnet-integrations.md#hosting). Packaging does not establish financial execution.

## Conversations and delivery

[Chat](public/chat.js) retains signed encrypted originals in [the account store](public/chat-store.js). Adding someone sends a message request; the recipient can Accept or Decline without manually adding the sender. Profile names are labels, not identity proofs. Lenz IDs bind public keys and remain stable across profile edits.

Ordinary Send queues direct delivery and retries the saved original. [Shared packet rules](public/delivery-packets.js) apply across Bluetooth, Nostr, carrier and WebRTC clients. [Authenticated intake](public/receive-packet.js) and [signed receipts](public/delivery-receipts.js) enforce recipient, request, replay and storage rules.

The [Android host](../native/android/README.md) packages the interface with native BLE. Direct Samsung-to-Xiaomi and reverse delivery were observed on November 17; the user reported about 20 seconds for the reverse retry check. Physical multi-hop, radio interruption, process-restart recovery and background delivery remain unverified. Browser-only Nearby uses WebRTC on reachable Wi-Fi or a hotspot; see [Nearby](../docs/nearby-delivery.md). The Lenz BLE protocol does not interoperate with Bitchat clients.

Chat uses P-256 signatures, static ECDH and AES-GCM without forward secrecy. An unlocked or compromised device remains a separate exposure. BLE and relay routing, size and timing metadata remain observable.

## Wallet and execution

Wallet and Chat use the same encrypted tUSD vault and reservation rules. Payments remain available outside conversations. Funding, exact recipient review and signed acceptance precede onward transfer; offline acceptance is provisional until canonical settlement. Payment and swap file handovers remain available.

The [reserve/Rhea](../contracts/README.md), [original Intents verifier](../contracts/intents-testnet/README.md), [Aurora](../aurora/README.md), [Aave](../docs/lending-testnet.md) and [native Zcash](../zcash/README.md) routes have separate authority, execution and result checks. [Recorded evidence](../docs/evidence/README.md) distinguishes testnet transactions, fixture backing and operator recovery. November 17's hosted payment/Rhea run reached final outcomes; the Rhea swap required three operator advances after the sponsor cap stopped normal progression.

The Android host serves packaged GET files and BLE operations. It has no financial POST backend. Use the configured hosted or local web services for connected financial execution. A saved approval, transport acknowledgement or encrypted request does not establish settlement or private blockchain execution.

Hyperliquid funded trading and general LP/yield/staking/claims execution remain unfinished. Markets provides public catalogues, charts and cached snapshots; owned balances and positions need their own verified reads.

## Offline state and recovery

Wait for Ready offline before disconnecting. Prepared app files, encrypted history, profile changes, drafts, requests, market snapshots and reviewed actions remain available through the applicable caches. Current quotes, fresh chain state and final settlement need connectivity. Never-online first use and broad private offline DeFi remain unfinished.

[Account backup](../docs/automatic-backup.md), [identity recovery](../docs/identity-recovery.md) and [financial recovery](../docs/financial-recovery.md) retain original authority and outstanding liabilities. Clearing device-only storage loses an account without a usable backup. Browser archives do not restore native Zcash spending keys or prove canonical funds.

## Source and verification

Browser source is in `public/`; Node routes, build tools and tests are in this directory. Browser tests use disposable identities and simulated external/native boundaries. Component results distinguish local checks from recorded transactions.

Run the root [nonfinancial checks](../README.md#local-setup) and the route checks in [implementation status](../docs/implementation-status.md#reproduce-the-nonfinancial-checks). More focused checks include:

```sh
node --test web/delivery-receipts.test.mjs web/nostr-protocol.test.mjs web/nostr-contact-request.test.mjs
node web/carrier-browser.test.cjs
node web/nostr-browser.test.cjs
node web/nearby-browser.test.cjs
node web/verify-chat-static.mjs
```

Run these commands from the repository root after installing the locked dependencies. Selected browser checks require Microsoft Edge. They do not submit financial transactions.

The [original proof payment experiment](legacy-proof-demo.md) retains its single-workspace demo and dated results. `/payment-demo.html`, `/swap-tools.html`, `/wallet-lab.html` and other lab pages remain separate from the normal product journey. Existing encrypted legacy records remain readable; new unbacked demo imports are rejected by the current Wallet/Chat flows.
