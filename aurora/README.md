# Aurora integration and development setup

The mounted Wallet uses owner-signed proof-funded Aurora Swap and durable funding/execution services. A November 14 test finalized the original funded note to 2 LTT through the deployed factory and fixed-rate test adapter, with exact final receipts and beneficiary credit. See [recorded execution](../docs/evidence/aurora-wallet-swap-20261114.json), [mounted source path](../docs/evidence/SOURCE-MAP.md) and [current addresses/privacy limits](../docs/testnet-integrations.md). Broader venues, private settlement and live interrupted-submission recovery remain unverified.

## Local tooling and earlier experiments

The [offline ETH budget rehearsal](../docs/offline-budgets.md) uses this toolchain
for source-asset authorization, isolated venue callers and owner recovery. Its
contract is restricted to chain 31337; it is neither an Aurora deployment nor a
connected Intents/private-settlement adapter. Run
`node aurora/verify-offline-budget.mjs` from the repository root with the
existing Playwright runtime on `NODE_PATH`.

This folder also supplies local EVM development tools, [Engine call/result codecs](engine-interface.md) and [transaction confirmation checks](engine-transactions.md) for Aurora testnet. A [durable submission journal](engine-submissions.md) validates and stores already signed calls, then recovers interrupted sends by hash. [Current access-key permissions](engine-access.md) gate each broadcast. A [direct ERC-20 receipt checker](engine-transfers.md) compares the reported token transfer with independently supplied payment terms. The November 1 EthereumJS tooling checks were local/read-only experiments; the later mounted Wallet route has separate execution evidence above.

The [name lookup](names.md) resolves ENS Aurora records and native NEAR accounts,
with final-block observations and a browser page for saved offline reference.
Name ownership is not yet linked to Lenz contacts.

## Installed tools

| Package | Version |
| --- | --- |
| EthereumJS VM, common, tx and util | 10.1.3 |
| ethers | 6.17.0 |
| solc | 0.8.38 |

`package-lock.json` pins transitive dependencies. A scoped override uses `tmp` 0.2.7 for solc to address [GHSA-7c78-jf6q-g5cm](https://github.com/advisories/GHSA-7c78-jf6q-g5cm). Compilation uses the installed solc JavaScript API, with no compiler download. Both compiler and local VM use Paris rules, optimizer enabled with 200 runs. This is a fixture setting, not proof of compatibility with every Aurora opcode or precompile.

## Reproduce

From this directory in PowerShell:

```powershell
npm ci --ignore-scripts --cache .npm-cache --no-fund
npm audit
npm test
npm run compile
npm run check:local
npm run check:proof
node local-evm-mutations.mjs
npm run check:testnet
npm run check:engine
```

`compile` builds both Solidity files into ignored `artifacts/`. It always compiles from source. `check:local` independently compiles `ToolchainProbe`, deploys it in memory, checks exact runtime bytecode, writes 42 and checks storage and the receipt event. [local-results.json](local-results.json) records four checks and the lockfile hash. The VM has chain ID 31337 and a fresh in-memory fixture account; no RPC transport or user wallet is attached. Static reads roll back temporary state, and transaction balance, gas and failure checks remain enabled.

`check:testnet` reads `eth_chainId` and `eth_blockNumber` from the [documented Aurora endpoint](https://doc.aurora.dev/dev-reference/network-endpoints/), checks chain ID 1313161555 and writes [testnet-rpc-results.json](testnet-rpc-results.json). Replies are limited to 16 KiB and a 20-second deadline, including body streaming; redirects, mismatched response IDs and malformed quantities are rejected. It cannot sign or send transactions. Configured HTTP accounts are empty. [Reader tests and limits](rpc-validation.md).

The current local compiler, VM and proof checks pass inside the Windows sandbox. Earlier Hardhat CLI startup failed in tsx's `os.userInfo()` call (`uv_os_get_passwd`, ENOMEM) and passed outside the sandbox without code changes. Sandboxed external RPC requests returned EACCES; authorized read-only reruns passed. Those recorded host restrictions are separate from contract assertions.

## Dependency status

The November 1 [npm audit](dependency-audit.json) reports **zero known vulnerabilities** across 44 dependencies and exits zero. Hardhat, its ethers plugin and Zod are absent from the lockfile and clean installation. The [dependency resolution](dependency-resolution.md) records the migration and its checks. This closes the Aurora tooling's Zod finding; it does not certify the blockchain or every Lenz dependency.

Lifecycle scripts remain disabled in `.npmrc`. The current lockfile contains no installation hooks. Tests check pinning, registry integrity metadata, installed versions and absence of nested Zod packages. Dependency packages stay outside the repository and are not imported by the web wallet.

The earlier [Engine interface](engine-interface.md) report has bounded call/result serialization and a read-only mapping check. Its configured tUSD token had no Aurora mapping at that checked block. The current proof-funded Wallet route uses its separately pinned LTS/LTT assets and deployed adapter; this does not establish general tUSD or NEAR↔Aurora routing.

## Payment-proof verifier experiment

`npm run check:proof` compiles the generated `PaymentStepVerifier.sol` with the pinned solc library and deploys it to the in-memory EthereumJS VM. It uses local packages and makes no external request. The existing test proof is reused; no new proving parameters are created.

Run `npm test` and `npm run check:proof` before publishing a verifier-related change.
The default test command covers the JavaScript suites and does not invoke this
separate proof script. Passing either command does not establish measured Solidity
line/branch coverage. The [November 2 review](../research/security/review-2026-11-02.md)
records this coverage gap and the component's remaining cryptographic limits.

The existing test PLONK proof passed, all seven individually changed public inputs failed, and an altered proof failed. A local transaction used **302,476 EVM gas**, with **996 bytes** of calldata and **7,118 bytes** of deployed verifier bytecode. [proof-results.json](proof-results.json) records source/circuit hashes and scope. This is not NEAR gas or an Aurora testnet result.

The verifier was generated by snarkjs 0.7.6 from the existing test-only proving key:

```powershell
node research/crypto-step/node_modules/snarkjs/cli.js zkey export solidityverifier research/crypto-step/build/step.zkey aurora/contracts/PaymentStepVerifier.sol
```

It fixes its verification key in the contract. The GPL-3.0 notice from the generated source is preserved. The circuit remains the smaller ownership/nullifier/conservation step with a visible commitment graph and test-only setup. A private settlement wrapper, reserve linkage, native NEAR verification and production parameters remain required.
