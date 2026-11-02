# Intents protobuf compatibility review

Historical checkpoint: the SDK dependency environment described below was later
removed. Its raw compatibility test is no longer in the current source tree;
commands below require that retired environment. See the [current cleanup and
empty-authentication evidence](dependency-cleanup-2026-11-02.md). This report's
original JSON evidence is preserved.

The isolated Intents dependency tree now has zero critical advisory entries.
Its scoped `@confio/ics23` override selects `protobufjs` 7.6.6, replacing 6.11.6.
The [recorded results](intents-protobuf-refresh-2026-11-02.json) include the exact
locks, source hashes, passing compatibility tests and the failing original
code-injection regression. SDK 0.93.0 remains isolated from product signing.

| Registry affected-package entries | Before | After |
| --- | ---: | ---: |
| Critical | 1 | 0 |
| High | 24 | 18 |
| Moderate | 10 | 10 |
| Low | 17 | 22 |
| Total | 52 | 50 |

Counts include dependency ancestors and severity reclassification. The updated
scan still exits 1. It removes the protobuf advisory path; the 50 remaining
entries require further review. The [original snapshot](dependency-audit-2026-11-02.json)
is preserved with its original lock identity.

## Update and compatibility boundary

The installed path is Intents SDK -> Omni Bridge -> Wormhole CosmWasm components
-> CosmJS Stargate -> `@confio/ics23` -> `protobufjs/minimal`. The parent codec
package requests protobuf `^6.8.8`. Registry metadata still identifies 6.11.6
as the latest 6.x release, while the advisory ranges include it. The reviewed
7.x release is [7.6.6](https://registry.npmjs.org/protobufjs/7.6.6).

This is an explicit cross-major override. Installation changed protobufjs and
its `long` dependency (4.0.0 to 5.3.2), and removed the unused `@types/long` and
`@protobufjs/inquire` packages. No other lock entries changed. The complete
installed Intents SDK and ICS23 package directory hashes match their pre-update
hashes, using unambiguous filename/content-hash records. Quote modules, server,
proof-tooling lock, Aurora lock and recorded NEAR locks remain unchanged.

Lifecycle scripts were disabled. Protobuf 7 no longer bundles the `pbjs`/`pbts`
CLI; this integration consumes existing generated codecs. Regenerating those
upstream codecs requires a separately reviewed compiler toolchain. Compatibility
fixtures do not cover every cross-chain bridge method or proof shape.

## Reproduced dependency defect

The [bytes-default code-injection advisory](https://github.com/advisories/GHSA-66ff-xgx4-vchm)
was reproduced through the full protobuf reflection API. A JSON schema containing
a JavaScript assignment as a bytes-default array element made `Type.toObject`
execute that assignment under 6.11.6. The regression uses only an in-memory
marker, with no file, network or operating-system action.

The old converter inserted the joined array elements into generated JavaScript.
The updated converter serializes the array with JSON encoding. The identical
test leaves the marker unset under 7.6.6. The recorded baseline has four passes
and one expected failure; the updated suite passes all five compatibility tests.

Current quote routes do not import the experimental SDK. The inspected ICS23
codec imports the minimal runtime and uses static generated schema code. It does
not pass provider-controlled schema descriptors to the reflection API. The
reproduction establishes a dependency defect; no current Lenz application path
to this injection has been demonstrated.

## Verification

The combined run passes 25 tests on Node.js v24.21.0, Windows:

- Hand-encoded ICS23 wire bytes, JSON conversion and membership verification
  against an independently calculated SHA-256 root.
- Rejection of changed roots, keys, values, proof contents and a truncated message.
- Exact signed/unsigned 64-bit limits through protobuf Writer/Reader.
- A deterministic unsigned empty intent and versioned nonce, with fetch blocked.
- The code-injection regression and 20 existing quote, local HTTP and NEAR receipt
  checks, including real local signature fixtures.

From the repository root:

```powershell
node --test integrations/protobuf-compatibility.test.mjs integrations/quotes.test.mjs web/defi-relay.test.mjs contracts/client.test.mjs
node research/security/check-dependencies.mjs
```

The metadata policy check passes for all eight npm projects. `npm ls protobufjs
long --all --json --offline`, run from `integrations`, confirms the override and
its actual dependency path. The first registry read failed with sandbox EACCES;
approved access succeeded. An initial nonce fixture used incorrect constants;
source inspection corrected that fixture before the recorded baseline, without
changing SDK code.

No live account authentication, signing, transaction, funding, deployment or
user-wallet operation ran. Partner access, a funded route, privacy binding,
execution/finality/refunds and the remaining security findings remain open.
