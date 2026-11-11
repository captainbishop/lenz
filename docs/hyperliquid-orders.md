# Hyperliquid orders in Lenz

Supported Hyperliquid markets now have an order form below their chart. Choose a
market, connect an external wallet, check funds, enter a size and limit price,
choose public execution, and review before signing. Returning from another market
category retains the editable draft for that market during the current page session.

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

Deposit and withdrawal open Hyperliquid's [official interface](https://app.hyperliquid.xyz/trade).
Use the same wallet there, then return to Lenz and refresh funds. Native funding,
withdrawal and leverage changes are not connected. This path does not turn NEAR
test dollars into mainnet collateral or represent a completed cross-chain route.

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

The 60-second signed expiry limits when the action can be submitted. An accepted
GTC order remains open until filled or cancelled. Cancelling requires a separate
signature, and already-filled quantities remain filled.

An expired attempt that never reached submission can be marked not sent. A missing
lookup after possible submission remains uncertain; Lenz does not automatically
create another order. Saved activity stays readable offline, with its saved time.
Users can export local history and explicitly clear resolved records. Open and
uncertain records remain, and nonce history survives clearing visible activity.

Local encryption protects stored records, not public venue activity or a compromised
application origin. This flow provides neither private settlement nor offline order
execution. Those integrations remain active work alongside lending and liquidity.

## Validation and interfaces

The browser checks use isolated stores, an ephemeral signer and simulated exchange
responses. They cover review/back, reconnect, cancellation, account changes during
signing, expired pre-submission recovery, status races, margin-mode changes and
history cleanup. No real wallet signature, order, deposit or withdrawal was used.
Live metadata was read separately; it is not execution evidence.

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
