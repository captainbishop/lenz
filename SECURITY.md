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

Read the [behavior and safety boundaries](docs/behavior.md),
[verification and failure record](research/security/verification.md) and
[development status](docs/status.md). Keep secrets out of Git even when
the repository is private.
