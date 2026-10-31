# Active DeFi integration

Rhea, NEAR Intents, Zcash and privacy are part of the current Lenz build alongside NEAR settlement. These modules implement the quote stage. The separate [Rhea adapter](../contracts/adapter/README.md) now has funded testnet swap/refund and browser evidence. A [native shielded Zcash transfer](../zcash/pczt.md) is confirmed, with separate [unsigned browser review and expiry checks](../zcash/payment-freshness.md). NEAR Intents execution, browser Zcash signing, the shielded DeFi route and private NEAR settlement remain incomplete. Aurora has local execution/verifier evidence; no separate Aurora Intents connection is implemented.

October 30: [installation checks](installation-results.json) confirm Intents SDK 0.93.0 and the Aurora EVM toolchain. The isolated [1Click verifier](quote-verifier/README.md) adds SDK 0.1.26 and requires valid signatures on preview quotes. The latest confidential live preview still returns HTTP 401.

`web/server.mjs` now mounts these same-origin local routes:

| POST route | Behavior |
| --- | --- |
| `/api/defi/rhea/quote` | Read a simple pool and its return at one final NEAR testnet block; calculate minimum output with integer arithmetic. |
| `/api/defi/intents/tokens` | Fetch the supported asset list from 1Click. |
| `/api/defi/intents/quote` | Request a dry exact-input quote with an explicit confidential route; validate the echoed terms and minimum output. |

Requests require JSON and the local Lenz origin. Provider credentials, if configured, stay in the server process as `LENZ_INTENTS_API_KEY`. The server does not expose signing, deposits or spending through these routes.

Rhea uses the [published testnet exchange](https://guide.rhea.finance/developers/contracts), `ref-finance-101.testnet`. Its reads share a final block hash. These are RPC-authenticated observations, not browser light-client verification or guaranteed future prices. The adapter currently handles simple pools only.

The [1Click quote API](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote) uses its mainnet endpoint. Previewing that service cannot convert testnet tUSD into mainnet assets. The client forces `dry: true`, rejects unexpected deposit details and never silently drops the requested `basic`/`advanced` confidentiality setting. The official SDK now verifies selected signed fields before a preview is returned. Its signature omits `confidentiality`, so the checked HTTPS echo is not cryptographic proof of the privacy mode or the operator's privacy guarantees. Live provider signature verification remains untested because partner access is missing.

## Local evidence

```powershell
node --test integrations/quotes.test.mjs web/defi-relay.test.mjs contracts/client.test.mjs
```

Twenty tests passed on October 30: thirteen quote/authentication tests, four local route tests and three NEAR receipt tests. Upstream responses are fixtures, with real local signatures for the quote-verification tests. Checks include altered terms, signature/key substitution, timestamp freshness, confidentiality downgrade, slippage, inconsistent blocks and receipt handling. Both removed signature/freshness guards were detected. These are not evidence of a live provider signature or executed Intents swap.

Live checks run with:

```powershell
node integrations/check-live.mjs rhea
node integrations/check-live.mjs intents
node integrations/check-live.mjs intents-auth
```

These scripts save dated result files and return nonzero on failure. [Rhea's live quote](rhea-results.json) passed at a final testnet block. [Empty-intent authentication](intents-auth-results.json) succeeded using a disposable Ed25519 identity and the official SDK's versioned nonce builder. Keys and access/refresh tokens were not saved. This confirms account authentication only.

Confidential quote requests still return HTTP 401. The public token list works. A user-session token was also rejected by the quote endpoint, so it is not substituted for partner credentials. Partner access is not configured. Obtain one through the [partner dashboard](https://partners.near-intents.org), configure `LENZ_INTENTS_API_KEY` only in the server environment, and rerun the dry quote check. Do not paste it into chat or put it in browser assets. The [authentication docs](https://docs.near-intents.org/integration/distribution-channels/1click-api/authentication) distinguish partner and user-session credentials. No public-route fallback was used.

The experimental signer dependencies are isolated here: `@defuse-protocol/intents-sdk` 0.93.0, pinned by the lockfile. Its ESM entry fails under Node due to an extensionless import; the probe uses its supported CommonJS export without patching dependencies. [dependency-audit.json](dependency-audit.json) records 52 package findings (17 low, 10 moderate, 24 high, 1 critical). These need assessment before broader signer use. The quote routes do not import this SDK.

The NEAR reserve now builds, deploys and redeems. [Rhea's funded test](../contracts/rhea-flow-results.json) created tUSD/wrapped-NEAR pool 2870, rejected an impossible minimum without debiting deposits, swapped one tUSD for `16631929970821175489787` base units of wrapped test NEAR and withdrew the output into the disposable account. Every successful call includes final receipts. The documented `register_tokens` example omitted the required one-yocto deposit; a live failure identified it and the corrected run passed. The deployed code hash is recorded; source-to-bytecode equivalence has not been established.

Next Intents work is partner access, a supported execution route, and a verified binding for the requested confidentiality mode. Rhea follow-through includes external signing and recovery for missing contract callbacks; [receipt checks](../research/rhea-receipt-recovery.md) are implemented. Native shielded wallet work is in [zcash/](../zcash/README.md), and contract-verifier evidence is in [aurora/proof-results.json](../aurora/proof-results.json).
