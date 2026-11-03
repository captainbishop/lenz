# Chainlink reference prices

Markets → Prices reads 18 Chainlink USD feeds from four mainnets. Opening this
view starts automatic reads; **Data settings** can pause them. The ordinary
market, pool-price and Hyperliquid tape readers remain separate.

| Feed network | Connected USD pairs |
| --- | --- |
| Ethereum | BTC, ETH, LINK, USDC |
| Arbitrum | BTC, ETH, LINK, USDC, NEAR, HYPE |
| Base | BTC, ETH, LINK, USDC |
| HyperEVM | BTC, ETH, USDC, HYPE |

The network identifies where the oracle contract is deployed. For example,
NEAR/USD on Arbitrum is a NEAR reference price; it does not establish a NEAR-native
oracle connection, bridge or trading route. HyperEVM feeds are distinct from the
HyperCore market/order API. Aurora and NEAR-native price adapters remain open.

## Sources and validation

[The pinned catalogue](../web/public/oracle-feeds.js) records each proxy,
description, precision and heartbeat. These were checked against Chainlink's
[official address directory](https://docs.chain.link/data-feeds/price-feeds/addresses?network=arbitrum)
on November 4, 2026, including its embedded Ethereum, Arbitrum, Base and HyperEVM
metadata. Base BTC and ETH use the listed standard secondary proxies, not an
SVR auction interface. No dependency installation or consumer deployment is needed.

The reader verifies chain ID, a recent block hash, deployed code, `description`,
`decimals` and `latestRoundData`. It rejects nonpositive prices, incomplete rounds,
zero/future timestamps, updates older than the feed-specific heartbeat, and a
changed canonical block. Base and Arbitrum also require the documented
[sequencer uptime feed](https://docs.chain.link/data-feeds/l2-sequencer-feeds) to be
up for more than one hour. The browser independently checks the response shape,
network, fixed feed identity, precision, timestamps and non-executable status.
Older observation/block/round replies cannot replace newer values.

Reads use EIP-1898 block hashes with `requireCanonical`, then recheck that block.
This relies on the public RPC response over HTTPS; it is not an independent
light-client proof or verification of oracle signatures. Proxy code presence and
description checks are not a contract audit. A failed individual feed displays
Unavailable; a failed network read retains its earlier prices with a failure state.

Fixed RPC sources: [Ethereum PublicNode](https://ethereum.publicnode.com/),
[Arbitrum One](https://docs.arbitrum.io/chain-info), Base `mainnet.base.org`, and
[HyperEVM](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/hyperevm).
The local `/api/markets/oracles` accepts only a reviewed network name and checks
Host/Origin, body size and content type. It cannot accept an arbitrary URL,
contract, account or transaction. Identical network reads are coalesced and cached
for 15 seconds, or 30 seconds for HyperEVM, without changing source timestamps.

## Updates and offline use

The screen schedules the next read 15 seconds after completion, or 30 seconds for
HyperEVM. Failures back off to at most 60 seconds. It pauses when hidden, offline,
disabled or outside Prices; late replies cannot restart it. Chainlink publishes
according to heartbeat/deviation conditions, so checking again need not produce a
new round. These are polled Data Feeds, not Data Streams or nanosecond delivery.

The last four bounded snapshots persist separately as `lenz-oracle-prices-v1`.
Offline reload preserves their original update times and labels them as saved.
Saved RPC data is not authenticated storage. No wallet address, typed amount or
account state is sent by this price view. Public providers can observe the reads.

Reference prices do not establish executable swap amounts, full account/risk
validation, private settlement or a trading route. The Base swap still uses its
pool price for immediate indicative arithmetic and separate consent for an exact
checked quote. Connected-carrier price delivery and offline execution remain
active integration work; neither was added by this price reader.

## Evidence

- [Reader and parser tests](../integrations/oracle-prices.test.mjs): nine groups
  covering all networks, wrong chains/blocks, feed identity/precision, stale and
  invalid rounds, L2 outage/recovery and cached data.
- [HTTP boundary tests](../web/market-relay.test.mjs): fixed network inputs,
  Host/Origin rejection, concurrent coalescing and timestamp-preserving caching.
- [Browser fixtures](../web/oracle-prices-browser-results.json): automatic loading,
  exact displayed coverage, hidden update control, search/responsive themes,
  failed-source labels and offline reload with unrelated storage preserved.
- [Live browser evidence](../web/oracle-prices-live-results.json): all 18 feed reads
  across four networks and both themes at desktop/phone widths. No signing,
  account access, quote or financial submission.

The first HyperEVM RPC attempt failed; a diagnostic retry and the subsequent
four-network browser run passed. Physical phones, independent carriers and
independent-chain proof validation are not covered by these Windows checks.
