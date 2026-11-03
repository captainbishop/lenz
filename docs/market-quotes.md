# Public market estimates

Markets now offers a WETH/USDC swap estimate on Base and buy/sell estimates for
listed Hyperliquid perpetuals. Controls appear above expandable market data.
Public-query consent starts unchecked and is reset when changing markets.
There is no wallet connection, signing, order submission or reservation.

## Uniswap

The adapter uses Base QuoterV2 at
`0x3d4e44eb1374240ce5f1b871ab261cd16335b76a`, for the existing WETH/USDC v3
500-fee pool. It verifies chain, token decimals, quoter factory/WETH identity,
pool identity, code presence and pool availability. All reads and simulation
use one canonical latest block hash, rechecked before returning. The latest
block is unfinalized and must be at most 60 seconds old and no more than five
seconds ahead of the local clock.

The only simulated operation is `quoteExactInputSingle`, via `eth_call` with a
fixed gas cap. It never constructs or broadcasts a transaction. Price-boundary
results that may represent partial input consumption are rejected. Integer
arithmetic computes minimum output by rounding down after the selected slippage.
USDC has six decimals and WETH has 18; excessive precision is rejected.

The pool fee is included in estimated output. Network fees are excluded.
Quoter gas is a simulation metric, not a complete transaction fee estimate.
This is one pool; it does not find a best route, bridge, wrap native ETH or
verify a user's balance/allowance. The amount is visible to the Base RPC.

## Hyperliquid

The adapter first refreshes the default perpetual metadata and binds the
instrument/index to the selected market. It then requests an unaggregated
`l2Book`. The instrument and book time must match; future, old, crossed, unordered
or malformed books are rejected. Prices follow the documented significant-digit
and decimal limits; sizes follow the market precision.

Buy estimates walk asks; sell estimates walk bids. The full requested size must
fit within the returned depth, which is capped at 20 levels per side. Otherwise
the request fails rather than extrapolating a fill. Arithmetic uses integers;
costs round upward and proceeds downward to six-decimal units. The result shows
notional value and the worst consumed book price. `fullDepth` records coverage of
the requested size, not coverage of the entire exchange book.

The venue receives only the market identifier, while the local server receives
the amount and side. Estimates exclude fees and margin. Minimum order value,
margin tiers, account/position state, order policy, funding and liquidation
effects still require the execution adapter. A sample size is not a valid-order
claim. Price/size checks alone cannot authorize an order.

## Freshness, privacy and input handling

`POST /api/markets/quote` requires the local Host/Origin, a bounded JSON request,
an exact known schema and `privacy: public`. Unknown fields, wallet/recipient
injection, unsupported markets and private-to-public downgrade are rejected.
Identical in-flight requests coalesce; completed quotes are never cached.
At most four distinct quotes run concurrently. Failures release their slots.

Returned previews are immutable and have `executable: false`. Client validation
binds them to the exact request and checks asset identity, integer amounts,
minimum output and source time. Expiry is at most 30 seconds after receipt,
also bounded by the source's age allowance. Hyperliquid books have a 30-second
age allowance. These checks trust provider responses; they are not independent
chain proofs or price guarantees.

Changing the amount, direction, slippage or consent invalidates the old result.
Late replies, offline transitions and expiry cannot restore it. Quotes are not
saved to browser storage or the offline snapshot cache. Public estimates do not
enable private execution, and the separate route planner's privacy requirement
is unchanged. The separate [route draft service](route-drafts.md) now matches
bounded same-chain objectives and explicitly saves encrypted drafts. It is not
connected to Markets controls. Full route authorization and execution remain open.

## Verification

```sh
node integrations/verify-market-quotes.mjs
node integrations/check-market-quotes.mjs
node web/market-quote-browser.test.cjs
node web/market-quote-live.test.cjs
```

[Quote verification](../integrations/market-quotes-verification.json) records
19 tests and 19 detected deliberate guard changes. The refreshed
[discovery verification](../integrations/market-discovery-verification.json)
has 26 tests and 20 guard changes; seven relay tests overlap the quote suite.
Thirty-eight existing route/quote/authentication/relay regressions pass.

[Browser fixtures](../web/market-quote-browser-results.json) pass seven groups,
including consent, edits during requests, expiry, offline reload, altered replies,
exact amount display and both themes from phone to desktop. Seven existing
Markets groups also pass. Screenshots were visually inspected.

[Direct live reads](../integrations/market-quotes-live.json) passed both Uniswap
directions and both Hyperliquid sides. The [live browser run](../web/market-quote-live-results.json)
passes four groups through the actual local API, with one swap quote and one
ETH buy estimate. No account, wallet database, saved quote or financial
submission was created. These reports are historical observations.

Initial restricted-network reads failed before the authorized rerun. A browser
fixture incorrectly extended expiry beyond the book-age limit and was rejected;
the corrected fixture passes. A concurrency guard-removal test initially waited
on the deliberately unbounded fifth request; it now checks the response before
awaiting completion, releases every test request and has a runner timeout. The
first live browser test assumed Uniswap would load first; it now explicitly
selects that market. Each failed attempt preceded the final passing checks.

## Sources

- [Uniswap Base deployments](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments)
- [QuoterV2 interface](https://raw.githubusercontent.com/Uniswap/v3-periphery/main/contracts/interfaces/IQuoterV2.sol)
- [QuoterV2 implementation](https://raw.githubusercontent.com/Uniswap/v3-periphery/main/contracts/lens/QuoterV2.sol)
- [Hyperliquid L2 book](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Hyperliquid tick and lot size](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size)
