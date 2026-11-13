# NEAR Intents testnet route

This package uses the original [NEAR Intents verifier](https://github.com/near/intents/tree/16d04f6ec4401263f8914638710260da50bb46b0) and owner-issued NEP-141 test assets. A user and funded solver sign opposite token changes. The verifier executes them atomically; the runner checks final token balances, consumed nonces and an external withdrawal.

This NEAR route is public on-chain. It supplies no Zcash shielded settlement, Tornado withdrawal or EVM bridge guarantee. It does not call 1Click or depend on partner credentials.

The compiler, source revision and exact Wasm hashes are recorded in [source-lock.json](source-lock.json). Build the two upstream packages with Rust 1.99.1, the recorded flags, `--locked --features contract --target wasm32-unknown-unknown --release`, selecting `defuse` and `defuse-poa-token` separately. Store the upstream checkout and generated artifacts outside the application source tree. The runtime pins refer to this recorded local build; a different compiler build requires its own review.

Run `node --test integrations/intent-testnet/swap.test.mjs` from the repository root for NEP-413 signing and exact review checks. The suite includes an independent upstream signature vector and changed source, output, amount, beneficiary key, verifier, nonce, deadline and extra-action rejection. These tests do not establish a live testnet result.

Use `faucet.mjs --run --state-dir <private-directory>` to create one fresh disposable faucet account. The request and key are saved before the single helper request. If the response is lost, `--status` only reads the original account and signing-key state. Keep the key, signed transaction bytes and journals outside Git.

`fund.mjs` transfers exactly eight testNEAR between two of those fresh accounts. Supply `--source-dir`, `--target-dir` and a separate private `--state-dir`. `--plan` reads their final balances, `--run` journals and submits one exact transfer, and `--status` reconciles its retained hash. The source keeps at least one testNEAR for gas. The original application deployer is not used for these top-ups.

The rehearsal requires explicit `--wasm`, `--token-wasm`, `--deployer-key`, `--state-dir` and `--prefix` arguments. `--plan` reads the parent balance and checks the proposed child names. `--run` requires 24 available testNEAR for new deployment. It creates fresh children, initializes the zero-fee verifier with no administrative grants, checks the deployed code, and removes the contract access keys. The issuer can mint the two clearly named test assets; neither asset represents redeemable dollars.

The runner saves and syncs each exact signed transaction and its hash before broadcast. A lost response leaves the original operation unresolved and prevents another automatic attempt. Preserve its `run.lock`, `state.json` and signed artifact, then reconcile the original sender/hash. Successful completion writes `verified-public-report.json` only after the final balance, nonce, invalid-signature, replay and withdrawal checks pass. Publish that report only after checking its actual recorded scope.
