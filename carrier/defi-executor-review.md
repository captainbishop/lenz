# Executor security review

## Scope

Internal adversarial review of the encrypted DeFi inbox, executor journal and NEAR
client. The reviewed paths are [intake](defi-inbox.mjs), [authorization](../web/public/defi-request.js),
[dispatch](defi-executor.mjs) and [chain checks](../contracts/defi-executor-client.mjs).
Tests use generated identities and fixture chain responses; no public service,
live balance or existing wallet was attacked. This is not an independent audit.

Adversaries considered: a packet sender replaying or changing signed requests, an
owner reusing a spending key across messaging identities, a faulty/stale RPC,
concurrent executor processes, and a signer returning changed transaction bytes.
The selected executor necessarily sees the decrypted operation; its honesty and
the configured RPC remain explicit trust boundaries for result delivery.

## Reproduced findings and fixes

### Final evidence overwritten after an outage

Severity: low within the developer library. After a final refund observation was
saved, making the next RPC read fail and calling `run` replaced the durable report
with `unavailable`. The test demonstrated lost saved evidence, not lost funds.

Reports now preserve newer block observations and final results. The regression
`unavailable and stale observations cannot overwrite a saved final result` fails
before the fix and passes after it. Transient failed checks remain reportable
without deleting the saved final evidence.

### Regressed state could trigger a new action

Severity: medium for executor gas/availability. Save a final swap observation with
no local attempts, then return an older unresolved state from the RPC and call
`run` again. The original implementation issued a settlement attempt. The local
fixture observed one unintended broadcast. No double spend was demonstrated.

The worker now compares observations against its persisted final/block state both
before planning a dispatch and immediately before claiming an attempt. The test
`a saved final state prevents dispatch from a later regressed chain response with
no prior attempts` demonstrates zero broadcasts after the fix.

### Messaging aliases bypassed local input conflicts

Severity: medium for duplicate admission and sponsor abuse. An owner retained one
spending key but created another messaging encryption key and Lenz ID. Both IDs
signed requests for the same input. The inbox originally accepted both because its
conflict slot included the messaging ID. This bypassed local conflict policy;
NEAR's input-consumption rule was not bypassed.

New conflict slots bind the spending authority. Intake also checks existing
per-profile slots for all recorded identities with that signing key. Tests cover
sequential requests, concurrent aliases and older database records, preserving the
original ciphertext and rejecting the competing request. There is no automatic
cleanup or rewriting of existing records. Previously admitted competing requests
still require operator review and chain reconciliation.

## Other exercised boundaries

The [recipient boundary](defi-results.md) now authenticates the original approval
and encrypted report, then reads the approved operation through its own pinned
observer. A signed false success, unavailable RPC, foreign request, malformed
report, nonfinal state and expired recovery are exercised. Seven additional
alterations are detected. This read-only module does not credit or unlock funds;
the recipient's configured RPC remains trusted and wallet integration is open.

The test suite checks signed terms/owner/executor/disclosure, exact expiry,
funded-root and consumed-input checks, final-block code/configuration pins,
refund-payer authority, durable-before-broadcast ordering, SDK byte identity,
concurrent claims, lost-response/restart handling and receipt-graph consistency.
Neither a storage receipt nor a successful executor response mutates wallet funds.
Guard-removal verification checks that selected regressions detect disabled controls.
See the [intake report](defi-inbox-results.json) and [executor report](defi-executor-results.json)
for exact counts and source hashes.

## Limits

No full Solidity, Rust contract, Zcash prover, dependency, deployment or release-key
audit is represented here. Oracle/flash-loan, lending, liquidity and ERC-4626 claims
are outside this increment because those execution adapters are not implemented.
The testnet reserve and adapter retain their existing contract trust and upgrade
assumptions. This review does not establish live-chain reliability, global offline
double-spend prevention, private settlement, metadata anonymity, forward secrecy,
Sybil resistance or safe restoration of copied wallets. Independent review and
end-to-end validation remain required before real funds.
