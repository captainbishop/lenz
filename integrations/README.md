# Active DeFi integration

The current Wallet mounts the original NEAR Intents verifier route, proof-funded Aurora Swap and native Zcash Send, alongside NEAR reserve/Rhea and Sepolia lending. [Recorded testnet outcomes](../docs/evidence/README.md) and the [implementation source map](../docs/evidence/SOURCE-MAP.md) identify the actual authority, execution and result paths. These are separate from the quote adapters and general route previews described below. Broader routes, private settlement and production recovery remain open.

[Market discovery](../docs/market-discovery.md) connects public Uniswap/Aave
Base markets and Hyperliquid perpetual contexts to the Markets page and route
candidate matcher. Explicit refresh and saved offline snapshots are available.
[The perpetual workspace](../docs/trading-workspace.md) adds checked Hyperliquid
candles/depth and a compact order ticket, with explicit public-data consent.
[Public estimates](../docs/market-quotes.md) add Uniswap WETH/USDC quotes and
Hyperliquid order-book previews. [Route drafts](../docs/route-drafts.md) match
bounded swap/order objectives and persist encrypted non-executable records.
Markets provides a draft review, and Drafts supports offline reading and explicit
estimate refresh/delete. These general route drafts have no execution authority;
complete fees, account positions, cross-chain legs, private quotes and their
signing/execution/recovery path remain open.

The [shared route planner](../docs/route-planner.md) adds provider-independent
catalogue discovery and validated objectives for EVM/NEAR routes, credit and
Hyperliquid orders. It is a pure developer module with synthetic examples;
its previews cannot sign, dispatch, release reservations or credit a wallet.

The quote adapters implement bounded provider previews. The separate [Rhea adapter](../contracts/adapter/README.md) has funded testnet swap/refund evidence. The mounted [original NEAR Intents verifier route](../docs/evidence/near-intents-wallet-20261113.json) has a final testnet swap; 1Click partner execution is separate and unverified. [Native Zcash Wallet Send](../docs/evidence/zcash-wallet-send-20261114.json) delegates signing to configured native custody, while its developer browser lab retains [unsigned review](../zcash/payment-freshness.md). [Aurora Wallet Swap](../docs/evidence/aurora-wallet-swap-20261114.json) has a deployed fixed-rate test venue and final receipts. General shielded DeFi and private NEAR settlement remain incomplete.

November 2: [installation checks](installation-results.json) confirm the empty-authentication payload builder and the Aurora EVM toolchain. The isolated [1Click verifier](quote-verifier/README.md) retains SDK 0.1.26 and requires valid signatures on preview quotes. November 9 live checks accepted confidential dry quotes and EVM ownership authentication; the [account adapter](../docs/confidential-account.md) adds private balance reads and fresh same-key reauthentication.

`web/server.mjs` now mounts these same-origin local routes:

| POST route | Behavior |
| --- | --- |
| `/api/defi/rhea/quote` | Read a simple pool and its return at one final NEAR testnet block; calculate minimum output with integer arithmetic. |
| `/api/defi/intents/tokens` | Fetch the supported asset list from 1Click. |
| `/api/defi/intents/quote` | Request a dry exact-input quote with an explicit confidential route; validate the echoed terms and minimum output. |
| `/api/markets/read` | Read public Uniswap, Aave or Hyperliquid data; no account, quote or transaction. |
| `/api/markets/quote` | Explicit public Uniswap simulation or Hyperliquid book estimate; no account, signer or transaction. |
| `/api/markets/tape` | Explicit public Hyperliquid candle/book snapshot; bound market/interval, no account or execution. |

Requests require JSON and the local Lenz origin. Provider credentials, if configured, stay in the server process as `LENZ_INTENTS_API_KEY`. The server does not expose signing, deposits or spending through these routes.

Rhea uses the [published testnet exchange](https://guide.rhea.finance/developers/contracts), `ref-finance-101.testnet`. Its reads share a final block hash. These are RPC-authenticated observations, not browser light-client verification or guaranteed future prices. The adapter currently handles simple pools only.

The [1Click quote API](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) uses its mainnet endpoint. Previewing that service cannot convert testnet tUSD into mainnet assets. The client forces `dry: true`, rejects unexpected deposit details and never silently drops the requested `basic`/`advanced` confidentiality setting. The official SDK verifies selected signed fields before a preview is returned, including in the November 9 disposable live checks. Its signature omits `confidentiality`, so the checked HTTPS echo is not cryptographic proof of the privacy mode or the operator's privacy guarantees.

## Local evidence

```powershell
node --test integrations/intents-auth-payload.test.mjs integrations/quotes.test.mjs web/defi-relay.test.mjs contracts/client.test.mjs
```

Twenty-six tests passed on November 2: six empty-authentication checks plus the existing thirteen quote/authentication, four local route and three NEAR receipt checks. Upstream responses are fixtures, with real local signatures. Checks include altered terms, signature/key substitution, timestamp freshness, confidentiality downgrade, slippage, inconsistent blocks and receipt handling. The earlier quote signature/freshness controls and seven new authentication guard/domain alterations are detected. These are not evidence of a live provider signature or executed Intents swap.

Live checks run with:

```powershell
node integrations/check-live.mjs rhea
node integrations/check-live.mjs intents
node integrations/check-live.mjs intents-auth
```

These scripts save dated result files and return nonzero on failure. [Rhea's live quote](rhea-results.json) passed at a final testnet block. [Empty-intent authentication](intents-auth-results.json) succeeded using a disposable Ed25519 identity and the official SDK's versioned nonce builder. Keys and access/refresh tokens were not saved. This confirms account authentication only.

Partner access was verified locally on November 9 with a signed confidential dry quote. Each host still needs its own server-side configuration: obtain a key through the [partner dashboard](https://partners.near-intents.org), configure `LENZ_INTENTS_API_KEY` in the server process, and run the dry quote check. Keep keys out of chat, browser assets and Git. A user-session token is separate and is not substituted for partner credentials. The [authentication docs](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication) explain the distinction. Wallet now mounts explicit ownership authentication and private balance reads using the shared browser-compatible account adapter. User tokens stay in page memory; no deposit or execution route is enabled.

The experimental bridge SDK was used only for an empty authentication payload and
a probe. It has been removed. The current lock contains only `@scure/base` 1.2.6
and reports zero registry advisories. The bounded [authentication builder](intents-auth-payload.mjs)
retains the SDK v0 wire format, validated against [32 official-SDK fixtures](intents-auth-sdk-fixtures.json)
before removal. No live authentication was repeated during that November 2
cleanup. The November 9 account checks subsequently verified live EVM
authentication. Quote routes retain their separate verifier.

The [cleanup evidence](../research/security/dependency-cleanup-2026-11-02.md)
records compatibility checks and scope. The original [dependency audit](dependency-audit.json)
and [protobuf update](../research/security/intents-protobuf-refresh-2026-11-02.md)
describe the retired SDK environment. This quote-adapter dependency replacement
implements no bridge/token execution. The mounted original verifier route uses
its separate signed testnet swap and result checks; general funded asset/return
routes and 1Click execution remain open.

The NEAR reserve now builds, deploys and redeems. [Rhea's funded test](../contracts/rhea-flow-results.json) created tUSD/wrapped-NEAR pool 2870, rejected an impossible minimum without debiting deposits, swapped one tUSD for `16631929970821175489787` base units of wrapped test NEAR and withdrew the output into the disposable account. Every successful call includes final receipts. The documented `register_tokens` example omitted the required one-yocto deposit; a live failure identified it and the corrected run passed. The deployed code hash is recorded; source-to-bytecode equivalence has not been established.

Remaining Intents work includes production recovery, broader funded execution/return routes and a verified binding for the requested confidentiality mode. The current original-verifier testnet swap does not satisfy those broader requirements. Rhea follow-through includes external signing and recovery for missing contract callbacks; [receipt checks](../research/rhea-receipt-recovery.md) are implemented. Native shielded wallet work is in [zcash/](../zcash/README.md); the local Aurora verifier experiment retains its separate [proof evidence](../aurora/proof-results.json).
