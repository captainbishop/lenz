# Offline proof timeout investigation

Recorded October 31, 2026. The original 90-second timeout remains unexplained. Four diagnostic runs completed; they verify diagnostic behavior without establishing a performance fix.

## Evidence

The original [failure](../../web/security-proof-offline-timeout.json) reached `Creating proof…` on the second payment. That stage is emitted before `snarkjs.plonk.prove` opens the proving key. It establishes that worker startup and witness calculation completed, but cannot distinguish loading the key from proof computation. Its bytes remain unchanged; the SHA-256 is recorded in the [review record](proof-timeout-review.json).

| Run | Result | Individual proofs | Evidence |
| --- | --- | --- | --- |
| Inherited diagnostic 1 | 25 passed in 56.911 s | 27.081 s; 29.225 s | [Report](../../web/security-proof-offline-2026-10-30T23-11-07-926Z.json) |
| Inherited diagnostic 2 | 25 passed in 49.866 s | 24.293 s; 24.934 s | [Report](../../web/security-proof-offline-2026-10-30T23-12-41-057Z.json) |
| Inherited diagnostic 3 | 25 passed in 41.354 s | 21.837 s; 19.055 s | [Report](../../web/security-proof-offline-2026-10-31T09-42-28-767Z.json) |
| Fresh diagnostic | 25 passed in 26.241 s | 13.073 s; 12.889 s | [Report](../../web/security-proof-offline-2026-10-31T09-51-28-665Z.json) |
| Deliberate 10-second interruption | Exit 1; unfinished first proof retained | Still `running` at `Creating proof…` | [Failure report](../../web/security-proof-offline-2026-10-31T09-52-16-320Z.json) |

All four completed runs used the original 90-second suite allowance. They used disposable Windows Edge profiles, actual test-only PLONK proofs and emulated offline networking. None recorded a CSP violation or page exception. The deliberate 10-second limit tests failure reporting; it is not a reproduction of the original 90-second failure.

The test page exposes `window.proofTestProgress`, and the runner supports `--diagnostic`. It records unfinished stages, worker lifetimes, local request events, available host memory and browser process CPU samples in a uniquely named report. It does not record witness inputs or open an existing browser profile. The original failure and normal result files are preserved when diagnostic mode runs.

The first two inherited reports predate asset-response instrumentation. The third and fresh completed reports contain successful cached responses for both `step.wasm` and `step.zkey` for each proof. Response events show status and cache source, not when the whole response body finished. Renderer CPU increased during computation; these process-level samples cannot isolate a particular cryptographic phase. Samples from successful runs do not explain the original failure.

The original failure lacks the timings needed to identify the cause. Passing runs do not justify a change to wallet timeouts, proof concurrency, CSP or accounting.

## Recorded verification

- Nine worker/build tests passed, including worker timeout cleanup and exact agreement with the pinned worker implementation.
- Both existing worker mutations were detected: sending before readiness and treating progress as completion.
- Static verification found all 44 cache routes; syntax checks passed for both changed test files.
- The deliberate 10-second run exited unsuccessfully and saved its partial results, `running` proof stage, cached asset responses and CPU samples. A separate archive check asserted those fields and the original failure's unchanged hash.

The diagnostic suites used the local server with the restrictive CSP and disposable browser profiles. Wallet, signer and chain suites were not rerun for these test-only changes.

Reproduce from the project root with the existing server on port 4173:

```powershell
# Set NODE_PATH to your local test-tools node_modules directory.
$env:LENZ_PROOF_TEST_TIMEOUT_MS='90000'
node web/security-proof.test.cjs --offline --diagnostic
node --test web/proof-worker.test.mjs web/build-proof-worker.test.mjs
node web/proof-worker-mutations.mjs
node web/verify-static.mjs
node --check web/security-proof.test.cjs
node --check web/public/browser-tests.js
```

For the failure-report control, set `LENZ_PROOF_TEST_TIMEOUT_MS` to `10000` and run the diagnostic command once. Expect a nonzero exit if a proof is still running, then inspect the uniquely named report. Restore `90000` afterward. A sufficiently fast machine could complete before this shortened limit; that would not test interruption.
