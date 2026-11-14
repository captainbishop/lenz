# Tornado v2.1 browser prover

`public/tornado-prover.js` generates original Tornado notes and proofs locally. It uses the released v2.1 circuit and key, with 20-level MiMC trees and Pedersen note hashes. It performs no wallet connection, transaction submission or server proving.

The caller must encrypt and preserve the returned note. `nullifier` and `secret` are spending secrets. A proof demonstrates the original circuit's commitment membership and binds its six public inputs; it does not establish the pool's current root, nullifier availability, funding, transaction finality or cross-chain settlement. Verify those through the actual pool and route before acting.

```js
import {createTornadoProver} from './tornado-prover.js';
const prover=createTornadoProver({isCurrent:()=>accountId===currentAccountId});
const note=await prover.generateNote();
const path=await prover.buildMerklePath(orderedPoolCommitments,noteIndex);
const result=await prover.prove({
  note,...path,recipient,relayer,fee:'0',refund:'0',
},{signal:controller.signal,onProgress:phase=>updateProofStatus(phase)});
// result.solidity contains the original verifier calldata.
prover.dispose();
```

The note has `{version:1,nullifier,secret,commitment,nullifierHash}`. Secrets are decimal strings; the public hashes are 32-byte hexadecimal strings. Paths contain `root`, 20 `pathElements` and 20 binary `pathIndices`. Beneficiary and relayer must be 20-byte hexadecimal addresses; fee and refund must be canonical unsigned field strings. `prove()` returns the original snarkjs `proof`, `solidity` calldata, six decimal `publicSignals` and timing/memory `metrics`. `verify(proof)` checks the matching released key locally.

All operations accept optional `{signal,onProgress}`. Progress phases are `artifacts`, `initializing`, `witness` and `verifying`. One operation runs per instance. `cancel()`, `dispose()`, an aborted signal or `lenz-account-identity` terminates the current worker. `isCurrent()` is checked before starting and before delivering results. Disposal removes the account listener.

The default public artifact endpoint is `/api/intent-testnet/private-pool/artifacts/`. Only three GETs are supported: `withdraw.json`, `withdraw_proving_key.bin` and `withdraw_verification_key.json`. The worker checks bounded lengths and SHA-256 before using them. An alternate endpoint must have the current origin. Secrets and witnesses travel only through local worker messages. Failure returns an error; there is no proving fallback.

The runtime retains Lenz's existing `script-src 'self' 'wasm-unsafe-eval'` and `worker-src 'self' blob:`. The build emits the hash-pinned circuit functions as static generators and uses an explicit execution stack to preserve the legacy synchronous trigger order without overflowing browser call stacks. Groth16 workers are same-origin files. The original WebAssembly module requires at least 1,000 64-KiB pages; the runtime uses that minimum with at most two workers. Desktop verification measured approximately 13.5 seconds per proof and 187.5 MiB of initial WebAssembly memory across the three instances. Peak memory and physical mobile devices have not been measured.

Set `LENZ_TORNADO_TOOLS` to a directory with the pinned `snarkjs`, `circomlib`, `websnark`, `fixed-merkle-tree`, `buffer` and `acorn` dependencies. Set `LENZ_TORNADO_ARTIFACTS` to the released v2.1 artifact directory. `tornado-prover-inputs.json` pins the dependency source digests and MiMC constants. The build rejects changed inputs and records its source revisions, input digests and output digests in `tornado-prover-build.json`.

```powershell
node web/build-tornado-prover.mjs
node web/tornado-prover-browser.test.cjs
```

The browser gate also needs Playwright and the artifact directory's compiled original verifier. Optional `LENZ_TORNADO_EVIDENCE` writes the public proof and verification report to an approved private location. The gate generates a real note and proof, checks the original key and Solidity verifier, changes each public input, and exercises note/path tampering, artifact integrity, cancellation, account changes and Lenz's actual CSP. Its local EVM is an explicit internal verification boundary; it submits no financial transaction.

The proving key and circuit JSON remain outside Git and automatic application bootstrap caching. Bundled dependencies retain their license notices in `public/tornado-vendor/`.
