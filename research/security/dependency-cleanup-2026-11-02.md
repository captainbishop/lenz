# Dependency cleanup, November 2, 2026

The Intents helper now has zero registry advisory matches. Proof tooling has
15 low affected-package entries, with no moderate, high or critical entries.
Both NEAR locks retain one vulnerability, two maintenance warnings and one
unsoundness warning after the compression updates. These are dependency counts,
not a clean bill of health for Lenz. [Exact evidence](dependency-cleanup-2026-11-02.json)
binds the current sources, locks, compatibility checks and advisory results.

## Intents authentication

The experimental Intents SDK was used only for an empty authentication payload
and an installation probe. Removing that unused execution/bridge dependency tree
reduces the isolated lock from 586 package entries to one: `@scure/base` 1.2.6.
The separate 1Click quote-verification SDK and existing quote routes are retained.
Full Intents execution remains unimplemented and required.

The [empty-authentication builder](../../integrations/intents-auth-payload.mjs)
encodes the SDK's v0 nonce: fixed domain/version, four-byte contract salt,
little-endian deadline/start times and seven random bytes. It fixes the salt
query to `intents.near/current_salt` on the configured public mainnet endpoint,
validates its response and rejects malformed identity, time, salt and randomness.
It cannot construct token actions. The existing disposable Ed25519 signer is retained.

Before removal, 32 unsigned payloads were compared byte-for-byte against installed
SDK 0.93.0. [Public fixtures and upstream source hashes](../../integrations/intents-auth-sdk-fixtures.json)
preserve that comparison. Twenty-six authentication, quote, HTTP-route and receipt
tests pass, and seven deliberate guard/domain alterations are detected. Signature
tests use disposable generated keys and mocked endpoints. No live authentication
was repeated. Partner access, execution routes, privacy binding and recovery remain open.

The [earlier protobuf report](intents-protobuf-refresh-2026-11-02.md) describes the
retired SDK environment. Its original findings and evidence remain historical;
its compatibility command is no longer part of the current dependency tree.

## Proof tooling

The earlier `ws` 8.22.1 and `underscore` 1.13.8 overrides remain. Jake's `filelist`
now resolves 2.0.2 with nested `minimatch` 11.0.4, bringing brace-expansion 5.0.12,
balanced-match 4.0.4 and nonrecursive-glob-match 1.0.3. Compiler, prover and
cryptographic package versions are unchanged. Fifteen low entries through
`elliptic` 6.6.1 remain; replacing that cryptographic path needs separate review.

Updating minimatch alone initially broke the actual Windows filelist glob test:
it returned no files. Updating filelist fixed it. An initial sibling override
left a nested minimatch 10.2.6; the final nested override and actual lock now agree.
Those failed attempts are retained in the evidence. Twenty-eight proof,
provenance, dependency and worker tests pass, including real proofs. The web build
passes. All seven original artifact hashes and all twelve saved browser/metadata
file hashes match; original setup metadata is unchanged. These checks do not
turn the local TEST-ONLY setup into a production setup.

## NEAR native tooling

Both locks update only `zstd` 0.13.3 to 0.13.4 and `zstd-safe` 7.3.0 to 7.4.0.
Reserve tests pass 16 cases and adapter tests pass 26. Both locked offline Wasm
builds pass. The retained RustSec database finds the following in each lock:

| Package | Remaining finding | Current exposure and follow-up |
| --- | --- | --- |
| crypto-bigint 0.5.5 | RUSTSEC-2026-0387, timing variability | NEAR native test runtime path; absent from the Wasm normal/build tree. A coordinated cryptographic/runtime migration remains open. |
| lru 0.16.4 | RUSTSEC-2026-0253, panic-safety use-after-free | Native runtime dependency; absent from the Wasm normal/build tree. Fix requires a compatible runtime update or reviewed backport. |
| unsafe-libyaml 0.2.11 | RUSTSEC-2024-0449, unmaintained | Native tooling path; absent from the Wasm normal/build tree. |
| wee_alloc 0.4.5 | RUSTSEC-2022-0054, unmaintained | Present in the Wasm build; allocator replacement and artifact/release review remain open. |

Upstream metadata inspection found near-vm-runner 0.38.0 uses lru 0.18.2 but still
uses p256 0.13.2 and its crypto-bigint 0.5.x path. near-sdk 5.30.0 still defaults
to wee_alloc. Those versions were inspected, not applied to the project. A broad
SDK bump would therefore not remove all remaining findings.

The original cached target Wasm hashes differed from the new builds. A controlled
rebuild with the old locks and then the new locks, using the same current command
and toolchain, produced identical outputs for each contract. This isolates the
lock updates from that difference; it does not explain the original cache's
provenance. Both sets of hashes are recorded. The archived adapter deployment
candidate remains unchanged. No deployment, funding or financial transaction ran.

## Recheck

```sh
node --test integrations/intents-auth-payload.test.mjs integrations/quotes.test.mjs web/defi-relay.test.mjs contracts/client.test.mjs
node --test research/crypto-step/dependency-compatibility.test.mjs
```

The proof suite's full command and exact source hashes are in the evidence record;
run it from `research/crypto-step`. Registry results are time-bound snapshots.
Broader contract/circuit review, dependency residuals, release authority, safe
restoration and physical-device/live executor checks remain open.
