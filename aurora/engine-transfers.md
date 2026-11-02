# Aurora ERC-20 transfer receipts

The transfer checker compares an independently prepared payment expectation with
the final receipt of a direct ERC-20 call through Aurora. It distinguishes EVM
execution success from a token's reported transfer. It is a read-only developer
module and command; it never credits the Lenz wallet or releases a reservation.

## Expected transfer

Save a JSON file with exactly two fields: `reference`, using the
[Engine call reference](engine-transactions.md#check-a-call), and `payment`:

```json
{
  "version": 1,
  "network": "testnet",
  "engine": "aurora",
  "token": "<lowercase token contract address>",
  "from": "<lowercase Engine caller address>",
  "to": "<lowercase recipient address>",
  "amount": "<positive integer in token base units>"
}
```

The example is the `payment` field, not the whole request. Use independently
reviewed token, parties and amount; deriving expectations from the same receipt
being checked would defeat the comparison. This module does not obtain or verify
the user's approval.

The Engine reference must target that token with zero EVM value and exactly
`transfer(address,uint256)` calldata. The sender address must equal the
[pinned Engine derivation](engine-interface.md) for the reference's NEAR signer.
Addresses in the payment expectation must be lowercase, nonzero 20-byte hex
strings. The amount must be a positive canonical uint256 decimal string.
Amounts use base units, with no floating-point conversion or assumed decimals.

This bounded path excludes zero-value and self transfers, approvals,
`transferFrom`, swaps, bridge exits and arbitrary router calls. ERC-20 permits
zero-value transfers; excluding them here is a payment-check policy.

From `aurora/`:

```sh
npm run check:transfer -- path/to/expected-transfer.json
```

The command makes only the existing bounded `tx` lookup to NEAR testnet.
The input is limited to 72 KiB. It prints separate `execution` and `transfer`
objects. Exit 0 means the transfer evidence matches; exit 2 means execution is
pending or unavailable; exit 1 covers invalid input and other unsuccessful
checks. Exit 0 is not a token-trust decision or settlement authorization.

`inspectEngineTransfer(reference, payment, transaction)` checks a supplied receipt.
`checkEngineTransfer(reference, payment)` performs the read-only lookup. Both
validate expectations first; the lookup snapshots them before awaiting a response.

## Evidence checks

A reported transfer requires all of the following:

- The existing verifier accepts the exact transaction and its complete final
  receipt graph, with successful EVM execution and no failed side receipt.
- The return value is exactly the 32-byte ABI encoding of `true`.
- Exactly one log has the standard `Transfer(address,address,uint256)` event topic.
- That log comes from the expected token, has exactly three topics, and encodes
  the expected sender, recipient and amount with canonical padding and widths.

A canonical `false` return produces `transfer.state: not_reported`.
Absent or noncanonical return bytes produce `unverified`. Missing, duplicate,
extra or mismatched transfer logs also produce `unverified`. Unrelated event
topics can coexist with the one matching transfer. Pending or failed execution
produces `unconfirmed`.

These rules follow [ERC-20](https://eips.ethereum.org/EIPS/eip-20) and the
[Solidity ABI specification](https://docs.soliditylang.org/en/latest/abi-spec.html).
Tokens with optional return data or fees need their own reviewed behavior; this
checker does not silently accept them.

## Verification and remaining trust

Run `node engine-submission-verification.mjs` after installing the pinned Aurora
and contracts dependencies. The [recorded suite](engine-submission-results.json)
passes 105 Aurora tests and one independent NEAR SDK check.
[Eleven transfer guard alterations](engine-transfer-mutations.json) are detected,
alongside sixteen submission and eight receipt controls. The reports bind sources,
tests, compiler helper and lockfiles by SHA-256.

Fourteen transfer checks cover full-width values, exact calldata, caller
derivation, recipient/token substitutions, false and malformed returns, log layout,
duplicate/fee events, receipt failure, asynchronous snapshots and CLI behavior.
The ethers ABI implementation independently builds synthetic call/event bytes.

Local EVM tests compile and execute a small Solidity fixture, compare its deployed
runtime bytes and read actual balances before and after calls. Normal transfer,
false return, missing event, fee deduction and revert cases are exercised.
The caller is supplied by the local harness to match Engine derivation; the NEAR
receipt wrapper is synthetic. These are not live Aurora or funding results.

A separate adversarial token emits the exact expected event and returns true
without changing balances. The checker correctly describes its report, but cannot
establish the token's honesty. Conversely, a token may move value while returning
false or omitting an event. Neither an unmatched result nor expiry authorizes a
replacement payment.

Production payment verification still needs an approved token implementation and
upgrade policy, trustworthy chain evidence, a funded route, Lenz approval/account
binding and liability reconciliation. Matching logs alone cannot prove a balance
change, bridge completion or private settlement. The generic submission journal's
states and saved transaction bytes are unchanged.
