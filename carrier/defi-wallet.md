# Durable wallet approval

The [browser wallet service](../web/public/defi-wallet.js) saves a signed Rhea
approval, its reservation and one encrypted executor request in the existing
encrypted tUSD vault. It returns only after the shared IndexedDB transaction
commits. A failed write returns no successful approval or handoff.

The [wallet workspace](../docs/defi-workspace.md) now exposes executor choice,
review and explicit encrypted-file/carrier delivery. Nearby executor delivery,
automatic execution and recipient result-to-credit integration remain open.
The approval service itself does not call a network endpoint or select an executor.

## Approval and retry

`approveDefiSwap(config, executorProfile, swap, consent)` takes the existing Rhea
swap terms (`text`, `minOutput`, `receiver`, `deadlineMs`). Consent must contain a
stable random 32-hex `approvalId`, `PUBLIC_TESTNET_DISCLOSURE`, and `expiresAt`.
The caller retains that approval ID for retries of the same user decision.
Changing executor, route, terms, expiry or disclosure under that ID is rejected.
An unchanged retry returns the original request/order IDs without signing another
request or reserving more money, including after the approval expires.

The caller must show the selected executor and public-chain disclosure before
calling this API. A valid contact key does not prove operator reliability or
authenticate a displayed name. The service validates the profile/key binding and
snapshots all inputs before its first asynchronous operation.

The shared Web Lock serializes the complete read, preparation and write across
tabs. The existing Rhea reservation excludes its input from both wallet and chat
spending. Splitting a larger note preserves the available change. No new database
version, identity, vault key or balance format is introduced; optional executor
metadata lives on its existing order inside the encrypted vault.

`defiHandoff(config, requestId)` rechecks the original signed approval, reservation,
encrypted packet and direction, then returns that exact saved packet after a
successful store commit. It refuses expired approvals, known consumed/conflicting
inputs and already completed/refunded orders. It never creates replacement bytes.
With `{envelope:true}`, it persists one signed carrier envelope before returning
it. Its packet must match the original ciphertext; retries and cached reloads
reuse the exact envelope. With `{carrier:true}`, it also checks durable carrier
opt-in. A failed envelope commit produces no outward handoff.

`sendDefiRequest` rechecks consent, expiry and conflicts before each configured
carrier POST. It accepts only a matching storage acknowledgement, and persists
the storage origin after the reply. Response loss keeps the original envelope
for retry. Storage receipt processing never invokes the executor dispatcher.

## Receipt and money boundaries

`recordDefiStorageReceipt(config, requestId, packet)` authenticates the selected
executor's receipt against the saved request. Foreign requests/signers, financial
claims, malformed receipt times and substituted saved packets fail. A receipt
issued during the approval window can be recorded after expiry. Duplicate receipts
preserve the first saved acknowledgement.

The receipt means only that an executor stored the request. It changes neither
the swap's execution status nor its roots, spends, available balance or reservation.
Elapsed time never releases money. [Independent result checks](defi-results.md)
remain separate from applying verified results and backed refunds to the wallet.
Copied-device restoration and missing state cannot be repaired by retrying this API.

## Evidence and retained limits

[Thirteen browser cases](../web/defi-wallet-browser-results.json) use real Edge,
IndexedDB, Web Locks and WebCrypto with synthetic initial backing on a disposable
loopback origin. They exercise failed approval/handoff/receipt commits, reload,
loaded offline use, repeated/concurrent approvals, competing tabs, mutable callers,
expiry during encryption, old receipts and changed stored bindings. Identity,
contacts, history, nonextractable keys and the remaining change are checked.
The 63 existing executor, intake and money-protocol regressions also pass.

[Eleven deliberate alterations](../web/defi-wallet-verification.json) are detected.
The handoff-expiry control removes both adjacent time checks together; the other
controls each change one guard or operation. These tests are not a complete audit.

The first launch could not resolve Playwright until the existing bundled package
directory was supplied through `NODE_PATH`; no package installation was required.
A later regression launch failed before starting because Windows could not start
the sandbox account (1909). Its approved rerun passed all 63 cases.

There is no physical-device, live-chain or financial-transaction result here.
The original service tests loaded modules before disabling network access.
The later [wallet UI checks](../web/defi-approval-browser-results.json) also cover
a cached offline page reload with the current app worker. They use disposable
profiles, synthetic backing and loopback HTTP/SQLite carrier/executor intake.
Transport metadata and public NEAR execution remain visible as disclosed.

The UI review freezes the displayed terms and starts with unchecked consent.
Back and failed writes preserve funds; rapid clicks reserve only once. Private
execution is the default and blocks quotes/signing on the current public route.
Late replies cannot overwrite a changed privacy choice, amount or slippage;
the returned minimum is checked against the requested tolerance. Other DeFi
actions describe unconnected features without simulating positions or rates.

The [UI alteration gate](../web/defi-approval-verification.json) tests consent,
reviewed terms, removed contacts, privacy enforcement, quote races/minimums,
carrier consent, envelope binding/persistence and storage-only acknowledgements.
This remains a component review, not an external audit or private-settlement proof.

With Node.js 24 and Playwright available to the test process:

```sh
node web/defi-wallet-verification.cjs
node --test --test-concurrency=1 contracts/defi-executor.test.mjs carrier/defi-inbox.test.mjs web/rhea-protocol.test.mjs web/near-protocol.test.mjs web/near-payment-service.test.mjs web/near-deposit.test.mjs
```
