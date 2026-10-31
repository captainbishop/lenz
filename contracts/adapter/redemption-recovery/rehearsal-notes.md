# Live redemption recovery rehearsal

2026-10-31. **27 rehearsal checks passed across 28 final testnet transactions.** Five additional checks of the saved receipts verified the transfer events, expected failures, state snapshot and final balances. This rehearsal deployed the recovery candidate to an isolated adapter; it did not change the configured Lenz wallet or contracts. The subsequent [configured rollout](rollout-review.md) is recorded separately.

- Reserve: `lenz-redrec-reserve-1793441886009.testnet`
- Adapter: `lenz-redrec-adapter-1793441886009.testnet`
- Signed refund recipient: `r.lenz-redrec-adapter-1793441886009.testnet`
- Candidate SHA-256: `53b9b2ebb270ceb643aae7f07fcb4ab852ca47882bd17375b27db04d45bc4a80`
- [Full receipts and snapshots](rehearsal.json); [receipt verification](rehearsal-verification.json).

Two new faucet-funded accounts hosted the reserve and adapter. The adapter created its recipient subaccount. Three disposable P-256 identities signed separate 1-tUSD orders with expired dispatch deadlines, allowing exact refund checks without interacting with Rhea's pool. The reserve used the same artifact as the current upgraded Lenz reserve. The adapter started with the exact original deployed artifact. These were test tokens and test NEAR; no user browser identity or real funds were used.

## Observed behavior

| Case | Result |
| --- | --- |
| Original adapter | One order redeemed and refunded normally; two other orders remained ready. |
| Injected callback failure | A test-only build made `on_redeem` panic after an actual reserve redemption. The reserve transferred 1,000,000 base units, its exact consumption identifier persisted, and the adapter stayed `redeeming`. |
| Code-only candidate upgrade | All **seven** stored entries, covering completed and pending orders and input assignments, matched byte for byte. No initializer ran. This is the isolated adapter's state, separate from the earlier 74-entry reserve upgrade. |
| Overlapping recovery | Two recovery calls in one transaction restored the order once. The later callback failed its stage guard. No token moved during recovery. |
| Original callback race | A new redemption raced two recovery queries. The order reached `funded`, two stale callbacks were rejected, and the reserve transferred exactly 1 tUSD. This is one observed scheduling outcome, not every possible interleaving. |
| Forged callback | The recipient's direct call to the recovery callback failed the private-call guard; state was unchanged. |
| Replayed original callback | A test-only helper replayed the original callback using the reserve's idempotent redemption result. The exact candidate rejected it after payout; token balances and state were unchanged. This was a constructed replay, not a naturally delayed historical receipt. |
| Repeated completed commands | Repeating `submit`, `advance` and `recover_redemption` for all three orders changed neither stored state nor token balances. |

The event verifier found exactly six NEP-141 transfers: three 1-tUSD redemptions from reserve to adapter and three 1-tUSD refunds from adapter to the account bound by each signature. Final supply was 3,000,000 base units; recipient balance was 3,000,000; reserve balance, adapter balance and reserved liability were all zero. Recovery, the callback replay and terminal retries emitted no token-transfer event.

Six failed execution receipts were intentional: one injected callback failure, three stale callbacks from overlapping/racing requests, one forged callback and one replayed callback. The recorded final transactions and failures remain visible in the evidence. No unexpected on-chain failure was accepted as success.

Selected transaction references:

| Case | Transaction hash |
| --- | --- |
| Actual redemption followed by injected callback failure | `7jxSLVGAaWbN5JpF7my2Z3jHeXomhRztdbDAPP8TJ39n` |
| Overlapping recovery requests | `G3X9YZcDxpcXtgvytRnLFis95juzdQRaaQ3YF5qnyQso` |
| Original callback racing recovery | `2CdKDsVYnUiqjfaoWFs3STWZyqZvLzkvgXne2qdADGZH` |
| Replayed original callback after payout | `DM5o5TBV3sMc1CDbGTLPdrMSMFhaNCmBxvxnbPXWDmgP` |

## Test fixture and operational failures

[The fixture source](fault-fixture.rs) derives from the archived original adapter, replacing its redemption callback with a deliberate panic and adding a private replay helper restricted to the rehearsal account prefix. It retains the original storage layout. Its source and Wasm hashes are in [the build record](fault-build.json). The helper is absent from the exact candidate. For the replay check, one transaction installed the fixture, queued the old callback and restored the candidate before that callback executed. The final isolated adapter code hash was checked against the candidate.

The following harness/setup failures were corrected and remain part of the record:

- The fixture initially used an unnecessary `.into()` on the SDK's generic function-name argument. Compilation failed; [original output](fault-build-initial-failure.txt). Removing it produced the fixture Wasm.
- The sandbox blocked the initial RPC connection with `EACCES`. The authorized retry ran with network permission; no faucet request or transaction preceded that initial failure.
- After the reserve faucet request succeeded, evidence serialization failed on the SDK's `BigInt` account balance. The recorder now writes such integers as decimal strings. It reused the confirmed reserve account instead of submitting another claim.
- Recipient setup initially used an action name not exported by SDK 7.4.0. Inspection showed `addFullAccessKey`; the corrected name is checked during preflight. This failure appears in the rehearsal's `failures` array. No recipient-creation transaction had been signed at that point.

The script journals each signed transaction hash before broadcast. A saved unresolved hash is queried on resume, never blindly resubmitted. Faucet attempts are also saved before requests, and an unresolved attempt prevents another claim. Private test keys are retained only under ignored `contracts/.testnet/`.

## Reproduction and limits

```powershell
# Local fixture build and preflight; no network transaction.
./tooling/build-redemption-rehearsal.ps1
node contracts/adapter-redemption-rehearsal.mjs

# Read saved receipts and check events, outcomes, hashes and balances offline.
node contracts/adapter-redemption-rehearsal-verify.mjs

# Resumes only this recorded isolated rehearsal; a completed run sends nothing again.
node contracts/adapter-redemption-rehearsal.mjs --run
```

The callback failures were explicitly injected and the token flows were actual NEAR testnet execution. RPC finality and state responses remain trusted; this is not an independent consensus/inclusion-proof verifier. The native 26-adapter/16-reserve tests and six mutation checks from the previous checkpoint were not rerun because the candidate did not change. This rehearsal exercised expired refunds, not exchange deposits/swaps/withdrawals, live external-wallet approval, private settlement, Zcash or physical phones.

The subsequent configured rollout includes release review and a bounded client connection to the new method. Missing callbacks in other stages and `attention` recovery remain open. A successful rehearsal does not protect against compromised full-access keys or replace the broader security review.
