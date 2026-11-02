# Aurora access-key preflight

Before broadcasting a saved Engine call, the submission journal checks the
signing key's current NEAR permissions. It requests `view_access_key` at
`finality: final` from the fixed testnet endpoint. The account and public key come
from the validated signed transaction, so a caller cannot supply a different key
for the permission check.

The check runs for the initial dispatch and every explicit retry that reaches
the broadcast stage. It leaves the signed bytes unchanged. Ordinary recovery
continues to query the original transaction receipt without requiring the key to
remain active.

## What is checked

The decoder already requires one NEAR V0/Ed25519 FunctionCall to `aurora.call`,
with exact reviewed Engine arguments, gas and zero attached NEAR. The preflight
then applies these checks to the reported final block:

- A regular `FullAccess` key permits the action.
- A `FunctionCall` key must name `aurora` and allow the exact `call` method.
  An empty method list permits all methods, as defined by NEAR.
- A finite allowance must be a canonical uint128 decimal string. Zero blocks the
  dispatch; `null` means unlimited. A positive allowance does not prove that the
  key or account can afford the transaction.
- The signed nonce must exceed the reported key nonce and be below the recorded
  block height times 1,000,000, saturated at uint64 maximum.
- Block hashes must encode exactly 32 bytes. Heights and reported nonces must be
  safe nonnegative JavaScript integers, with a positive height. Unsafe numeric
  RPC values are rejected rather than rounded into an authorization decision.

Gas-key permission variants are unsupported in this V0 path. Permission objects
have an exact schema. Method lists are bounded at 128 entries and 256 UTF-8 bytes
per name; responses remain subject to the shared 256 KiB body limit and request
deadline. Out-of-scope legitimate keys require separate review.

The implementation follows the [pinned NEAR runtime and account definitions](engine-access-source.json).
The public [access-key guide](https://docs.near.org/protocol/accounts-contracts/access-keys)
and [RPC interface](https://docs.near.org/api/rpc/contracts#view-access-key)
describe the two supported permission forms.

## Results and recovery

`checkEngineAccessKey(reference, signedTxBase64)` is read-only and returns:

| State | Meaning |
| --- | --- |
| `permitted` | The reported permission and nonce checks passed at the returned block. This is not payment approval or a guarantee of execution. |
| `blocked` | A parsed permission, nonce or exhausted allowance prevents dispatch. The reason and observed block are included. |
| `unverified` | Evidence is malformed, unsupported or exceeds a bound. |
| `unavailable` | The lookup failed, including RPC errors for missing accounts or keys. It does not distinguish a deleted key from every other RPC failure. |

A rejected preflight does not increment the journal's attempt count, replace the
transaction or alter its receipt observation. The developer CLI prints it under
`preflight`, returning exit 1 for blocked/unverified or exit 2 for unavailable.
The transient preflight result is not cached as a durable transaction outcome.

The journal rechecks permissions before each dispatch. Its atomic revision claim
prevents sending after a concurrent receipt update. If a final receipt arrives
while an unsuccessful key lookup is in progress, the final outcome takes
priority. A consumed nonce alone cannot establish whether this specific call
executed; recovery still checks the saved transaction hash.

## Verification and limits

Run `node engine-submission-verification.mjs` from this directory after installing
the pinned Aurora and contracts dependencies. The [recorded run](engine-submission-results.json)
passes 105 Aurora tests, one independent SDK check and 35 detected guard alterations,
including eleven [transfer-receipt controls](engine-transfers.md).

Eleven access tests cover exact query identity/finality, restricted keys, nonce
boundaries, integer precision, unsupported permissions, missing keys, changing
permissions, concurrent final receipts and unchanged signed bytes. Loopback HTTP
checks exercise missing-key errors, redirects, oversized/stalled bodies and unsafe
numeric values. CLI checks verify denied/unavailable exit codes and zero dispatch
attempts. These tests use synthetic key observations; no live account was modified
and no transaction was broadcast.

The final-receipt priority test failed before its fix. The first malformed-hash
fixture was itself valid base58 and was corrected. An initial mutation run exposed
test crashes before broadcast assertions; the revised tests check the unwanted
dispatch directly, and removing the preflight gate now fails those assertions.

A final-block observation can lag newer key changes and pending nonces. It is
neither a nonce reservation nor a consensus proof. The node still validates
permissions, balances, fees, recent-block validity and execution when processing
the transaction. Permission checks alone cannot bind a Lenz user's approval to
an EVM asset, recipient or amount: a key allowed to call `aurora.call` can invoke
different EVM targets through that method. Lenz approval binding, account linking,
funded routing, payment effects and liability accounting remain required.
