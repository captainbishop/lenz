# Route estimates and saved drafts

The route service can attach a public estimate to an exact same-chain Uniswap
swap or Hyperliquid order objective. These are non-executable drafts. Matching
does not authenticate the provider, approve spending or establish a complete route.
The browser API has no product controls yet and sends no network requests.

## Estimate checks

`bindRouteQuote(objective, quote)` requires explicit `transparent` privacy,
unexpired objective/quote times, matching provider and actual execution chain.
Private objectives cannot use public estimates. Cross-chain funding and return
objectives need separate verified legs and are rejected by this bounded matcher.

For the Base Uniswap WETH/USDC pool, the source/output contracts and decimals,
exact input and minimum received must match. A quoted minimum below the objective
minimum is rejected. Pool fees are included in the quote; total fees and the
objective's fee budgets still need verification.

Hyperliquid orders require `sizeDecimals` matching the venue estimate and
`priceDecimals: 6`. Size and limit price are integer units with those explicit
scales. Legacy objectives without scales remain valid planning documents but
cannot attach an estimate. Instrument, side and size must match; the worst book
price must satisfy the buy/sell limit. Order size is not source USDC collateral.
Collateral sufficiency, margin, leverage, reduce-only effects, account state and
venue order-size rules remain unverified.

Both paths retain unverified recipient authority, balances, total fees, signing,
execution, finality and recovery. The quote's provider market ID records the
observed pool/instrument; the objective still names a provider-level destination.
Neither object is a signed authorization. Saved quote bytes can be fabricated by
a caller and must never be consumed as execution authority.

The developer CLI accepts a fresh estimate file:

```sh
node integrations/preview-route.mjs --file objective.json --quote estimate.json
```

## Browser storage

`saveRouteDraft(objective)` and `attachRouteQuote(id, expectedRevision, quote)`
use the existing shared IndexedDB/Web Locks commit boundary. A separate
nonextractable AES-GCM key encrypts up to 100 records, with the Lenz identity ID
in authenticated associated data. Existing wallet ciphertext, keys, contacts,
messages and reservations are preserved. Duplicate IDs cannot replace terms;
competing tabs must reload the current revision before replacing an estimate.
Arguments are snapshotted before asynchronous work. Failed writes or expiry
during encryption return no saved result.

`listRouteDrafts()` revalidates saved records and derives their current status:
`needs-quote`, `estimate-saved`, `quote-expired`, `objective-expired` or
`clock-changed`. Expired estimates remain historical records. Refreshing requires
an explicit new quote and revision check. There is no automatic quote request,
signature, reservation, transport, credit or release. Encryption at rest does not
defend against a compromised same-origin application with access to its keys.

This is a browser service, not an execution journal or recovery backup. Product
draft controls, offline page caching, deletion/export and device migration remain
unconnected. The current Markets page still discards quotes on edits/offline/expiry
and never saves them automatically.

## Verification

```sh
node integrations/verify-route-quotes.mjs
node integrations/verify-route-planner.mjs
```

[Binding verification](../integrations/route-quotes-verification.json) records
seven fixture groups, seven [browser service groups](../web/route-drafts-browser-results.json)
and 15 detected guard alterations. Real Edge IndexedDB, Web Locks and WebCrypto
exercise competing tabs, failed writes, queued caller edits, expiry during
encryption, ciphertext corruption and cross-identity copies. Online reload and
loaded offline reads preserve saved records and existing wallet state.

The first binding test tried to alter a frozen fixture; it now clones that input.
Removing the early provider check still rejected mismatches through the later
chain/action/asset guards, so that overlapping guard is explicitly not counted
as independently detected. These checks use fixtures and disposable browser
profiles, with no live account, financial transaction or physical-device test.
