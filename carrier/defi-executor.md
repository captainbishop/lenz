# DeFi executor

The executor reads an authenticated request from the encrypted inbox, checks the
configured NEAR testnet at a final block, and dispatches at most one action per
`run(requestId)`. It supports the existing Rhea swap and refund-return operations.
Repeated calls to `run` can advance a swap through its stages. They do not retry a
step whose broadcast outcome is uncertain. `retry(requestId)` explicitly resends
a retained signed transaction after current authorization and chain checks.

`check(requestId)` reads progress without claiming a step, opening a signer or
broadcasting a transaction. It is the status-polling boundary; `run` is an execution
action. Checks authenticate the saved request, use the same pinned final-chain
reads and reconcile any existing transaction. They may save encrypted evidence.
An unresolved submission stays pending, and a failed or unsigned attempt at the
current step needs review. An expired approval can still be checked, but does not
become permission to start another action. A confirmed outcome remains saved when
later reads fail or regress. These observations never credit or release funds.

This is a developer library, separate from the forwarding carrier server and its
container. Browser approval and nearby request storage exist; their connection to
this worker under a personal browser identity and operator discovery remain pending.
The separate [receiving service](defi-service.md) accepts carrier deliveries for
an independently provisioned executor contact and resumes its saved inbox. The
wallet can check a saved approval through its own local chain reader; automatic
encrypted result retrieval and financial credit/return integration remain open.
No production funds or shielded settlement are supported.

The [durable wallet approval service](defi-wallet.md) now supplies a tested browser
storage boundary for approvals and encrypted handoffs. The browser courier can
retain requests and return storage receipts; a receipt does not start this worker
or confirm execution.

## Execution boundary

[The NEAR client](../contracts/defi-executor-client.mjs) checks the chain ID,
freshness of a final block, and pinned adapter, exchange and reserve code hashes.
All contract state reads use that same block hash. The reserve code hash is derived
from the configured Wasm SHA-256. Changed code/configuration, missing funding or
conflicting consumption stops dispatch.

The action planner verifies the original signatures and exact order. Its allowed
calls are reserve `settle`, adapter `submit`/`advance`/`recover_redemption`, and
reserve `deposit_offline`. Amounts stay in integer base units. The signed minimum
output and destination remain unchanged. In-flight or attention states wait;
redemption recovery requires the exact reserve consumption record.

Refund return requires the final refunded order, signed deposit terms, current
payer balance and deposit capability. An existing deposit is checked against its
exact root and consumption record. The payer must sign its own deposit. The
provided client supports only the configured disposable test sponsor; it cannot
spend another receiving account's balance.

## Persistence and recovery

The [worker](defi-executor.mjs) stores an execution attempt in SQLite before opening
the signing boundary. The exact SDK-signed transaction bytes, hash and sender commit
together before broadcast. The bytes are encrypted and limited to 64 KiB. A failed
write prevents broadcast and retains the attempt. Expiry is checked again after
commit, so waiting on another database writer cannot permit a late broadcast.
The committed signed record remains available for status checks. Its signer checks the call and
verifies the returned transaction bytes against the approved bytes. A detached copy
prevents the signer from changing them while storage is awaited. SDK nonce retries
are disabled.

Each request/step/call combination has one durable slot. Concurrent workers cannot
claim it twice. A crash, storage failure, expired approval or lost response retains
the attempt. A later run reads current state and reconciles the saved transaction.
It can advance a demonstrated next stage, but does not automatically resubmit an
unresolved or failed step.

`retry(requestId)` never opens the signer or prepares a new step. It first reads
fresh final chain state and reconciles the original transaction. Only an unresolved
transaction with a still-current, identical planned step can be resent. The client
checks canonical encoding, transaction hash, signature, sender, exact call and payer
before sending. Approval expiry and journal progress are checked again at the
broadcast boundary. Changed configuration, a completed/failed transaction, a
different planned step or missing retained bytes prevents resubmission.

Submission replies are checked against the exact transaction and receipt graph,
just like later status reads. Valid final replies are saved before attempting
another status read; unavailable or invalid replies remain unresolved.
Verified final transaction outcomes are encrypted and retained per attempt. A
later unavailable status response cannot downgrade that result or permit another
submission. Recovery also checks for a final outcome learned by another worker
while authorization was being validated. These transaction records remain
separate from independently checked swap/deposit state and wallet credit.

Concurrent explicit retries may transmit the same transaction more than once;
they preserve its bytes, nonce and hash. This relies on NEAR's transaction replay
rules, not on local knowledge that the earlier transmission failed. A lost reply
keeps the original attempt unresolved. The worker does not replace an expired
block reference, change a nonce or increase fees. Chain rejection requires review.

Older journals and clients that retained only a transaction reference remain
status-only. A process stopping between claim and signing still needs recovery
work before that step can resume. No row is deleted or financial authority released
to make a retry possible.

Attempt arguments, retained signed transactions and result reports are encrypted
for the requesting identity and readable by the executor.
The journal also contains request/step hashes, public transaction references and
timing metadata. It stores no signing key. Its database is bound to the executor
identity and configuration. Upgrade all inbox processes together; new intake also
checks the earlier per-profile conflict slots without deleting existing records.

Final saved observations survive unavailable or older responses. Once a final
result is saved, a regressed response cannot trigger another action. A transient
failed check can return `unavailable` while `report(requestId)` retains the last
verified observation and its timestamp/block reference.

## Result semantics and privacy

`check`, `run` and `retry` return an encrypted `lenz/defi-observation/v1` packet. It binds the request ID,
check time, observed final-block state and available transaction/receipt references.
Transaction inspection checks the exact signer, target, arguments, gas/deposit and
receipt graph. Caught side-receipt failures remain visible. Transaction success is
separate from the current swap or deposit outcome.

The observation is evidence from the executor's configured RPC. The separate
[recipient verifier](defi-results.md) now checks reports through independent,
pinned chain reads in developer tests. The wallet also has a read-only status check
against its own configured reader; it does not trust or credit the executor report.
Neither report is a light
client proof, a new offline note or permission to release a wallet reservation.
The wallet must independently verify the result and apply its existing deposit
consumption rules before crediting eligible returned funds. A malicious executor or
RPC remains a trust boundary until that integration is complete.

The existing explicit public-NEAR disclosure policy applies. The executor decrypts
terms/ancestry; carriers see traffic metadata; NEAR publishes executed terms.
Private-only requests fail closed. Request expiry stops new executor dispatch but
does not revoke underlying contract signatures or release reserved money.

## Verify

Requires Node.js 24.21.0 and the locked `near-api-js` 7.4.0 dependency in `contracts`:

```sh
node carrier/defi-inbox-verification.mjs
node carrier/defi-executor-verification.mjs
node --test carrier/network.test.mjs web/rhea-protocol.test.mjs web/near-protocol.test.mjs web/near-deposit.test.mjs web/rhea-relay.test.mjs contracts/adapter-recovery.test.mjs
```

[Executor evidence](defi-executor-results.json) and [intake evidence](defi-inbox-results.json)
use real WebCrypto, SDK signing, SQLite and local HTTP with synthetic chain state
and receipts. They perform no live funding, financial transaction or user-wallet
operation. [Security review](defi-executor-review.md) records reproduced findings,
mitigations and the review's limits. Physical-device tests, live executor validation,
additional DeFi adapters, unsigned-claim/replacement recovery and independent
auditing remain open. Recovery checks use synthetic RPC state and real ephemeral
SDK signatures; they do not establish live chain replay behavior or private settlement.
