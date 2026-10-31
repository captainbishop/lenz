# Configured adapter recovery release

Reviewed 2026-10-31 in the development workspace. This is a bounded testnet release review, not an independent audit or approval for real funds.

Target: `lenz-rhea-1792987934062.testnet`. The [live plan](rollout-plan.json) records 13 public storage entries, six completed/refunded orders, block height 275588540 and the account's one full-access public key. The reserve and exchange code matched the configured/reviewed versions. No order was in flight at that snapshot.

- Previous Wasm SHA-256: `6a01b6fa4e1a1d07d3bfe495d6bbfb97c24182c274b332815e864580f58012e1`.
- Candidate SHA-256: `53b9b2ebb270ceb643aae7f07fcb4ab852ca47882bd17375b27db04d45bc4a80`; 309,632 bytes.
- Candidate NEAR code hash: `6dq5B7LSetQyUffc6NgY8Y5dXG2g4tJyboFhbBofVqMy`.

The runner verifies the archived baseline, candidate, source/test/lock hashes and rehearsal digest. Removing the two added methods from the production source reproduces the archived source exactly. State types, existing methods and prefixes are unchanged. The saved rehearsal establishes actual storage preservation and exact refunds on isolated accounts; it is not repeated for this release.

## Authority review

Recovery reads the reserve's permanent consumption identifier while the order is still `redeeming`. Private callback identity, result count, bounded parsing, exact digest and current stage determine whether it may become `funded`. Neither recovery method retries a token action. Original and competing callbacks cannot rewind an advanced order. The permanent record establishes historical redemption, not present solvency; it must never authorize recovery from later stages.

The local relay verifies its pinned deployment and the current signed order before opening its sponsor. Recovery requires an enabled capability and exactly `{adapter,id}`; the fixed call contains only `{id}`, zero deposit and 250 Tgas. Changed or unsupported stages return current status without opening a signer. Every signed recovery hash is journaled before broadcast. A same-origin compromised script can still use permitted sponsor calls and access the authority of its browser context; the origin check is not protection from such code.

The wallet shows **Resume swap** only for an enabled `redeeming` order. It makes one recovery request and leaves later advancement to **Continue swap**. **Check status** remains read-only. Pending, unavailable or forged replies do not release the signed reservation or create offline credit. Repeated clicks are suppressed while busy. The cache version changes; IndexedDB namespaces and keys do not.

The configured account's full-access key can replace code or move tokens outside the order machine. Reserve/exchange upgrades and a compromised builder remain trusted-authority risks. Same-host hashes, local tests and this review do not provide independent release approval. Independent review, build isolation and separation of signing/upgrade authority remain requirements before real funds or increased custody.

## Upgrade and recovery procedure

`node contracts/upgrade-adapter-recovery.mjs` saves a read-only plan. `--apply` sends exactly one `DeployContract` action using the existing adapter key. There is no initializer, funding, new account, token action or key change. A filesystem lock prevents concurrent invocations; a stale lock requires inspection of the recorded process and journal, never automatic deletion/redeployment.

Before signing, compare current storage to the reviewed snapshot and durably save it. Save the exact SDK-signed hash before broadcast. If the reply is lost, query that hash on resume. Unknown or nonfinal replies never trigger another signature. Nonfinal replies remain eligible for a later status query. Final failed or contradictory receipts require investigation. Compare final code and every storage entry before enabling the public capability. A code or storage mismatch leaves configuration unchanged for inspection; there is no automatic rollback. If configuration writing fails after verified deployment, resuming completes it without another deployment.

The receipt verifier binds network/target, signed hash, exact deploy digest, absence of extra actions, successful final receipt graph and return path. RPC responses remain trusted; this does not verify consensus inclusion independently. The historical deployment file is retained.

## Verification and failures

Fresh checks before application: 42 Node tests, 11 disposable Edge wallet checks, three refund-return browser checks, four receipt-guard mutations, four upgrade-guard mutations and 39 static cache routes. Browser funding/RPC/recovery responses are fixtures; browser signing, encrypted storage, cache refresh, offline reload and layout checks are real. No physical-phone or external signer test ran. The candidate did not change, so the prior native/chain rehearsal was not repeated.

The additional nonfinal-then-final retry test failed against the first runner: a saved nonfinal response prevented another status query. Resuming now rechecks nonfinal responses under the same saved hash. The regression and guard-removal check pass. The first upgrade mutation harness expected a missing-rejection assertion for the artifact guard; the actual failure correctly showed that a signer had been opened. Its expected diagnostic was corrected; the production guard was unchanged.

The initial network read failed with sandbox `EACCES`. The approved read timed out with no plan/transaction saved; a labeled diagnostic retry succeeded. No failed run is counted as passing evidence. The earlier offline-proof timeout remains unexplained and its original evidence is preserved.

Application completed in transaction `3S7We8EdECFaeDJWKbh3bn6RLzVwETMk7xKEbE1qu2TZ`: [full journal](rollout.json). All 13 entries matched, the capability was enabled, and five [deployment/follow-up checks](rollout-verification.json) passed. Three [live HTTP checks](../../../web/rhea-recovery-live-results.json) verified the running server and unchanged return for an existing refunded order without signing. No new missing-callback fault was injected into the configured adapter. The local server was restarted after preserving a Windows stop failure and the resulting port-in-use error; see the [security failure record](../../../research/security/verification.md).
