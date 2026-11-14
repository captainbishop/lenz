# Browser wallet connection

The wallet page connects an existing injected EVM wallet without creating a Lenz
profile. It supports Ethereum, Arbitrum and Base, plus explicitly saved
[custom EVM networks](wallet-networks.md) for balances and Receive. The user
selects a discovered wallet, grants account access, and sees its native balance.
Receive displays the complete address and a locally generated EIP-681 QR with the
selected chain ID. A copied bare address still requires selecting that network
in the sending wallet.

[Connected-wallet sends](wallet-transfers.md) now add a separate explicit review,
wallet approval and encrypted attempt history for ETH and reviewed USDC/WETH.
The connection-only behavior below remains distinct from those transfer calls.

## Account and privacy boundary

EIP-6963 announcements supply selectable providers. A legacy `window.ethereum`
provider is offered only when no supported announced provider is available.
Names are untrusted text, not verified wallet brands. Remote icons and provider
URLs are not loaded. Providers must support EIP-1193 account/network events.

No account RPC runs before explicit selection. The disclosure covers address
sharing with Lenz and public data services under “What connecting allows”.
Selecting the wallet also permits automatic token discovery on supported chains;
there is no extra checkbox or signature. Payments still require their own review
and wallet approval.
The default connection uses only `eth_requestAccounts`, `eth_accounts`, `eth_chainId`,
`eth_blockNumber` and `eth_getBalance`. Balance reads use an explicit block number,
followed by account and chain checks. Provider responses are observations from
that wallet; Lenz does not independently verify their canonicality or prove
ownership by signature. Native quantities retain integer precision.

The provider and account exist only in page memory. Account/network events,
disconnect, offline, page exit and restored page history invalidate the session.
An explicitly requested switch accepts its expected chain-change event and
rechecks the account and actual destination before showing a new balance.
Refresh rechecks the granted account without requesting new permissions.
Cancellation invalidates pending requests before native dialog close completes;
late replies cannot revive a cancelled or replaced session. Calls time out after
30 seconds. Disconnect removes Lenz's listeners and session; revoking wallet site
permissions remains a separate wallet action.

The connection writes no Lenz keys, contacts, messages, reservations or offline
balance. Automatic discovery saves checked token observations to the encrypted
watchlist when a local profile exists. External addresses are not linked to Lenz contact
cards or passed to the market relay. The wallet's own provider can observe reads;
public-chain activity is not private settlement. Saving the app offline caches
the controls, never a connected account or active permission.

## Remaining work

The connection exposes its Receive address; the separate transfer flow implements
bounded sending and local lost-reply recovery. It does not implement DeFi protocol
approvals/execution, complete transaction recovery, mobile
WalletConnect, native NEAR/Zcash signing, or Lenz identity recovery. Tokens added
to the watchlist remain watched assets. No asset moves to NEAR through connection.

Current Lenz identity keys remain nonextractable. A recovery phrase cannot export
those existing keys. New recoverable identities and migration must also preserve
historical decryption and reconcile outstanding offline payments; restoring an
old archive cannot make old funds spendable again. External-wallet recovery does
not recover Lenz chat history or offline tUSD.

## Verification

Run `node web/verify-evm-wallet.cjs` with the existing Playwright runtime available
through `NODE_PATH`. Twelve Node tests and seven disposable Edge browser groups
cover permission consent, native precision, three chain identities, unsupported
chains, changes during reads, cancelled/late replies, offline cache, QR decoding,
copy, keyboard controls and unchanged Lenz storage. Six deliberate guard changes
must fail. Reports: [browser results](../web/evm-wallet-browser-results.json) and
[guard checks](../web/evm-wallet-verification.json).

The initial browser run exposed a deferred-dialog-close cancellation race; the
test now resolves the permission promise during Escape's cancel event. A test
removing synchronous cancellation reproduces it. Both themes and 320–1280px
layouts are inspected locally. This is injected-provider desktop evidence, not
an installed wallet, physical phone, mainnet read or financial transaction test.
Overall wallet visual acceptance and the broader recovery/integration tasks stay
open.
