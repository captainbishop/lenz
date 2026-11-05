# Degen discovery

Open **Markets → Degen** to browse trending and newly indexed pools, search a
token or address, or open a DEX Screener or GeckoTerminal pool link. Search reads
both providers. The chain selector requests the selected chain directly.
Trending and New pools use GeckoTerminal's first result page;
they are not a complete feed of token launches or an organic-volume ranking.

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
a trusted token recommendation. Open source opens the corresponding provider.

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

## Requests, privacy and offline use

`POST /api/degen/read` accepts a bounded, validated request from the local app
origin. Provider hosts are fixed; supplied URLs are parsed into supported pool
references and are never fetched directly. Redirects, excess fields, oversized
responses and substituted pool/token data are rejected. Source metadata is
rendered as text. Remote token icons and arbitrary website links are not loaded.

Reads are coalesced and cached with their original timestamps: ten seconds for
trades, sixty seconds for market discovery/candles and one hour for networks.
The relay permits at most four distinct concurrent reads, 24 GeckoTerminal
request units and forty DEX Screener request units per minute. A candle request
uses one unit, including token validation. The free provider limits can
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

## Provider references

- [DEX Screener API](https://docs.dexscreener.com/api/reference)
- [GeckoTerminal API](https://www.geckoterminal.com/dex-api)
