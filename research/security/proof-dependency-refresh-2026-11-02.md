# Proof-tooling utility compatibility review

Historical first patch: the [later cleanup](dependency-cleanup-2026-11-02.md)
also updates filelist/minimatch and lowers the current advisory count to 15 low.
The original evidence below remains unchanged; the current compatibility record
binds the final lock and all 128 installed package directories.

The proof-tooling lock now resolves `ws` 8.22.1 and `underscore` 1.13.8 through
scoped overrides. The registry snapshot drops from 24 affected-package entries
(13 low, seven moderate, four high) to 20 (15 low, five moderate, zero high or
critical). These counts include transitive effects; they are not distinct exploits.
The scan exits 1 because advisory matches remain. The [evidence record](proof-dependency-refresh-2026-11-02.json)
binds the lock, tests, current sources and advisory references.

Only those two lock entries changed. Compiler, circuit libraries and prover
versions remain unchanged. The seven original artifact hashes, including circuit,
compiler WASM, R1CS and proving/verification keys, still match. Original build
metadata is preserved. The pre-install snapshot also matches the other 125
installed package directories and generated browser assets. That historical
directory snapshot used the delimiter encoding described below; it is not a
retroactive per-file attestation. The new record uses unambiguous file records.

## Build provenance

The old browser build correctly rejected the updated lock as stale. An explicit
[compatibility record](../crypto-step/dependency-refresh.json) now binds the
unchanged original setup metadata and original lock to the current lock and all
127 installed package directories. The browser build checks that record before
copying assets. Changes to the original metadata, either lock identity, package
coverage, source bytes or proof artifacts stop the build.

The initial directory digest had a reproduced encoding defect: files `a` containing
`a` and `b` containing `b` produced the same transcript as one file `a` containing
`a\0b\0b`. This was a framing ambiguity, not a SHA-256 collision. A party able to
alter dependency files could exploit it to preserve the stored directory digest.
JSON-encoded filename/content-hash records remove this ambiguity. The regression
fails with the old encoding and passes with the fix.

This is a local build consistency check. The metadata and compatibility record
are trusted repository inputs, not signed release attestations. They do not
prevent an attacker who can replace both records and build code, scan for malware,
or sandbox imported dependencies. No new setup or ceremony ran.

## Verification

On Node.js v24.21.0, Windows x64:

- 27 checks pass: ten actual circuit/proof tests, five provenance tests, three
  utility compatibility tests and nine browser worker/build tests. These include
  A-to-B-to-C proofs, rejected witnesses and proof/public-input tampering.
- The utility checks use deep arrays/JSONPath and real loopback WebSockets for
  typed-array slices and bounded fragmented messages.
- [Seven deliberate provenance alterations](../crypto-step/provenance-results.json)
  each make their intended assertion fail, including the old digest encoding.
- The browser build passes; generated asset snapshot digests remain unchanged.
- The [metadata policy check](dependency-check.json) passes for all eight npm
  projects. That check is separate from the registry advisory scan.

From `research/crypto-step`, reproduce the tests against the existing artifacts:

```powershell
npm test
node provenance-verification.mjs
node --test ../../web/build-proof-worker.test.mjs ../../web/proof-worker.test.mjs
```

Then run `node build.mjs` from `web`. A different dependency or artifact set must
pass its own compatibility review. Do not generate new test keys merely to clear
a mismatch. The combined test runner initially ran from the repository root and
failed with a missing verification key (17 passes, one failed test file); its
corrected run from the proof directory passed 27. Circuit `ERROR: 4` output in
the passing run belongs to expected rejected-witness tests.

## Remaining scope

The current residual advisory roots are `elliptic` (low) and `minimatch`
(moderate). Their transitive effects contribute to the 20 entries. This update
does not establish function-level reachability for every advisory or audit the
cryptographic dependencies. The experimental Intents tree still has its separately
recorded 52 entries; Rust warnings/vulnerabilities and wider component review gaps
remain open. The [original snapshot](dependency-audit-2026-11-02.json) stays intact.

The existing proof setup is test-only. No deployment, funding, live transaction,
user-wallet operation or physical-device test ran. Browser assets and runtime
behavior are unchanged, so this update does not resolve the intermittent proof
timeout, recovery, full private settlement or executor product integration.
