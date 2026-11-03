# Market discovery

The Markets page loads public mainnet data on request, with categories, search,
market details and optional saved snapshots. Opening it performs no provider
query. Optional [public estimates](market-quotes.md) are now available for the
Uniswap pool and listed perpetuals. There is no account lookup, signer or trading
control. The homepage's separate recorded DeFi gallery remains illustrative.

## Connected reads

| Source | Observed scope | Boundaries |
| --- | --- | --- |
| Uniswap v3, Base | WETH/USDC pool at the 500 fee tier; identity, liquidity and price state | One pool, not aggregate liquidity, a quote or LP position |
| Aave v3, Base | WETH/USDC reserve configuration, LTV, liquidation threshold and active/frozen/paused/borrowing flags | No rates, caps, account health, debt, capacity or position proof |
| Hyperliquid, HyperCore | Default perpetual universe and aligned price/funding contexts; delisting, size decimals and venue leverage | No account, order book, margin tiers, precision-complete order or HIP-3 coverage |

Base reads verify chain ID 8453 and pin a finalized block hash with
`requireCanonical: true`. The adapter checks code presence, token decimals,
pool identity and reserve membership/configuration, then rechecks the canonical
block. WETH has 18 decimals; Base USDC has six. Code hashes are observations,
not approval of deployed code or independent proofs.

Finalized blocks can lag the head: the reader rejects blocks older than one
hour or more than one minute in the future. The page shows block time separately
from observation time. Hyperliquid supplies no timestamp in this response;
its displayed time is local receipt time. Neither response is an execution quote.

## Privacy and persistence

`POST /api/markets/read` accepts only a provider ID from the local Lenz Host and
Origin. Fixed HTTPS endpoints reject redirects; request/response sizes and read
times are bounded. Errors are sanitized. Concurrent reads are coalesced, and
successful responses can be reused for 15 seconds with their original timestamp.
The browser sends no wallet address or credentials. Providers and the local
server see these public queries; proxying does not make them private.

Saving is explicit, using the separate `lenz-market-snapshots-v1` storage entry.
Stored observations display **Saved data**; live-read observations become
**Needs refresh** after 60 seconds. Failed refreshes retain earlier rows with a
failure label. Removal leaves unrelated identity storage untouched. The offline
page cache and saved market observations are separate.

## Route matching

The [matcher](../web/public/defi-market-match.js) narrows the
[route planner](route-planner.md) to observed candidates by exact chain, contract
and precision, or HyperCore instrument/leverage ceiling. Aave borrow/withdraw
uses the requested received reserve; borrowing also requires its enabled flag.
Stale observations retain refresh blockers.

```sh
node integrations/check-market-discovery.mjs
node integrations/preview-route.mjs --file objective.json --markets observations.json
node integrations/verify-market-discovery.mjs
```

The live command writes a report. `--markets` takes an array of observations,
rather than that report wrapper. Cross-chain funding assets, bridges, positions,
fees and private execution remain unverified. Candidates and previews always
have `executable: false`. Snapshot validation checks structure; edited or
caller-supplied observations are not authenticated evidence.

## Verification

[Local verification](../integrations/market-discovery-verification.json) records
26 tests and 20 detected guard alterations with source/test hashes, including
three added quote-API checks. Checks cover
chain/canonical-block substitution, token precision, pool/reserve identity,
context alignment, borrowing flags, exact route assets, timestamps, immutable
data, execution claims and local HTTP boundaries. Thirty-eight existing
route/quote/authentication/relay tests also pass.

[Browser fixtures](../web/markets-browser-results.json) pass seven groups:
explicit reads, filtering/keyboard selection, failed refresh, both themes and
responsive layouts, saved offline reload/removal, and malformed storage. Desktop
and phone screenshots were visually inspected. The shorter homepage copy also
passes seven gallery, five homepage and three screen-response groups.

The [live browser run](../web/markets-live-results.json) passes four groups using
real API/provider responses: one Uniswap pool, two Aave reserves and 235
Hyperliquid entries. Both Base readers used finalized block 53443169. No wallet
database, storage entry or financial operation was created. The earlier
[direct live read](../integrations/market-discovery-live.json) used block 53442392;
it retains every EVM row and the first five Hyperliquid rows with the full count.
Browser fixtures reuse those shapes with synthetic receipt times.

The initial ABI mock accessed an empty ethers `Result`; guarding its length
fixed the fixture. A borrow regression reproduced collateral-reserve selection
instead of the requested borrowed asset, then passed after the matcher fix.
The context-length guard initially survived removal because per-row validation
also rejected missing contexts; an excess-context fixture now detects removal.
An initial restricted-network read failed; the authorized live run passed.

This slice does not complete quotes/execution, private settlement, recovery,
LP management, staking/restaking, farming or claims. Those remain current
integration work. It does not establish real-fund or physical-device readiness.

## Deployment references

- [Uniswap Base](https://developers.uniswap.org/docs/protocols/v3/deployments/v3-base-deployments)
- [Aave Base addresses](https://raw.githubusercontent.com/bgd-labs/aave-address-book/main/src/AaveV3Base.sol)
- [Aave reserve configuration](https://raw.githubusercontent.com/aave-dao/aave-v3-origin/main/src/contracts/protocol/libraries/configuration/ReserveConfiguration.sol)
- [Circle USDC addresses](https://developers.circle.com/stablecoins/usdc-contract-addresses)
- [Hyperliquid perpetual info](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint/perpetuals)
