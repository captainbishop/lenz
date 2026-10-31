# Saved payment expiry and network check

October 31, 2026. The developer page can now check a saved unsigned payment's expiry against the next reported Zcash testnet block. It reads the PCZT with a pinned native inspector, checks the consensus branch at that height and compares the local wallet height with the server's tip. It neither synchronizes nor signs the wallet.

The check requires the matching saved request and unchanged PCZT hash. It saves `checking` before I/O, verifies the file again afterward and replaces an earlier successful result with `unavailable` if a new check fails. Reload and reconnect never start a check or recreate a payment automatically.

Possible observations are `network-changed`, `expired`, `expires-soon` (20 blocks or fewer), `wallet-behind`, `network-behind` and `within-expiry`. Even `within-expiry` is **not signing approval**: a reported wallet height does not establish complete scanning, current witnesses, spend availability or cryptographic change ownership. Explicit signing approval, anchor validation, submission recovery and safe restore/rescan remain open. Both `canSign` and `canSend` remain false.

## Recorded evidence

- [Eight fixture browser checks](../web/zcash-freshness-browser-results.json) and [six actual Edge checks](../web/zcash-freshness-live-results.json) passed. These are different evidence classes.
- The actual unsigned 0.01-test-ZEC review was **expired**: wallet height 4,563,325; server height 4,563,629; expiry height 4,563,366; next target 4,563,630. The consensus branch matched. The unsigned review was then discarded.
- [Saved-evidence verification](payment-freshness-verification.json) confirms unchanged balances and native transaction histories. No funding, signing, proof generation, synchronization or transaction submission occurred in this slice.
- [Four guard mutations](payment-freshness-mutations.json) were rejected, covering expiry, request binding and pre/post-check PCZT integrity. The Rust inspector's malformed-input test and release build passed.

```powershell
node --test zcash/payment-freshness.test.mjs zcash/payment-review.test.mjs zcash/companion.test.mjs web/zcash-relay.test.mjs web/defi-relay.test.mjs
node zcash/payment-freshness-mutations.mjs
node zcash/verify-payment-freshness.mjs
node web/zcash-review.test.cjs --freshness
```

The last command requires Playwright and Edge. `--live` prepares another real unsigned request; it is not a routine health check. Preserve the completed evidence and private journal. The original unexplained offline proof timeout remains unrelated and unresolved.
