# Development status

## Current implementation — November 17

The [current implementation table](implementation-status.md) is the entry point for supported behavior, source links, reproducible checks and unfinished work. It includes automatic signed message requests with Accept/Decline, bounded encrypted request recovery and the original Android BLE host. Direct message delivery was observed between Samsung and Xiaomi phones on November 17; the user reported about 20 seconds for the reverse retry check. Physical multi-hop, radio interruption, process-restart recovery and background delivery remain unverified. Browser/JVM transport tests are separate evidence.

The [recorded integration evidence](evidence/README.md) links actual NEAR Intents, Aurora, Aave and native Zcash outcomes to their mounted implementation and retains their privacy/recovery limits. November 17's NEAR payment and Rhea verification used hosted testnet APIs; the swap required operator recovery after its normal sponsor cap was reached. Android financial POST endpoints remain absent. The [architecture guide](architecture.md) maps implementation ownership and delivery/execution paths. The sections below describe earlier checkpoints.

## Current submission scope — November 14

The browser app integrates NEAR settlement and the original Intents verifier,
Aurora proof-funded Swap, Sepolia lending, native Zcash Send and encrypted
offline/chat continuity. Hyperliquid trading uses the shared Coming soon dialog.
Component tests are separate from final original-account Swap, native Send and
lending-exit acceptance. Ordinary native Wallet → Send has a separately confirmed
testnet transfer and retained canonical receipt evidence. Ordinary Wallet Swap
also finalized 1 LTS→2 LTT, with exact action/events, final NEAR/Aurora receipts and
encrypted archive restoration offline using the same key. A strict recorder
aborted a background market-assets read after financial success; that limit is
retained. The original lending repayment and free-fund exits are finalized; a
small indexed aLINK collateral balance remains. [Addresses, privacy and backend
setup](testnet-integrations.md).

Automatic caching and encrypted account/action recovery are mounted. Recovery
preserves original requests and liabilities; browser backups do not replace
native custody or prove canonical funds. Physical mesh, the never-online
first-use path and production recovery remain open. The static Vercel preview
has unavailable APIs. The [live prototype](https://lenz-prototype.vercel.app) serves
the website and API proxy on Vercel, connecting through a temporary Cloudflare
tunnel to this computer's authenticated gateway and local testnet signers.
Availability depends on those local services. Public pages, reserve reads and
access boundaries passed read-only checks; hosted financial execution and
physical-device acceptance remain separate from package/fixture checks.
[Hosting setup](testnet-integrations.md#hosting).

## Earlier product boundary — November 4

The [offline source-budget candidate](offline-budgets.md) now has local contract
enforcement, offline browser signing, encrypted handoff and owner recovery work.
It is not a connected funding feature or private settlement route. The build
priority is the complete existing-wallet journey; Networks is in wallet settings.

[Identity/chat recovery](identity-recovery.md) now has a separate module for new
phrase-derived identities and encrypted text-chat archives. Restore returns staged
data without changing an active account. Existing accounts, money and product
Create/Restore remain unconnected.

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
| DeFi workspace and executor | [DEX workspace](defi-workspace.md) with private execution required by default, explicit public-testnet choice, frozen executor/terms review and unchecked disclosure consent. [Wallet approval service](../carrier/defi-wallet.md) atomically saves reservations and encrypted handoffs across browser tabs, with explicit file/carrier delivery and storage-only receipts. Developer [dispatch](../carrier/defi-executor.md) and independent [result checks](../carrier/defi-results.md) remain separate. Mounted Sepolia Aave Supply/Borrow/Repay/Withdraw and transfer actions add bounded reviews, durable Activity and recovery. Original repayment, withdrawal and free-fund exits are finalized with residual indexed collateral. [Current testnet scope](testnet-integrations.md). | Nearby executor handoff, automatic execution from wallet delivery, general result/credit integration and independent operators remain open. Liquidity, other general protocol operations and production private-settlement adapters remain unconnected. |
| NEAR reserve | Testnet funding, signed settlement, conflict rejection and backed deposits. [Contract documentation](../contracts/README.md). | Private settlement, safe restoration and external signing. |
| Rhea | Signed swaps, exact refunds and backed offline re-entry; bounded recovery for a missing redemption callback. [Adapter evidence](../contracts/adapter/README.md). | Other callback failures, aggregate liability review and independent release/key controls. |
| NEAR Intents | Partner-authenticated confidential dry quotes with provider-signature checks; [EVM account authentication and private balance reads](confidential-account.md), including an explicit wallet sign-in, transient private balances and disposable same-key reauthentication. | Installed-wallet compatibility, persistent key recovery, supported funding/execution/refunds and independently verified settlement privacy. Confidentiality is not covered by the quote SDK signature. Testnet tUSD is not a mainnet route. |
| Aurora | Local EVM execution and proof-verifier checks; bounded network reads and Engine call/result codecs. [Transaction checks](../aurora/engine-transactions.md) bind expected calls to final receipts and separate EVM success from NEAR/side-receipt failures in fixtures. A [developer submission journal](../aurora/engine-submissions.md) validates and persists signed calls before sending, with restart recovery and explicit same-transaction retry verified locally. A [key-permission preflight](../aurora/engine-access.md) checks the exact signing key, restricted receiver/method and nonce before dispatch. [Direct ERC-20 receipt checks](../aurora/engine-transfers.md) bind exact transfer terms to return/event evidence; local EVM tests retain the counterexample of a token emitting a matching event without changing balances. The earlier read-only final-block check confirms the chain ID and reports no mapping for the configured tUSD token. [Engine evidence](../aurora/engine-interface.md), [dependency checks](../aurora/dependency-resolution.md). Ordinary Wallet Swap finalized the exact 1 LTS→2 LTT proof-funded route, with final NEAR/Aurora receipts, action/events and offline encrypted archive restoration using the same key. [Current deployment and privacy boundaries](testnet-integrations.md). | The recorder aborted a background market read after financial success. Live interrupted-submission recovery, broader asset routes, aggregate liability review, independent operators and production privacy remain open. Test-pool proofs have limited anonymity; recipient, amounts and later DeFi activity remain public. |
| Naming | ENS Aurora records and native NEAR account lookup at final blocks; light/dark developer screen with opt-in saved offline reference and changed-address warnings. [Verification](../aurora/names.md). | Proof of naming-account control bound to Lenz keys, contact integration, revocation/rechecking and off-chain ENS resolution. No portable login or payment authorization. |
| Zcash | Confirmed native shielded test transfer and ordinary Wallet → Send with local PCZT proving/signing, exact native output/change verification and retained canonical confirmation. Unsigned payments have separate expiry checks. [Native transfer](../zcash/pczt.md), [output checks](../zcash/payment-effects.md). | Restore/rescan, broader current-input and note-encryption review, ambiguous submission recovery and a supported shielded ZEC/DeFi route. Browser archives retain action references rather than native spending keys. |
| Private settlement | Executable relations, counterexamples and a local PLONK step proof. [Proof component](../research/crypto-step/README.md). | Full private ownership/settlement relation and graph-hiding witness delivery. A step proof does not establish these guarantees. |

NEAR, Rhea, NEAR Intents, Aurora, Zcash, private settlement and recovery remain active work. Completing one component does not complete the others.

## Prerequisites

- Configure partner credentials only in the server environment. Never place them in browser assets or Git.
- Live checks require explicitly configured disposable test accounts, test funding and pinned native tooling. Installation or a passing fixture does not prove live execution.
- Windows Edge is the recorded browser environment. The Android host now has a compiled, signed APK; iPhone remains unfinished. Compilation and browser/JVM simulations do not establish physical-phone delivery or iPhone interoperability.
- Account backup, restoration and new-device migration must preserve keys, contacts, messages and outstanding liabilities. Restoring an old snapshot must not make already-spent value spendable again.
- Independent review of release authority, signing keys and component security is still required before real funds.

See [behavior and safety boundaries](behavior.md), [security policy](../SECURITY.md) and [evidence conventions](evidence.md).

The [November 2 security review](../research/security/review-2026-11-02.md) records
checked local executor/relay fixes, unresolved dependency advisories and the
intermittent proof timeout. Solidity coverage, independent release controls,
restoration and physical-device validation remain incomplete. No real-fund
readiness follows from the passing component tests.
