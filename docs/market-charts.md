# Candles and recent trades

Degen and perpetuals use the same locally bundled TradingView Lightweight Charts
renderer. Candles have a price scale, time scale, separate volume pane,
last-price line and crosshair. MA7, MA25 and MA99 use reported closing prices;
each can be toggled in the chart legend. An average starts only when enough
bars exist. Drag to pan, use the mouse wheel or pinch to zoom, and drag the axes
to adjust the scale. Keyboard users can focus the chart: arrows inspect candles,
Home/End select the first/last candle, plus/minus zoom, Page Up/Down pan, and zero
returns to the latest range. Refresh preserves the current zoom and position.
The chart time axis and candle readout use UTC.

Both views offer 1m, 5m, 15m, 30m, 1h, 4h, 1d and 1w. Up to 300 candles are kept
for a period. Panning is limited to loaded history; this is not an unlimited
historical chart or a drawing suite.

GeckoTerminal supplies the Degen pool history. The reader verifies the selected
base token and pool before fetching it. Thirty-minute candles combine reported
15-minute candles; weekly candles combine reported daily candles on Monday UTC
boundaries. Open, high, low, close and volume are aggregated, with the first
truncated bucket excluded. Missing source bars are not fabricated. Hyperliquid
supplies its native intervals; its weekly bars start on Thursday UTC.

## Degen discovery and trades

The chain selector fetches the selected network's trending/new pools and scopes
GeckoTerminal search. Solana, Ethereum, Base, BNB Chain, TON, Sui, Arbitrum,
Polygon, Avalanche and Optimism are available directly. More networks can be
loaded from the provider catalogue under Data sources. Availability depends on
the provider's coverage. A discovery chain does not acquire wallet or trading
support by appearing in this menu.

The selected pool's recent trades appear in aligned Time, Type, USD, Amount,
Price and Size columns. Buys are green and sells red; text also identifies the
side. Size markers describe the reported trade value, not a trader's wealth:
shrimp below $1,000; fish from $1,000 to below $10,000; whale at $10,000 or above.
The label and threshold are accessible on hover/focus.

Trade direction is checked against the selected token's input/output addresses.
Conflicting duplicate events, mismatched tokens, malformed values and future
observations are rejected. Wallet/maker addresses are not retained. These are
provider-reported trades, not independently proved settlement or executable
orders. The view keeps the newest 100 observations and displays up to 60. It
does not provide complete transaction history or streaming execution data.

## Refresh and offline behavior

Trades poll approximately every 15 seconds while visible and automatic updates
are enabled. Discovery refreshes about every 65 seconds. Hidden, offline,
superseded and paused requests cannot install later results. Manual refresh
still works when automatic updates are off. Observations, candles and trades
are saved locally; these are public-data caches, not encrypted account backup.

The relay coalesces duplicate requests, caches trades for ten seconds, other
market reads for sixty seconds and network catalogues for one hour. It permits
four distinct concurrent reads, 24 GeckoTerminal request units and 40 DEX
Screener units per minute. A candle read costs two units. Provider throttling
sets a shared cooldown and Retry-After response; the selected chart and tape
retry after that delay and preserve earlier data. Chart requests are debounced
when the selection changes. Free upstream limits can still delay a new chart;
these controls do not guarantee continuous or low-latency feeds.

Successful pool candles are also stored in a shared server SQLite cache. Up to
200 pool/interval snapshots are retained across preview restarts, each bounded
to 250 KB. Records are revalidated against their exact request before use;
older observations cannot replace newer ones. During throttling or source
failure the relay can return this history with an explicit saved flag and a
retry delay. The browser shows its saved timestamp and keeps retrying. An
uncached pool remains waiting until data arrives. This cache stores public
market data only and is separate from account and payment storage.

Production availability still requires sufficient provider capacity and tested
fallback coverage. A fallback must match the chain, token, pool, quote currency
and interval; a different pool or a synthetic candle is not an interchangeable
substitute. AI inference does not increase market-data quotas.

The chart renderer runs locally with no CDN or chart-service request. Its
[package and licenses](../web/public/chart-vendor/README.md) are pinned. Chart
objects and observers are disposed when a view is replaced.

## Verification

- [Parser, routing and interval checks](../integrations/degen-verification.json)
- [Hyperliquid tape checks](../integrations/market-tape-verification.json)
- [Discovery browser checks](../web/degen-browser-results.json)
- [Trade, retry and lifecycle checks](../web/degen-feed-browser-results.json)
- [Perpetuals browser checks](../web/terminal-browser-results.json)
- [Public chain and chart reads](../integrations/market-charts-live-results.json)
- [Public browser and offline reload](../web/degen-live-browser-results.json)

Browser checks use disposable Edge profiles and both themes. Provider reads are
public and submit no financial transaction. Windows testing does not establish
physical phone or native-app behavior.

## Switching speed

Trending and New pools keep separate snapshots. After a successful active feed,
the alternate feed is warmed while the page is visible and updates are enabled.
Switching to a snapshot younger than one minute paints it immediately without
another feed request. Expired server feed caches return with their original
saved time while a coalesced request refreshes them. Hidden/offline pages cancel
warming; prefetched results never replace a different selected feed.

Perpetuals retain up to eight market/interval snapshots, including migration of
the previous single saved chart. Revisiting an interval paints its saved candles
while a fresh checked book and candle response loads. Hyperliquid metadata,
book and candles start concurrently; listing and identity validation still
precede display of the result. The collapsed candle table is built only when
opened, and the chart engine handles resizing without rebuilding that table.

[Switch timings](../web/degen-switch-browser-results.json) measure cached clicks
to the next frame with synthetic feeds at desktop and phone viewport sizes.
They do not measure first-load provider latency or physical phone performance.

## Chart analysis adapter

The [NEAR AI adapter](../integrations/chart-analysis.mjs) prepares analysis from
the selected public chart and an explicit question. It normalizes either pool
candles or a Hyperliquid snapshot, includes source age and moving averages, and
excludes order-book, account and private-chat fields. The question itself is
sent as entered; it must not contain secrets. Returned text carries the chart
identity and observation time, so a future interface can reject replies for a
superseded selection. It must render the answer as text, with its source age,
and keep analysis separate from order approval.

The adapter uses the server entry point of `@nearai/inference-sdk`, E2EE and
strict up-to-date gateway/model attestation policies. It awaits response
signature verification before returning text, rejects model tool calls, and
grants no financial authority. Signature verification establishes response
provenance, not the accuracy of an analysis or the safety of a trade.

No public route or visible AI control invokes the adapter yet. Deployment needs
Node 24.22.1 or later, a reviewed pinned SDK installation, a supported NEAR TEE
model, and a NEAR AI Cloud account with credits and a server-side API key.
Keep the key in host secret configuration. An authenticated endpoint with
per-account quotas, request timeout/cancellation and usage limits is required
before enabling paid inference. Current tests inject an SDK fixture; no live
inference, attestation or encryption exchange has been verified.

Official references: [JavaScript SDK](https://docs.near.ai/cloud/inference-sdk/javascript.md)
and [Cloud setup](https://docs.near.ai/cloud/quickstart.md).
