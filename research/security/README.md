# Security verification

Lenz's security checks cover browser policy, worker loading, signer messages, receipt validation, dependency integrity and composed accounting behavior. These are implementation checks, not an external audit.

- [Verification and failure record](verification.md).
- [Offline-proof timeout](proof-timeout.md).
- [Dependency checker](check-dependencies.mjs) and [tests](check-dependencies.test.mjs).
- [Composition tests](composition-model.test.mjs) and [installation policy tests](install-policy.test.mjs).
- [Security policy](../../SECURITY.md) and [behavior boundaries](../../docs/behavior.md).

Keep release/signing authority, recovery, private settlement and device coverage explicit. A pass in one component does not certify the composed application.
