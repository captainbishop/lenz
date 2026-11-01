# Aurora dependency verification

November 1, 2026. The local contract tooling uses pinned EthereumJS 10.1.3,
ethers 6.17.0 and solc 0.8.38. The [lockfile](package-lock.json) contains 44
dependencies and no Hardhat, Hardhat ethers plugin or Zod package. A clean install
with lifecycle scripts disabled passed. A fresh [npm audit](dependency-audit.json)
exited zero with no known vulnerabilities.

The affected dependency was Zod 3.25.76, used by Hardhat 3.21.0 and its plugin.
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) describes
memory exhaustion when oversized constrained collections are validated. It produced
four package-level findings. Hardhat 3.21.2 still declares Zod 3, while the advisory
lists 4.6.6 as patched. The toolchain now uses the documented
[EthereumJS VM API](https://github.com/ethereumjs/ethereumjs-monorepo/tree/master/packages/vm)
for local execution. No advisory suppression, forced Zod-major override or local
dependency patch is used.

## Verification

- Fourteen Node tests pass: two dependency-policy tests, five compiler/VM tests and
  seven network-reader tests. The no-Zod regression failed against the affected
  lockfile before the dependency change.
- Three VM controls are detected by failing tests: allowing writes during static
  reads, retaining temporary read state and skipping transaction balance checks.
- Both existing Solidity contracts compile. The local probe deploys exact compiled
  runtime bytecode, writes 42, reads 42 and emits the matching receipt event.
  [Local results](local-results.json).
- The existing test proof is accepted; all seven individually changed public
  inputs and an altered proof are rejected. The signed in-memory transaction uses
  302,476 gas, 996 bytes of calldata and 7,118 bytes of runtime code, matching the
  recorded Hardhat measurement. Verifier source and circuit hashes are unchanged.
  [Proof results](proof-results.json).

The VM uses chain ID 31337 and Paris rules. It creates a fresh fixture account in
memory and has no network transport. Static calls restore the complete state root;
reverted and out-of-gas transactions fail visibly and preserve contract storage.
These checks exercise actual compilation and EVM execution locally. They do not
establish Aurora-specific opcode compatibility, deploy an adapter or move funds.

The initial package-metadata request was blocked by the host sandbox (EACCES);
authorized registry access succeeded. The first dependency-test draft tried to read
an absent optional package for another platform; it now permits absent optional
packages while requiring every nonoptional locked package to be installed. The
current lockfile has no optional dependencies or installation hooks.

Run the commands in the [setup guide](README.md#reproduce). The
[verification record](toolchain-results.json) binds the checks to their source and
lockfile hashes. A zero-finding audit concerns known npm advisories at the time of
the check. Aurora integration, private settlement and account recovery remain
separate requirements in [development status](../docs/status.md).
