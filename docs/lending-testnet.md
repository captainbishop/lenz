# Sepolia lending

Lenz's lending reader checks Aave V3 on Ethereum Sepolia, chain ID 11155111.
It reports LINK collateral, Aave test USDC debt, free token balances and the
selected account's health from one canonical finalized block. An unavailable
position stays unknown. Reserve liquidity alone does not establish ownership.

The [fixed configuration](../web/public/intent-lending-config.js) distinguishes
Aave test USDC from Circle's Sepolia USDC. Callers may select an account and
owner; they cannot replace the network, token addresses or deployment pins.
Runtime code and proxy implementations must match the configured hashes before
the reader verifies an execution route. Without deployment pins, it provides
protocol observations without advertising an executable route.

When later activity or accrued interest prevents the current position from
verifying an original request, reconciliation checks its finalized receipt-time
position. Financial calls use the exact canonical receipt hash. Historical code
and proxy storage use its block number, bracketed by receipt and finalized-head
hash checks. Later account activity cannot replace the original credit or debt
evidence. Missing history,
changed hashes, or another permission in the same block leave the request
unresolved; status checks do not create a replacement transaction.

The [HTTP adapter](../web/intent-lending-http.mjs) accepts bounded JSON requests
from the configured local Lenz origin. It returns noncached observations and
limits concurrent reads. It does not sign, fund or submit transactions. Mounting
an execution service is a separate integration step.

Run the reader and HTTP checks from the repository root after installing the
locked dependencies in `aurora/`:

```powershell
node --test web/intent-lending-read.test.mjs web/intent-lending-http.test.mjs
```

These tests use protocol-shaped RPC and local HTTP fixtures. They cover account
and asset binding, code changes, finality conflicts, cancellation, malformed
responses and request limits. They do not establish live Supply or Borrow.

Execution requires a dedicated funded Sepolia sponsor, its key file and a
durable journal outside the repository. The normal app server uses
`LENZ_LENDING_KEY` and `LENZ_LENDING_DATA` for those paths. Keep the same journal
and sponsor through restarts; reconcile unresolved requests before new actions.
The proving worker and its hash-bound artifacts must also be available before
private Supply. An unconfigured or static hosted preview cannot execute lending.

The Repay view offers one fixed 1 Aave test USDC grant to cover test loan
interest. A new grant requires an outstanding debt in both finalized and latest
positions. Its review identifies Sepolia, the receiving lending account, the
public mint, the sponsor-paid fee and the one-grant limit per owner and account.
The pinned faucet and token cannot be replaced with another asset or recipient.
No approval or account-spending permission is needed for the faucet mint.

The grant shares the existing sponsor fence and durable journal with setup,
LINK funding, Supply and account orders. A journal upgrade adds its namespace
without replacing those original requests. Check Repay funding reconciles the
exact mint and finalized independent balance. Resume can resend only the
retained signed transaction after its absence is checked; interrupted signing
stays unresolved. Checking the original grant remains possible after repayment.
These boundaries have fixture-backed unit and browser tests; they do not by
themselves establish live repayment or a completed account exit.

The withdrawal proof hides the cryptographic deposit-to-withdrawal link.
Lending accounts, amounts, collateral, debt and Aave actions remain public.
RPC, network and service operators may correlate activity; a small pool provides
limited anonymity. Testnet verification does not certify production fund safety.
