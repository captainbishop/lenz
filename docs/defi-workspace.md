# Offline DeFi workspace

The product target is a [cross-chain DeFi aggregator](crosschain-defi.md), including
Hyperliquid perpetuals/margin, staking, farming and further strategies. The current
workspace below is the first UI slice; its five tabs do not limit that scope.
Rhea is one provider, and Aurora is one possible execution environment.

Lenz's DeFi workspace includes Swap, Supply, Borrow, Liquidity and Withdraw.
Each operation needs an offline approval path, a stated privacy boundary and
recoverable results. The current connected action is the public NEAR testnet
tUSD → wNEAR Rhea adapter. The other views describe missing integrations;
they do not show fabricated markets, rates or usable lending positions.

## Current wallet behavior

The swap panel shows the input balance, estimated output, rate, slippage,
minimum received, receiving account and deadline. A rate requires connectivity.
Offline, the user can enter an explicit minimum without treating a saved rate
as current. Quote replies must still match the selected amount, slippage and
privacy choice before they can populate the panel.

Private execution is required by default on every new swap. Lenz has no private
route for these test assets, so that choice blocks both quotes and approvals.
The user can explicitly allow this public testnet swap. This does not claim
that encrypted storage or transport makes the on-chain execution private.

The user can save a swap to run themselves later, or select a contact who runs
a Lenz executor. The latter opens a review with the exact person, amounts,
minimum, receiving/refund account and deadline. Disclosure consent starts
unchecked. The executor can read the request and included payment history;
carriers can observe routing identifiers, sizes and timing. A contact name or
avatar is not proof that the operator is trusted or available.

Approval saves the reservation and encrypted request atomically. The wallet
then offers an encrypted file or explicit carrier delivery. Reloads and retries
reuse the same signed envelope. Carrier storage and executor acknowledgements
remain separate from execution and never release or credit money. See the
[approval and delivery implementation](../carrier/defi-wallet.md).

Nearby executor intake, automatic execution from wallet delivery, independently
verified results applied to the wallet, and backed offline reuse of returned
assets still need integration. A missed deadline alone cannot release a
reservation. The current interface must not be presented as completed offline
DeFi or private settlement.

## Provider capabilities and route selection

Provider documentation reviewed on November 2, 2026 describes broader capabilities
than the current Lenz adapter. These are integration candidates, not verified
Lenz routes.

| Provider | Documented capability | What Lenz still has to establish |
| --- | --- | --- |
| [Rhea](https://www.rhea.finance/) | Cross-chain swaps and lending/borrowing. Its [cross-chain API](https://github.com/rhea-finance/rhea-sdk-docs/blob/main/CrossChainDexAPI.md) describes EVM aggregation and confidential routing. | Exact supported chains/assets, route and fee binding, partner access, signed approvals, terminal status, recovery and privacy assumptions. Specific Uniswap pools and Aave markets have not been verified. |
| [Rhea cross-chain lending](https://guide.rhea.finance/docs/rhea-finance-cross-chain-lending-litepaper) | Cross-chain accounts, wallet bindings, nonces/deadlines and relayed actions. | Account authority and upgrades, collateral and liquidation checks, bounded actions, offline monitoring limits, withdrawal/repayment and liability recovery. |
| [NEAR Intents confidential swaps](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps) | Confidential routing options, including a distinct embedded confidential-intent flow. | Supported assets, actual disclosure/trust model, partner access, refund and final-result verification. Documentation claims are not independent proof of unlinkability. |
| [NEAR signed intents](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/signed-intent-execution) | Exact off-chain intent signing, submission and status recovery for funds held in Intents. | Online quote generation/authentication and an authorization design that remains safe when the user disconnects. Off-chain signing alone does not establish offline execution. |
| [Aurora chain signatures](https://doc.aurora.dev/crosschain/chain-signatures/) | EVM-compatible execution and outbound cross-chain signing mechanisms. | Actual destination contracts and funded asset routes, current external-state verification, approval binding, result verification and recovery. EVM compatibility alone does not provide another chain's liquidity. |

For a Uniswap pool or [Aave market](https://aave.com/docs/index), support must name
the actual chain, contracts, assets and operation. A route to a token does not
establish support for supplying collateral or managing a debt position. Cross-chain
crypto transfers also do not by themselves provide fiat deposits, bank withdrawals
or every jurisdiction's cross-border financial services.

## Requirements for each additional action

- Approve offline with exact asset, amount, destination, fee, expiry and operation
  bounds. A connected executor must obtain current chain/price/collateral checks
  before acting; an unavailable executor leaves the action pending.
- Carry the privacy requirement through quote, approval, execution and recovery.
  State who can read each part. Never substitute a public route for a private one.
- Keep durable reservations and attempts across interrupted delivery or submission.
  Reconcile duplicate and ambiguous results before retrying or releasing money.
- Verify the actual resulting balance or position independently. Supply, borrow,
  liquidity, repay and withdrawal each need their own accounting checks.
- Explain risks that continue while the user is offline, especially liquidation,
  interest and changing pool positions. Any delegated monitoring or protective
  action needs explicit authority and limits.
- Preserve identity, outstanding liabilities and backed offline onward transfer
  through recovery and device migration.

These requirements apply to Rhea, NEAR Intents, Aurora and shielded Zcash routes
together. See [development status](status.md) for their separate implementation
and funding, partner, recovery and device limits.

## Browser evidence

[Approval cases](../web/defi-approval-browser-results.json) and
[deliberate guard alterations](../web/defi-approval-verification.json) exercise the
real Edge UI and storage, offline cached reload, loopback carrier and executor
intake. Quote responses and initial backing are explicit fixtures. No live
financial transaction, physical-phone test or remote executor is established.
