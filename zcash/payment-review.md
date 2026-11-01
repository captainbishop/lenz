# Browser review of an unsigned Zcash payment

[Expiry and network checks](payment-freshness.md) and [cryptographic output/change verification](payment-effects.md) are implemented as separate explicit actions. Signing approval, full anchor/witness validation and submission recovery remain open. The original October 31 review evidence below is preserved.

October 31, 2026. `/zcash-lab.html` can now prepare a real native testnet PCZT,
show the recipient, amount, fee and total debit, reopen the saved request and
discard it while it is unsigned. The normal chat and tUSD wallet are unchanged.

The actual browser test prepared **0.01 test ZEC from A to B**, with a
**0.0001-test-ZEC fee** and **0.8898 proposed change**. It restored the same
transaction after reload and discarded the unsigned request. Balances remained
**A 0.8999 / B 0.1 test ZEC**, and both native histories were unchanged. No new
signature, proof, broadcast, synchronization, funding or deployment occurred.

[Five actual browser checks](../web/zcash-review-live-results.json),
[six fixture browser checks](../web/zcash-review-browser-results.json),
[verification](payment-review-verification.json),
[native state after the test](payment-review-native-after.json).

## Boundary

The local API accepts only A or B and an exact decimal amount up to 0.1 test ZEC.
The recipient is always the other existing disposable account, read from the
pinned native wallet. Request bodies cannot choose executables, paths, keys,
networks, arbitrary recipients or commands. Host/origin checks and the shared
operation lock apply to balance, sync and review requests. Signing, proving,
export and send routes remain unavailable.

Preparation uses the existing executable's `pczt create` and `inspect` commands
with no network or mnemonic decryption. The parser requires version-6 Ironwood,
two actions, one real input, exact recipient value, positive proposed change and
a fee no greater than 10,000 zatoshis. PCZTs and the journal stay in ignored
`zcash/.testnet/payment-review/`. Only the sanitized review reaches the browser.

A durable `preparing` record is saved before native work. Retries and service
restarts reuse the saved request; a different amount or account requires explicit
reconciliation. Ready records verify the private file's hash. Interrupted/failed
preparation remains visible rather than silently creating another transaction.
Discard requires the matching account and request ID. This is safe only because
this service never produces signatures; it is not a rule for releasing signed
swap reservations.

At this October 31 checkpoint, displayed change was proposed without independent ownership verification. The November 1 output check now verifies owned change explicitly. The prior
bounded signer verifies commitments and owned change when signing. A future
product signer must also check expiry, current anchor/chain readiness and exact
reviewed terms, with a separate approval and submission-recovery model. A PCZT
created from an old synchronized wallet may already be unsuitable for submission.
`ready` means ready to review, not ready to settle.

Opening, reloading and reconnecting the page trigger no wallet or payment action.
Reviews are loaded only on explicit request. Raw transaction IDs and addresses
stay under details. The page creates no Lenz IndexedDB identity or ledger.

## Checks and observed issues

**25 Node checks** cover decimal precision/caps, parser bounds, idempotence across
restart, file tampering, account/ID matching, failure persistence, concurrency and
the existing companion/HTTP restrictions. **Six fixture browser checks** cover
review, reload/reconnect, forged terms, responsive layout and discard. The existing
**seven browser regression checks** also passed. Five actual browser checks used
the pinned native tool; post-test local reads confirmed unchanged balances/history.

The first live screenshot exposed an existing stale offline message after reconnect.
The online handler now replaces it, and the fixture test explicitly checks the
restored connection message without an API request. Native review behavior was
unaffected. Earlier proof, faucet and refresh failures remain in their original
records.

This recorded checkpoint used cache `proof-u-chat-v21-zcash-review` with 44 routes; the current app cache includes later expiry and shared payment-status modules. No storage
namespace or user identity was replaced. Signing approval, submission recovery,
restore/rescan and the ZEC↔DeFi route remain active work.

```powershell
node --test zcash/payment-review.test.mjs zcash/companion.test.mjs web/zcash-relay.test.mjs web/defi-relay.test.mjs
node web/zcash-review.test.cjs
node zcash/verify-payment-review.mjs
```

The browser test needs Playwright and Edge. `--live` deliberately prepares and
discards one actual unsigned request; do not repeat it as a health check.
`--capture-native` on the verifier reads current local native state; its default
uses saved evidence plus the Node tests and sends nothing.
