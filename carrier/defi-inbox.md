# Encrypted DeFi request intake

The DeFi inbox accepts encrypted requests for an existing signed Rhea swap or
its signed refund return. It authenticates the owner and selected executor,
checks the action and disclosure consent, and saves ciphertext before returning
an encrypted storage receipt. Forwarding uses the existing carrier protocol.

This is a developer library. The wallet and chat do not yet publish these requests,
and automatic execution is not enabled in the app. A separate [executor library](defi-executor.md)
can dispatch validated requests. The inbox itself contains no chain signer, sponsor
key or financial API. Its receipt means **stored**, never executed,
refunded or spendable. Existing wallet reservations remain unchanged.

## Supported requests

| Action | Offline checks | Checks still required before execution |
| --- | --- | --- |
| `rhea-swap` | Existing order signatures, ancestry, owner, configured testnet contracts/pool, input amount, minimum output, recipient and deadline. | Current adapter/exchange code and configuration, authentic funded root, consumption/conflicts, existing order and final receipts. |
| `rhea-refund-return` | The original order plus its signed deposit request; exact reserve, payer, source, owner and amount. | Final refunded order, actual payer authority and balance, deposit execution, matching final root and consumption check. |

These checks reuse [Rhea authorization](../web/public/rhea-protocol.js) and
[deposit authorization](../web/public/near-deposit.js). A structurally valid reserve
root does not prove funding. A signed refund request does not prove a refund exists
or authorize the executor to debit somebody else's NEAR account. The existing
[refund executor](../contracts/refund-return.mjs) requires the receiving account's
signer. No new chain interface or permission is introduced here.

Liquidity, lending/borrowing, general withdrawals, Aurora actions and shielded
settlement are not supported by this inbox yet. Unknown action types fail closed.
Each needs its own protocol authorization and result checks before it can be added.

## Authorization and disclosure

The signed `lenz/defi-request/v1` terms contain the owner's Lenz ID, selected
executor's Lenz ID, creation/expiry times, explicit disclosure policy and exact
operation. The request ID hashes those terms. The action retains its original
contract signatures. The outer request cannot change or broaden that authority.

The only accepted policy is `lenz/disclosure/public-near-executor/v1`. It means:

- The selected executor can decrypt the action, amounts, receiving account and
  included note ancestry. Profile names/photos and unrelated wallet history are
  not included in the request.
- NEAR execution on this route publishes action data, amounts and accounts.
- Forwarding carriers see routing IDs/public keys, timestamps and packet sizes.
  Their stored bodies contain ciphertext. They cannot open it without an endpoint's
  private key. Collusion with the executor defeats that separation.

Consent must be supplied explicitly. Missing consent or a private-only policy is
rejected; there is no automatic public fallback. This policy records permission,
but cannot prevent an executor from leaking information after decrypting it. The
executor must be selected and authenticated through a separate product approval
flow. Static P-256 ECDH/AES-GCM uses the existing Lenz encryption and does not offer
forward secrecy, anonymous routing or private chain settlement.

Request lifetime is at most 24 hours. Swap intake also ends at the signed swap
deadline. A refund return can have a later, separately approved intake window.
**Intake expiry does not revoke the underlying signatures.** In particular, the
reserve redemption signature has no expiry. Never unlock its input on a timer,
a mailbox failure or an executor's storage acknowledgement.

## Durable inbox

`DefiInbox` binds its SQLite database to one executor ID and configured route.
`receive(envelope)` checks both carrier signatures, decrypts the packet, validates
the request, and commits before issuing a receipt. It rechecks expiry after the
asynchronous cryptographic checks. A storage failure produces no acknowledgement.

The database stores the original encrypted envelope plus IDs, times, byte counts
and a hashed conflict key. Decrypted instructions and private keys are not written
to it. Repeated delivery of the same request returns another receipt with the
original storage time, including after restart. Newly encrypted copies of the same
request still deduplicate.

A different authorization for the same spending key's swap input or refund deposit ID
is rejected, including a newly signed expiry or altered destination. Expired rows
retain their conflict protection. This is local duplicate/conflict protection;
it does not detect every conflicting ancestor, copied wallet, other executor or
on-chain spend. The chain must resolve those cases. The inbox does not evict old
requests to admit new ones. Default limits are 256 requests, 32 MiB and 32 per owner;
operator retention and recovery of a full inbox remain deployment work.

`read(id)` returns the saved encrypted envelope and storage/expiry metadata. It
conveys no execution authority. The executor must revalidate policy, deadline
and current chain state before dispatching and preserve ambiguous attempts for
receipt reconciliation. Wallet integration must atomically save its reservation
and request before exposing the encrypted packet to any transport.

## Reproduce

Requires Node.js 24.21.0 with built-in SQLite. From the project root:

```sh
node carrier/defi-inbox-verification.mjs
node --test carrier/network.test.mjs web/rhea-protocol.test.mjs web/near-protocol.test.mjs web/near-deposit.test.mjs web/rhea-relay.test.mjs
```

The [verification report](defi-inbox-results.json) records source hashes, passing
tests and detected guard alterations. Tests use disposable keys, synthetic reserve
roots, actual WebCrypto, SQLite and two loopback HTTP carriers. They cover both
actions, altered terms/consent, expiry during verification, lost acknowledgements,
restart, concurrent duplicate delivery, conflicts, quotas and storage-only receipts.
Guard alterations run in temporary copies and must fail their intended assertions.

No live transaction, faucet grant, user-wallet change, physical-phone test or
remote executor deployment is represented by this evidence. The shipping carrier
container remains a ciphertext forwarder and does not include this inbox library.
