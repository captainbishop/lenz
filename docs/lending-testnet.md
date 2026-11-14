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
durable journal outside the repository. A later local execution integration will
use `LENZ_LENDING_KEY` and `LENZ_LENDING_DATA` for those paths. Keep the same journal
and sponsor through restarts; reconcile unresolved requests before new actions.
The proving worker and its hash-bound artifacts must also be available before
private Supply. An unconfigured or static hosted preview cannot execute lending.

The withdrawal proof hides the cryptographic deposit-to-withdrawal link.
Lending accounts, amounts, collateral, debt and Aave actions remain public.
RPC, network and service operators may correlate activity; a small pool provides
limited anonymity. Testnet verification does not certify production fund safety.
