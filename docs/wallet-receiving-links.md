# Wallet receiving links

External wallets receive funds at their existing addresses. Selecting ETH, USDC
or WETH changes the requested asset and QR instructions, not the wallet address.
Ethereum, Arbitrum and Base use their reviewed token contracts. A bare EVM address
does not identify its network; Send requires that selection before wallet queries.
Network-qualified EIP-681 links supply it directly. Unsupported chains, tokens,
amount-bearing links and cross-chain sends are rejected before transfer review.

## Optional identity binding

Receive includes a collapsed **Wallet payment link** option for an original Lenz
identity with a connected externally owned wallet. Creating a link asks that
wallet to sign purpose-specific EIP-712 receiving instructions. Lenz then signs
the instructions and wallet signature with the identity's existing P-256 key.
No transaction, allowance, wallet key export or account replacement is involved.
Contract wallets and delegated-code accounts are not supported by this verifier.

The signatures bind the Lenz identity, receiving address, chain, exact token,
public visibility, random nonce and expiry. Send checks both signatures and the
requested asset/network, then retains the existing balance, fee, durable journal
and finality checks. Editing a review or changing the wallet invalidates approval.
Expiry is checked again before wallet dispatch. Contact-recovery restrictions
remain in place. A signed name alone does not establish who shared a link; a
matching saved contact is identified separately from a new recipient.

Only the link expires after 15 minutes. The wallet address and previously sent
funds are unaffected. This limit bounds acceptance of old instructions; it does
not revoke the address, erase shared information or establish online revocation.
The link can be reused within its lifetime, with a separately reviewed payment
each time. It is not an invoice or a one-use spending authorization. Once a wallet
prompt is dispatched, link expiry cannot cancel a transaction the wallet submits.

Links contain public identity/address associations. Anyone holding a link can
read and redistribute it. They are placed in the URL fragment, removed from the
address bar on opening, kept only in page memory and never fetched as arbitrary
URLs. No address directory is published, and no association is added to chat
storage or backups. This limits routine server exposure; it does not hide links
from the browser, the sender or a party with access to the page.

## Receiving and execution boundaries

These links resolve to the recipient's existing external wallet. They do not
create a confidential Intents balance, shield settlement, establish wallet
recovery or provide offline DeFi execution. A raw Lenz ID still cannot retrieve
current asset-specific instructions automatically. The intended ID-first flow
needs authenticated retrieval and refresh without a manual link ceremony.
Optional links are a transport for instructions, not that lookup service.

External recipients can use ordinary addresses or supported EIP-681 links without
registering a Lenz account. Paying across networks requires an integrated route;
the current direct-transfer flow stops on a mismatch without switching networks.
Future route deposit addresses may have separate funding deadlines and must not
be presented as permanent wallet addresses. The confidential receiving adapter
remains described in [Receiving assets](receiving-assets.md).

## Verification

`node web/verify-receiving-links.mjs` runs 69 Node tests, including the existing
wallet, transfer and account-recovery regressions. Four isolated guard removals
must fail their named tests: wallet ownership, Lenz signature, expiry and
destination network. The report binds the checked source bytes.

`node web/receiving-links-browser.test.cjs` covers creation, native/token QR
binding, address stability, late signature cancellation, opening links without
a Lenz account, explicit network selection, EIP-681, address substitution and
expiry during review. It uses disposable Edge accounts and independently signed
synthetic wallet responses. No live wallet operation, deposit, transaction,
confidential settlement or physical-device test is represented by these checks.

References: [EIP-681 payment requests](https://eips.ethereum.org/EIPS/eip-681)
and [EIP-712 typed signatures](https://eips.ethereum.org/EIPS/eip-712).
