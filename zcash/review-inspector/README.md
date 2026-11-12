# PCZT review inspector

This small native executable reads an unsigned version-6 PCZT and returns bounded expiry metadata. It accepts exactly two Ironwood actions and no other pools. Its output is limited to version, testnet label, expiry height, target height and whether the consensus branch matches testnet at that target. The label reflects the selected testnet check; it is not a claim that a PCZT contains an independently authenticated network identifier.

The parser is pinned to librustzcash revision `eb38d7a373661179dbc083a2fd58b3a6c9b25818`, with `pczt` default features disabled and its Orchard verifier enabled. It has no network, prover or signing operation. Malformed input returns failure. [Expiry integration and limits](../payment-freshness.md).

The `--effects PRIVATE_PCZT` mode accepts a bounded JSON object containing `ufvk`, `recipient`, `amount` and `fee` on stdin. It checks the recipient, values, commitments, input ownership and internal change using the testnet full viewing key. It recovers the encrypted payment using the sender's external outgoing viewing key and decrypts change with the internal incoming viewing key, using the bundle's own encryption domain. Both recovered notes must match their committed recipient and value. The existing creator deliberately omits outgoing recovery for change. Memos are authenticated by decryption but are not approved or returned by this review.

The key never appears in arguments or output. Real input signatures are rejected; zero-value dummy signatures created by the I/O finalizer are permitted. See [output verification](../payment-effects.md) for the exact checks and remaining signing gates. This mode handles private viewing material in process memory, so the host and local bridge remain trusted. Native tests construct synthetic two-action PCZTs in memory from public test seeds; they do not open an account or submit a transaction. Builder and I/O-finalizer dependencies are enabled only for these tests.

Build from the repository root with the existing local Rust toolchain/cache:

```powershell
./zcash/review-inspector/build.ps1
```

The script runs the locked test/build offline and writes source, manifest, lockfile and executable hashes to `build.json`. A fresh machine must first obtain Rust 1.99.1 and the pinned dependencies. Runtime binaries remain ignored under `target/`; the local bridge refuses a binary or source mismatch. The recorded Windows build does not establish another platform's behavior.

The November 1 lockfile expansion resolved 146 dependencies after an index refresh (147 entries including the inspector); the cached `inout` 0.2.3 release was yanked, and this inspector now resolves 0.2.5. The original wallet executable and its separate lockfile were unchanged. This is a build result, not a dependency security audit.
