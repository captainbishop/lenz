# Ironwood PCZT test signer

The pinned developer CLI omits Ironwood from `pczt sign` even though its pinned
librustzcash dependency supports `Signer::sign_ironwood`. The original executable
returned success on the actual unsigned A → B transaction, then extraction failed
with `Ironwood(Extract(MissingSpendAuthSig))`. This failure is recorded in
[the run journal](../pczt-results.json).

The candidate adds Ironwood ZIP32 key discovery and calls the existing library's
signer. It also requires the expected testnet recipient, amount and maximum fee.
It only accepts a version-6 transaction with two Ironwood actions and no other
pools. Before signing, it checks value commitments, input nullifiers and keys,
output commitments, the actual recipient and account 0's internal change address.
It uses the pinned Zcash libraries; no cryptographic primitive was rewritten.

The original inspector displays the change value without identifying its owner:
the creator stores proprietary recipient information but omits an output ZIP32
derivation. The first JavaScript review assumed that derivation would be present
and failed. The candidate checks ownership from the actual receiver and the
wallet-derived full viewing key instead. The original failure remains recorded.

`lenz-zcash-pczt.exe` is a separate experimental binary. The browser companion still
uses the original executable, whose hash must match `zcash/source-lock.json`.
The dependency lock remains unchanged. [Build hashes](build.json) and the
[source patch](ironwood-test-signer.patch) identify the candidate.

To reproduce the build, apply the patch to the exact clean source revision in
`zcash/source-lock.json`, configure the project-local `RUSTUP_HOME`/`CARGO_HOME`,
set `AWS_LC_SYS_PREBUILT_NASM=1`, then run from the project root:

```powershell
cargo +1.99.1 build --manifest-path tooling/zcash-devtool/Cargo.toml --bin lenz-zcash-pczt --release --locked --offline
node zcash/pczt-support/record-build.mjs
```

The recorder saves hashes; successful compilation must be checked separately.
Do not rerun the transaction as a build check. `node zcash/pczt-test.mjs` only reads
the saved report. Mutating steps are explicit and fixed to this disposable run.
Submission journals the exact txid and signed artifact hash before network access;
an interrupted submission requires reconciliation, never a newly created spend.

All PCZTs and wallet secrets stay under ignored `zcash/.testnet/`. PCZTs can reveal
private witnesses and payment metadata, so they are not browser assets or public
test fixtures. This is a local Windows test tool, not a production wallet or an
offline onward-transfer protocol. Network confirmation still requires connectivity.
