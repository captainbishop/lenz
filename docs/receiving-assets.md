# Receiving assets

The integration reads the current NEAR Intents token catalogue by asset, source
network and contract. A token is identified by its provider asset ID and chain,
not its ticker. Catalogue browsing is not exposed as a Receive action. Existing
tUSD and connected-wallet receiving controls retain their respective destinations
and public-settlement disclosures.

The relay uses the fixed 1Click token endpoint, bounds responses, shares concurrent
requests and retains a five-minute cache. Failed refreshes have a 30-second
backoff; older results carry a stale flag. The catalogue is discovery data and
cannot enable a deposit, create a balance or grant spending authority.

Lenz ID identifies the recipient across private chat and payments. Asset-specific
receiving instructions must be authenticated by that identity and checked against
the selected asset and route before an address is shown. This resolution is not
implemented by the catalogue. tUSD remains a test asset; the receiving model
preserves each supported incoming asset rather than converting it into tUSD.

## Confidential balance preparation

`integrations/intents-receive.mjs` prepares a dry, same-asset funding quote from
the selected source chain into `CONFIDENTIAL_INTENTS`. It preserves integer base
units, the requested confidential account, an explicit origin-chain refund
destination and deadline. It requests advanced confidentiality with no public
fallback or asset conversion. The reviewed minimum output equals the quoted
output; the difference from the input is reported as fees.

Changed request fields, invalid amounts, stale responses, failed quote signatures
and any allocated deposit address or memo are rejected. The pinned quote verifier
does not sign the confidentiality field; its echoed value is not a privacy proof.
The preview is not connected to a browser funding action.

Source refund validation currently covers the reviewed Ethereum, Arbitrum and
Base networks. It rejects Lenz IDs, other-chain address formats, zero addresses
and invalid EVM checksums before contacting the quote service. Other source
networks remain catalogue entries until their address/memo validation is
implemented. A valid EVM address alone proves neither ownership nor recovery;
it must not be used as evidence that a Lenz deposit route is ready.

An enabled receiving destination still requires partner access, authenticated
ownership of a recoverable confidential account, chain-specific address/memo
validation, a live supported same-asset route and verified deposit/refund
reconciliation. The application exposes no Lenz deposit address for catalogue
assets. A contact ID is not a universal blockchain address.

Supported funds would enter a confidential balance before a separately approved
action. Route selection can arrange the necessary cross-chain movement without
a manual bridge workflow. Public venue positions, including Hyperliquid orders,
remain public unless the complete execution path establishes otherwise. Offline
authorization and onward payment require their own bounded authority, conflict
handling and recovery; this quote adapter does not establish them.

## Verification

Run `node --test integrations/intents-receive.test.mjs` for exact asset/chain
binding, amounts, response substitutions, public fallback rejection, deposit
allocation rejection, response bounds, caching and retry behavior. The browser
check that Receive exposes no nonfunctional catalogue action is covered by `node web/receive-ai-browser.test.cjs` with disposable accounts
and synthetic AI responses. Live token lookup on November 5 returned 215 assets on
38 networks. No deposit, signing or settlement was performed by that lookup.

Sources: [token API](https://docs.near-intents.org/api-reference/oneclick/get-supported-tokens),
[quote API](https://docs.near-intents.org/api-reference/oneclick/request-a-swap-quote),
[confidential balances](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps).
