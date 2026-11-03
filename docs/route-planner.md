# Cross-chain route objectives

The shared [catalogue](../web/public/defi-catalog.js) and
[planner](../web/public/defi-route-plan.js) describe a complete desired DeFi
operation before an adapter is selected. A Uniswap action can have NEAR funding
and a return leg. An Aave position can stay on its EVM chain. Hyperliquid orders
use the HyperCore venue interface, independently of HyperEVM.

This is a developer foundation. It has no network, wallet, signer, dispatch or
storage access. Every generated step remains unverified and every preview has
`executable: false`. Catalogue entries are integration targets; they do not
establish a deployment, market, asset pair or connected route. Rhea's recorded
public testnet swap remains the existing connected adapter.

## Try the examples

From the repository root:

```sh
node integrations/preview-route.mjs --fixture near-evm-return
node integrations/preview-route.mjs --fixture aave-position
node integrations/preview-route.mjs --fixture hyperliquid-order
node integrations/preview-route.mjs --file objective.json
node --test integrations/route-planner.test.mjs
node integrations/verify-route-planner.mjs
```

The [fixtures](../integrations/route-planner-fixtures.mjs) use synthetic token
addresses, accounts and amounts. They are not wallet instructions. The file
command validates an objective using the current time; it does not submit it.

## Objective boundaries

An objective contains the exact source asset and maximum spend, destination
chain/market/action, recipient, expiry, minimum received, per-asset fee budgets,
privacy preference and an explicit return destination or `null`. Asset identity
includes chain, token standard and contract or venue identifier. Decimals must
agree across references to the same asset. Amounts use bounded integer strings.
Asset metadata still needs validation against the actual deployment.

Position changes need a position or order reference. Order placement,
modification and reduction also include instrument, side, size, limit price,
leverage bound and reduce-only policy. These are objective fields; actual venue
precision, collateral/debt limits, market health, signing and exact recipient
semantics still require an adapter. A reduction cannot request increased exposure.
An opening position cannot implicitly withdraw itself to satisfy a return leg;
that needs a separate explicit exit objective.

The planner rejects unknown fields, including injected calldata or purported
execution authority; mismatched asset standards, networks and recipients;
missing privacy/fees/minimums; expired requests; and inconsistent decimals.
Returned objects are immutable snapshots, including fees and recovery policy.
The snapshot is not a signature or durable journal.

Orders may explicitly include `sizeDecimals` (0–6) and `priceDecimals: 6`.
These scale the integer size and limit price. Existing unscaled objectives can
still be previewed but cannot attach a [route estimate](route-drafts.md).

## Steps, evidence and recovery

Steps cover source verification, funding only when the execution destination
differs, destination action and verification, then an explicitly requested
return and its verification. Stable identifiers and dependencies describe the
required order. Funding includes venue deposits as well as bridge routes; no
specific bridge or asset conversion is selected here.

Missing observations are unavailable. Fixtures remain fixtures. Caller-supplied
live-read metadata is labelled `reported-live`, becomes `cached` at expiry, and
rejects future timestamps. This label authenticates neither the provider nor its
claim. No observation makes a preview executable.

Every unknown step requires reconciliation before retry. Expiry, delivery,
preview generation and incomplete evidence never release a reservation or issue
offline credit. Durable storage, exact signed authorization, independent result
verification and backed return remain separate integration requirements.

## Verification

[Tests](../integrations/route-planner.test.mjs) cover NEAR/EVM return, same-chain
Aave positions, Hyperliquid place/modify/cancel/reduce/close objectives, asset and
network substitution, stale reads, snapshot mutation and authority confusion.
[Verification results](../integrations/route-planner-verification.json) record
15 tests and 11 detected guard alterations. No live market read or financial
operation was part of this run.

The first decimals test changed a shared fixture object in two places at once;
replacing one reference reproduced the intended conflict. The mutation runner
initially supplied a file URL to Node's CLI; converting it to a filesystem path
made the baseline and guard checks run. Both failures preceded the final pass.

The [market discovery slice](market-discovery.md) now connects public Uniswap,
Aave and Hyperliquid reads, a Markets screen and candidate matching through
`--file objective.json --markets observations.json`. Every preview remains
non-executable. [Public estimates](market-quotes.md) and [encrypted route drafts](route-drafts.md)
now cover bounded same-chain swaps/orders. Full action bounds, durable execution steps,
executor/recovery integration and positions remain open alongside
staking/restaking, farming, claims, liquidity and further strategies.
