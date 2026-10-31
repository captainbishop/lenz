# Returning account tUSD to offline notes

2026-10-26. Implemented and verified on testnet; see [upgrade and live wallet evidence](../contracts/upgrade/README.md).

The original reserve created offline notes only from its one-time test grant. Rhea refunds are ordinary NEP-141 balances at the signed receiving account. Returning those tokens requires the receiving account's authorization; a Lenz signature alone cannot debit an arbitrary NEAR account.

`deposit_offline` extends the token/reserve contract without changing its serialized state. In one NEAR receipt it transfers tUSD from the calling account into the reserve, increases the reserved liability and creates a fresh root note. Total token supply is unchanged. Insufficient balance, invalid signatures or insufficient storage payment revert the receipt.

The browser signs `["lenz/near-deposit/v1", "testnet", reserve, payer, source, owner, amount]`. `source` is a 32-byte hex identifier. A root is identified by the hash of `["lenz/near-deposit-root/v1", "testnet", reserve, payer, source]`. One payer/source pair can create only one root: exact retries return that root without another debit, and changed owner/amount is rejected. The original consumed swap note is never revived. A previously spent deposit root stays spent on replay.

For the local test sponsor, `source` is the hash of `["lenz/rhea-refund-source/v1", adapter, orderId]`. Its relay verifies final `refunded` state, exact amount and signed owner, and that the sponsor is the original receiving account. A new browser signature binds the return to that owner. These checks prevent one browser from returning another browser's refund or changing the source to charge it twice. The on-chain payer/source record survives relay restarts.

External receiving accounts must authorize their own deposit with a NEAR signer. The local relay must never pretend that a browser signature grants access to those accounts. Its supported sponsor route remains explicitly testnet-only. A generic unsigned deposit action can be provided for external signers; creating that file is not execution evidence.

The browser saves its return request before submitting it. A matching final root plus its consumed status is required before adding it to the encrypted vault. Reimports preserve local transfers, outstanding reservations and chain conflicts. Lost responses recover the same source/root. A pending, rejected, attention or merely expired swap cannot create a refund credit.

The [recorded upgrade rehearsal](../contracts/upgrade/README.md) checked funded notes, settled spends, redeemed balances and an existing receipt across code deployment, then exercised deposits, duplicates, rejection, onward settlement and redemption. The applied code-only upgrade preserved all 74 state entries in the configured reserve. Its initializer was not rerun.

This is public NEAR accounting. It does not resolve private settlement, old-snapshot recovery, Intents execution or the separate shielded Zcash DeFi route.
