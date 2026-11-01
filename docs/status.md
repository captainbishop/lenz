# Development status

Lenz combines private conversations, offline onward payments and connected DeFi execution. The current implementation uses disposable test assets. It is not ready for real funds.

| Component | Recorded implementation and evidence | Remaining work |
| --- | --- | --- |
| Chat and wallet | Shared identity and encrypted storage; offline tUSD payments within chat or the standalone wallet; onward transfer and later NEAR confirmation. Live testnet checks cover interrupted confirmation recovery and conflicting onward payments. Conflicted outgoing wallet files are labelled and cannot be downloaded again there. [Funded flow](../research/offline-social-live.md), [confirmation checks](../research/payment-status.md). | Safe recovery, broader failure coverage, transport between physical devices, broader browser coverage and delivery automation. |
| NEAR reserve | Testnet funding, signed settlement, conflict rejection and backed deposits. [Contract documentation](../contracts/README.md). | Private settlement, safe restoration and external signing. |
| Rhea | Signed swaps, exact refunds and backed offline re-entry; bounded recovery for a missing redemption callback. [Adapter evidence](../contracts/adapter/README.md). | Other callback failures, aggregate liability review and independent release/key controls. |
| NEAR Intents | Installed SDK, authenticated empty payload and local quote-signature validation. [Integration checks](../integrations/README.md). | Configured partner API access, a supported funded route, live quote binding, execution and refund handling. Testnet tUSD is not a mainnet route. |
| Aurora | Local EVM execution and proof-verifier checks. [Aurora evidence](../aurora/README.md). | Lenz deployment and a defined asset/execution adapter between NEAR and Aurora; dependency findings remain open. |
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
