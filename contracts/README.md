# Lenz tUSD and NEAR reserve

This is a testnet-only settlement implementation, with a NEP-141 token named **Lenz Test Dollar (tUSD)**. It is not a dollar-backed stablecoin. The web app starts at zero. Older synthetic balances remain preserved in their separate encrypted vault; the current app does not expose demo funding or trading.

## Current verification boundary

Fifteen native Rust contract tests passed on 2026-10-26, including actual Edge funding/transfer/deposit signatures, reserve conservation, onward settlement, redemption, replay, conflicting spends and backed deposits. The SDK's `storage_withdraw` parameter was corrected to `Option<NearToken>`; storage refunds explicitly detach their promise. See `test-results.json` and `test-output.txt` for fresh evidence.

The [backed-deposit upgrade](upgrade/README.md) is now deployed to the same reserve after a separate testnet rehearsal. All 74 existing state entries were preserved. `deposit_offline` moves an account's existing tUSD into a fresh offline note without minting more tokens. Four live Edge checks cover refund return, lost-response recovery, offline onward signing and actual settlement. External NEAR account signing remains to be connected.

The locked Wasm release build passed after online work resumed. The 359,136-byte artifact deployed to `tusd.lenz-dev-1792984696547.testnet`; [deployment.json](deployment.json) records its SHA-256 and final receipt. The deployer initially supplied too little storage stake; topping the same disposable contract account up to 5 test NEAR resolved the failure without replacing deployed code. The deployment script enabled `web/public/near-config.json` after verifying metadata. Do not change `ready` by hand.

All seven [live contract checks](testnet-results.json) passed: funding, offline A → B → C signatures, settlement, replay, competing spend, atomic rollback and NEP-141 redemption. Nine [live Edge checks](../web/near-wallet-live-results.json) also passed, including real funding, offline reload/onward handover, lost-response settlement retry and final-state refresh. These used disposable identities. No physical phones or real funds were involved.

The first live flow exposed an SDK mismatch: `Account.callFunction` returns decoded contract output in near-api-js 7.4.0. `callFunctionRaw` supplies the complete receipt needed for finality checks. A new regression test failed on the old call and passed on the corrected one.

## Why NEAR is part of the mechanism

NEAR runs the reserve contract. `fund_test` mints a capped test grant into its token balance and creates a note bound to the user's P-256 key. `settle` checks the browser's signed ownership transitions, conserves the reserve and allows each input to be consumed once. A carrier pays testnet gas and submits the path; the carrier cannot change its recipient or amount. No local validator group is required.

`redeem` consumes a settled note and credits a registered NEAR account's NEP-141 balance in the same contract execution. Standard token transfers and transfer calls use `near-contract-standards`. Their asynchronous receipt semantics still apply; reserve redemption itself has no cross-contract callback.

Ethereum's programmable-contract model remains the design inspiration. This contract is executable NEAR code with fixed transfer and redemption rules. It is not an EVM, a general offline interpreter, a deployed Ethereum integration, a DEX or a solver connection. The separate [Rhea adapter](adapter/README.md) now implements signed, bounded swap instructions with testnet execution and recovery evidence.

## Protocol

All tUSD amounts use integer base units, with six decimals. Keys are compressed SEC1 P-256 points. Signatures are WebCrypto's 64-byte `r || s`, over SHA-256 of UTF-8 JSON arrays. The exact array order is part of the protocol:

```text
fund:    ["lenz/near-fund/v1", "testnet", contract, owner, amount, nonce]
spend:   ["lenz/near-transfer/v1", "testnet", contract, input, recipient, amount, nonce]
redeem:  ["lenz/near-redeem/v1", "testnet", contract, input, NEAR recipient, nonce]
```

A root ID is `root:` followed by the funding array's SHA-256 hex digest. A spend ID is its signed array's digest; output suffixes `:0` and `:1` identify the recipient and change. IDs exclude signature bytes, so ECDSA malleability cannot mint a second output or bypass input consumption. Each spend consumes one note and has one or two outputs. Paths contain at most 16 transitions. New recipient keys control the received outputs.

The browser validates signatures and ancestry offline, encrypts the packet for the recipient and commits its changed vault and outgoing file together under a Web Lock. Imported funding records are claims until checked against final NEAR state. A receipt shown by the prototype is authenticated through its configured RPC, not by a browser light client. A conflicting settled ancestor excludes all affected descendants from the locally available amount.

## Security boundaries

- A copied wallet can authorize competing offline paths. NEAR selects at most one; it does not guarantee payment to every disconnected recipient. The UI retains pending, settled and conflicting states.
- This first contract publishes amounts, keys and ancestry at settlement. Chat and handover packets use encryption; the NEAR path is not a shielded pool or a Zcash integration.
- Recovery and safe restoration of outstanding authorizations remain prerequisites for real funds. The test flow uses fresh disposable identities and does not access existing browser identities.
- The local relay sponsors only the configured test contract's grant and settlement methods. It has no browser spending key. Its testnet key lives outside the public server root, in ignored `contracts/.testnet/` files.
- Test grants are not Sybil resistant and do not claim scarcity. The per-key grant cap limits one test request; a new key can claim again. The relay is a local developer service, not an internet-facing faucet.
- Storage growth is charged to the caller and excess deposit is refunded. Full-access deployment keys can upgrade the test contract; it is not an immutable production deployment or an audited reserve.

## Pinned interfaces

- `near-sdk = 5.29.1`, `near-contract-standards = 5.29.1`; Cargo.lock pins transitive packages.
- `near-api-js = 7.4.0`; package-lock.json pins transitive packages.
- Rust 1.99.1, Windows MSVC, `wasm32-unknown-unknown`.
- [SDK `p256_verify`](https://docs.rs/near-sdk/5.29.1/near_sdk/env/fn.p256_verify.html): signature `[u8; 64]`, prehash `[u8; 32]`, public key `[u8; 33]`.
- [NEP-635](https://github.com/near/NEPs/blob/master/neps/nep-0635.md) is still marked Draft in its document. A live testnet protocol-config read reported version 88 and `p256_verify_base = 1300000000000`. This is capability evidence, not a measured contract execution.
- SDK 5.29.1 distinguishes `cfg(near)` host imports from ordinary Wasm fallbacks. The build below sets `--cfg near` explicitly.

## Reproduce

From the project root in PowerShell, with the project-local toolchain:

```powershell
$env:RUSTUP_HOME = Join-Path (Get-Location) 'tooling/.rustup'
$env:CARGO_HOME = Join-Path (Get-Location) 'tooling/.cargo'
$env:PATH = (Join-Path (Get-Location) 'tooling/.cargo/bin') + ';' + $env:PATH
$env:CARGO_HTTP_MULTIPLEXING = 'false'
$env:AWS_LC_SYS_PREBUILT_NASM = '1'
cargo test --manifest-path contracts/Cargo.toml --lib --locked
$env:RUSTFLAGS = '--cfg near -C target-feature=-bulk-memory,-reference-types,-multivalue'
cargo build --manifest-path contracts/Cargo.toml --target wasm32-unknown-unknown --release --locked
Remove-Item Env:RUSTFLAGS
```

`AWS_LC_SYS_PREBUILT_NASM=1` selects aws-lc-sys's documented bundled assembly objects from its locked crate on Windows when NASM is unavailable. It was needed for the native test build. A convenience wrapper records exit status, source/lock hashes and output:

```powershell
.\tooling\build-near.ps1 -Action test -Offline
.\tooling\build-near.ps1 -Action wasm
```

Use `-Offline` only after the required dependencies have been cached locally. That flag controls dependency downloads, not the app's offline payment capability. The wrapper's local result does not establish deployment or chain execution.

Only after the contract checks pass, `node contracts/deploy.mjs` creates isolated faucet-funded testnet accounts, deploys the contract, checks token metadata and writes the public configuration. It refuses to replace an existing deployed contract automatically. No mainnet endpoint or user wallet is accepted. It needs external network access.

`node contracts/testnet-flow.mjs` then produces `contracts/testnet-results.json` with transaction hashes, actual gas and checks for funding, A → B → C, replay, conflicting spend, atomic rollback and NEP-141 redemption. The file does not exist until those checks succeed. The browser handover phase is tested separately with three offline Edge contexts.

Browser checks:

```powershell
node --test web/near-protocol.test.mjs
# Set NODE_PATH to your local test-tools node_modules directory.
node web/near-wallet-browser.test.cjs
```

The browser integration suite explicitly uses a local funding RPC fixture. It is not on-chain evidence. `fixtures/browser-transfer.json` contains public signatures for the Rust interoperability test; no private keys are exported.

To run that suite against the deployed test contract and running local Lenz server:

```powershell
$env:LENZ_LIVE_TESTNET = '1'
node web/near-wallet-browser.test.cjs
Remove-Item Env:LENZ_LIVE_TESTNET
```

Live mode saves `web/near-wallet-live-results.json` separately from the fixture result. `node contracts/rhea-flow.mjs` exercises the disposable account's redeemed tUSD against the documented Rhea testnet exchange; its staged results are in `rhea-flow-results.json`. This direct-account experiment does not implement an offline swap authorization or private settlement.

The separate [signed Rhea adapter](adapter/README.md) now connects offline wallet authorization to real testnet execution, refunds and payout retries. It leaves this reserve deployment unchanged. Its evidence, scripts and remaining custody/recovery limits are recorded separately.
