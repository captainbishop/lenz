# Offline source-asset budgets

The first enforcement candidate connects a limited ETH deposit to offline-signed
instructions, encrypted delivery, execution and owner recovery. It runs only in
the isolated chain-31337 rehearsal. It is not connected to a user funding button,
NEAR Intents, Aurora Intents, a real venue or private settlement.

Ordinary users should choose an action and its spending limits. Network controls
are under wallet settings. Assets do not need to move to NEAR or Aurora merely
to join Lenz. The code lives under `aurora/` because it uses the existing EVM
toolchain; that directory does not make this an Aurora deployment.

## Authority over existing ETH

An ordinary wallet connection cannot let another party spend native ETH. This
candidate uses an explicitly funded, limited escrow on the source chain. The
funding transaction records an immutable policy and only the attached ETH becomes
available to that budget. The remainder of the user's wallet is outside its
authority. No unlimited allowance, imported wallet key or administrator exists.

The policy fixes the offline signing address, target and direct runtime hash,
allowed function selector, output asset/runtime hash, beneficiary, maximum debit
per instruction, maximum fee, minimum output per ETH and expiry. A compromised
offline signer could consume the entire funded budget within those rules; the
deposit is the overall loss bound. This escrow is a local implementation candidate,
not a selected production custody design or a funded public deployment.

Each instruction is EIP-712 signed over its budget ID, sequential nonce, input,
minimum output, fee and fee recipient, deadline, call-data hash and privacy policy.
The domain binds chain ID and contract address. The executor cannot substitute
terms or pay its own address unless the instruction authorizes that recipient.
Signature bytes do not identify a separate spend: nonce consumption does.

The contract is [OfflineBudget.sol](../aurora/contracts/OfflineBudget.sol).
[Browser signing and envelope validation](../web/public/offline-budget.js) use
the pinned [EIP-712/signature bundle](../web/offline-budget-build.json).
No provider is required to sign. Production signer generation, encrypted key
recovery and migration remain incomplete; browser tests use explicitly disposable
fixture keys and do not alter the user's Lenz identity.

The [offline outbox](../web/public/offline-budget-outbox.js) persists the signed
instruction, chosen executor and exact encrypted carrier envelope in the shared
browser store before returning a handoff. Web Locks serialize competing tabs.
Another instruction for the same budget nonce is refused, including after expiry;
retrying the same instruction retains its original terms and ciphertext.
Storage capacity is checked before committing new records, with room reserved
for their later acknowledgements. A full outbox preserves earlier authorizations
and lets their delivery state advance. This module is available offline but is not
connected to a funding or signing control in the product.

Carrier delivery requires explicit enablement and records destinations before
sending. Up to four carriers can receive an authorization, including attempts
whose replies were lost. Carrier storage and authenticated executor storage have
separate states. Neither state settles an instruction, releases its nonce, or
credits the wallet. Expiry leaves the authorization unresolved. There is no
automatic retry through another destination or a public execution route.
If carrier retention expires while the instruction remains valid, handoff renews
and saves the outer retention wrapper. The signed instruction, executor, nonce,
encrypted payload and message ID stay the same. Expired carrier storage is no
longer reported as current custody; renewed delivery requires a new acknowledgement.

## Execution and recovery

A distinct `BudgetCall` is created for each budget. Only the manager can invoke
it. Venues therefore see separate caller addresses for separate budgets. This is
essential when a venue associates rewards, positions or withdrawals with its
caller rather than a recipient argument.

The manager checks the nonce, deadline, policy, signature, target code, fee and
remaining budget before dispatch. It debits input plus fee, pays the signed fee,
then measures output before and after the venue call. Measuring after fee payment
prevents the fee itself satisfying a native-output minimum. The price floor
rounds upward. A failed call, failed fee or insufficient output reverts all of
that transaction's changes, including the nonce and debit.

The original instruction remains potentially executable after a reverted attempt
until it expires or is revoked. An execution result must not be interpreted as
permission to sign a replacement against the same funds. A successful replay is
blocked on chain. Sequential nonces also mean a later instruction waits for the
earlier one; independent offline queues and replacement handling are not provided.

The funding owner can revoke without receiving ETH, then withdraw the exact
unspent remainder. Withdrawal goes only to that owner. A failed receiver cannot
erase its refund liability. Revocation is effective when ordered on chain; a
previously submitted execution can win transaction ordering.

Owner-only `recoverPosition` revokes delegation and calls a venue or related
contract through the same isolated caller. It can use a different selector to
exit a position or claim rewards, but forwards none of the unspent budget ETH.
Any residual native funds at that caller are swept to the original owner. The
offline signer has no access to this recovery authority. A real integration
must still decode, review and verify each protocol's exit; this entry point alone
does not establish Aave, LP, staking or Hyperliquid recovery support.

Manager balances and remaining liabilities are distinct from funds or positions
already delivered elsewhere. Closing a budget does not close a venue position.
This implementation never credits an EVM result as offline tUSD.

## Privacy boundary

The existing Lenz encryption protects the instruction for the chosen executor.
The executor can read it. The on-chain payload contains no Lenz chat identity,
but funding addresses, budget signer, amounts, targets, fees and calls remain
public in this candidate. Transport identities, timing and packet lengths retain
the [existing privacy limits](privacy-workflows.md).

Both the signer module and contract accept only the explicit
`lenz/public-local-rehearsal/v1` policy. A request requiring private execution is
rejected; there is no automatic downgrade. This tests authority and encrypted
transport, not private settlement. Production private funding, execution,
metadata protection and return paths remain current integration work.

NEAR Intents may provide eligible funding/settlement routes; a 1Click deposit does
not establish a destination protocol action. Aurora may provide execution where
needed. Their actual authorization, funding, solver, privacy and refund interfaces
must connect to this path before a user can fund or execute it. The manager's
single-call output check cannot establish cross-chain atomicity or finality.

## Verification and limits

Run with the existing Playwright runtime available through `NODE_PATH`:

```text
node aurora/verify-offline-budget.mjs
```

[Contract/signature verification](../aurora/offline-budget-verification.json)
records source hashes and detected guard alterations.
[Offline browser evidence](../aurora/offline-budget-browser-results.json) records
the browser-to-executor rehearsal. The browser reloads offline, loads cached
signing modules, signs and encrypts an instruction, and retains ciphertext across
another reload using the outbox. A real local HTTP/SQLite carrier receives it;
the test discards the response, restarts the carrier, reloads the browser and
retries the identical envelope. The executor retrieves one envelope through its
authenticated inbox, checks it and executes the actual compiled contract against
a synthetic venue. Recipient balances and source remainder are measured in the EVM.
The encrypted reply is authenticated executor communication, not an independent
chain finality proof. The test also returns a storage acknowledgement through the
carrier and checks that it creates no recipient output. Physical mesh delivery
is not exercised. The signing key remains a disposable test fixture.

[Outbox browser tests](../web/offline-budget-outbox-browser.test.cjs) cover nonce
conflicts across tabs, failed writes, recipient binding, missing consent, altered
terms, forged acknowledgements, expiry and capacity. These use disposable Edge
contexts with real IndexedDB, Web Locks and WebCrypto.

Security review of the initial design identified shared downstream caller
authority. A synthetic venue reproduced a second budget claiming the first
budget's rewards; isolated callers and an independent attacker-key regression
close that path. Owner recovery addresses the resulting separate-caller exit
requirement. Deliberate guard alterations test whether critical assertions fail.
This is development review, not a completed external audit or measured Solidity
line/branch coverage. Foundry coverage, Slither and Aderyn scans did not run for
this contract. A command-path lookup alone does not establish whether those
tools are installed elsewhere.

Direct code hashes do not pin proxy implementations, external dependencies,
governance or honest balance reporting. Aggregate ERC-20 balance growth can
include a rebase rather than newly delivered output. No arbitrary rebasing,
upgradeable, fee-on-transfer or otherwise unusual token/venue is approved by
these tests. Actual adapter/token policies and protocol-specific result proofs
must be reviewed before extending the rehearsal to external assets. The current
synthetic venue is not evidence of Uniswap, Aave or Hyperliquid execution.

Approved rehearsal instructions can also use the [nearby courier](nearby-delivery.md)
path. The receiving device must independently approve the sender and budget
policy. Its durable inbox returns a signed storage receipt, retains conflicting
nonce history, and does not execute the request or release the sender's nonce.
This extends offline delivery, not the rehearsal's production or privacy scope.

The full [existing-wallet journey](crosschain-defi.md) still needs recoverable
onboarding, product budget signing/storage, deployment and funding preflight,
durable external submission/reconciliation, privacy-preserving routes and verified
position exits. These remain active requirements rather than completed features.
