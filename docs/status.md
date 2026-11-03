## Current product boundary — November 4

The [offline source-budget candidate](offline-budgets.md) now has local contract
enforcement, offline browser signing, encrypted handoff and owner recovery work.
It is not a connected funding feature or private settlement route. The build
priority is the complete existing-wallet journey; Networks is in wallet settings.

Lenz remains a prototype. Encrypted chat, bounded testnet offline payments and
public market reads are implemented. [Browser wallet connection](wallet-connection.md)
now supplies explicit Ethereum/Arbitrum/Base account access, native balance
reads and chain-specific Receive QR addresses. [Wallet transfers](wallet-transfers.md)
add ETH and reviewed USDC/WETH sends with explicit wallet approval and encrypted
attempt tracking. [Network controls](wallet-networks.md) add explicit switching
and saved custom EVM networks for native balances and Receive; they do not enable
additional transfer assets or protocols. Evidence covers an isolated local EVM and injected-provider
browser tests. Recoverable onboarding, installed-wallet/live-network sending,
complete mainnet DeFi execution and recovery are not verified. A Lenz ID is a public-key contact identifier, not a chain deposit
address. The [wallet token list](wallet-tokens.md) watches assets; it grants no
spending authority. [Privacy integrations](privacy-workflows.md) retain separate
transport and settlement guarantees. UI work does not close these gaps.

# Development status

Lenz combines private conversations, offline onward payments and DeFi actions approved offline for connected execution. Privacy, offline authorization and recoverable outcomes apply to every integration. The current implementation uses disposable test assets. It is not ready for real funds.

The [cross-chain aggregator scope](crosschain-defi.md) includes EVM liquidity such
as Uniswap, credit positions such as Aave, Hyperliquid perpetuals/margin, liquidity
management, staking, farming and further strategies. Rhea is one adapter. Public
discovery and estimates do not establish full protocol integrations or private
execution on public venues.

| Component | Recorded implementation and evidence | Remaining work |
| --- | --- | --- |
| Chainlink prices | [18 live reference feeds across Ethereum, Arbitrum, Base and HyperEVM](oracle-prices.md), automatic updates, source ages and separate offline snapshots. | Broader asset/network coverage, independent proof verification, connected-carrier price delivery and execution. |
| Market workspaces | [Asset exchange, credit limits, liquidity positions and Hyperliquid price/depth/order rail](trading-workspace.md). Inline review limits, position states and phone Chart/Book/Order tabs. Explicit public consent, snapshot expiry and actual provider/browser evidence. | User visual review, account/position reads, full margin/fee checks and execution. No preliminary NEAR bridge is required by the architecture. |
| Route drafts | [Checked-estimate review and encrypted offline Drafts page](route-drafts.md). Atomic quoted saves, separate public consent, exact order terms, revision-checked refresh/delete and expiry. Binding/service and product guard-removal checks pass. | Full fee/account/action validation, cross-chain legs, private quotes, execution journals and recovery. No execution authority. |
| Market discovery | [Public reads and Markets screen](market-discovery.md): Uniswap/Aave on Ethereum, Arbitrum and Base, Hyperliquid perpetuals, optional offline snapshots and route matching. Provider-bound fixture and live browser evidence. | Additional asset/pool coverage, positions, private routing and execution. |
| Public estimates | [Uniswap quotes and Hyperliquid book estimates](market-quotes.md), exact amounts, explicit public consent, expiry and stale-response rejection. 19 tests/19 guard changes, seven fixture/four live browser groups. | Additional route/asset binding, complete fees, accounts/positions, private quotes, bounded signing and execution. |
| Shared route planning | [Provider catalogue and route objectives](route-planner.md) with exact asset/chain references, fee/privacy/recipient bounds, HyperCore-specific orders and explicit return/recovery steps. Fifteen synthetic tests and 11 guard alterations pass. Every preview remains unverified and non-executable. | Broader asset discovery, concrete quotes, action-specific authorization, durable route journals, connected execution and positions. |
| Chat and wallet | Shared identity and encrypted storage; offline tUSD payments within chat or the standalone wallet; onward transfer and later NEAR confirmation. Encrypted file acknowledgements remain separate from settlement. Conflicted outgoing payment cards remove their download action. [Funded flow](../research/offline-social-live.md), [confirmation checks](../research/payment-status.md), [delivery receipts](delivery-receipts.md). | Safe recovery, broader failure coverage, transport between physical devices and broader browser coverage. |
| Carrier network | Opt-in automatic delivery of encrypted messages, payment files and recipient receipts; persistent independent carrier stores, multi-hop forwarding, reconnect and bounded retries. [Setup](../carrier/README.md), [verification](../carrier/verification.md). Three-node loopback and disposable Edge evidence; no financial submission. | Independently operated remote hosts, deployed HTTPS, ingress abuse controls, metadata reduction, native offline discovery and physical-device testing. Browser work requires an open page. |
| Internet delivery | Existing contact keys, standard NIP-59 encryption, durable retries and signed recipient receipts. Offline messaging/onward payments pass with disposable browser profiles; two public relays accepted and returned test ciphertext. [Protocol and evidence](internet-delivery.md). | Retention and operator reliability, native device transport, safe recovery and broader browser coverage. Public relays retain visible traffic metadata and may retain ciphertext indefinitely. |
| Nearby transfer | Signed QR pairing, direct WebRTC host channels, recipient-specific delivery indicators, encrypted message/payment delivery and onward transfer with HTTP unavailable. [Setup and evidence](nearby-delivery.md). | Physical-phone and hotspot testing, local-network isolation, native discovery and routed mesh. Requires a saved secure-origin app and reachable peers. |
| DeFi workspace and executor | [DEX workspace](defi-workspace.md) with private execution required by default, explicit public-testnet choice, frozen executor/terms review and unchecked disclosure consent. [Wallet approval service](../carrier/defi-wallet.md) atomically saves reservations and encrypted handoffs across browser tabs, with explicit file/carrier delivery and storage-only receipts. Developer [dispatch](../carrier/defi-executor.md) and independent [result checks](../carrier/defi-results.md) remain separate. | Nearby executor handoff, automatic execution from wallet delivery, verified result/credit integration, live executor tests and independent operators. Supply, borrow, liquidity and general withdrawal views are present but their operations and private-settlement adapters are unconnected. |
| NEAR reserve | Testnet funding, signed settlement, conflict rejection and backed deposits. [Contract documentation](../contracts/README.md). | Private settlement, safe restoration and external signing. |
| Rhea | Signed swaps, exact refunds and backed offline re-entry; bounded recovery for a missing redemption callback. [Adapter evidence](../contracts/adapter/README.md). | Other callback failures, aggregate liability review and independent release/key controls. |
| NEAR Intents | Empty-authentication helper and isolated 1Click SDK for local quote-signature validation. [Integration checks](../integrations/README.md). | Configured partner API access, a supported funded route, live quote binding, execution and refund handling. Testnet tUSD is not a mainnet route. |
| Aurora | Local EVM execution and proof-verifier checks; bounded network reads and Engine call/result codecs. [Transaction checks](../aurora/engine-transactions.md) bind expected calls to final receipts and separate EVM success from NEAR/side-receipt failures in fixtures. A [developer submission journal](../aurora/engine-submissions.md) validates and persists signed calls before sending, with restart recovery and explicit same-transaction retry verified locally. A [key-permission preflight](../aurora/engine-access.md) checks the exact signing key, restricted receiver/method and nonce before dispatch. [Direct ERC-20 receipt checks](../aurora/engine-transfers.md) bind exact transfer terms to return/event evidence; local EVM tests retain the counterexample of a token emitting a matching event without changing balances. A read-only final-block check confirms the chain ID and reports no mapping for the configured tUSD token. [Engine evidence](../aurora/engine-interface.md), [dependency checks](../aurora/dependency-resolution.md). | Lenz deployment, user-approval/account binding and a funded asset/execution adapter between NEAR and Aurora, with approved token/code trust, full payment-outcome verification, liability handling and live integration of submission recovery. |
| Naming | ENS Aurora records and native NEAR account lookup at final blocks; light/dark developer screen with opt-in saved offline reference and changed-address warnings. [Verification](../aurora/names.md). | Proof of naming-account control bound to Lenz keys, contact integration, revocation/rechecking and off-chain ENS resolution. No portable login or payment authorization. |
| Zcash | Confirmed native shielded test transfer and local PCZT proving/signing; browser review, native output/change verification and separate expiry checks for unsigned payments. [Native transfer](../zcash/pczt.md), [output checks](../zcash/payment-effects.md). | Product signing approval, current input/witness and complete note-encryption checks, restore/rescan, ambiguous submission recovery and a supported shielded ZEC/DeFi route. |
| Private settlement | Executable relations, counterexamples and a local PLONK step proof. [Proof component](../research/crypto-step/README.md). | Full private ownership/settlement relation and graph-hiding witness delivery. A step proof does not establish these guarantees. |

NEAR, Rhea, NEAR Intents, Aurora, Zcash, private settlement and recovery remain active work. Completing one component does not complete the others.

## Prerequisites

- Configure partner credentials only in the server environment. Never place them in browser assets or Git.
- Live checks require explicitly configured disposable test accounts, test funding and pinned native tooling. Installation or a passing fixture does not prove live execution.
- Windows Edge is the recorded browser environment. Native Android and iPhone remain roadmap work; no iPhone/Xcode build or physical-phone interoperability result is established.
- Account backup, restoration and new-device migration must preserve keys, contacts, messages and outstanding liabilities. Restoring an old snapshot must not make already-spent value spendable again.
- Independent review of release authority, signing keys and component security is still required before real funds.

See [behavior and safety boundaries](behavior.md), [security policy](../SECURITY.md) and [evidence conventions](evidence.md).

The [November 2 security review](../research/security/review-2026-11-02.md) records
checked local executor/relay fixes, unresolved dependency advisories and the
intermittent proof timeout. Solidity coverage, independent release controls,
restoration and physical-device validation remain incomplete. No real-fund
readiness follows from the passing component tests.
