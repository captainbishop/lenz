# Active DeFi integration

[Market discovery](../docs/market-discovery.md) connects public Uniswap/Aave
Base markets and Hyperliquid perpetual contexts to the Markets page and route
candidate matcher. Explicit refresh and saved offline snapshots are available.
[The perpetual workspace](../docs/trading-workspace.md) adds checked Hyperliquid
candles/depth and a compact order ticket, with explicit public-data consent.
[Public estimates](../docs/market-quotes.md) add Uniswap WETH/USDC quotes and
Hyperliquid order-book previews. [Route drafts](../docs/route-drafts.md) match
bounded swap/order objectives and persist encrypted non-executable records.
Markets provides a draft review, and Drafts supports offline reading and explicit
estimate refresh/delete. Complete fees, account positions, cross-chain legs,
private quotes, signing, execution and recovery remain open.

The [shared route planner](../docs/route-planner.md) adds provider-independent
catalogue discovery and validated objectives for EVM/NEAR routes, credit and
Hyperliquid orders. It is a pure developer module with synthetic examples;
its previews cannot sign, dispatch, release reservations or credit a wallet.

Rhea, NEAR Intents, Zcash and privacy are part of the current Lenz build alongside NEAR settlement. These modules implement the quote stage. The separate [Rhea adapter](../contracts/adapter/README.md) now has funded testnet swap/refund and browser evidence. A [native shielded Zcash transfer](../zcash/pczt.md) is confirmed, with separate [unsigned browser review and expiry checks](../zcash/payment-freshness.md). NEAR Intents execution, browser Zcash signing, the shielded DeFi route and private NEAR settlement remain incomplete. Aurora has local execution/verifier evidence; no separate Aurora Intents connection is implemented.

November 2: [installation checks](installation-results.json) confirm the empty-authentication payload builder and the Aurora EVM toolchain. The isolated [1Click verifier](quote-verifier/README.md) retains SDK 0.1.26 and requires valid signatures on preview quotes. The latest confidential live preview still returns HTTP 401.

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

The [1Click quote API](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) uses its mainnet endpoint. Previewing that service cannot convert testnet tUSD into mainnet assets. The client forces `dry: true`, rejects unexpected deposit details and never silently drops the requested `basic`/`advanced` confidentiality setting. The official SDK now verifies selected signed fields before a preview is returned. Its signature omits `confidentiality`, so the checked HTTPS echo is not cryptographic proof of the privacy mode or the operator's privacy guarantees. Live provider signature verification remains untested because partner access is missing.

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

Confidential quote requests still return HTTP 401. The public token list works. A user-session token was also rejected by the quote endpoint, so it is not substituted for partner credentials. Partner access is not configured. Obtain one through the [partner dashboard](https://partners.near-intents.org), configure `LENZ_INTENTS_API_KEY` only in the server environment, and rerun the dry quote check. Do not paste it into chat or put it in browser assets. The [authentication docs](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication) distinguish partner and user-session credentials. No public-route fallback was used.

The experimental bridge SDK was used only for an empty authentication payload and
a probe. It has been removed. The current lock contains only `@scure/base` 1.2.6
and reports zero registry advisories. The bounded [authentication builder](intents-auth-payload.mjs)
retains the SDK v0 wire format, validated against [32 official-SDK fixtures](intents-auth-sdk-fixtures.json)
before removal. The existing disposable signer remains; no live authentication
was repeated after this change. Quote routes retain their separate verifier.

The [cleanup evidence](../research/security/dependency-cleanup-2026-11-02.md)
records compatibility checks and scope. The original [dependency audit](dependency-audit.json)
and [protobuf update](../research/security/intents-protobuf-refresh-2026-11-02.md)
describe the retired SDK environment. No bridge/token execution is implemented
by this replacement; full Intents integration remains open.

The NEAR reserve now builds, deploys and redeems. [Rhea's funded test](../contracts/rhea-flow-results.json) created tUSD/wrapped-NEAR pool 2870, rejected an impossible minimum without debiting deposits, swapped one tUSD for `16631929970821175489787` base units of wrapped test NEAR and withdrew the output into the disposable account. Every successful call includes final receipts. The documented `register_tokens` example omitted the required one-yocto deposit; a live failure identified it and the corrected run passed. The deployed code hash is recorded; source-to-bytecode equivalence has not been established.

Next Intents work is partner access, a supported execution route, and a verified binding for the requested confidentiality mode. Rhea follow-through includes external signing and recovery for missing contract callbacks; [receipt checks](../research/rhea-receipt-recovery.md) are implemented. Native shielded wallet work is in [zcash/](../zcash/README.md), and contract-verifier evidence is in [aurora/proof-results.json](../aurora/proof-results.json).
