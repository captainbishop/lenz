# DeFi executor

The executor reads an authenticated request from the encrypted inbox, checks the
configured NEAR testnet at a final block, and dispatches at most one action per
`run(requestId)`. It supports the existing Rhea swap and refund-return operations.
Repeated calls can advance a swap through its stages. They do not retry a step
whose broadcast outcome is uncertain.

This is a developer library, separate from the forwarding carrier server and its
container. Wallet approval, automatic nearby handoff, operator discovery and
recipient-side chain verification are not wired into the app yet. The existing
wallet flow is unchanged. No production funds or shielded settlement are supported.

The [durable wallet approval service](defi-wallet.md) now supplies a tested browser
storage boundary for approvals and encrypted handoffs. Its user controls and
transport/result integration are still pending.

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
the signing boundary. The exact SDK-signed transaction hash and sender are committed
before broadcast. Its signer checks the call and verifies the returned transaction
bytes against the approved bytes. SDK nonce retries are disabled.

Each request/step/call combination has one durable slot. Concurrent workers cannot
claim it twice. A crash, storage failure, expired approval or lost response retains
the attempt. A later run reads current state and reconciles the saved transaction.
It can advance a demonstrated next stage, but does not automatically resubmit an
unresolved or failed step. Explicit retry/replacement policy remains unimplemented.
A process stopping between claim and signing therefore needs recovery work before
that step can resume.

Attempt arguments and result reports are encrypted for the requesting identity.
The journal also contains request/step hashes, public transaction references and
timing metadata. It stores no signing key. Its database is bound to the executor
identity and configuration. Upgrade all inbox processes together; new intake also
checks the earlier per-profile conflict slots without deleting existing records.

Final saved observations survive unavailable or older responses. Once a final
result is saved, a regressed response cannot trigger another action. A transient
failed check can return `unavailable` while `report(requestId)` retains the last
verified observation and its timestamp/block reference.

## Result semantics and privacy

`run` returns an encrypted `lenz/defi-observation/v1` packet. It binds the request ID,
check time, observed final-block state and available transaction/receipt references.
Transaction inspection checks the exact signer, target, arguments, gas/deposit and
receipt graph. Caught side-receipt failures remain visible. Transaction success is
separate from the current swap or deposit outcome.

The observation is evidence from the executor's configured RPC. The separate
[recipient verifier](defi-results.md) now checks reports through independent,
pinned chain reads in developer tests. It is not integrated into the wallet.
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
additional DeFi adapters, safe recovery and independent auditing remain open.
