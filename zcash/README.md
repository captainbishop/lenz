# Zcash integration in progress

The developer browser supports local wallet reads, synchronization, [unsigned payment review](payment-review.md), [output and change verification](payment-effects.md), and [expiry/network checks](payment-freshness.md). It prepares a native test transaction, verifies its recipient, amount, fee and owned change locally, and preserves the unsigned request across reloads. Signing, broadcast and recovery from this page remain incomplete. The recorded payment passed output verification but was expired.

A native shielded testnet payment is confirmed in the [October 31 PCZT evidence](pczt.md): wallet A paid B 0.1 test ZEC in a version-6 Ironwood transaction with a 0.0001-test-ZEC fee. At the recorded tip, both wallets reported fourteen confirmations and spendable balances of A 0.8999 / B 0.1 test ZEC. Five actual browser checks displayed those balances. The original tool omitted Ironwood signing; a separately hashed bounded signer uses the pinned library support. Browser routes never sign or send.

The [funding/read/sync report](companion.md) records the preceding observation of 1 spendable test ZEC in wallet A. Its funding source is unknown. That report's zero balance for wallet B predates the confirmed payment; faucet failures remain part of the record.

The official `zcash-devtool` wallet built successfully on Windows with Rust 1.99.1 on 2026-10-26. [source-lock.json](source-lock.json) pins the source revision, its librustzcash revision, Cargo.lock and local executable hashes. The source is under ignored `tooling/zcash-devtool/`. This upstream developer tool uses prerelease wallet libraries and is for disposable tests; it is not the production Lenz wallet.

`wallet.mjs` is a narrow local test bridge. It checks the binary/dependency hashes, restricts wallets to two project-local disposable directories, and exposes initialization, chain info, synchronization, receive addresses, balance and transaction IDs/mined heights. It cannot invoke seed export or send funds. The companion routes permit read/sync operations. Separate browser review routes prepare and inspect an unsigned payment, without signing or sending. Existing browser identities are untouched. Wallet state and its age decryption key stay under ignored `.testnet/` and must not be published.

## Run locally

From the project root:

```powershell
node zcash/wallet.mjs check
```

The executable and dependency hash checks passed; see [check-a-results.json](check-a-results.json). `wallet init`, `wallet sync`, `wallet get-info` and PCZT help commands also ran from the built executable.

Historical setup commands are shown below. Both wallets already exist; do not repeat initialization or funding. Use the read-only status commands or explicit synchronization when needed:

```powershell
node zcash/wallet.mjs info a
node zcash/wallet.mjs sync a
node zcash/wallet.mjs address a
node zcash/wallet.mjs balance a
```

Initialization explicitly selects Zcash **testnet** through `testnet.zec.rocks`. Disposable wallets `a` and `b` both initialized and synchronized. Their receive addresses and zero balances are recorded in the corresponding `*-results.json` files. The server reported `chain_name: test`. An unsynchronized wallet initially could not produce a balance summary; synchronization resolved it.

The October 26 funding checks reported failure: Fauzec returned HTTP 503 `runtime_unavailable`, and Valar said its wallet could not pay either the Orchard-only or Sapling address. Both Valar statuses were failed with no transaction ID, and the wallet reads then showed zero. [Fauzec evidence](faucet-a-results.json), [Valar Orchard evidence](valar-faucet-a-results.json) and [Valar Sapling evidence](valar-sapling-a-results.json) preserve those outcomes. October 31's synchronization supersedes the zero-balance observation without establishing which source funded A. No claim was resubmitted; the later outgoing shielded transfer is documented above.

Current [Ironwood documentation](https://zcash.github.io/ironwood/concepts.html) distinguishes the Orchard protocol from the Orchard and Ironwood pools. After NU6.3, new value cannot enter the Orchard pool. The pinned library supports Ironwood; its [wallet tests](https://zcash.github.io/librustzcash/rustdoc/latest/zcash_client_backend/data_api/testing/pool/index.html) describe delivering an Orchard receiver through a version-6 Ironwood bundle. Do not infer which pool a payment used from its address alone. The faucet's generic address error does not prove a specific consensus cause.

Next: reviewed browser transaction approval and signing, expiry/ambiguous-submission handling, wallet rescan/recovery and a supported ZEC↔DeFi route. Measure target-device performance before claiming phone support. The completed native transfer and browser read/sync checks do not finish these requirements.

## Privacy boundary

Native shielded Zcash and private Lenz settlement on NEAR are separate active work. The [wallet source](https://github.com/zcash/zcash-devtool) provides native transaction and PCZT machinery. The [behavior and safety boundaries](../docs/behavior.md) must independently hide the payment graph and bind reserve accounting on NEAR. Its local EVM verifier experiment does not turn the public tUSD reserve into a shielded pool. [Intents' documented transparent Zcash boundary](https://docs.near-intents.org/resources/chain-support) also needs explicit handling before a shielded DeFi route can be claimed.
