# Wallet actions and token lookup

[Connect an existing browser wallet](wallet-connection.md) separately for its
Ethereum, Arbitrum or Base native balance and chain-specific Receive address.
The token watchlist below does not become spending authority through connection.

Send selects a person before showing the amount. Scanning opens the existing
local QR reader and contact-verification flow. Existing contacts can be selected
again; new IDs require confirmation. EVM addresses are rejected as Lenz IDs.
Receive displays the user's Lenz QR immediately, with share/copy actions and
received-payment import under a disclosure. These are offline tUSD receiving
IDs, not EVM or Zcash addresses. Camera denial offers ID/image input.

The three wallet actions and close controls use SVG icons with accessible names.
The recipient dropdown has been replaced with keyboard-operable person rows.
Both wallet and chat keep their existing identity, vault and financial handlers.
Section links lead to tokens, payments, people and DeFi.

## Adding a token

Choose Ethereum, Arbitrum or Base and enter a contract. An optional wallet address
reads its ERC-20 balance. Explicit consent precedes sending either address to
the fixed network provider. No wallet connection, signature or allowance is
requested, and watching an address does not grant authority over its funds.

The reader checks chain ID, a recent canonical block, deployed code, bounded
name/symbol/decimals and `balanceOf` when an account is supplied. RPC observations
are not independent chain proofs or token audits. Calls have fixed gas, time,
response and concurrency limits. Unsupported or nonstandard contracts can fail.

Reference valuation is available only for the reviewed WETH/USDC contract pairs
on those networks, through the existing checked Chainlink feeds. Symbols never
select a price. An unknown token shows **Price unavailable**; adding its contract
alone does not create a market price. Valuations use integer arithmetic and are
not executable quotes. Watching tokens never adds to the tUSD balance.

Saved snapshots are encrypted with an identity-bound, nonextractable key in the
existing IndexedDB transaction. Opening/reloading the wallet does not send
account reads. Update reopens the lookup for fresh consent. Offline snapshots
show their saved time; balances follow the wallet visibility control. Removal,
broader price mappings, injected-wallet connection and native tokens remain open.

## Evidence

- [Browser flows](../web/wallet-actions-browser-results.json): local QR decoding,
  camera-denial handling, recipient selection, consent/races, encrypted token
  snapshots, offline reload, light/dark and phone/desktop layouts.
- [Token read tests](../integrations/token-watch.test.mjs) and
  [HTTP boundaries](../web/token-relay.test.mjs): seven fixture groups.
- [Live metadata/price reads](../integrations/token-watch-live.json): Ethereum
  USDC, Arbitrum USDC and Base WETH, without an account or transaction.

No physical phone/camera, user wallet connection, live balance-owner relationship
or financial submission is established by these checks. Visual acceptance remains
pending.
