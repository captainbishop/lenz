# Wallet networks

Networks under wallet settings selects Ethereum, Arbitrum or Base through the
connected browser wallet. A user can also save a custom EVM network’s chain ID,
name, native currency symbol/decimals and HTTPS RPC URL, then select it in their
wallet. This does not move assets between chains.

Custom networks provide native balance reads and a chain-specific Receive QR.
They do not enable Send, token discovery or DeFi adapters. The existing reviewed
[transfer assets](wallet-transfers.md) remain limited to Ethereum, Arbitrum and
Base. A saved network cannot replace those built-in definitions or reinterpret
an outstanding transfer. Complete protocol execution, cross-chain routes and
recovery remain current integration work.

## Selection and consent

Opening the chooser, editing details, saving and removing networks make no RPC
request. Custom registration requires an unchecked disclosure before forwarding
the exact saved metadata through `wallet_addEthereumChain`. Selection separately
uses `wallet_switchEthereumChain`. Built-in networks use only the switch request;
if the wallet does not know one, Lenz asks the user to add it in their wallet.
Users starting on an unsupported chain can select a network before choosing
their wallet and granting account access.

The session clears its old account and invalidates transfer reviews before the
switch. It accepts an expected chain-change event during that operation, then
checks the actual chain and account before and after the balance read. An
unexpected change, rejection, timeout, cancellation, revoked custom consent or
changed saved metadata cannot publish a new balance. Late replies cannot revive
the session or disconnect a newer session, including one using the same provider.
A wallet request already dispatched may still finish in the wallet after local
cancellation; Lenz makes no follow-up reads and requires explicit reconnection.

No custom RPC URL is fetched or proxied by Lenz. The wallet handles registration
and endpoint validation. Wallets may retain their own endpoint for a chain they
already know; a successful add does not prove they changed endpoints. Observed
balances come from that wallet’s provider. A matching chain ID alone does not
authenticate a network, currency, RPC operator or balance. Users must check custom
metadata against the network’s official source. Lenz has not independently
verified custom endpoints or their declared native decimals.

## Saved settings

At most 20 custom networks are stored in a separate, unencrypted localStorage
record, `lenz-evm-networks-v1`. Only network metadata belongs there; use public
URLs without API keys. It contains no account, key, balance or transaction.
Browser Web Locks serialize settings writes. Failed writes cannot report a
successful save, corrupt records are not silently overwritten, and built-in
networks remain usable if custom settings are unreadable. Settings survive
reload and are available offline; account connections and consent are not
restored. Another tab’s settings change invalidates the current session.
Removing a custom network in Lenz does not remove it from the external wallet.

IDs accept decimal or hexadecimal input from 1 through JavaScript’s maximum safe
integer and are stored in canonical hexadecimal form. Native decimals accept
0–36; quantities use integer arithmetic. RPC URLs require HTTPS public hostnames
on the default port and exclude credentials, query strings, fragments, literal
IP addresses and local hostnames. These syntax checks are not DNS validation or
protection against a dishonest provider. Wallets may impose narrower limits.

Existing Lenz identity, contacts, offline balances and the encrypted transfer
journal remain separate. Returning to a built-in chain restores its unresolved
transfer history and duplicate-send barrier. Connecting or adding a network does
not recover a Lenz identity, credit offline tUSD, confer protocol support or make
public-chain activity private.

## Verification

Run `node web/verify-evm-networks.cjs` with the existing Playwright runtime through
`NODE_PATH`. Reports include exact source hashes:

- [Node and altered-guard checks](../web/evm-networks-verification.json)
- [Disposable Edge browser checks](../web/evm-networks-browser-results.json)

Coverage includes wrong-chain and account replies, delayed/cancelled requests,
consent revocation, changed RPC/decimals, duplicate and failed settings writes,
unresolved history, decoded QR addresses, offline reload and both themes at
320–1280px. Existing wallet-connection, transfer, wallet and cache-upgrade checks
run separately. Tests use injected providers and local browser storage, without
installed-wallet prompts, actual custom RPC validation, physical devices or
financial operations. No actual wallet compatibility or full-product completion
claim follows from these checks.

Protocol references: [EIP-1193](https://eips.ethereum.org/EIPS/eip-1193),
[EIP-3085](https://eips.ethereum.org/EIPS/eip-3085),
[EIP-3326](https://eips.ethereum.org/EIPS/eip-3326).
