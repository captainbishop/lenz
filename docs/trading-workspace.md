# Markets and DeFi workspaces

Markets uses separate compositions for swaps, credit, liquidity and perpetuals.
Swaps put editable payment and estimated receipt across an asset route; the large
received amount is approximate, with exact output/minimum retained below. Credit
opens on Supply/Borrow/Repay/Withdraw actions; collateral limits are expandable.
These are reserve settings, not personal borrowing capacity. Liquidity shows the
selected pool assets and fee, with its deposit-execution limit visible.

Hyperliquid combines candles and bid/ask depth above an order rail; phone layouts
switch between Chart, Book and Order. Reviews show transaction terms above inline
editable limits. They save encrypted drafts, not orders. Reduce-only reviews use
Buy/Sell labels without claiming a new long or short position.

The wallet swap has opposing asset amounts and inline route/privacy/protection
controls. Its Supply/Borrow/Liquidity/Stake/Farm/Claims/Withdraw views have no entry
forms or invented balances. Unsupported position/claim reads remain explicit.
The existing Rhea testnet reserve, signing, refund and approval behavior is unchanged.

Wallet Supply, Borrow and Liquidity links open the matching market category and
action. Unconnected actions explain their purpose and unavailable execution;
blank position totals are omitted. This navigation does not supply assets, add
liquidity or establish a current rate. Balance/rate reads, deposit quotes, private
execution, approval and verified position/withdrawal paths remain required.

## Public reads

Opening a perpetual market loads its public candles and order book. Automatic
updates follow the switch in **Data settings**; when paused, selecting a market
or interval makes one read and the refresh icon can request another.
The server reads Hyperliquid metadata, `l2Book` and `candleSnapshot` through
`POST /api/markets/tape`. Supported candle intervals are 15m, 1h and 4h. No account
address is sent. Order estimates retain their separate public consent.

The checked response is immutable and non-executable. Validation binds market,
source, interval and timestamps; rejects crossed/unsorted depth and invalid OHLC;
and limits the response to 100 candles and 20 levels per side. The display uses
up to 96 candles and nine levels per side. Candles retain actual time spacing,
keyboard inspection and an expandable data table. Filled falling candles and
hollow rising candles supplement colour. A faint Lenz watermark sits behind the
plot and does not intercept pointer or keyboard input.

Book validity lasts at most 30 seconds. The screen labels snapshots, expiry,
offline state and failed refreshes. Interval changes clear the previous chart and
book. Pause changes, market changes and offline transitions invalidate pending
requests; late replies cannot replace the current view even if abort is ignored.
Automatic updates read discovery, pool prices and tape on separate schedules.
The last bounded candle/book snapshot is saved separately and shows its original
time offline. Unsaved checked order quotes are not restored as current quotes.

Markets loads and saves public discovery automatically. Hyperliquid discovery and
the current Base pool-price reader schedule another read two seconds after each
completion; Base discovery refreshes after 20 seconds, and the selected tape after
10 seconds. Hidden/offline pages pause, late replies are rejected and errors back
off. **Data settings** holds the pause control; Refresh and Save offline are hidden
while automatic updates are enabled. These intervals add network request time.

The selected price and chart lead the perpetual view. Market statistics and
unavailable account reads are expandable. Phones use a searchable market picker
with themed rows, keyboard selection and offline saved-market access; search
and network filters sit under Data settings. The wallet opens with its offline
balance and labelled Send/Receive/Add tUSD actions. Confirmed, pending and reserved
amounts are under Details, whose label flags pending or reserved funds.

Typing a swap amount recalculates Receive synchronously on the device from the
latest pool price, including the 0.05% pool fee. It excludes price impact and
network fees. **Share amount to check price** is separately unchecked: enabling it
requests a checked quote after 350 ms without typing/clicking an estimate action.
Cached arithmetic remains available offline with a saved-price label.

The [Prices view](oracle-prices.md) adds Chainlink reference prices on Ethereum,
Arbitrum, Base and HyperEVM. They are distinct from venue execution estimates.

The local route retains origin/Host checks, JSON/body limits and sanitized errors.
It coalesces identical in-flight reads and caps distinct concurrent tape requests
at four. Outbound native HTTPS accepts only the fixed Base and Hyperliquid POST
endpoints, rejects redirects, supports cancellation and passes response streams
to the existing bounded parser. This transport also serves discovery and quotes.

## Execution boundaries

Using Lenz requires no preliminary bridge to NEAR. Assets and positions stay on
their actual chain unless the requested route needs a cross-chain transfer.
Hyperliquid uses HyperCore; Aurora is an optional EVM execution component, not a
substitute for HyperCore or a mandatory gateway. Intents routing does not remove
the need to verify a route's funding, destination action and return/recovery legs.
The broader [aggregator scope](crosschain-defi.md) remains current.

Public market data is not a private settlement mechanism. Account positions,
balances, complete fees, margin/liquidation checks, signing and order submission
remain unconnected. The position area says so and contains no fabricated account
data. Funding and liquidation at the venue continue while the user is offline.
An [encrypted draft](route-drafts.md) is neither execution authority nor a funds
reservation; connected execution and reconciliation need separate verification.

## Evidence

- [Parser/relay checks](../integrations/market-tape-verification.json): 14 fixture
  tests and six detected guard alterations. The native transport has separate
  [request/stream/cancellation tests](../integrations/market-http.test.mjs).
- [Workspace checks](../web/terminal-verification.json): seven grouped browser
  checks and a detected late-response guard alteration, with disposable storage
  and synthetic provider responses. Both themes and 320–1440px layouts are
  checked. This does not certify physical-phone behavior or visual quality.
- [Actual provider/browser check](../web/terminal-live-results.json): seven groups
  covering public candles/depth, order and Base swap estimates, credit limits,
  liquidity, both themes and responsive layouts. No draft/order was submitted.
- [Review checks](../web/route-drafts-ui-verification.json) retain atomic-save,
  identity preservation, stale-reply, exact-amount and modal focus coverage.
- [Wallet DeFi checks](../web/defi-approval-browser-results.json) retain private
  default, separate public consent, frozen terms, storage-failure, offline and
  delivery checks with synthetic backing in disposable Windows Edge profiles.

Desktop, phone and review screenshots were inspected locally. The visual result
still needs user review; automated checks cannot establish superior design.
