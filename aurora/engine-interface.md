# Aurora Engine interface

The Engine codec encodes NEAR-to-EVM call arguments and reads EVM execution
results. It is preparation for an execution adapter; the wallet does not submit
these calls yet. Encoding a call does not authorize it or fund its sender.

## Encodings and bounds

`engine-codec.mjs` follows Aurora Engine revision
[`f296f06ab618468dff58cbef81732b1d0ee1782e`](https://github.com/aurora-is-near/aurora-engine/tree/f296f06ab618468dff58cbef81732b1d0ee1782e).
The [source manifest](engine-source.json) records the interface references and hashes.

| Operation | Representation |
| --- | --- |
| `call` arguments | Borsh `CallArgs::V2`: discriminator 0, 20-byte contract, raw 32-byte big-endian value, little-endian input-vector length and input |
| `view` arguments | 20-byte sender, 20-byte contract, raw 32-byte amount, input vector |
| Token lookup | Borsh NEAR account string; response is exactly 20 raw address bytes |
| Token deployment arguments | `WithMetadata` discriminator 1 and Borsh NEAR account string; encoding only |
| `view` response | `TransactionStatus` |
| `call` response | Version-7 `SubmitResult`, including status, full-width uint64 gas and logs |

NEAR account addresses use the last 20 bytes of Keccak-256 of the account ID.
The codec validates account syntax and keeps amounts as unsigned `bigint` values.
Calldata is limited to 32 KiB and decoded responses to 64 KiB. Submit results admit
at most 128 logs and four topics per log. Unknown versions/statuses, truncation,
oversized vectors, invalid UTF-8 and trailing bytes fail closed.

Only `Succeed` sets `succeeded: true`. `Revert` remains a failure even when its
return bytes decode correctly. All twenty status variants in the pinned interface
are covered by the tests. The 42-byte upstream serialization fixture embedded in
the test is attributed to Aurora Engine; no upstream implementation is included.

## Verification

Run from `aurora/`:

```sh
npm test
node engine-codec-mutations.mjs
npm run check:engine
```

The November 1 run passed 23 tests, including six codec and three query-wrapper
tests. Four altered guards were detected: treating a revert as success, ignoring
the result version, accepting trailing bytes and removing vector bounds.
[Mutation results](engine-codec-mutations.json).

The [read-only Engine check](engine-preflight-results.json) observed chain ID
1313161555 at final block 275731024. An empty EVM view succeeded. The configured
tUSD token returned `ERR_NEP141_NOT_FOUND`, so its mapping was absent at that block.
Every contract query uses the same block hash. The check reads no private account
and performs no signing, funding, deployment or financial transaction.

An earlier November 1 query at block 275726077 reported `Invalid result bytes`.
Inspection of that same block showed a contract execution error inside the NEAR
query's `result` object. `engine-query.mjs` now distinguishes it from return bytes,
requires the selected block, and recognizes only the exact observed missing-token
error. Other errors and ambiguous responses remain failures. Restricted network
attempts failed; the authorized read-only checks succeeded.

The RPC reader rejects redirects, malformed JSON, mismatched response IDs and
top-level errors, with a 128-KiB streamed-response limit and a 20-second deadline.
The observed Engine code hash is recorded, but it is not proof that the deployed
code was compiled from the pinned source revision.

## Transaction receipts

The [transaction checker](engine-transactions.md) now binds an expected call to
final NEAR receipts and its returned Engine result. Its fixture tests distinguish
EVM reverts, NEAR failures, failed side receipts and unavailable responses.
This is preparation for payment-outcome verification and recovery; no live Aurora
execution or wallet submission is established by those tests. A separate
[submission journal](engine-submissions.md) persists signed calls and recovers
interrupted sends; it remains a developer component.

## Remaining integration work

Lenz still needs a deployed execution adapter, account authorization, a funded
NEAR/Aurora asset route, duplicate and expiry rules, asynchronous receipt recovery,
and verified conservation of liabilities across the route. An EVM success status
alone cannot establish NEAR finality, bridge completion or settlement of an offline
payment. No separate Aurora Intents integration is implemented by this codec.
