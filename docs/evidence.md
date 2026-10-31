# Evidence and reproducibility

Reports distinguish fixture tests, checks of saved results and actual testnet transactions. A recorded pass is evidence for its stated run and environment, not a fresh deployment check or production certification.

Result files included in this first commit use portable placeholders for machine-specific paths. Test outcomes, transaction receipts and measured values retain their recorded results. Source, executable and deployed-code hashes describe the artifacts used in each recorded run.

Screenshots and videos use disposable test identities. Homepage clips are edited replays of the documented source flow; playing them does not execute a financial action. Media requires visual privacy review in addition to automated text checks.

Compiled contract binaries are not included. Recorded hashes and source/rehearsal scripts are provided. Checks requiring a specific binary need a separately obtained, hash-verified artifact; a fresh build may have different bytes. Do not overwrite a recorded deployment hash with a new build hash or run deployments to make an evidence check pass.

The original offline-proof timeout remains unexplained. Its failure record is retained alongside later passing runs. Successful reruns do not establish a performance fix. [Failure and diagnostic evidence](../research/security/proof-timeout.md).

For browser suites, install Playwright and other required test dependencies in a local tools directory and set NODE_PATH to that directory's node_modules. Use an installed Edge browser where the suite specifies channel msedge. Private browser profiles, wallet files, credentials, source caches and raw local records are excluded from publication.
