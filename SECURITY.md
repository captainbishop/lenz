# Security policy

Lenz is an experimental testnet project. There is no audited production release,
mainnet custody service or supported real-money version. The current development
branch is the only actively maintained version; historical evidence is retained for
review, not presented as a support commitment.

## Report a vulnerability

Do not publish an exploit, seed, wallet file, token or private transaction in a
public issue. If GitHub offers **Report a vulnerability** in this repository's
Security tab, use that private channel. Otherwise contact
[captainbishop](https://github.com/captainbishop) through a private channel explicitly
listed on the profile. If none is available, request a private reporting channel
without revealing vulnerability details publicly.

Include the affected commit/component, impact, a minimal reproduction with disposable
data and suggested mitigations where available. Do not test against accounts,
systems or funds you do not own or have permission to use. No bounty, response-time
guarantee or safe-harbor commitment is offered by this file.

## Known boundaries

- Encrypted chat, native shielded Zcash and private NEAR settlement are separate claims.
  The current NEAR reserve exposes settlement metadata.
- Offline local validation cannot rule out every conflicting authorization from a
  copied wallet. Chain settlement and recovery have additional assumptions.
- Safe account recovery, independent release/signing authority and component-appropriate
  external reviews remain incomplete.
- Native Zcash tests use prerelease tooling and disposable test coins. The local
  companion is not a production signer.

## Review during development

Security review is required at each stage. Before implementation, identify the
assets, actors, authorization and privacy boundaries affected by the change.
During implementation, review every path that can sign, send, credit, release a
reservation or recover an outstanding obligation. Use the review method for the
actual component: browser and transport, Rust/NEAR, Solidity/EVM, or the precise
cryptographic statement and verifier.

Before publication, reproduce reported defects with disposable data, verify the
fix and relevant failure cases, and run the affected regression and guard-removal
checks. Record dependency/analyzer availability, source hashes, observed failures
and untested scope. Review outgoing files and cached-app updates as part of the
same change. A passing component suite does not establish safe recovery, private
settlement, live deployment behavior or approval to handle real funds.

Read the [behavior and safety boundaries](docs/behavior.md),
[verification and failure record](research/security/verification.md) and
[development status](docs/status.md). Keep secrets out of Git even when
the repository is private.
