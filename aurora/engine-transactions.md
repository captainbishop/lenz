# Aurora transaction confirmation

`engine-receipt.mjs` checks whether a specific NEAR-to-Aurora call has finished
and whether the EVM execution succeeded. It is a developer module for the pending
execution adapter. It is not connected to the Lenz wallet and cannot sign,
broadcast, retry a transaction or release an offline payment reservation. The separate
[submission journal](engine-submissions.md) adds persistence and explicit retry
for already signed calls.

## Check a call

Keep the expected call reference from the application that submitted it. Do not
construct the expected fields from the same RPC response being checked. The
reference contains public call details only, with this shape:

```json
{
  "version": 1,
  "network": "testnet",
  "engine": "aurora",
  "sender": "your-sender.testnet",
  "txHash": "<actual NEAR transaction hash>",
  "gas": "250000000000000",
  "contract": "<actual 20-byte EVM contract address>",
  "value": "0",
  "input": "0x"
}
```

Replace the placeholders and use the actual gas allowance, value in wei and hex
calldata. Decimal amounts must be strings. This version accepts named `.testnet`
senders and 64-character implicit account IDs. The transaction must contain
exactly one `call` action to `aurora`, with zero attached NEAR deposit. EVM value
comes from the Engine account; encoding a value does not fund it.

From `aurora/`:

```sh
npm run check:transaction -- path/to/reference.json
```

The command sends one `tx` request to `https://test.rpc.fastnear.com`, using the
hash, sender and `wait_until: FINAL`. It writes the result to stdout and leaves
wallet state untouched. Exit 0 means EVM success; exit 2 means pending or
unavailable; exit 1 covers failed execution, review and invalid evidence/input.
Exit 0 does not mean a payment settled. Returned uint64 gas is printed as a decimal
string without losing precision.

For integration code, `checkEngineTransaction(reference)` performs the lookup.
`inspectEngineTransaction(reference, transaction)` validates a supplied response
without network access and throws on invalid input. The lookup snapshots its
reference before awaiting, rejects invalid references before making a request,
and returns `unverified` for invalid RPC evidence.

## Result states

| State | Meaning |
| --- | --- |
| `pending` | A recognized NEAR execution status has not reached `FINAL`. Hash-only responses can stay pending. |
| `evm_succeeded` | The final returned Engine result is `Succeed`, the expected call matches and the complete receipt graph contains no failed receipt. |
| `evm_failed` | NEAR returned an Engine result, but the EVM reverted or reported another failure. |
| `near_failed` | The final returned NEAR outcome is a failure. |
| `needs_review` | EVM execution succeeded, but a side or refund receipt failed. Failed receipt IDs are included. |
| `unavailable` | The request timed out, the transport failed or the RPC reported an error. No resend is authorized or attempted. |
| `unverified` | The response is malformed, inconsistent, incomplete at `FINAL` or exceeds the configured bounds. |

The checker requires the transaction hash, signer, receiver, gas and exact encoded
call bytes to match. All receipts must be reachable, unique and resolved, with
no cycles or shared children. A promise return must identify a direct child;
the final transaction summary must match the outcome reached along those returns.
Engine success bytes must come from `aurora`. Receipt payloads use canonical
base64 and the bounded [Engine decoder](engine-interface.md).

Limits are 128 receipt outcomes, 32 KiB of calldata, 64 KiB per result and
256 KiB for the streamed RPC body. The default 20-second deadline covers the
request and body; redirects are rejected. Oversized legitimate transactions
remain unverified and require separate review. The reader does not silently
weaken these bounds or switch providers.

## Verification and limits

Run:

```sh
npm test
node engine-receipt-mutations.mjs
```

The November 1 run passed 20 receipt tests, within 43 Aurora tests. Eight deliberate
guard removals were detected, covering finality, exact arguments, direct return
links, summary matching, failed side receipts, EVM reverts, reference snapshots
and graph completeness. [Recorded controls](engine-receipt-mutations.json) bind
the source, tests and codec by SHA-256. The fixtures cover complete success,
NEAR failure, promise returns, full-width values, an ERC-20-style false return,
invalid evidence and response loss. Loopback HTTP tests exercise actual redirects
and stalled bodies; other responses are synthetic.

A regression test caught invalid UTF-8 in an Engine error being classified as a
transport failure. Result validation now returns `unverified` for that case,
while actual connection failures remain `unavailable`.

No live Aurora transaction has been submitted or confirmed by these tests.
The reader relies on the selected RPC's report; it does not verify a consensus
proof or attest the deployed Engine code. NEAR's [transaction RPC documentation](https://docs.near.org/api/rpc/transactions)
distinguishes `EXECUTED` from `FINAL`, which includes completion of refund
receipts. An incomplete final graph is rejected rather than treated as success.

Even a successful EVM call may return false, do nothing or only begin an
asynchronous asset transfer. The [direct ERC-20 checker](engine-transfers.md)
now checks exact transfer calldata, canonical true return and matching event
parties/amount. Its reported result does not establish token trust or credit money. The execution adapter must still verify the intended
asset, recipient and amount, final bridge/callback outcomes and conservation of
liabilities. The [developer journal](engine-submissions.md) now saves signed calls
before dispatch and checks interrupted submissions by hash. Account authorization,
a funded NEAR/Aurora route and integration with payment liabilities remain required.
The configured tUSD mapping was absent in the separate [read-only preflight](engine-preflight-results.json).
