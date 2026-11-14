# Bounded lending accounts

The [lending account](../aurora/contracts/LendingAccount.sol) holds one fixed
Aave route. Its factory derives the same account address for the same owner.
The contract permits Ethereum Sepolia and the local test chain.

Borrow, Repay and Withdraw require an exact EIP-712 owner permission bound to
the deployed account, chain, amount, recipient, deadline and current nonce.
Borrow and Withdraw also enforce debt and health bounds; Borrow caps the
variable rate. Repay spends account-held Aave test USDC and clears the pool
allowance. Receipt minting and burning use Aave's scaled accounting and the
post-operation stored index.

Separately signed Transfer permissions release only free test LINK or Aave test
USDC to the specified recipient. Transfer, Cancel and lending orders consume the
same nonce. There is no arbitrary-call or administrator spending interface.
Cancellation competes with execution; chain ordering decides which succeeds.
Expired permissions reject, and failed calls roll back the nonce and token state.

The route binds token and pool runtime hashes and checks receipt ownership.
Aave proxy implementation upgrades remain a governance boundary, so execution
adapters must also verify the configured implementation pins. Events alone do
not prove a finalized balance or position.

Run the local contract checks after installing the locked `aurora/` dependencies:

```powershell
node --test aurora/lending-account.test.mjs
```

The tests execute compiled Solidity in a local EVM with token and indexed Aave
fixtures. They cover signature/domain changes, replay, expiry, cancellation,
health/debt/rate bounds, exact credit/debit, allowance cleanup, index rounding,
changed code and reentry. They do not establish live lending, restored browser
keys, hosted execution or a complete security audit.

Recovery must preserve the same owner, factory, account and unresolved signed
permissions. On-chain accounts, amounts, collateral, debt and actions are public.
Private Supply and the browser execution journey are separate integrations.
