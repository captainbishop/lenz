# Backed return to the offline wallet

Verified 2026-10-26. `deposit_offline` converts an existing account's tUSD into a new offline note. It debits the calling account and increases the reserve by the same amount in one receipt. Total token supply does not change. A payer/source pair can create only one root, so retries cannot debit twice or revive a spent note.

The configured reserve remains `tusd.lenz-dev-1792984696547.testnet`. A code-only upgrade added the method; it did not rerun initialization or change the state layout. All **74 existing state entries** matched exactly afterward. [Upgrade receipt](applied.json), [reviewed plan](plan.json) and [pre-upgrade public state](before-state.json) are saved. `contracts/deployment.json` retains the original deployment evidence; `reserve-v1.wasm` preserves its exact original artifact. The upgraded Wasm is 367,798 bytes.

## Verification

- **15 native reserve tests** passed, including actual Edge deposit signatures, exact backing, payer/source/amount/domain binding, duplicate deposits and spent-root replay.
- A [separate testnet rehearsal](rehearsal.json) deployed the original Wasm, funded/settled/redeemed old notes, upgraded without initialization, compared all storage entries and exercised deposit failures, retries, onward transfer and redemption. All 12 recorded steps passed.
- [Three targeted guard removals](mutation-results.json) were detected: missing backing transfer, missing authorization and missing idempotence. These are test-strength checks, not a security audit.
- [Three isolated Edge checks](../../web/near-deposit-browser-results.json) passed with fixture chain data and actual browser crypto/storage. A failed commit sent no request; a dropped response credited once; returned value remained transferable offline.
- [Four live Edge checks](../../web/near-deposit-live-results.json) passed using the configured reserve and Rhea: rejected swap → actual refund → one backed deposit despite a dropped response → offline A → B → C signatures → actual NEAR settlement. The receiving account lost exactly one tUSD on deposit, the reserve gained exactly one, and total supply stayed unchanged.
- The existing tUSD and Rhea browser suites were rerun: eight and five checks passed respectively. Tests used disposable browser identities. Physical phone behavior remains untested.

## Wallet behavior and scope

For a confirmed refund paid to the configured local test receiver, its original Lenz owner sees **Return refund to wallet**. The wallet saves a new authorization before submitting it. The relay checks the final adapter order, owner, amount, receiving account and deterministic refund source before spending the test receiver's tokens. Browser signatures alone do not authorize debits from arbitrary NEAR accounts.

External receiving accounts still need their own NEAR signer. Under deposit transaction details, the wallet can save an action for that account and check its eventual deposit. External wallet connection/signing is not integrated yet. A downloaded action or an expiry is never credited as returned value.

The original swap note stays consumed/reserved. The returned note has a new root and can be sent onward. Repeated deposit checks preserve earlier local transfers and known chain consumption. This is public NEAR accounting; it does not complete private settlement, native shielded Zcash or old-snapshot recovery.

## Reproduce

```powershell
./tooling/build-near.ps1 -Action test -Offline
./tooling/build-near.ps1 -Action wasm -Offline
./tooling/check-reentry-mutations.ps1
node --test contracts/refund-return.test.mjs web/near-deposit.test.mjs web/rhea-relay.test.mjs web/rhea-protocol.test.mjs web/near-protocol.test.mjs contracts/client.test.mjs integrations/quotes.test.mjs web/defi-relay.test.mjs
# Set NODE_PATH to your local test-tools node_modules directory.
node web/near-deposit-browser.test.cjs
node web/near-deposit-live.test.cjs
```

The live browser test creates new disposable test tokens and requires the local server. Do not rerun it as a read-only health check. `node contracts/reentry-rehearsal.mjs` resumes its saved isolated rehearsal. `upgrade-reentry.mjs` defaults to a plan for the old baseline; the applied upgrade is already recorded, so do not create another deployment or reset the public config.

Remaining work: connect external NEAR account signing; reconcile ambiguous adapter receipts; review the reserve, sponsor and upgrade-key trust boundaries. Intents access, Zcash test coins, privacy and recovery remain in [development status](../../docs/status.md).
