# Testnet integrations

Lenz's submission uses the browser app, testnet execution and continuity after connectivity loss. A compiled Android host provides native BLE transport; physical delivery and multi-hop require separate device verification. iOS and the full never-online first-use path remain further work. The Android host does not establish a native financial backend. Component tests are separate from final original-account transaction acceptance. [Current implementation](implementation-status.md) · [dated transaction evidence](evidence/README.md).

## Contracts and source

These addresses are pinned by the current app. Runtime code and canonical receipt checks must pass before execution; this table is not a fresh chain audit.

| Network | Component | Address or account | Configuration/source |
| --- | --- | --- | --- |
| NEAR testnet | tUSD reserve | `tusd.lenz-dev-1792984696547.testnet` | [Configuration](../web/public/near-config.json), [contract](../contracts/README.md) |
| NEAR testnet | Rhea adapter | `lenz-rhea-1792987934062.testnet` | [Configuration](../web/public/rhea-config.json), [source](../contracts/adapter/README.md) |
| NEAR testnet | Intents verifier | `verifierif13a.lenz-dev-1794582631653.testnet` | [Pinned route](../web/public/intent-near-plan.js), [original source/build](../contracts/intents-testnet/README.md) |
| NEAR testnet | LTS / LTT test assets | `sourceif13a.lenz-dev-1794582631653.testnet` / `targetif13a.lenz-dev-1794582631653.testnet` | [Pinned route](../web/public/intent-near-plan.js) |
| Aurora testnet, 1313161555 | Private pool | `0x0ff2408b29c276f141bfb553f42d0ffadf7ef736` | [Addresses and code hashes](../web/public/intent-aurora-config.js) |
| Aurora testnet | Swap factory | `0x410b2ba41260520f70f4146150a718569b80e1f9` | [Vault/adapter source](../aurora/contracts/PrivateIntent.sol) |
| Aurora testnet | Fixed test offer adapter | `0x31c24c2a2ae6e208f2e1dd2bccf82043ac05f172` | [Addresses and code hashes](../web/public/intent-aurora-config.js) |
| Aurora testnet | LTS / LTT test assets | `0xafa88fe18a46dda58e79d8f89abda51c13411590` / `0x68884014da20174e79f9e7b06466f3a7c6085b09` | [Pinned assets](../web/public/intent-aurora-config.js) |
| Sepolia, 11155111 | Lending account factory | `0xb1127e6416ce6a875361b68c838c46ccabf956ff` | [Code pins](../web/public/intent-lending-deployment.js), [source](../aurora/contracts/LendingAccount.sol) |
| Sepolia | Privacy pool / Supply factory | `0xdf45f28484715decbb66d77ed17c2b24ecf6d178` / `0xf783835738efc0eb399064989f93484b7a0a6bae` | [Code pins](../web/public/intent-lending-deployment.js), [Supply source](../aurora/contracts/PrivateSupply.sol) |
| Sepolia | Aave V3 pool | `0x6ae43d3271ff6888e7fc43fd7321a503ff738951` | [Asset/network pins](../web/public/intent-lending-config.js), [lending scope](lending-testnet.md) |
| Sepolia | Aave test LINK / USDC | `0xf8fb3713d459d7c1018bd0a49d19b4c44290ebe5` / `0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8` | [Pinned assets](../web/public/intent-lending-config.js) |

LTS, LTT, tUSD and Aave test USDC have no cash value. Aave test USDC is distinct from Circle's Sepolia USDC. Individual lending accounts and swap vaults bind their original owner and request; they are not global deposit addresses. Zcash uses shielded testnet receivers and has no EVM contract address. Hyperliquid trading is Coming soon.

The original Sepolia lending continuation finalized repayment, withdrawal and
free-fund exits. At finalized block 12136221, the account had nonce 6, no free
LINK or USDC and no debt; 0.000067332779539608 LINK remained as indexed aLINK
collateral. The final exit returned 0.998442 test USDC to its original owner.
The account is therefore not fully closed.

## Execution and privacy

NEAR tUSD and the original Intents verifier route are public on-chain. The Intents verifier atomically executes opposite signed token changes; external withdrawal is verified separately. This route uses NEP-413 and its own testnet solver, independently of unavailable 1Click partner access.

Aurora and private Supply use the original Tornado v2.1 membership statement. Deposits, fixed denomination, withdrawal recipient and subsequent swap/lending activity remain public. The proof hides the cryptographic deposit link. Signers, RPC/network operators and timing can correlate activity; small pools offer limited anonymity. [Original prover and artifact pins](../web/tornado-prover.md).

The ordinary Wallet Swap finalized an exact 1 LTS→2 LTT testnet exchange. Final NEAR/Aurora receipts, the action and events, and encrypted archive restoration offline with the same key were checked. The strict recorder aborted a background market-assets read after financial success; that limit remains recorded. This result does not establish broader asset routes or general interrupted-submission recovery.

Native Zcash keeps keys, scans and PCZT artifacts in configured local custody. Wallet → Send reviews the shielded recipient, amount, fee, owned change and expiry. Activity retains the original request through restart. The browser backup retains encrypted action references and cannot restore native spending keys. The local signer sees payment details; the lightwallet server observes sync/submission timing. [Native source](../zcash/README.md), [payment review](../zcash/payment-review.md).

Chat and carried requests are signed and encrypted. Static ECDH does not provide forward secrecy. Host-only WebRTC tests do not establish physical Bluetooth mesh or iPhone/Safari support. Carrier acknowledgements confirm storage, without crediting funds or releasing reservations. Expired or uncertain financial actions require original-request reconciliation. [Nearby](nearby-delivery.md), [carriers](../carrier/README.md), [recovery](financial-recovery.md).

## Backend setup

Install locked dependencies and build browser proof assets using the [README](../README.md#local-setup). The app server requires the same loopback HTTP origin and port; the default is `http://localhost:4173`. Use `LENZ_ACCOUNT_DATA` for a private account-backup directory.

Configure only the services you need. All custody, key, artifact and journal paths below belong outside Git.

| Service | Server environment |
| --- | --- |
| Offline tUSD relay | `LENZ_TESTNET_SPONSOR_DATA` for its private allowance journal; `LENZ_TESTNET_SPONSOR_DAILY_LIMIT` defaults to 12 sponsored transactions per UTC day |
| NEAR Intents | `LENZ_NEAR_INTENT_DATA`, `LENZ_NEAR_INTENT_RELAYER_KEY`, `LENZ_NEAR_INTENT_DEPLOYMENT` |
| Aurora funding/Swap | `LENZ_AURORA_FUNDING_DATA`, `LENZ_AURORA_SWAP_DATA`, `LENZ_AURORA_FUNDING_KEY`, `LENZ_AURORA_FUNDING_OPERATOR`, `LENZ_AURORA_ENGINE_CODE_HASH` |
| Sepolia lending | `LENZ_LENDING_DATA`, `LENZ_LENDING_KEY` |
| Tornado proving artifacts | `LENZ_TORNADO_ARTIFACTS`; files must match [input hashes](../web/public/tornado-vendor/artifacts.json) |
| Native Zcash | `LENZ_ZCASH_INTENT_DATA`, `LENZ_ZCASH_INTENT_BACKEND`; pinned executable, wallet scans and custody required by that backend |

Keep the same sponsor, custody and journal through restart. Reconcile original actions before retrying; interrupted signing must not create replacement authority. Operator provisioning requires separately reviewed testnet funding and deployments, rather than someone else's keys.

The tUSD relay checks signed funding and every payment-path edge against the configured reserve before sponsorship. Confirmed retries return their original final state; failed or uncertain broadcasts retain their allowance reservation. The journal defaults to `~/Documents/Lenz-local-notes/testnet-operator/reserve-sponsor`, outside the app repository. Preserve `allowance.json` and `initialized` through restart. If a crash leaves `allowance.lock`, stop every sponsor process, check the saved requests against final NEAR state, and remove only that stale lock before restarting. A missing or corrupt initialized ledger requires restoration of its original journal, rather than an allowance reset.

Public requests share the daily sponsor limit and a 60-request minute limit. The current deployed reserve exposes no grant lookup by owner: a key already funded elsewhere may fail its new funding attempt on-chain and consume a sponsor slot. The cap bounds that cost; it does not prevent someone creating multiple profiles or guarantee public-service availability.

The exact owner-signed Rhea submission, continuation and recovery routes share
that allowance, with a 100 tUSD swap limit. Signed status and refund reads have a
separate shared 60-request minute limit and never invoke a signer. Every operation
requires the original signed permission; an order ID alone grants no execution.

## Hosting

`node web/build-vercel.mjs /absolute/path/to/a/new/preview-directory` builds a static preview. Its APIs return HTTP 503 `BACKEND_UNAVAILABLE`; it can show local account creation and cached navigation after an initial visit.

`node web/build-hosted-vercel.mjs /absolute/path/to/a/new/connected-directory` builds the connected Vercel package. The package contains public browser assets and an authenticated proxy. Operator signing keys, native wallets, private artifacts and execution journals remain on the separately configured backend.

Configure these Vercel server environment variables, keeping credential values out of Git and browser assets:

| Variable | Purpose |
| --- | --- |
| `LENZ_HOSTED_ORIGIN` | Exact public HTTPS origin permitted by the proxy and gateway |
| `LENZ_GATEWAY_URL` | Authenticated HTTPS tunnel to the private gateway |
| `LENZ_GATEWAY_SECRET` | Separate private proxy-to-gateway credential |
| `LENZ_DEMO_SESSION_SECRET` | Private secret for the existing-identity session cookie |
| `LENZ_HOSTED_CUSTODY` | Private JSON mapping of each permitted Lenz identity to its original source, owner and financial route |

Start `node web/hosted-gateway.mjs` on the operator host after configuring the same `LENZ_HOSTED_ORIGIN`, `LENZ_GATEWAY_SECRET` and `LENZ_HOSTED_CUSTODY`, plus private `LENZ_ACCOUNT_DATA` and `LENZ_HOSTED_JOBS` directories. The gateway binds to loopback port 4187 by default. `LENZ_GATEWAY_BACKEND` and `LENZ_GATEWAY_LOCAL_ORIGIN` select the fixed loopback app and its configured origin; both default to port 4173. Set `LENZ_GATEWAY_PORT` if a different gateway port is required.

Public reads and ordinary signed account backups use their normal app routes. Offline tUSD funding, signed settlement, Rhea execution and final-state checks use original signed permissions without an operator account mapping. Amounts, spending keys and settlement records are public on NEAR; payment files remain encrypted between contacts. Native Zcash, NEAR Intents, Aurora and lending still require the signed existing Lenz identity and its configured source/owner mapping. Recovered routes require the original verified source/account guards; signing in does not restore native custody. Unmapped operator routes remain unavailable.

The [live prototype](https://lenz-prototype.vercel.app) serves its website and API proxy on Vercel. A temporary Cloudflare tunnel connects the proxy to this computer's authenticated gateway and local testnet signers. Availability depends on that computer, gateway and tunnel; custody and execution journals remain local.

Connected packaging and disposable HTTPS proxy checks pass. Read-only checks at the public origin confirmed the pages and NEAR reserve status, rejected anonymous native custody access, and separately confirmed mapped native configuration at the gateway. Real financial execution through the public origin and physical-device acceptance remain separate. Restart or replace an operator service only after its original in-flight jobs are resolved; retain the same custody and journals through restart.
