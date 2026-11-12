# Unsigned payment output verification

November 1, 2026. The Zcash developer page has an explicit **Verify outputs and change** action. It checks the saved native transaction against the displayed recipient, amount, fee and change. A successful result remains separate from the network observation: an expired payment can have valid outputs and still be unsuitable for signing.

## Native boundary

The local route accepts only a disposable wallet selector and the saved request ID. It uses the existing operation lock, saves `checking` before native work, and compares the private PCZT hash before and after inspection. Any failed check replaces the earlier result with `unavailable`. Reopening, reloading or reconnecting never initiates the check. Both `canSign` and `canSend` remain false.

The hash-pinned native inspector accepts version-6 Ironwood with exactly two actions, one real input, one payment and positive internal change. It rejects other pools, nonzero empty-pool balances and disabled inputs or outputs. Its pinned library verifies:

- Each value commitment, input nullifier and randomized spend key against the wallet's full viewing key.
- Each output commitment and the bundle's cross-address restriction.
- Encrypted payment recovery with the sender's external outgoing viewing key, and full change-note decryption with the internal incoming viewing key. Both recovered notes match the committed recipient and value under the bundle's own encryption domain. The creator deliberately omits outgoing recovery for change; this check does not introduce it.
- The exact recipient amount, owned internal change, conserved values and a bundle value balance matching the reviewed fee.
- The absence of a spending signature on the real input. Creation already signs zero-value dummy inputs; these authorize no real input value.

Fresh successful checks require `noteEncryptionVerified: true`. Older saved commitment checks reopen with that flag false and an explicit prompt to check encryption. Reading such a record leaves its private journal and transaction bytes unchanged; failed or interrupted new checks still invalidate the earlier successful observation. No check enables signing or sending. Decryption authenticates the encrypted memo, but this amount-only review does not approve memo contents or return them to the browser.

The amount is capped at 0.1 test ZEC and the fee at 0.0001 test ZEC. The native bridge retrieves the existing account's full viewing key in memory and sends it to the inspector over stdin. The browser, journal and reports receive only whitelisted review fields. Seeds, viewing keys, PCZTs, wallet databases and native binaries are excluded from the repository. The local host remains trusted; this is not an isolated signer.

## Recorded checks

The [actual Edge run](../web/zcash-effects-live-results.json) passed seven checks using one unsigned 0.01-test-ZEC A-to-B request, then discarded it. Its fee was 0.0001 and owned change was 0.8898 test ZEC. The separate network check returned **expired**: wallet height 4,563,325, server height 4,567,974, expiry 4,563,366 and target 4,567,975. No real input signature, proof, synchronization, funding or broadcast occurred.

After the native balance/flag guards were added, the [final native check](payment-effects-native-results.json) re-inspected that same private PCZT and rejected four controls: changed amount, changed fee, another recipient and the other wallet's viewing key. The native check did not change either account, the PCZT or its discarded journal. [Saved-evidence verification](payment-effects-verification.json) also matches both account balances and transaction histories to the pre-feature record: A 0.8999 / B 0.1 test ZEC. It passes three checks and rejects four altered records.

Forty Node tests, three Rust tests and ten [fixture browser checks](../web/zcash-effects-browser-results.json) passed. The fixtures cover forged terms, request IDs, ownership, reload behavior, both themes, narrow/landscape layouts and enlarged text. Six [removed output-review guards](payment-effects-mutations.json) and four [expiry guards](payment-freshness-mutations.json) caused test failures. These are bounded regression checks, not a complete cryptographic audit.

Reviewed fixture views: [light](../web/evidence/zcash-effects-light.png) and [dark](../web/evidence/zcash-effects-dark.png). The actual browser and fixture runs are distinct evidence classes.

## Observed failures and limits

The first signature check rejected a valid unsigned PCZT because the native I/O finalizer had signed its zero-value dummy spend. The corrected rule rejects signatures on real value; the dummy/real distinction has a regression test. The first browser fixture also used an input total inconsistent with its output values; correcting the fixture made conservation explicit.

The first saved-evidence comparison failed because native `list-tx` uses `mined_height`, while the earlier companion report uses `minedHeight`. Exact transaction values matched after that field mapping; no history entry was removed or changed. Initial dependency resolution failed on a yanked cached release, and a restricted online attempt failed; the permitted index refresh and locked build then succeeded.

Signing still requires independent approval of exact terms and any memo, current input availability, anchor/witness validation and safe submission/recovery behavior. The bounded encryption checks cover this two-output creator's policy; arbitrary pools, outgoing policies and transaction shapes need their own verification. This read-only inspector does not establish signing readiness or a shielded ZEC/DeFi route. Native Zcash privacy, encrypted Lenz chat and private NEAR settlement remain separate claims. Existing unexplained proof/refresh failures retain their original records.

```powershell
node --test zcash/payment-effects.test.mjs zcash/payment-freshness.test.mjs zcash/payment-review.test.mjs zcash/companion.test.mjs web/zcash-relay.test.mjs web/defi-relay.test.mjs
./zcash/review-inspector/build.ps1
node zcash/payment-effects-mutations.mjs
node web/zcash-review.test.cjs --effects --freshness
node zcash/verify-payment-effects.mjs
```

The browser command requires Playwright and Edge. Adding `--live` deliberately prepares another actual unsigned request; the completed run should not be repeated as a health check. `node zcash/check-payment-effects-native.mjs` only reads an existing private request and native accounts, but requires their pinned local tooling. The saved-evidence verifier uses no wallet or network access.
