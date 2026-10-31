# Shared handover vectors

Native Android/iPhone integration remains roadmap work. The portable WebCrypto adapter is reused by the web prototype; no iPhone/Xcode build is established by these vectors.

This package defines byte-level compatibility for the existing AES-256-GCM research envelope. It does not implement a wallet, peer authentication, key exchange, BLE fragmentation, settlement, or payment-proof verification in Java/Swift.

`vectors.tsv` contains **public test keys**, 12-byte nonces, exact plaintext/AAD bytes, ciphertext and separate 16-byte tags. Do not reuse these keys/nonces with actual messages. The manifest records fixture hashes. Only the `real-step` positive fixture carries a real PLONK proof; Unicode and 64 KiB fixtures test encoding/size rather than monetary validity.

AAD is UTF-8 of the exact compact array `["proof-u/witness-capsule/v1",domain,handoff]`. This native profile accepts ASCII domains matching `[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}` and lowercase 16-byte hexadecimal handover IDs. It is narrower than the earlier Node fixture's unrestricted domain string. Payloads remain exact UTF-8 bytes: do not parse and reserialize them before testing the tag. JVM/WebCrypto use ciphertext followed by tag internally; CryptoKit accepts the split components.

Observed verification on Windows: all 16 vectors passed in WebCrypto and the JVM; 22 Node test cases passed, including real-proof preservation and native compilation. Three targeted adapter guard removals admitted the corresponding context substitution, AES-128 key, or oversized valid ciphertext that the original adapter rejected. Java was compiled against the Java 8 API surface using Temurin 25.0.4.1. This does not validate Android's runtime/provider or device behavior. Swift/CryptoKit sources are prepared but **not compiled or tested**.

Run from this directory:

```powershell
node generate-vectors.mjs
node --test handover.test.mjs
node mutations.mjs
```

On an eventual Mac with Xcode command-line tools:

```sh
mkdir -p build
swiftc CapsuleCrypto.swift CapsuleVectors.swift -o build/capsule-vectors
./build/capsule-vectors vectors.tsv
```

The expected native runner output is a pass count matching the manifest, currently 16. Keep that test pending until actually run. A native caller must compare expected envelope context, validate the decrypted capsule and its proof, and implement durable delivery/credit deduplication. Successful repeated decryption is not permission to credit value twice.

No Bitchat source or wire protocol was modified or copied. Upstream's [Swift README](https://github.com/permissionlesstech/bitchat), [whitepaper](https://github.com/permissionlesstech/bitchat/blob/main/WHITEPAPER.md), [security policy](https://github.com/permissionlesstech/bitchat/blob/main/SECURITY.md), [license](https://github.com/permissionlesstech/bitchat/blob/main/LICENSE) and [Android README](https://github.com/permissionlesstech/bitchat-android) were inspected. Those describe an application transport, not compatibility with this envelope. A later integration must pin both implementations and test framing, retention, retries and radio behavior. No transport commit is selected here.
