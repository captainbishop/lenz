# Connected-wallet transfers

The wallet sends ETH and the reviewed USDC/WETH contracts on Ethereum, Arbitrum
and Base through the selected browser wallet. Assets stay on that network. This
flow creates no NEAR bridge, token allowance, Lenz identity or offline tUSD credit.
The wallet holds the signing keys. A separate public-transfer disclosure precedes
sharing the recipient and amount with its network provider.

Send accepts a checksummed or uniformly cased EVM address and an exact decimal
amount. It checks the account/network, token deployment and decimals, token/ETH
balances, pending nonce and gas estimate. The review is a separate editable
receipt. Editing or closing invalidates it; a review expires after 60 seconds.
Approve in wallet repeats those checks and opens the external wallet only after
the attempt has been saved successfully.

## Fees and authorization

Transactions carry explicit chain, sender, recipient/contract, value, calldata,
nonce, gas limit and gas price. Gas has a 20% estimate margin, bounded to two
million units. The displayed gas budget is the execution gas limit multiplied
by the gas price; it is not a promise of the total fee. Unused execution gas is
not charged. Arbitrum/Base may add rollup fees, which the user must review in the
wallet. Higher gas estimates/prices or changed funds/nonce require a new review.
Live wallet/network fee compatibility has not been established by local tests.

Only ETH and the exact WETH/USDC contracts in the reviewed market catalogue are
enabled. Adding a token to the watchlist does not enable sending it. There is no
automatic chain switching, custom network support, approval transaction or
generic contract-call input. Public-chain sends are not private settlement or
user-offline execution.

## Saved attempts and checking results

A separate IndexedDB store encrypts transfer records with AES-GCM and a local
nonextractable key. Web Locks serialize updates across tabs. The journal is
saved before `eth_sendTransaction`. An unresolved attempt blocks another send
from the same account/network in Lenz; a failed save prevents dispatch.

An explicit wallet rejection differs from an uncertain RPC error. After a
60-second wait, the UI records uncertainty while retaining the original promise;
a late hash updates the same attempt. Disconnecting after dispatch does not
discard its eventual reply. No status check or reload calls the send method.

Reconnect the original account/network to see its history. If a hash was lost,
copy it from wallet activity into the saved attempt. Lenz verifies the exact
transaction fields and nonce before accepting an included recovery hash.
An unrelated or unobserved hash cannot confirm the attempt or release the
duplicate-send barrier.

Checks distinguish submission, inclusion, finality and execution failure. A
receipt must agree with the transaction, canonical block, transaction index,
sender, destination and reviewed fee bounds. Successful token calls also require
the exact Transfer event. A finality read and repeated canonical-block check
precede a confirmed/failed result; unsupported finality remains included.
These are observations from the selected wallet provider, not independent chain
proofs. A token event is not an independent proof of balance conservation, and no
result here issues offline value.

## Recovery limits

This restores local attempt tracking after a page reload or lost wallet reply.
It does not recover deleted browser storage, migrate Lenz identity/history or
prevent a user operating another wallet/client from sending again. The journal
and local key can be lost together; copied/rolled-back storage is outside the
cross-tab barrier. Replacement/cancelled transaction handling and wallet-edited
terms remain incomplete. Changed hashes or transaction terms stay unresolved.
Custom networks, broader assets, Create/Restore onboarding, DeFi protocol
execution and complete privacy/offline recovery remain current integration work.

## Verification

`node web/verify-evm-transfer.cjs` runs the session/transfer tests, actual isolated
EthereumJS execution of native and ERC-20 sends, and six disposable Edge groups.
The local EVM checks recipient balance changes and token integer precision with
ephemeral test keys; it never connects to a public network. Nine altered guards
must fail, including persistence order, duplicate sends, lost-response retention,
recipient binding, finality, token effects and closing during preflight.

[Verification report](../web/evm-transfer-verification.json) and
[browser evidence](../web/evm-transfer-browser-results.json) bind results to source
hashes. The existing wallet/session and cache-upgrade checks remain separate.
Both themes and 320–1280px layouts were inspected. No installed-wallet, physical
phone, live-network signing, real funding or public-chain transaction was tested.

Address/checksum validation uses the existing pinned ethers 6.17.0 source and
@noble/hashes 1.3.2. `node web/build-evm-address.mjs` builds the small browser export
with the installed connector esbuild. [Source hashes](../web/evm-address-build.json)
and [licenses](../web/public/evm-vendor/NOTICE.txt) accompany it. No dependency lock
or production smart contract was changed.
