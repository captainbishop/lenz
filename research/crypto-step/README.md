# Real payment-step proof experiment

November 2 dependency status: [the latest cleanup](../security/dependency-cleanup-2026-11-02.md)
retains the ws/underscore patches and adds compatible filelist/minimatch updates.
Twenty-eight proof/provenance/dependency/worker tests pass; 15 low advisory
entries remain. Original setup metadata, seven proof artifact hashes and saved
browser assets match. The local TEST-ONLY setup remains unsuitable for funds.

2026-10-25. Local research for Proof of U. This implements a one-input/two-output PLONK proof and connects its verifier to the existing dependency witness assembler. It is a custom circuit, not Orchard or a Zcash transfer. The full private settlement statement remains unimplemented.

## Statement and ownership

The circuit uses BN254 scalar-field Poseidon with distinct labels:

| Object | Construction |
| --- | --- |
| Owner address | `P(101, context, spendingSecret)` |
| Note commitment | `P(102, context, asset, ownerAddress, value, randomness)` |
| Nullifier | `P(103, context, spendingSecret, inputCommitment)` |
| Transfer digest | `P(104, context, inputCommitment, nullifier, output0, output1, nonce)` |

The context is SHA-256 of a versioned domain tuple, reduced into the scalar field. The prototype domain is `proof-u/local-plonk-step/v1`; production network, pool and asset identifiers are not selected.

The seven public fields, in order, are context, input commitment, nullifier, two output commitments, nonce and transfer digest. Private inputs include the spending secret, asset, input value/randomness, and the two output owners, values and randomness values. The relation checks:

- The input commitment opens to the address derived from a nonzero spending secret.
- The nullifier derives from that secret and input commitment.
- The input value is nonzero; input and output values are unsigned 64-bit integers.
- Input value equals the sum of the two output values, and both output commitments use the same asset.
- Output commitments are distinct, and the transfer digest binds the public transfer components.

Zero-valued outputs permit padding/change on a full-value payment. A zero-valued input cannot be spent. Integer ranges make conservation an integer statement: two bounded outputs cannot wrap the much larger field modulus.

Recipients generate their own secrets. The sender uses the recipient's address to create its output, and must supply the recipient's note opening separately. A later proof and witness assembly require no earlier owner's spending secret. This experiment assumes completed, authenticated opening/key handover; it does not implement that wallet exchange.

Hash-preimage ownership and the keyed-Poseidon nullifier are research constructions requiring cryptographic review. Tests against an earlier sender's secret/address are examples of rejection, not a proof of pseudorandomness or unlinkability.

## Integration

`step.mjs` produces real `snarkjs` PLONK proofs and verifies them against a locally loaded verification key. Canonical field encodings reject reduction aliases. The edge retains the existing input/nullifier/digest/output interface. Its proof envelope also carries the nonce and scheme identifier.

`verifiedCapsuleVerifier` verifies every proof asynchronously, then returns a synchronous cache of exact verified edge fingerprints for `assembleWitness`. Entries enter the cache only after real verification. The assembler's existing fixture allowlist remains confined to the earlier fixture tests/demo.

The benchmark creates A -> B and B -> C, plus a fresh randomized proof of the same A -> B statement. It checks that proof randomness changes proof bytes while keeping the nullifier and transfer digest fixed. It encrypts/decrypts the two-step capsule, adds unrelated snapshot state, times out one mirror, obtains another complete snapshot and assembles witnesses using verified proofs. Mirrors and the checkpoint are local test fixtures; there are no network/device calls or transferred funds.

## Reproduce

From this directory with Node.js (measured on v24.21.0, Windows x64):

```powershell
npm ci --ignore-scripts --no-audit --no-fund
npm run build
npm test
npm run mutations
npm run benchmark
```

Dependencies are pinned in `package-lock.json`: `circom2` 0.2.23 (Circom 2.2.3), `circomlib` 2.0.5, `circomlibjs` 0.1.7 and `snarkjs` 0.7.6. The npm WASM compiler wrapper is described upstream as experimental. Its package README identifies upstream short revision `a100fae`; the build records the actual compiler WASM hash.

`build.mjs` uses power-14 universal parameters with one random local contribution. **These parameters are TEST ONLY, not an independently contributed production ceremony. Never use this setup for real funds.** Entropy and spending secrets are not saved. Generated build artifacts and dependencies are ignored by Git. New clean builds create different setup keys; saved sample proofs remain tied to their recorded sample verification key.

### Existing-artifact dependency refresh

The November 2 utility update pins `@ethersproject/providers`'s `ws` to 8.22.1
and `jsonpath`'s `underscore` to 1.13.8 through scoped npm overrides. The compiler,
circuit libraries and prover versions stay pinned above. See the
[compatibility review](../security/proof-dependency-refresh-2026-11-02.md) for
advisory results, verification and remaining limits.

For the existing test setup, `dependency-refresh.json` binds the original build
metadata and lock hashes to the reviewed current lock and installed package
contents. `artifact-provenance.mjs`, used by the browser build, checks this record
whenever the lock differs from the one that generated the setup. File records use
JSON-encoded relative names and SHA-256 content hashes, so embedded delimiters
cannot hide a changed file layout. Missing or extra package entries in the record,
changed sources and changed proof artifacts cause a build failure. `node provenance-verification.mjs` checks the
guards using disposable files, without generating new setup keys.

This record applies only to its exact local artifacts and dependency bytes. It
is not a signed release attestation or a malware scanner. A fresh `npm run build`
records its own lock and new test keys; it does not need the older compatibility
record. Do not regenerate an existing setup merely to clear a provenance failure.
Dependency changes need compatibility review and a new exact record before the
existing artifacts can be reused.

The compiler uses its supported runner API with only the current folder preopened. Compilation writes into a fresh staging directory before copying completed artifacts. On this Windows/WASI host, runs targeting an already existing circuit-output directory stalled while fresh-directory runs completed. The exact upstream cause has not been established. Earlier attribution to binary assembly/optimization alone was incomplete; an attempted WABT alternative was removed.

The selected `--O0` circuit has 8,892 R1CS constraints, 8,898 wires, seven public inputs and 11,964 PLONK gates in a 16,384-row domain. An earlier `--O2` experiment had fewer R1CS constraints (2,178) but expanded to 44,584 PLONK gates and exceeded the chosen parameters. R1CS count alone is not a PLONK cost estimate. No optimality claim is made for O0.

## Verification and measurements

`step.test.mjs` checks honest witnesses, ownership, input/output openings, assets, conservation, overflow, field-wrapping attacks, zero secrets/inputs, duplicate outputs, real proof tampering, domain changes, encoding aliases and A -> B -> C integration.

`mutations.mjs` removes ten individual source guards. It generates each adversarial witness from the modified circuit, asserts that its exact symbol-to-wire mapping matches the original, and checks that the same witness is accepted by the mutant R1CS and rejected by the original R1CS. This tests the constraints themselves rather than relying on witness-generator assertions. The saved results are in `mutation-results.json`; this is targeted evidence, not an exhaustive circuit audit.

`benchmark-results.json` records three individual observations, artifact hashes, serialized sizes and process peak resident memory. It is not a latency distribution or a phone measurement. `proof-example.json` contains a public sample proof and its test verification key for replay; an application must never trust a verification key supplied by an untrusted payment envelope.

Observed on 2026-10-25: all 10 proof tests passed, all 10 circuit guard-removal experiments produced the expected original-rejects/mutant-accepts result, and the existing 46 model/delivery tests and 14 model safeguard mutations passed. The three benchmark proofs all verified.

| Measurement | Observed value |
| --- | ---: |
| Witness generation | 209–229 ms |
| Proof generation | 24.93–25.46 seconds |
| Verification, first call including initialization | 441 ms |
| Verification, next two calls | 29 ms and 51 ms |
| Serialized proof envelope | 2,232–2,241 bytes |
| Circuit WASM | 4,368,077 bytes |
| Proving key | 40,735,788 bytes |
| Verification key JSON | 2,146 bytes |
| Two-step dependency capsule JSON | 5,722 bytes |
| Encrypted envelope JSON | 11,664 bytes |
| Two-entry snapshot JSON | 334 bytes |
| Assembled witness JSON | 313,456 bytes |
| Whole benchmark process peak resident memory | 399.56 MiB |

These desktop costs are a feasibility baseline, not an acceptable mobile latency promise. Proof generation uses snarkjs's single-thread option; verification initializes its cached curve on first use. The November 2 dependency checks are bounded advisory and compatibility checks, not a complete package-code audit.

## Privacy and remaining boundaries

| Observer | What this construction exposes |
| --- | --- |
| Sender | Recipient address and the opening/amount/randomness of the output it creates; no recipient spending secret is supplied. |
| Capsule holder | The ancestor commitment/nullifier graph and public step fields. Previous amounts, owners and openings are not in the capsule. Graph correlations remain possible. |
| Encrypted-envelope relay | Envelope context, ciphertext length and whatever endpoints/timing its transport exposes. Key exchange and BLE are absent. |
| Snapshot mirror | Common checkpoint request and connection metadata. The tested request contains only domain, epoch and root. |
| Public-state observer | Opaque snapshot keys/values and update grouping/timing. Publishing raw step proofs would additionally expose the commitment graph. |

The intended private settlement wrapper must hide the carried graph from public verification while proving its complete authenticated state transition. No recursive verifier, membership circuit, global uniqueness check, settlement proof, checkpoint finality check, durable wallet recovery, secure key storage or device transport is supplied here. The existing JavaScript witness assembler checks membership/conflicts in its transparent state model; that is separate from what the step circuit proves.

Hiding ancestors from the eventual holder is not implemented. This proof does not establish guaranteed offline redemption under arbitrary partitions.

Native Android and iPhone are roadmap targets. There is no mobile proving/memory measurement or NEAR verification/gas measurement. BN254 operations in NEAR's SDK do not establish that this PLONK verifier fits its gas budget. A meaningful Zcash entry/exit route is still required; this custom proof does not inherit Zcash's anonymity set, consensus or audits.

Sources inspected: [snarkjs](https://github.com/iden3/snarkjs), [Circom WASM package](https://github.com/antimatter15/circom), installed pinned Circomlib circuit sources, [ZIP 224](https://zips.z.cash/zip-0224), and [NEAR SDK environment reference](https://docs.rs/near-sdk/latest/near_sdk/env/index.html). See the [behavior and safety boundaries](../../docs/behavior.md) for the broader obligations.
