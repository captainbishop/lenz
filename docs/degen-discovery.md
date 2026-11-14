# Degen discovery

Open **Markets → Degen** to browse trending and newly indexed pools, search a
token or address, or open a DEX Screener or GeckoTerminal pool link. Search reads
both providers. The chain selector requests the selected chain directly.
Trending and New pools start with one page. **Load more tokens** appends the next
page while retaining the selected token and chart. Each feed and chain supports
up to ten pages, normally twenty pools per page; pools for the same token are
grouped. Search and chain selection reach beyond the initial list. These feeds
are not a complete inventory of tokens or an organic-volume ranking.

Select a token to inspect its pools, liquidity, reported price, volume and market
cap. The largest reported-liquidity observation supplies the token row. Provider
observations remain separate: liquidity and volume are never added across feeds.
Missing market cap is shown as unavailable, with FDV separately in Token details.
DEX Screener boosts are labelled where reported. Listing is not endorsement.

Candles offer eight periods from 1 minute to 1 week using GeckoTerminal's pool OHLCV. The reader
requests USD candles for the selected token address and verifies it against the
response's base/quote identities. This uses one request and supports tokens whose
orientation differs between listing providers. No candles are fabricated when
an interval or pool is unavailable.
Arrow keys inspect individual candles. The last candle time and read time remain
separate; a recent response does not imply recent trades.

The star saves a token on this device. Watchlist refresh reads the selected pool;
other entries retain saved prices. Copy token link produces a Lenz market link
which can be pasted into a conversation. It does not send a message or establish
a trusted token recommendation. Market navigation stays inside Lenz.

## Coverage and identity

The [data model](../web/public/degen-model.js) separates source observations from
the execution catalogue. Known network aliases share a chain identifier. Unknown
networks retain a provider-specific identifier and can appear without new UI
code; merging them across providers requires an explicit reviewed mapping.
Tokens are grouped by chain and address, never ticker. Case-sensitive addresses
remain case-sensitive; hexadecimal addresses are normalized for comparison.

Discovery does not register a chain RPC, request a wallet, grant spending
authority, or make a venue executable. Every observation carries
`executable: false`. Recent buys/sells are displayed as reported observations.
Their direction, quantity and price follow the selected token's transfer leg,
including when the provider lists that token as the quote side of its pool.
This screen provides no order submission, position management,
launch-curve migration verification or private settlement. Those require the
actual venue interfaces and independently verified authorization and outcomes.
Adding a source is independent of implementing an execution adapter.

## Swap quotes

Eligible Base listings expose **Quote swap** beside the selected pool. Allow
public pool and amount queries to check the pair, choose Buy or Sell, and enter
the amount to pay. Buy spends the pool's other asset to receive the selected
token; Sell spends the selected token. The form shows both contract addresses,
the expected output, minimum received and included pool fee. Long amounts use
an approximation marked ≈; **Quote details** retains every decimal. Network fees are
excluded. A quote does not establish token safety or the ability to sell later.

`POST /api/degen/quote` supports exact-input quotes for registered Base Uniswap V3
pools with active liquidity and tokens using at most 18 decimals. The backend
checks the factory registration, token identities, token decimals, pool state
and QuoterV2 identity at one recent canonical block. Discovery labels cannot
substitute the pool, token or quote direction. Integer units determine amounts
and minimum output; slippage is bounded to 0–500 basis points. Unsupported
venues and tokens return unavailable rather than a fabricated price.

The relay accepts same-origin JSON requests up to 1 KB, uses a fixed RPC host,
coalesces duplicate requests and permits two distinct reads at once. It cancels
work after the last viewer leaves and does not cache completed quotes. Requests
disclose pool/token identifiers and the entered amount to the Lenz server and
public RPC. Quotes contain no wallet address or spending authority.

Results expire within 30 seconds of observation and 60 seconds of the source
block. Editing terms, changing direction, revoking consent, going offline,
hiding the page or closing the dialog clears the result. Late responses and
changed pair metadata cannot restore it. Quotes are not saved offline.

This flow returns `executable: false`. A current quote can proceed to the wallet
check below. Exact approval and swap signing, durable submission,
settlement/finality, recovery, additional chains/venues and private or offline
execution require further implementation.

## Wallet and fee checks

After a quote, **Wallet & fees** connects an externally owned EVM wallet. A
separate checkbox permits sharing its address for public checks. If needed,
**Switch to Base** requests that network explicitly. **Check wallet & fees**
shows the input-token and ETH balances, current approval requirement, simulated
spend/receive amounts and estimated total network fees. A token shortage skips
simulation; insufficient ETH is shown separately from successful token execution.
Connection and simulation grant no spending authority.

`POST /api/degen/preflight` accepts the current quote, account and public-query
consent in at most 8 KB. It shares the quote route's two-read limit, cancellation
and no-cache behavior; different accounts cannot share results. The backend
rechecks pool metadata and the fixed Base SwapRouter02 identity, then reads
balances and allowance at a recent canonical block. One `eth_simulateV1` call
runs balance reads, any needed allowance reset/exact approval, a deadline-bound
swap, and final balance reads. It supplies no signatures or state overrides.
The exact input decrease and output increase must match the swap and minimum.
This checks the selected transaction's effects, not general token safety or
future sellability.

For each approval and swap, the estimate includes L2 gas with a 20% gas buffer,
the gas oracle's L1 data-fee upper bound and its operator fee. Missing fee data
fails the check; it is never replaced with zero. These are current estimates,
not guaranteed future charges. The RPC supplies the observations; Lenz does not
independently prove chain state. Unsigned simulation with validation disabled
does not verify an account's ability to authorize a transaction.

Wallet checks expire no later than their quote and within 60 seconds of the
observed block. Freshness is checked after the final wallet identity read.
Expiry, edited terms, account/network events, revoked consent, hidden pages,
offline transitions and dialog closure clear results. Silent wallet changes are
also checked before and after each request. No result or connected account is
saved by this flow. The response remains `executable: false`; no approval or swap
is signed or submitted.

## Requests, privacy and offline use

`POST /api/degen/read` accepts a bounded, validated request from the local app
origin. Provider hosts are fixed; supplied URLs are parsed into supported pool
references and are never fetched directly. Redirects, excess fields, oversized
responses and substituted pool/token data are rejected. Source metadata is
rendered as text. Remote token icons and arbitrary website links are not loaded.

Reads are coalesced and cached with their original timestamps: ten seconds for
trades, sixty seconds for market discovery/candles and one hour for networks.
The relay permits at most four distinct concurrent reads and starts reads at
least 2.5 seconds apart for GeckoTerminal and 1.5 seconds for DEX Screener.
Selected cold charts take priority over background refreshes, with bounded
fairness and a ten-second maximum queue wait. Long provider cooldowns return
retry instructions immediately. Leaving the last foreground viewer cancels its
pending read. Saved responses return immediately with their original timestamps
while one bounded background refresh continues. A candle request uses one unit,
including token validation. The free provider limits can
still produce unavailable responses; no streaming or trading-latency guarantee
is made. Automatic refresh runs approximately every 65 seconds only while the
workspace is visible and automatic data updates are enabled. Trades poll about
every 15 seconds, with bounded retries after throttling. The relay retains the
last trades for each exact request during failures; the UI labels them Saved and
keeps their original time. Charts retry temporary server/network failures as well
as rate limits. Search and refresh
remain explicit actions when automatic updates are paused.

The providers and local server can see public token queries. Watchlists, public
observations and candles are stored in browser local storage, not encrypted
account backup. Financial records and chat identity storage are not accessed.
Saved data remains available offline; failed refreshes retain earlier data, and
superseded or hidden-page responses cannot replace the current view.
Saved price/candle updates from another tab do not rebuild the current chart or
restart its request. Only actual watchlist changes update the watchlist UI. This
preserves chart selection and prevents tabs from bouncing requests between each
other during a provider retry window. Feed refreshes also preserve a pending
chart request or its retry delay within the same tab, including before the first
candles arrive. Selecting another token or interval starts its own request.
All candle history still comes from GeckoTerminal: indexed pool coverage,
source latency and the shared request
budget can produce different loading times or unavailable charts across tokens.

## Verification

The current [market chart and trade checks](market-charts.md#verification) cover
chain discovery, trade direction, exact-pool candles, throttling, chart controls,
visibility, offline retention and public provider reads. Earlier discovery reads
remain recorded in [public reads](../integrations/degen-live-results.json).

The [loading checks](../web/degen-loading-browser-results.json) cover repeated
feed updates, slow reads and separate tabs during chart backoff. The
[recovery checks](../web/degen-recovery-browser-results.json) exercise network
failure, a temporary server failure and saved trade recovery. These use
disposable browser contexts and controlled API responses, not live availability.
Scheduler tests cover queue deadlines, priority, fairness, cancellation and
provider retry instructions. These do not measure live stream latency.

Quote checks run with:

```sh
node --test integrations/degen-quotes.test.mjs web/degen-quote-relay.test.mjs web/degen-quote-ui.test.mjs
node web/degen-quote-browser.test.cjs
```

They cover pool/token binding, exact amounts and minimums, malformed responses,
relay origin/concurrency/cancellation, consent, edits, expiry, stale replies,
offline behavior and keyboard focus. Browser checks use disposable contexts
and controlled API responses at desktop and phone widths in both themes. These
checks do not execute a swap or verify real-fund settlement.

## Provider references

- [DEX Screener API](https://docs.dexscreener.com/api/reference)
- [GeckoTerminal API](https://www.geckoterminal.com/dex-api)
