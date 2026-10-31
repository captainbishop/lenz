# Protocol code and verification

This directory contains executable transfer models, cryptographic components, tests and recorded implementation checks for Lenz. Proof of U remains the protocol namespace for compatibility.

- [PLONK step proof and circuit](crypto-step/README.md).
- [Portable encrypted handover and native vectors](mobile-handover/README.md).
- [Transfer model](transfer-model.mjs), [tests](transfer-model.test.mjs) and [counterexamples](counterexamples.mjs).
- [Transition relation](transition-relation.mjs) and [tests](transition-relation.test.mjs).
- [Witness capsule delivery](witness-delivery.mjs), [Merkle map](witness-map.mjs) and [tests](witness-delivery.test.mjs).
- [Funded offline social flow](offline-social-live.md), [chat integration](offline-social-money.md) and [payment confirmation](payment-status.md).
- [Security checks and failures](security/README.md).
- [Preview evidence](preview-motion.md) and [development freshness](development-freshness.md).

The models and step proof do not establish a production private settlement system or guaranteed offline redemption. [Behavior and safety boundaries](../docs/behavior.md), [development status](../docs/status.md).
