# Durable Aurora submissions

The developer journal saves an already signed NEAR-to-Aurora call before sending
it. If the response is lost or the process stops, it retains the transaction hash
and original bytes for recovery. It is a Node module and CLI; the Lenz wallet
does not call it yet.

## Record and recover a call

Use Node 24 or later and install the pinned dependencies with
`npm ci --ignore-scripts` in this directory. Supply a JSON request with exactly
three fields:

- `operationId`: a stable 64-character lowercase hexadecimal ID for the approved operation.
- `reference`: the independently reviewed [call reference](engine-transactions.md#check-a-call).
- `signedTxBase64`: the actual signed NEAR transaction, encoded as canonical base64.

The future execution adapter must derive the operation ID from the approved Lenz
instruction and keep it stable across retries. A random new ID per attempt is
not a replacement policy. One operation cannot change its reference or signed
bytes, and another operation cannot reuse the same transaction hash.

From this directory:

```sh
node scripts/engine-submission.js record path/to/request.json
node scripts/engine-submission.js inspect <operation-id>
node scripts/engine-submission.js send <operation-id>
node scripts/engine-submission.js check <operation-id>
node scripts/engine-submission.js retry <operation-id>
```

`record` validates and saves without network access. `inspect` reads the saved
summary. `send` can broadcast a transaction to NEAR testnet: it first checks the
endpoint network and [current access-key permissions](engine-access.md),
commits an attempt to SQLite, then calls `send_tx` with
`wait_until: NONE`. A successful dispatch response alone does not prove validation,
inclusion or execution.

After an earlier attempt or saved observation, ordinary `send` only checks status.
`check` always uses the saved hash and sender without broadcasting. Explicit
`retry` checks first and may resend only the saved bytes when status is
`unavailable` or `pending` at `NONE`. Included, unverified and final results prevent
that retry. A permitted access-key preflight is also required before dispatch.
Newer observations are rechecked before the atomic attempt claim.
Concurrent initial sends from two journal connections can claim only one attempt.

The four final states are `evm_succeeded`, `evm_failed`, `near_failed` and
`needs_review`. They survive later transient errors; contradictory final results
raise an error. Execution checks use the complete [receipt graph](engine-transactions.md).
Even `evm_succeeded` does not mean a payment settled: a contract can return false,
make no transfer or start another asynchronous operation.

Exit 0 means a successful record/inspect action, or verified EVM success for a
network action. Exit 2 means pending or unavailable; exit 1 covers failures,
review and invalid input/evidence. Stdout contains the operation ID, hash, attempt
count and outcome, without signed transaction bytes. A denied or unavailable
[preflight](engine-access.md#results-and-recovery) is reported separately and does
not record a dispatch attempt.

## Storage and limits

The default store is `.testnet/engine-submissions/submissions.sqlite`; use
`--journal directory` to choose a different private directory. It stores signed
broadcast capabilities and call details in plaintext. Keep it and the input
request private, outside source control. It is not an encrypted account backup.

SQLite uses WAL with synchronous FULL. Durability depends on the filesystem and
storage device honoring flushes. POSIX creation modes are 0700 for the directory
and 0600 for the database; Windows directory access follows its ACLs. Protect the
entire directory, including WAL files, and keep an existing directory private.
Deleting or restoring an old journal can erase knowledge of attempted calls.
Do not treat a stale copy as permission to spend again.

Limits are 128 records, 100 attempts per record, 34 KiB per signed transaction
and 128 KiB per CLI input. RPC bodies are bounded at 256 KiB, with a default
20-second deadline covering the request and body. Both submission and status
lookup use the fixed testnet endpoint `https://test.rpc.fastnear.com`; redirects
are rejected. Local record/inspect commands work without a connection.

The decoder accepts only NEAR V0 with an Ed25519 key/signature and exactly one
FunctionCall to `aurora.call`. It verifies the signature over the unsigned
transaction hash, sender, receiver, nonce, exact Engine arguments, gas and zero
attached NEAR. EVM value is denominated in wei and requires an existing Engine
balance. The separate access-key preflight checks reported permissions and nonce
bounds at a final block. It does not reserve a nonce, prove sufficient funds or
establish recent-block validity.

## Verification

After installing both the Aurora and `../contracts/` pinned dependencies, run:

```sh
node engine-submission-verification.mjs
```

The [recorded run](engine-submission-results.json) passed 105 Aurora tests and one
independent near-api-js 7.4.0 check of encoding, transaction hash and signature.
[Sixteen submission guard removals](engine-submission-mutations.json) and
[eight receipt guard removals](engine-receipt-mutations.json) were detected.
[Eleven transfer controls](engine-transfer-mutations.json) also pass for the
[direct ERC-20 receipt checker](engine-transfers.md).
Reports bind the checked implementation and tests by SHA-256.

Tests cover failed record/attempt/result writes, visibility from another database
connection before dispatch, lost responses, child-process termination, restart,
concurrent sends, immutable operations, retries, quotas and CLI round trips.
Actual loopback HTTP exercises redirects, oversized/stalled bodies, mismatched
response IDs and an expired-transaction RPC error. All signatures and receipts
in these tests are disposable fixtures; none were broadcast to a chain.

Regression tests reproduced two resend errors before their fixes: sending after
an inclusion observation with zero local attempts, and clearing a newer final
observation after an older retry check. Both now preserve the observed state.
An initial SDK signature test used the wrong field in the decoded SDK object;
the passing test uses its Ed25519 variant and independently rejects an altered
message hash.

The serialization review is pinned to [NEAR core source](engine-submission-source.json)
and the existing [Aurora Engine source](engine-source.json). NEAR documents
[`send_tx` and `tx`](https://docs.near.org/api/rpc/transactions) separately from
[transaction signing and validation](https://docs.near.org/protocol/transactions).

This step has no live submission evidence. Full account authorization, binding Lenz
approval to the call, deployed contracts, a funded NEAR/Aurora asset route,
payment effects and liability handling remain required. The journal trusts the
configured RPC and local database; it verifies neither consensus proofs nor
deployed code. Expiry, a timeout or an unavailable receipt cannot authorize a
replacement transaction or release an offline reservation. Full account recovery
and safe device migration remain separate work.
