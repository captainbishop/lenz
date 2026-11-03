# Route estimates and saved drafts

The route service can attach a public estimate to an exact same-chain Uniswap
swap or Hyperliquid order objective. These are non-executable drafts. Matching
does not authenticate the provider, approve spending or establish a complete route.
Markets can save a checked estimate through an explicit review. The Drafts page
lists encrypted records, refreshes estimates with consent and deletes drafts.

## Estimate checks

`bindRouteQuote(objective, quote)` requires explicit `transparent` privacy,
unexpired objective/quote times, matching provider and actual execution chain.
Private objectives cannot use public estimates. Cross-chain funding and return
objectives need separate verified legs and are rejected by this bounded matcher.

For the Base Uniswap WETH/USDC pool, the source/output contracts and decimals,
exact input and minimum received must match. A quoted minimum below the objective
minimum is rejected. Pool fees are included in the quote; total fees and the
objective's fee budgets still need verification.

Hyperliquid orders require `sizeDecimals` matching the venue estimate and
`priceDecimals: 6`. Size and limit price are integer units with those explicit
scales. Legacy objectives without scales remain valid planning documents but
cannot attach an estimate. Instrument, side and size must match; the worst book
price must satisfy the buy/sell limit. Order size is not source USDC collateral.
Collateral sufficiency, margin, leverage, reduce-only effects, account state and
venue order-size rules remain unverified.

Both paths retain unverified recipient authority, balances, total fees, signing,
execution, finality and recovery. The quote's provider market ID records the
observed pool/instrument; the objective still names a provider-level destination.
Neither object is a signed authorization. Saved quote bytes can be fabricated by
a caller and must never be consumed as execution authority.

The developer CLI accepts a fresh estimate file:

```sh
node integrations/preview-route.mjs --file objective.json --quote estimate.json
```

## Browser storage

`saveRouteDraft(objective, {quote})`, `attachRouteQuote(id, expectedRevision, quote)`
and `removeRouteDraft(id, expectedRevision)`
use the existing shared IndexedDB/Web Locks commit boundary. A separate
nonextractable AES-GCM key encrypts up to 100 records, with the Lenz identity ID
in authenticated associated data. Existing wallet ciphertext, keys, contacts,
messages and reservations are preserved. Duplicate IDs cannot replace terms;
competing tabs must reload the current revision before replacing an estimate.
Arguments are snapshotted before asynchronous work. Failed writes or expiry
during encryption return no saved result. A quoted save commits the objective
and estimate together; failed saves cannot leave a partial draft. Deletion also
requires the current revision, and a late refresh cannot recreate a deleted draft.

`listRouteDrafts()` revalidates saved records and derives their current status:
`needs-quote`, `estimate-saved`, `quote-expired`, `objective-expired` or
`clock-changed`. Expired estimates remain historical records. Refreshing requires
an explicit new quote and revision check. There is no automatic quote request,
signature, reservation, transport, credit or release. Encryption at rest does not
defend against a compromised same-origin application with access to its keys.

## Product controls and offline use

After obtaining an estimate in Markets, choose **Review swap** or **Review order**.
The receipt review places the amount/fill summary above inline editable limits, then
offers **Save draft**. The review requires
a receiving/trading address, explicit fee budget and separate unchecked consent
to a public route. Hyperliquid also records collateral, price, leverage and
reduce-only limits separately from order size. A local Lenz identity is required;
the form never infers an EVM or HyperCore account from a NEAR or chat identity.

The Drafts page retains exact terms and expired estimates after an offline
reload. Home and chat workers cache the page and its dependencies. Refreshing
requires an online connection and new public-quote consent. It sends the quote
request, without the saved recipient address, and rejects changed, revoked,
expired or mismatched replies before attachment. Abort is supplemented by a
generation check; an already-started atomic storage write completes normally.
Private objectives have no public refresh control. Corrupt storage is reported
as unavailable and preserved, rather than treated as an empty collection.

Markets still discards unsaved estimates on edits, offline transitions and
expiry. Neither page automatically fetches or saves quotes. Drafts are not an
execution journal, signing authority or recovery backup. Export, device migration,
complete fees/accounts/positions, cross-chain legs, private quotes, signing,
connected execution and reconciliation remain unconnected.

## Verification

```sh
node integrations/verify-route-quotes.mjs
node --test integrations/route-draft-form.test.mjs
node web/verify-route-drafts-ui.cjs
node integrations/verify-route-planner.mjs
```

[Binding verification](../integrations/route-quotes-verification.json) records
seven fixture groups, nine [browser service groups](../web/route-drafts-browser-results.json)
and 17 detected guard alterations. Real Edge IndexedDB, Web Locks and WebCrypto
exercise competing tabs, failed writes, queued caller edits, expiry during
encryption, ciphertext corruption and cross-identity copies. Online reload and
loaded offline reads preserve saved records and existing wallet state.

[Product verification](../web/route-drafts-ui-verification.json) covers explicit
consent, double submission, failed writes, stale reviews/replies, offline reload,
deletion races, exact legacy amounts and unreadable storage. Its five guard
alterations are independently detected. Five form groups check exact terms,
separate consent, precision, address, expiry and fee/collateral limits. Desktop
and phone screenshots cover both themes; browser checks also exercise landscape,
keyboard focus, reduced motion and doubled text. These are Windows Edge checks,
not physical-phone or screen-reader certification.

The initial product harness omitted the homepage route, preventing worker
installation; mapping it to the actual index fixed that fixture mismatch.
Legacy 36-decimal/78-digit records reproduced a rendering failure, and unreadable
storage incorrectly showed an empty collection. Both regressions now pass.
Native dialog focus can briefly move to browser chrome; the keyboard check allows
that browser behavior while ensuring focus returns inside the modal. The delete
mutation originally triggered a later uncaught error; its test now observes the
stale operation directly before checking subsequent behavior.
Resizing could leave the focused review control below the viewport; the dialog
now scrolls that control into view when the viewport changes.

The first binding test tried to alter a frozen fixture; it now clones that input.
Removing the early provider check still rejected mismatches through the later
chain/action/asset guards, so that overlapping guard is explicitly not counted
as independently detected. These checks use fixtures and disposable browser
profiles, with no live account, financial transaction or physical-device test.
