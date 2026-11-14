# Private LINK Supply

The [Supply factory](../aurora/contracts/PrivateSupply.sol) binds one original
LINK privacy pool, Aave pool, receipt token and chain. Each immutable plan fixes
the beneficiary, refund recipient, minimum scaled aLINK credit, deadline and
salt. Those terms determine the vault address used in the original withdrawal
proof.

Fulfillment withdraws the full LINK denomination to that vault and supplies it
directly to the beneficiary. The proof uses the exact vault recipient with zero
relayer, fee and native refund. The vault approves only the denomination, checks
the actual LINK debit and scaled aLINK increase, then clears the Aave allowance.
It does not hold or transfer the beneficiary's receipt tokens.

An original withdrawal already sent to the predicted vault can be recovered
through the same plan. Through its deadline, the vault supplies the LINK; after
expiry, unconsumed LINK returns to the fixed refund recipient. A successfully
supplied position needs a separate account-owned Aave withdrawal. Extra LINK
donations also return to the fixed refund recipient.

The factory fixes runtime hashes and receipt identities. It has no administrator,
arbitrary target, arbitrary call data or mutable payout. Runtime pins alone do
not freeze Aave proxy implementations; the execution adapter must check its
configured implementation pins as well.

Run the local checks after installing the locked `aurora/` dependencies:

```powershell
node --test aurora/private-supply.test.mjs
```

These tests execute compiled Solidity with local token and indexed Aave fixtures.
The original-pool fixture checks withdrawal arguments and spent nullifiers; it
does not verify a Groth16 proof. Real proof compatibility, deployed identities,
finalized protocol credit and browser recovery need separate integration checks.

The proof hides the cryptographic link between deposit and withdrawal. Accounts,
amounts and Aave activity remain public, and a small pool offers limited anonymity.
Supply grants no borrowing authority. Recovery must preserve the same plan,
note, beneficiary and unresolved request.
