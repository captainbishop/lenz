# Prediction events

Predictions shows a selection of public events from Polymarket, Kalshi and
Hyperliquid. Search, categories and the All markets selector filter this selection.
Activity ranks events within each provider because their volume units differ.
Polymarket reports USD; Kalshi reports contracts. Event details retain independent
markets, closing dates, price basis and resolution rules. Missing quotes stay unknown.

Polymarket and Kalshi links open their own sites. Kalshi event codes can be copied
for lookup. Hyperliquid events open Lenz's existing chart and market controls;
outcome order execution remains unavailable. These prices are observations for
discovery, not executable quotes or guaranteed probabilities.

Save events offline stores public event snapshots on this device. Failed providers
retain earlier events with their original read times. Saved Hyperliquid event
details remain readable without a separately saved native catalogue. An open
detail view keeps the price snapshot it opened with and labels it when offline,
stale or superseded. Reopen the event to see newer prices.

Overview includes CoinMarketCap market cap, 24-hour volume and BTC dominance.
Refresh overview refreshes these figures; Save overview offline includes them.
Public data reads use fixed provider endpoints and bounded responses. Event
artwork is relayed from approved hosts as PNG, JPEG or WebP with bounded size.
These requests contain no wallet address or signing authority. Kalshi artwork is
resolved lazily from metadata for the exact event ticker. A grouped event uses its
event image instead of presenting a featured candidate as the whole event.
Hyperliquid price events use existing local artwork selected by the template's
underlying asset parameter. Anthropic IPO events have an exact company mapping.
Unverified or unavailable event images retain the neutral prediction illustration.

Run `node --test integrations/prediction-catalog.test.mjs web/prediction-relay.test.mjs`
and `node web/predictions-browser.test.cjs` for provider, boundary and browser checks.

Sources: [Polymarket discovery](https://docs.polymarket.com/market-data/discover-markets),
[Kalshi events](https://docs.kalshi.com/api-reference/events/get-events),
[CoinMarketCap public API](https://coinmarketcap.com/api/documentation/pro-api-reference/keyless-public-api/).
