# Lenz web app

Open `http://127.0.0.1:4173/` for the homepage, `/money.html` for the wallet or `/chat.html` for conversations. The product name is Lenz; the logo uses two opposing L forms. Native Android and iPhone apps remain on the roadmap.

October 31: ordinary chat **Pay** now sends tUSD using the same encrypted vault/history as the wallet. Received payments can be passed onward offline. Saved swaps explain what needs connectivity and never execute automatically on reconnect. Earlier synthetic assets remain under **Earlier prototype**. [Product flow and fresh verification](../research/offline-social-money.md): 54 Node tests, 50 browser checks and 41 cache routes; browser initial backing is a fixture.

The wallet now uses plain actions and payment states. Raw signed-swap import and deposit-action export are on `/swap-tools.html`, outside normal navigation. `/wallet-lab.html` contains the external-signer experiment; MyNearWallet announced retirement on October 31, 2026, so it is not enabled as a product default. Read [connector status and verification](near-connector/README.md) before continuing signer work. These developer pages share the existing browser identity and encrypted vault.

The homepage uses real application previews, keyboard-operated feature tabs, expanding explanations, section navigation, scroll entrances and theme/motion controls. It respects reduced motion and works from its offline cache. The wallet now opens on a zero-balance tUSD view. See the [NEAR reserve](../contracts/README.md) for the deployed testnet implementation and its verification limits. The previous synthetic payment system remains under Earlier prototype, with its stored identity and balances preserved.

## Profiles and the standalone wallet

Both wallet and chat use the same IndexedDB identity and encrypted vault. A user can create a profile, exchange contact cards, prepare a payment, import an incoming payment and pass received value onward entirely from the wallet. The wallet also reviews incoming swap offers. No chat message or conversation screen is required. Send/import uses the same signatures, balance reservations and atomic storage writes as chat. Sending means preparing a file for handover, not confirmed delivery.

Edit profile changes the display name, one of four symbols, or an optional photo without changing keys, contacts, history or funds. Continue privately generates a readable alias and uses the default moon avatar. Names are not globally unique usernames or authentication. A profile edit does not unlink the account from existing contacts.

Photos are centre-cropped to 128×128 JPEG locally and re-encoded without the original metadata. Remote URLs and SVG uploads are rejected. Public contact files carry the photo; compact QR cards carry the name, symbol and public keys. An updated contact card requires source confirmation before replacing the existing contact with the same keys. Profile metadata is a label confirmed by the user, not a cryptographic assertion of someone's real-world identity.

Save offline on either screen caches both wallet and chat and registers their page scopes. The homepage uses a separate lightweight shell cache. The original proof experiment is `/payment-demo.html`.

Clearing site data loses this prototype's account. Recovery and device transfer are not implemented. Current private keys are nonextractable, and old wallet snapshots cannot safely be made spendable without handling later spends and outstanding authorizations. See [behavior and safety boundaries](../docs/behavior.md).

The conversation screen has a people list, search, a message thread and a composer with Pay and Swap actions. Pay prepares an encrypted tUSD payment; Swap opens the wallet's saved swaps. On narrow screens, choose a person to open their conversation and use the back button to return. Research details and the earlier scripted exchange are under About Lenz.

Share contact opens a name, avatar and QR card. Add someone accepts a camera scan, QR image or legacy contact JSON and asks you to confirm its source. Full fingerprints and JSON remain in technical details. QR processing stays local.

## Demo money in a conversation

Open Earlier prototype and choose Try demo money. Each identity receives synthetic starting roots of 100 demo dollars and 50 demo coins. Their deterministic IDs are verified on import; these are not funded reserves. You can offer a fixed two-asset swap, review it, agree and send some received value to another contact. The chat encrypts the complete financial card for its recipient. Files carry the card between browsers.

A single IndexedDB transaction saves the input reservation, encrypted outbox packet and encrypted trade ledger together. A failed commit exposes no packet and changes no saved balance. Web Locks serialize tabs. Reloads preserve keys, locks and downloadable messages. A pending offer holds its whole source note until agreement; no timeout-only unlock or cancellation is implemented. Accepted trades release change and permit onward use locally. Canonical chain settlement is not connected.

The encrypted trade vault has a nonextractable AES-GCM key. Chat uses P-256 signatures, static ECDH and AES-GCM; it has no forward secrecy. Contact names are labels, not identity proofs. Clearing browser storage loses the keys. Copied or rolled-back storage and hidden remote conflicts remain outside the local reservation guarantee.

Use Save for offline use, then reload. The chat cache is separate from the older proof wallet. All application and QR dependencies are local. A browser’s initial download needs a secure origin (localhost or HTTPS). Physical phone, camera, BLE and native share-sheet compatibility have not been established on this Windows host.

## Checks

Run from `web/`:

```powershell
node --test profile.test.mjs trade.test.mjs contact-card.test.mjs peer.test.mjs proof-worker.test.mjs
node peer-mutations.mjs
node trade-mutations.mjs
node verify-chat-static.mjs
node verify-static.mjs
# Playwright on NODE_PATH; installed Edge:
node peer-browser.test.cjs
node trade-browser.test.cjs
node reservation-browser.test.cjs
node reservation-mutations.cjs
node profile-browser.test.cjs
node money-browser.test.cjs
node home-browser.test.cjs
```

[Trade browser results](trade-browser-results.json) cover three isolated browser contexts, offline file handover, swap acceptance, onward receipt, duplicates, encrypted storage, failed writes and concurrent tabs. [Trade mutation results](trade-mutation-results.json) check backing validation, participant binding and matching local offers. The [behavior and safety boundaries](../docs/behavior.md) explains the protocol boundaries.

The original payment experiment below remains available from About Lenz.

## Run locally

The pinned dependencies and TEST-ONLY proof artifacts must already exist;
see [the cryptographic build instructions](../research/crypto-step/README.md).
From this directory:

```powershell
node build.mjs
node server.mjs
```

Open `http://127.0.0.1:4173/payment-demo.html` for this original experiment. The server binds only to localhost. The proof page generates proofs and stores its
wallet state in the browser. The same server separately exposes bounded developer
APIs for NEAR/Rhea, Intents quotes and the Zcash companion; those are not used by
this proof-only page.
The build checks all eight recorded proof-artifact hashes before copying
the WASM, proving key, trusted test verification key and local dependencies.

## Try the handover

1. Start with Amina (100.00 demo units). Send 40.00 to Bola.
2. Switch to Bola and choose Receive → Open payment. Bola now has 40.00.
3. Open the same payment again. It must not credit the balance twice.
4. Send 30.00 from Bola to Chidi, then receive as Chidi.
5. The balances are Amina 60.00, Bola 10.00, Chidi 30.00.

Each send creates an actual PLONK payment-step proof in a module worker,
verifies it locally and encrypts the handover using AES-256-GCM. Receipt
checks the proof history and recipient opening. Values use integer cents.
The demo spends one sufficiently large note at a time; it cannot merge
smaller notes. History is limited to 16 steps.

All three people, their spending secrets, delivery keys and the unbacked
genesis live in **one browser workspace**. Exported encrypted payment files
only work in that same workspace. This is not a cross-device key exchange.
The file is available only after the complete updated state is saved.
Web Locks serialize operations between tabs; a failed proof leaves state
unchanged. This is not secure storage or rollback-resistant wallet recovery.

## Reproduce the server-stopped test

1. Click **Prepare offline demo** and wait for confirmation. Current assets
   occupy about 48.23 MB of cached responses, including identity files.
2. Reload to pick up the cached release. The page checks cached resource
   presence and reports missing files when detected.
3. Stop `node server.mjs` with Ctrl+C in its terminal.
4. Reload the same browser URL. Send, receive, reopen a payment and send onward.
5. Reload again and check the saved balances.
6. Restart the server with `node server.mjs` when finished.

The header's online/offline indicator comes from `navigator.onLine` and is
not proof that the application server is reachable. It can say online with
the server stopped. The proof-only page has no remote CDN, font, wallet, RPC or API calls.
Resource caching requires a secure context: localhost for this developer
demo, or HTTPS for a hosted deployment. Initial app distribution/preparation
and browser storage eviction are separate constraints. PWA metadata and
icons exist, but installation on Android/iPhone has not been tested.

Caching is a research implementation; authenticated release updates, atomic
multi-file upgrades and recovery from evicted storage remain production work.

## Verification

From this directory:

```powershell
node --test proof-worker.test.mjs
node proof-worker-mutations.mjs
node verify-static.mjs
```

Open `http://127.0.0.1:4173/tests.html` for the browser suite. It uses a fresh
in-memory store and leaves the visible wallet untouched. To run offline,
cache resources first, stop the server, open the cached test page, select
**Require the app server to be unavailable**, and run the checks.

Evidence saved on 2026-10-25:

- [Browser report](browser-test-results.json): **25 passed, 0 failed**, in
  Windows desktop Chromium 156. The app server was unavailable
  before and after the run. Two actual worker proofs took **22.578 s** and
  **25.163 s**, including worker startup and witness calculation; the suite
  took 48.337 s. These are two observations, not a performance distribution.
- Checks include exact amounts, failed-prove atomicity, invalid proof
  rejection, wrong recipient/root, ciphertext and authenticated plaintext
  tampering, public transcript mutation, field bounds, local conflicts,
  duplicate and spent-receipt replay, missing ancestry, onward transfer and
  serialization round-trip.
- **6 worker-client tests passed**. [Both targeted regressions](worker-mutation-results.json)
  were detected: premature input delivery and progress treated as completion.
- Static check: **36 cache routes**, local cached module dependencies, and
  manifest PNG dimensions checked. Build passed with verified artifact hashes.
- Manual wallet flow also produced 60/10/30 balances; the onward send,
  receipt and reload were performed with the server stopped. The browser
  suite tests the same wallet and worker code.

The initial browser attempt timed out after five minutes without debiting
the balance. Waiting for an explicit worker-ready message resolved the
observed failure. A readiness regression reproduces the client contract
failure; the precise original browser scheduling trace was not captured.
The offline preparation code now waits for a newly registered worker to
activate before sending its cache request.

`layout-check.html` renders the wallet and identity page in 375×812 and
1024×768 browser frames. All four frames passed the horizontal-overflow
and image-load checks; the narrow wallet was also visually inspected.
This checks layout, not target-phone compatibility or full accessibility.

## Scope of the earlier proof-only demo

- No funded reserve, actual money, canonical chain state or guaranteed redemption.
- No completed private settlement/recursive proof. The seven public step
  fields expose a commitment graph if published, and recipients receive
  ancestry. Encrypting the file does not solve that privacy problem.
- No NEAR deployment, Zcash shielding route, native BLE transport or real
  Android/iPhone proving benchmark.
- No ability to detect conflicting spends hidden in disconnected partitions.

The intended network workaround is voluntary relayers: users can stay
offline while a connected participant submits authorized settlement data.
Some path to the chain remains necessary for canonical settlement. See the
[behavior and safety boundaries](../docs/behavior.md) for the guarantees and
tradeoffs still requiring resolution.

The [identity page](public/brand/index.html) and [brand documentation](../brand/README.md) use Lenz. Protocol domains and saved test state retain the Proof of U namespace.

The recorded [layout checks](evidence/layout-results.txt) cover the branded pages.
Current integration boundaries are listed in [development status](../docs/status.md).
