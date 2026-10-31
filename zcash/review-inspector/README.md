# PCZT expiry inspector

This small native executable reads an unsigned version-6 PCZT and returns bounded expiry metadata. It accepts exactly two Ironwood actions and no other pools. Its output is limited to version, testnet label, expiry height, target height and whether the consensus branch matches testnet at that target. The label reflects the selected testnet check; it is not a claim that a PCZT contains an independently authenticated network identifier.

The parser is pinned to librustzcash revision `eb38d7a373661179dbc083a2fd58b3a6c9b25818`, with `pczt` default features disabled. It has no wallet keys, signing, proving or networking. Malformed input returns failure. [Browser integration and limits](../payment-freshness.md).

Build from the repository root with the existing local Rust toolchain/cache:

```powershell
./zcash/review-inspector/build.ps1
```

The script runs the locked test/build offline and writes source, manifest, lockfile and executable hashes to `build.json`. A fresh machine must first obtain Rust 1.99.1 and the pinned dependencies. Runtime binaries remain ignored under `target/`; the local bridge refuses a binary or source mismatch. The recorded Windows build does not establish another platform's behavior.
