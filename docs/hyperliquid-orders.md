# Hyperliquid orders in Lenz

Spot, perpetual and prediction trading show the shared **Coming soon** dialog in
the current app. Charts and public market data remain available. Testnet funding,
orders, fills, cancellation and same-wallet recovery have not completed a live
acceptance journey. The adapter checks described below do not enable trading.

The retained adapter has an order form for supported markets. Its component tests
cover wallet connection, funds checks, size and limit price, explicit public
execution, and review before signing. Returning from another market category
retains the editable draft during the current page session. The release gate keeps
this form unavailable in the current app.

For supported perpetuals, the connected wallet's selected position shows direction,
size, entry price, unrealized P&L, liquidation price and margin used. Values carry
their read time; use Refresh position to update them. Missing risk values remain
unavailable. Account changes and going offline remove actionable position data.

Close with limit refreshes that position and fills the opposite direction and
current size with Reduce only enabled. Enter a limit price and review before
signing. The privacy choice stays unchanged. Position size is checked again before
and after signing; a smaller or reversed position requires a new review. A closing
limit order can remain open or fill partially; submitting it does not mean the
position has closed.

The native path covers USDC spot markets and default-venue perpetuals using a
standard Hyperliquid account (`userAbstraction: disabled`). Builder perpetuals,
outcomes, other quote assets, unified accounts and portfolio margin are not enabled.
Unsupported markets remain browsable and offer an explicitly external venue link.

## Funding and authority

Orders use [HyperCore testnet](https://app.hyperliquid-testnet.xyz/trade).
Test funds requests send a reviewed grant of test USDC from Lenz's configured
distributor into separate spot and perpetual balances. A new empty account first
approves Standard mode in its wallet. Grants require actual distributor inventory;
an unavailable distributor does not create a balance. Retained requests are checked
through the same wallet and original request. Funding, orders and positions are
public on Hyperliquid. Native withdrawal and leverage changes are not connected.

Connecting reads the selected address and balances; it does not sign. Execution
requires a separate public-route choice and wallet signature for one GTC limit
order. No agent key, token allowance, builder fee or withdrawal authority is requested.
The current connection implementation recognizes Ethereum, Arbitrum and Base.
The external wallet must support Hyperliquid's EIP-712 signing domain; compatibility
with a particular installed wallet still requires verification.

Fresh execution metadata resolves the selected market ID, token indices, collateral
and precision. Perpetual review includes current mark price, margin mode, leverage
and reduce-only status. Margin and fees are estimates, not a signed cap on venue
charges. Cross margin can expose other cross-margin funds to losses. Lenz rechecks
funds, fees, mode, leverage and the estimated budget both before and after signing;
the exchange remains authoritative at execution.

## Status and recovery

Lenz saves an encrypted local attempt before asking for a signature, then records
submission before sending. Status is checked against the same account, client order
ID, market, side, original size and limit price. Older responses cannot reverse
observed fills or completed outcomes. A successful HTTP response alone does not
establish a fill.

If a client-ID lookup is missing, Lenz checks that wallet's historical and open
orders for the exact client ID. It never substitutes another order with similar
price and size. Reported fills require matching order and trade IDs, market,
direction, price bounds, quantities, timestamps and fees. Missing, duplicate or
conflicting fill records leave the request unresolved. Provider history is capped;
absence from the available records does not prove that an order was never sent.

The 60-second signed expiry limits when the action can be submitted. An accepted
GTC order remains open until filled or cancelled. Cancelling requires a separate
signature, and already-filled quantities remain filled.

An expired attempt that never reached submission can be marked not sent. A missing
lookup after possible submission remains uncertain; Lenz does not automatically
create another order. Saved activity stays readable offline, with its saved time.
Users can export local history and explicitly clear resolved records. Open and
uncertain records remain, and nonce history survives clearing visible activity.
The external wallet remains the spending account. Local order history is not
included in a Lenz account backup; after losing the device, recover the same wallet
and reconcile its venue account before approving further activity.

Local encryption protects stored records, not public venue activity or a compromised
application origin. This flow provides neither private settlement nor offline order
execution. Those integrations remain active work alongside lending and liquidity.

## Validation and interfaces

The browser checks use isolated stores, an ephemeral signer and simulated exchange
responses. They cover review/back, reconnect, cancellation, account changes during
signing, expired pre-submission recovery, status races, margin-mode changes and
history cleanup. Recovery checks also cover missing lookups, exact historical and
open-order binding, partial cancellation, and rejected duplicate or changed fill
evidence. These are isolated tests. Live execution evidence must separately verify
funding, order receipts, fills and balances; market reads do not prove execution.

- [Info endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/info-endpoint)
- [Exchange endpoint](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/exchange-endpoint)
- [Signing](https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/signing)
- [Margin rules](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margining)
- [Official signing test vector](https://github.com/hyperliquid-dex/hyperliquid-python-sdk/blob/master/tests/signing_test.py)

The MessagePack codec is pinned and built by `web/hyperliquid-tools/build.mjs`.
EIP-712 hashing and signature recovery reuse the existing pinned ethers bundle.

## Section Account views

Supported Spot and Perpetuals sections have separate Markets, Trade and Account
views. Account reuses the shared funds summary and P&L layout, with Balances,
Positions, Open orders and History below. Switching views preserves the market
and editable order; it does not approve an order.

Trading history loads only after an explicit action. It covers available native
USDC perpetual fills from the last 30 days, with trading fees included and funding
payments and open-position gains excluded. Spot cost basis, builder venues and
other collateral performance remain unavailable. Missing figures stay unknown.
The selected address is sent to Hyperliquid for this read. History is encrypted
on this device and scoped to its Lenz identity; it is excluded from chat backups.
Balance hiding also removes the chart. Account changes and interrupted reads
discard pending history.

[Account verification](../web/market-account-verification.json) records tested
boundaries. Live market reads and disposable provider tests are separate from
real financial execution.
