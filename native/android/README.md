# Lenz Android nearby host

This Android host packages the Lenz web interface and provides native Bluetooth
LE discovery, a GATT central and peripheral, encrypted-envelope fragmentation,
bounded forwarding and account-scoped retry storage. Ordinary chat uses the
native transport directly. It does not attach files in another application.

The host serves packaged GET assets and the BLE bridge. It does not provide the
relative financial POST endpoints used by Wallet payment confirmation and Rhea
Swap. Connected financial execution needs configured hosted or local web
services; Wallet payment and swap file handovers remain available.

The implementation is original Lenz Java code. It uses the central/peripheral,
controlled-flood and retention techniques studied in [Bitchat's pinned source](https://github.com/permissionlesstech/bitchat/tree/04995f68e470a18d1fc99f86fa326c2a87bab4f2).
Its wire protocol is Lenz-specific and does not interoperate with Bitchat clients.
No upstream implementation code is redistributed.

## Build

Use JDK 17 or newer, Android platform 35 and build tools 35. The build has no
Gradle or Maven dependency resolution. Provide the compiled public Lenz files,
including `bluetooth-client.js`. Build outputs and the development signing key
belong outside the repository.

```sh
node native/android/test.mjs --output-dir /absolute/private/test-output
node native/android/build.mjs --platform /absolute/sdk/platforms/android-35 --build-tools /absolute/sdk/build-tools/35.0.0 --web-root /absolute/compiled-public --output-dir /absolute/private/android-build
```

The resulting APK has a local debug signature. Compilation and signature
verification do not establish physical Bluetooth delivery or a store release.
Use Android 8 or newer with a current Android System WebView. Both scanning and
advertising are required. The app asks for Nearby devices permission on Android
12 or newer; earlier versions require location permission for BLE scanning.
Android 8–11 also require the system's location services to be enabled for scans.
The mesh runs while the app is in the foreground.

## Transport and privacy boundaries

The native bridge is an origin-bound message port for packaged code. Remote
pages and frames cannot acquire it. Its operations control transport and carry
already encrypted envelopes; it has no signing, key-export or settlement API.
Radio presence, timing, payload size and Lenz routing metadata remain observable.
Existing static Lenz message keys do not provide forward secrecy.

GATT writes and indications acknowledge a link transfer. Only Lenz's signed
recipient receipt marks message arrival. A payment stays pending until its
separate blockchain confirmation. The browser verifies both carrier and packet
signatures before granting a one-use forwarding token to the native host.
Locally addressed packets consume a discard token after saved intake, without
being broadcast onward. A discard failure cannot undo the received message.

The queue is limited to 32 envelopes and 1 MiB, retaining exact ciphertext only
until its signed expiry, at most 24 hours. Account changes and explicit Stop
clear it; foreground suspension keeps the same account's sender queue. A signed
recipient receipt removes only the exact acknowledged envelope. There are at
most eight links and three attempts per envelope/peer in an app session. A
three-second GATT response timeout closes the link before retry. Restart and
new-peer discovery resume bounded original-envelope attempts.
Relay storage has a separate eight-envelope/256-KiB bound and four entries per
ingress, preserving capacity for the sender. Its private retention records keep
the ingress identifier so restarts preserve that classification.

Frames have a 28-byte big-endian header: `LZ`, version 1, hop count, fragment
index/count, total length and 16 SHA-256 digest bytes, followed by ciphertext.
They are capped at 512 bytes; negotiated MTU must be at least 64. Relay depth is
at most seven hops. Reassembly has a 30-second lifetime, 16 concurrent entries,
four entries per ingress and 1 MiB aggregate capacity. Forwarding tokens retain
the exact owner, ingress, bytes and hops for 30 seconds under the same
16-item/1-MiB bound, and forward at hop count minus one.

The JVM checks exercise exact-byte reassembly, corruption, missing/reordered
fragments, duplicates, retention, owner changes and queue limits. Direct delivery
was observed on November 17 between Samsung and Xiaomi Android phones with Lenz
visible; recipients confirmed arrival in both directions and reported about
20 seconds for the Xiaomi-to-Samsung retry check. Physical multi-hop, radio
interruptions, process-restart recovery and background delivery remain unverified.
Browser simulations and JVM tests are separate from those physical observations.
