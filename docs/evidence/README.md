# Recorded integration evidence

These summaries describe testnet transactions recorded on November 13–17, 2026, and the November 17 two-phone Bluetooth observations. They expose public transaction identifiers, exact methods, receipt or position binding, amounts, authentic observation dates and limitations. Original private records remain outside the repository.

| Journey | Recorded result | Fresh public check on November 17 | Limit |
| --- | --- | --- | --- |
| [NEAR payment and Rhea swap](near-payment-rhea-20261117.json) | 2-tUSD funding, 1-tUSD payment settlement and swap to 0.003786162812967755559353 wrapped NEAR | Independent RPC checks confirmed all eight transactions FINAL, exact original terms, payout receipt and recipient balance delta | Hosted sponsor hit its daily limit; three operator advances completed the same order. Protocol run, not Android UI or BLE money delivery |
| [NEAR Intents Wallet swap](near-intents-wallet-20261113.json) | 1 LTS to 2 LTT through the original NEP-413 verifier | Archival NEAR RPC returned FINAL with the same receiver, execute_intents method and six receipt IDs | Operator-funded test assets and solver; public settlement; 1Click execution remains unverified |
| [Aurora Wallet swap](aurora-wallet-swap-20261114.json) | Original funded note to 2 LTT with final receipts and exact beneficiary credit | Archival NEAR RPC returned FINAL with the same aurora receiver, call method and two receipt IDs | Funded fixed-rate test venue; limited pool anonymity; beneficiary and swap terms remain public |
| [Native Zcash Wallet Send](zcash-wallet-send-20261114.json) | 0.01 test ZEC, 0.0001 test ZEC fee, ten recorded confirmations and retained Activity | Original canonical wallet effects only; a fresh public confirmation was unavailable | Shielded amounts/recipient are verified through the wallets. Browser backup does not restore native spending keys |
| [Aave lending exits](aave-lending-exits-20261114.json) | Repay, collateral withdrawal and free-token exits with zero debt and free balances | Etherscan displayed matching hashes, Success status and blocks for all six actions | Residual indexed aLINK remained; the account was not empty |

[Implementation call paths](SOURCE-MAP.md) connect these journeys to the mounted UI, authority, adapters and result checks. Each JSON separates original-record hashes from current implementation hashes. Current hashes identify the inspected November 17 working files, which may contain later changes; they do not reconstruct the complete source used for an earlier transaction.

The NEAR summaries include Nearblocks links, but the automated request received HTTP 403. Sepolia's configured public RPC returned null for these historical receipts; Etherscan's transaction-specific status and block fields matched the retained records. HTTP availability alone is not a successful execution result.

Fixture suites simulate external RPC/native boundaries. They can test codecs, signatures, recovery and rejection behavior without proving a new live execution. Configuration readiness, Android builds and browser bridge tests likewise require separate transaction or physical-device evidence.

[Android Bluetooth observations](android-ble-20261117.json) record direct Samsung ↔ Xiaomi messages confirmed during the two-phone test. A → B appeared exactly once; the reverse retry check took about 20 seconds according to the user. This demonstrates the tested direct message path, with a remaining direction-dependent delay. Multi-hop, background delivery, radio interruptions and payment delivery were not established by that test.
