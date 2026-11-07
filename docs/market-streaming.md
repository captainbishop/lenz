# Native Hyperliquid market data

With live mode enabled, the selected perpetual chart reads an initial history snapshot, then receives public candle and order-book events through the same-origin Lenz relay. It does not poll the entire chart every ten seconds. Manual refresh remains available when live mode is off.

Changing interval, hiding the page, going offline or leaving the market closes the subscription. Reconnect reloads history without replacing newer accepted book or candle data. Source timestamps, candle trade counts and market/interval binding are checked independently. Old candles remain marked delayed even when book updates continue.

The relay accepts public market identifiers only: no wallet addresses, signing requests or caller-supplied upstream URLs. It caps simultaneous streams at eight and new starts at twenty-four per minute. A hosted deployment must size shared provider quotas for its viewers.

The shared chart renderer preserves keyboard inspection and follows arriving bars when the viewer is at the live edge. Panned historical views remain anchored when the retained history window advances.

Validation: market-stream.test.mjs, market-stream-browser.test.cjs, market-relay.test.mjs, market-tape.test.mjs, chart-intervals.test.mjs and the existing Degen/offline-cache browser checks. Browser coverage uses disposable desktop/phone Edge contexts and synthetic providers; physical-device and production-load behavior remain separate.

The public feed has no millisecond delivery guarantee. This change does not supply external DEX pool data, trading execution or private settlement. Protocol reference: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/websocket .
