# Checking an executor result

The recipient-side [read-only verifier](../contracts/defi-result-client.mjs)
authenticates the encrypted report against the original signed approval, then
queries the approved operation through a separately configured chain observer.
An executor's success claim is never the returned chain result. This developer
module is not yet connected to wallet credit, reservation release or nearby handoff.

Call `verifyDefiResult(identity, executor, config, approvedRequest, packet, options)`
with `options.observe` bound to the recipient's pinned `createDefiExecutorClients`
observer. The observer receives a copy of the checked original operation, not
the executor's reported state or transaction reference. Its final-block reads
check the chain, freshness, code hashes, exact order, funded root and consumption.
The verifier also checks that the returned observation has a final block and a
recognized state. The callback is trusted application code, never packet-supplied code.

The result must authenticate to the original owner from the selected executor,
use the exact request ID and report schema, and carry a plausible check time.
Malformed/foreign reports and nonfinal observations fail. An RPC failure returns
`unverified` with no observation. It does not fall back to an executor claim.

The original approval is revalidated at its signed issue time so expired requests
can still recover status. This path cannot dispatch or sign, and expiry never
releases funds. Callers must retain the original approved request; a received
packet alone is not an authorization record or a wallet backup.

## Verification and trust limits

The [combined executor suite](defi-executor-results.json) passes 21 tests with
18 detected alterations: eleven existing executor controls and seven recipient
controls. Recipient cases include a correctly signed false success report,
foreign/tampered requests, malformed reports, a forged signature, nonfinal or
unknown independent states, unavailable RPC and recovery after expiry. Wallet
snapshots and dispatch counters confirm no recipient-side credit, signing or
reservation release. Two initial test failures were missing the test's
`sealMessage` import; the corrected suite passes. The first mutation runner
expected a Node assertion code for the expiry control; the actual failing test
returned the browser helper's explicit expiry error. Its diagnostic expectation
now names that error without relaxing the expected failed-test check.

The chain fixture is synthetic; cryptography, SQLite, SDK signing and loopback
HTTP are real. No live executor or physical-device run is established. Independent
RPC reads are not a light-client proof and cannot defeat a dishonest configured
RPC. The module does not independently attribute a particular transaction hash;
it observes the current approved operation. Stale-state persistence, atomic
wallet consent/reservation, backed return, restoration and end-to-end product
integration remain separate requirements. The public-NEAR disclosure remains:
transport encryption does not hide executed terms from the chain.

```sh
node carrier/defi-executor-verification.mjs
```
