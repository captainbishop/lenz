# ENS and NEAR name lookup

Lenz's [name lookup screen](../web/public/name-lab.html) checks public names for
Aurora destinations. Open `/name-lab.html` on the local app, or use **Name lookup**
from the developer wallet lab. It supports light/dark themes and narrow screens.
No lookup runs until **Look up** is pressed.

This is a read-only integration. It does not link a name to a Lenz contact, sign a
message, send funds or enable account recovery. Existing contacts and private
wallet data are untouched.

## Resolution

| Service | Authority and destination |
| --- | --- |
| ENS | Ethereum mainnet's Universal Resolver, requesting the selected Aurora chain's ENSIP-11 address record. |
| NEAR | Account existence on the selected NEAR network, plus its derived Aurora Engine caller address. |

ENS names use `ensNormalize`, `dnsEncode` and `namehash` from pinned ethers 6.17.0.
The Universal Resolver address is
`0xeEeEEEeE14D718C2B47D9923Deab1335E144EeEe`, documented by ENS and present in
that SDK. `resolve(bytes,bytes)` receives a DNS-encoded name and the
`addr(bytes32,uint256)` request. The requested coin types are **3460645202** for
Aurora mainnet and **3460645203** for Aurora testnet. The lookup checks Ethereum
chain ID 1, reads its finalized block and calls at that block hash with
`requireCanonical: true`.

Lenz makes no fallback request for Ethereum coin type 60. A resolver can itself
supply a default EVM address; its answer does not prove an explicit Aurora record
was stored. Empty/zero addresses remain `no_address`. Missing resolvers remain
`not_found`. CCIP-Read requests are reported as `offchain_required`; this version
does not contact resolver-supplied URLs. DNS names requiring off-chain resolution
and other such records remain unsupported.

NEAR accepts native `.near` names on mainnet and `.testnet` names on testnet,
including subaccounts. It checks the RPC's network ID, selects a final block and
requires the account response to match that hash and height. A missing-account
error must identify the requested account. The Aurora caller address uses the
last 20 bytes of Keccak-256 of the exact NEAR account ID, as implemented by the
existing [Engine codec](engine-interface.md).

A derived caller address is **not a payment instruction**. Account existence does
not prove that its controller can execute an Engine call or withdraw funds there.
Native NEAR names are used here; no separate third-party naming registry is
integrated.

The three fixed read-only endpoints are `https://ethereum-rpc.publicnode.com`,
`https://rpc.mainnet.near.org` and `https://test.rpc.fastnear.com`. Lookups reject
redirects, invalid JSON-RPC identities and contradictory results. Responses are
limited to 128 KiB; a 20-second deadline covers the complete lookup and body reads.
The local API requires the documented origin/host, accepts only the lookup POST,
caps requests at 2 KiB and permits at most two concurrent lookups. No endpoint,
contract or method can be supplied by the browser.

## Saved results and identity

**Save on this device** is optional and initially off. The page
stores only that public lookup in a separate browser setting. It can reopen the
saved result offline once the app cache is ready. Saved and failed-refresh states
say that the result has not been refreshed. Switching names/networks hides the
previous result; a changed or removed address receives a visible warning.
**Forget saved check** removes only that setting.

Every result says `identityBinding: not_verified`. Name controllers and records
can change. A later contact integration needs proof binding the current naming
account/controller to Lenz's existing signing and encryption keys, plus expiry,
revocation and rechecking rules. A name must not silently replace a contact key
or authorize a payment. Linking a public name also changes the account's privacy
profile; it cannot make Zcash, NEAR settlement or social metadata private.

The RPC provider sees lookup data and connection metadata. The page sends no
Lenz keys, messages or wallet data. RPC reports are trusted observations, not
independently verified consensus proofs.

## Reproduce and evidence

From the repository root:

```sh
npm --prefix aurora test
node --test web/name-relay.test.mjs web/name-results.test.mjs
node aurora/name-resolution-mutations.mjs
npm --prefix aurora run check:names
```

With Playwright on `NODE_PATH` and installed Edge:

```sh
node web/name-browser.test.cjs
node web/near-payment-cache.test.cjs
```

The November 1 run passed **56 Aurora tests**, including 13 name-resolution tests,
plus six name API/display tests and four quote-API regressions. All six
[guard-removal controls](name-resolution-mutations.json) were detected. The test
fixtures were strengthened after downstream parsing masked two removed guards;
wrong-chain responses and word-aligned trailing ABI bytes now fail independently.

The [live check](name-resolution-live.json) binds its resolver source hash and
records final-block observations for ENS's official `ur.integration-tests.eth`
fixture, `wrap.near` and Lenz's configured testnet token account. The ENS fixture
returned its documented `0x2222…2222` address through the Universal Resolver.
These public naming reads do not establish identity ownership or move assets.

Nine [Edge checks](../web/name-browser-results.json) cover the page, actual
offline reload, opt-in saving, changed destinations, invalid replies and existing
identity/message preservation, automatic NEAR network selection and empty-result
handling. Four captures show a synthetic lookup result at desktop/narrow widths in both themes:
[light desktop](../web/evidence/name-lookup-light-1280.png),
[light narrow](../web/evidence/name-lookup-light-390.png),
[dark desktop](../web/evidence/name-lookup-dark-1280.png),
[dark narrow](../web/evidence/name-lookup-dark-390.png).
Two [cache-upgrade checks](../web/near-payment-cache-results.json) preserve the
existing identity, encrypted vault and expired reservation through failed and
successful updates. They use disposable browser state and fixture backing.

## Interface references

- [ENS address resolution](https://docs.ens.domains/web/resolution/)
- [ENSIP-11 chain address records](https://docs.ens.domains/ensip/11/)
- [Universal Resolver deployment and integration fixture](https://docs.ens.domains/resolvers/universal/)
- [ENSIP-23 ABI and error definitions](https://docs.ens.domains/ensip/23/)
- [NEAR account RPC](https://docs.near.org/api/rpc/contracts)
- [PublicNode Ethereum endpoint](https://ethereum.publicnode.com/)
