# Security verification

Lenz's security checks cover browser policy, worker loading, signer messages, receipt validation, dependency integrity and composed accounting behavior. These are implementation checks, not an external audit.

- [Verification and failure record](verification.md).
- [Latest dependency cleanup and remaining advisories](dependency-cleanup-2026-11-02.md).
- [Recipient-side DeFi result verification](../../carrier/defi-results.md).
- [November 2 component review and remaining requirements](review-2026-11-02.md).
- [November 2 dependency advisory snapshot](dependency-audit-2026-11-02.json).
- [Proof-tooling utility remediation and compatibility](proof-dependency-refresh-2026-11-02.md).
- [Intents protobuf remediation and compatibility](intents-protobuf-refresh-2026-11-02.md).
- [November 2 Rust dependency advisory snapshot](rust-dependency-audit-2026-11-02.json).
- [Offline-proof timeout](proof-timeout.md).
- [Dependency checker](check-dependencies.mjs) and [tests](check-dependencies.test.mjs).
- [Composition tests](composition-model.test.mjs) and [installation policy tests](install-policy.test.mjs).
- [Security policy](../../SECURITY.md) and [behavior boundaries](../../docs/behavior.md).

Keep release/signing authority, recovery, private settlement and device coverage explicit. A pass in one component does not certify the composed application.
