# Hyperliquid markets

The Spot, Perpetuals and Predictions sections discover native spot pairs, native
and builder perpetual venues and HIP-4 outcomes. The Predictions section includes binary and
other bounded outcome contracts. Market availability comes from current metadata;
registration alone does not establish liquidity.

Navigation groups activities. Hyperliquid and its builder venues appear in the
venue selector. Lend & Borrow and Liquidity retain their own sections. Overview
provides the existing cross-category summary. Bundled logos appear beside market
names; missing artwork uses a monogram, and outcomes use a neutral event icon.

Search and venue filters retain each market's quote or collateral asset. Outcome
sides share one market entry. Remote names and resolution descriptions render as
text. Spot metadata is joined by token index and exact context coin, since the
provider's arrays are sparse and contain mixed instrument types.

Entering a section opens its highest-volume matching market. Search and venue
changes select a matching market when the previous selection is filtered out.
Inline timeframe buttons and labelled utility icons use the native chart controls.
Selecting a market seeds its chart and book, then receives candle, book and
trade events through the same-origin relay. Automatic updates controls streaming.
Only the selected market subscribes. Empty history and empty book sides are valid;
old candles are marked delayed independently of book updates. Navigation, hidden
pages, offline mode and live-off cancel the subscription. Catalogue requests are
shared while consumers remain and stop when the final consumer leaves. Malformed
or unavailable sources leave healthy catalogue sections available.

Save offline stores the public catalogue on this device, with its observation time.
Existing charts remain visible offline; selecting an unsaved chart asks for a
connection. The catalogue does not save a live feed or enable offline trading. No wallet address,
trade participant address, signing key or financial authorization is requested.
Trade events sent to the browser contain market, time, side, price, size and ID only.

This is a read-only discovery feature. It does not add order execution, lending,
vault deposits or a settlement connection to NEAR. HyperCore data is not a feed for
arbitrary external-chain pools. There is no guaranteed update cadence.

Run `node --test integrations/hyperliquid-catalog.test.mjs web/hyperliquid-feed.test.mjs`
and `node web/hyperliquid-browser.test.cjs` for synthetic provider, relay and browser
checks. Browser tests use disposable profiles and do not execute financial actions.

Provider references: [HIPs](https://hyperliquid.gitbook.io/hyperliquid-docs/hyperliquid-improvement-proposals-hips),
[asset IDs](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/asset-ids),
[subscriptions](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket/subscriptions).
