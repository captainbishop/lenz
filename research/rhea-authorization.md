# Rhea authorization and custody

2026-10-26. Active implementation design for the testnet adapter.

The testnet implementation now passes native, live chain and live wallet checks. See [adapter evidence and commands](../contracts/adapter/README.md). This document records its accounting assumptions and the remaining recovery limits.

The existing tUSD reserve remains unchanged. A separate adapter accepts a P-256 signed swap instruction and the reserve's existing signed redemption authorization. The instruction binds the reserve, adapter, exchange, pool, full input note amount, minimum wrapped-NEAR output, receiving/refund account, nonce and submission deadline. A local self-transfer can split a larger note first. Both signatures and the reserve's recorded owner must agree before an input is locked to one order.

The deadline limits when the adapter dispatches the exchange swap. Rhea's documented swap method has no deadline parameter, so it cannot promise the execution receipt lands before that time. The old reserve redemption signature also has no expiry. A signed order must therefore remain locally reserved until its chain outcome is reconciled; passing a deadline alone never releases its note.

## Accounting and transitions

| State | Where the asset is | Next action |
| --- | --- | --- |
| Checking / ready | Original reserve note | Validate recorded owner, lock input, redeem to adapter |
| Funded | Adapter tUSD balance | Deposit into Rhea, or offer refund if expired |
| Deposited | Adapter's tUSD deposit inside Rhea | Dispatch bounded swap, or withdraw refund if expired |
| Output on exchange | Adapter's wrapped-NEAR deposit inside Rhea | Withdraw exact recorded output |
| Refund on exchange | Adapter's tUSD deposit inside Rhea | Withdraw original input |
| Output/refund available | Adapter token balance | Transfer to the account signed by the user |
| Paying | Transfer is in flight | Await callback; never dispatch it twice |
| Complete / refunded | Signed recipient's NEP-141 balance | Preserve final order record; no input reuse |
| Attention | Outcome cannot be established from the callback | Keep value unavailable; reconcile before further transfers |

The system contains three asset stores: reserve notes, adapter balances and exchange deposits. Asynchronous receipts create delays between them. Retrying an operation merely because a response is late can debit a store twice. Every external call therefore records an in-flight state first; only the matching private callback advances it. Repeated submissions return the existing order. Independent orders share token balances, but are credited only by their exact returned amounts, never by a before/after balance difference affected by other orders.

A failed direct swap is atomic inside the exchange and leaves its input deposit intact. A failed final NEP-141 payout leaves the token in the adapter and can be retried after the recipient registers. Missing or malformed transfer-call/withdrawal outcomes do not justify issuing a second payout; they become `attention`. Tests must establish the actual exchange withdrawal failure response before relying on it.

Refunds go to the signed NEAR account. They do not resurrect the consumed offline note. The [backed-deposit mechanism](../contracts/upgrade/README.md) returns refunds to fresh offline notes for the configured local receiver; other receiving accounts still require their own NEAR signer. The UI must state this destination before signing.

## Required evidence

- Reject altered terms, invalid signatures, mismatched reserve owners/amounts, a different network/adapter/pool and duplicate input claims.
- Preserve reservations through reload and failed storage writes. A failed local commit releases no signed packet.
- Verify success, slippage rejection/refund, expiry/refund, payout-registration failure/retry and duplicate submissions on testnet.
- Test callback authenticity, stage matching and ambiguous results. No public callback or late callback may credit value.
- Keep every order status and transaction receipt distinct from a claim of private settlement. This adapter publishes terms on NEAR and relies on the configured reserve/exchange implementation.

Intents partner access, browser Zcash signing and a shielded DeFi route remain open in [development status](../docs/status.md). The native Zcash test transfer has separate recorded evidence. This adapter does not replace either integration or the full private settlement construction.
