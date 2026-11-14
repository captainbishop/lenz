# Wallet assets and actions

[Connect an existing browser wallet](wallet-connection.md) separately for its
Ethereum, Arbitrum or Base native balance and chain-specific Receive address.
Balance observations are bound to that wallet and network. Public token details can
be added separately. Connection does not approve spending.

The wallet opens on Tokens, beside DeFi and NFTs. Account and primary actions
remain above these views. A small Activity control opens payment history; People
is available from Send. The redundant visible Wallet heading is removed. DeFi links to
markets, Hyperliquid perpetuals, credit, liquidity and Degen; existing positions
and offline approvals expand within that tab. NFT ownership is not connected.
The tab does not infer that a wallet owns no NFTs.

Send opens on the recipient field. Enter a wallet address, network-qualified
payment link or Lenz ID, then the asset and amount. If funding requires a wallet
connection, entered terms remain in place through selection or cancellation.
Connection alone does not approve a transfer; review the exact terms afterward.
Account changes invalidate reviews, and closed recipient lookups cannot populate
a newly opened Send. Pending transfers must be checked before another send.

Receive chooses ETH, USDC or WETH on the connected reviewed network and displays
the corresponding receiving QR. The external wallet address stays unchanged.
Connecting from Receive returns to the asset list; account changes remove stale
options. Asset choices identify supported transfers, not verified holdings.
Balances and fees are checked during a consented review.

tUSD uses the Lenz ID and appears under Test wallet in the chooser. Its balance,
pending/reserved details and funding control stay together in an expandable row
of Tokens. Imported ERC-20 transfers require a separate review and approval. Asset choices
identify public settlement; connecting a wallet does not shield its funds or
transactions. Custom networks retain their existing receive-only behavior.

For tUSD, Send selects a person before showing the amount. Scanning opens the existing
local QR reader and contact-verification flow. Existing contacts can be selected
again; new IDs require confirmation. EVM addresses are rejected as Lenz IDs.
Choosing tUSD for Receive displays the user's Lenz QR, with share/copy actions and
received-payment import under a disclosure. These are offline tUSD receiving
IDs, not EVM or Zcash addresses. Camera denial offers ID/image input.

The three wallet actions and close controls use SVG icons with accessible names.
The recipient dropdown has been replaced with keyboard-operable person rows.
Both wallet and chat keep their existing identity, vault and financial handlers.
Tabs support arrow keys, Home/End, reload and browser Back/Forward. Earlier section
links still open their matching tab and disclosure. Views change locally without
reading accounts or creating a financial authorization.

## Holdings and discovery

Tokens shows Bitcoin, Ethereum and Solana with their logos from the outset.
Unread balances use a dash; no BTC or SOL account is inferred from a Lenz identity
or an EVM address. BTC and SOL balance/signing connections remain unimplemented.
The selected EVM account supplies its native balance. Rows show quantity, unit
price and fiat value when available. Token display offers Hide zero balances;
unread balances stay visible. Saved balances remain labelled and do not acquire
a current valuation merely because a fresh price is available.

Choosing a wallet permits automatic token discovery after connection. The picker
keeps address sharing and provider details under “What connecting allows”.
There is no discovery checkbox or signature. The small refresh control
reuses that permission within the session. Disconnecting revokes it. Opening or
cancelling the picker, opening a tab and restoring a saved account do not trigger
discovery. A local profile is required to save discovered tokens.

Discovery asks the selected chain's Blockscout instance for its first page of
ERC-20 candidate contracts. Indexer quantities, names and prices are not trusted:
the existing canonical-block token reader checks each candidate. Known spam/scam
entries are filtered; this is not a token audit. Reads are limited to 24 contracts
with three concurrent checks and bounded responses/timeouts. More pages, failed
reads or full local storage are reported as partial coverage. Existing snapshots
are preserved. Storage retains at most 30 imports/discovered snapshots across
accounts, encrypted under the local identity. Unavailable prices retain quantity.

Ethereum, Arbitrum and Base use fixed Blockscout hosts. Direct endpoints were
reachable in this local preview, but production use must satisfy the provider's
current API access policy (including Base's paid access requirements). No API
subscription, key or availability guarantee is supplied by this implementation.

## Adding a token

Paste a contract address, Solana mint or named NEAR token account into Add token.
Public details load automatically after a short debounce, without connecting a
wallet or pressing a lookup button. Labelled, read-only fields show the network,
name, symbol and decimals. The primary action is Add token.

An EVM address alone cannot identify its network: the reader checks Ethereum,
Arbitrum and Base and offers a choice if more than one matches. Failed sources
remain explicit. Solana mint reads verify the full mainnet genesis hash, token
program and initialized mint, then use Token-2022 inline or mint-bound Metaplex
metadata. Named `.near` accounts use a finalized mainnet NEP-148 `ft_metadata`
view. Other chain families and nonstandard metadata are not supported by this
reader. User-configured networks do not automatically supply metadata adapters.

Details can be saved without an external wallet and appear with Balance not read.
Loaded details remain saveable after a delay or loss of connectivity; this does
not give them a balance, a price, ownership or transfer support. An optional
balance observation that ages during review retains its original timestamp and
appears as a saved balance. Failed network checks remain visible through match
selection, with a retry option. When a matching EVM account is connected, an
optional checkbox discloses that its address goes to the Lenz server and network
RPC provider to read the balance and price. Account changes discard those
observations while retaining public details.
Editing or closing the import discards late replies; failed reads offer a retry.
No signature or allowance is requested by import.

The EVM reader checks chain ID, a recent canonical block, deployed code, bounded
name/symbol/decimals and `balanceOf` when an account is supplied. RPC observations
are not independent chain proofs or token audits. Calls have fixed gas, time,
response and concurrency limits. Unsupported or nonstandard contracts can fail.

Reviewed WETH/USDC contracts use checked Chainlink feeds. Other tokens can use a
DEX Screener reference price from a pool matching the exact chain and base-token
contract, with at least $10,000 liquidity and $1,000 daily volume. The largest
eligible pool is selected. Symbols never select a price. Missing prices do not
hide token quantities; the portfolio reports partial valuation. Only fresh
balances and prices contribute to the displayed total, including native ETH.
Values use integer arithmetic and are estimates, not executable quotes or token
audits. Imported holdings remain separate from the tUSD balance.

Imported ERC-20 holdings appear in Send for the connected owner and network. The review
retains the exact contract, symbol and decimals. Before dispatch, Lenz rechecks
deployed code, decimals, wallet, network, balances, gas and nonce. Imported-token
reviews preserve their metadata for pending-transfer recovery without requiring
the current token list. No token approval or allowance is created.

Saved snapshots are encrypted with an identity-bound, nonextractable key in the
existing IndexedDB transaction. Opening/reloading the wallet does not send
account reads. A contract's Update action automatically reloads public details;
an account balance read still requires its separate checkbox. Token metadata and
balance observations each have a limit of 30 encrypted entries. Metadata is local
to this identity and does not extend transfer support beyond the reviewed adapters;
discovery refresh uses the session disclosure described above. Offline snapshots
show their saved time; balances follow the wallet visibility control. Saved
addresses that are not the connected wallet cannot be used to initiate Send.
Token artwork follows exact contract metadata; a matching symbol does not grant
a custom contract a trusted logo. Missing artwork uses a monogram.

## Lending account

DeFi includes an Aave V3 account view for Ethereum, Arbitrum and Base. Load account
reads the selected wallet's collateral, debt, remaining borrowing power and health
factor through its provider. Connection and tab changes do not automatically read
the lending account. Refresh is explicit; account/network changes and going offline
clear the current values. Values follow balance masking and are not persisted.

The reader checks the wallet before and after the read, the reviewed pool's
provider binding, its oracle's USD base currency and 8-decimal unit, strict ABI
responses and a recent canonical block. All contract calls use that block. An
unavailable response is distinct from an observed zero balance. These are provider
observations, not independent chain proofs. Collateral excludes supplies not
enabled as collateral; borrowing power does not establish available liquidity or
permission to borrow. This view does not submit supply, borrow or withdrawal calls.

Interface references: [Aave account data](https://aave.com/docs/aave-v3/smart-contracts/pool#getuseraccountdata),
[oracle units](https://aave.com/docs/aave-v3/smart-contracts/oracles), and
[base currency interface](https://github.com/aave/aave-v3-core/blob/master/contracts/interfaces/IPriceOracleGetter.sol).

## Evidence

- [Wallet navigation](../web/wallet-portfolio-browser-results.json): asset-first
  receiving, stale-account invalidation, keyboard navigation, view history,
  responsive themes and actual offline reload with unchanged account storage.
- [Send entry](../web/wallet-send-entry-browser-results.json): recipient entry,
  cancelled/declined connections, late replies, Lenz contacts and custom networks.
- [Lending reader](../web/lending-account.test.mjs) and
  [account view](../web/lending-account-browser-results.json): exact values,
  oracle units, account/block changes, failed reads and balance masking using fixtures.
- [Browser flows](../web/wallet-actions-browser-results.json): local QR decoding,
  camera-denial handling, recipient selection, consent/races, encrypted token
  snapshots, offline reload, light/dark and phone/desktop layouts.
- [Token read tests](../integrations/token-watch.test.mjs) and
  [HTTP boundaries](../web/token-relay.test.mjs): consent, source binding,
  failed reviewed-oracle pricing, encrypted storage and request limits.
- [Live metadata/price reads](../integrations/token-watch-live.json): Ethereum
  USDC, Arbitrum USDC and Base WETH, without an account or transaction.

No physical phone/camera, user wallet connection, live balance-owner relationship
or financial submission is established by these checks. Visual acceptance remains
pending.
