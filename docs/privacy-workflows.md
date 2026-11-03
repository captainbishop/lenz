# Privacy across Lenz workflows

Privacy requirements apply through quote, approval, handoff, execution and
recovery. A private request must stop when a required leg is public or unknown.
An encrypted request does not change the visibility of its eventual transaction.
The user need not reconnect if an authorized, connected participant can submit
the operation. Complete carrier execution and verified return remain open.

## Current boundaries

| Workflow | Implemented | Remaining work |
| --- | --- | --- |
| Conversations | Recipient-encrypted, signed messages; contacts use public-key IDs | Static ECDH has no forward secrecy. Routing IDs, timing and lengths remain observable; metadata protection needs a versioned transport upgrade. |
| Offline tUSD | Encrypted wallet/outbox; signed onward transfer; atomic reservations and duplicate/conflict checks | Public NEAR testnet settlement exposes amounts/accounts. Shielded settlement, restoration and device migration remain open. |
| Public DeFi | Separate consent for public estimates; private objectives cannot bind to them; executor disclosure is signed | Encrypted delivery is not private execution. Full action-specific effects, fees, connected execution and recovery are incomplete. |
| Token watchlist | Explicit address-sharing consent; encrypted saved account/balance snapshots | Queries expose the requested contract/account to the network provider. Watching grants no ownership or signing authority. |
| Zcash | Native testnet transfer evidence and bounded unsigned transaction review | Product signer approval, complete input/witness and note-encryption validation, recovery/rescan and shielded value routes remain open. |
| Tornado Classic | Local comparison of native-asset withdrawal calldata, approved terms and supplied pool observations | No deployed pool registry, verified proof, prover, note vault, relayer, submission or recovery connection. |

## Zcash and social payments

Use a recipient-specific shielded payment request inside the existing encrypted
conversation. Keep wallet spending/viewing keys, witnesses and change details
with the spender. A contact name is a label, not proof of address ownership.
The signer must check the actual decoded shielded receiver, network, amount,
fee, owned change and expiry. Reusing a transparent address must not satisfy a
shielded request. A unified address requires receiver-level validation.

This is the integration requirement, not a connected chat payment feature.
Current [Zcash review](../zcash/payment-effects.md) uses the isolated test wallets;
it does not merge their keys or balance with the browser identity. Existing
[freshness checks](../zcash/payment-freshness.md) do not prove input availability
or a current witness. Offline onward tUSD must never be relabelled shielded ZEC.

## Tornado withdrawal boundary

The [Classic contract](https://github.com/tornadocash/tornado-core/blob/master/contracts/Tornado.sol)
checks a known root, unspent nullifier and a proof with the recipient, relayer,
fee and refund as public inputs. The
[circuit](https://github.com/tornadocash/tornado-core/blob/master/circuits/withdraw.circom)
uses the deposit secret and membership path. Pool denomination and withdrawal
recipient are public; a later swap, loan or perpetual position remains visible.

[The local review adapter](../integrations/tornado-withdrawal.mjs) accepts only
native withdrawals with zero transaction value/refund. It binds exact calldata
and proof hash to reviewed terms, checks the received minimum and compares a
fresh supplied root/nullifier/pool observation. Unknown fields, including spend
notes and social identifiers, are rejected. Its result explicitly leaves proof,
deployment, canonical state, approval, fees and submission unverified.

A bearer note must not become an offline payment card: its sender can retain a
copy. Relays should receive a proof bound to the approved recipient and fee,
never the deposit secret. A trusted local pool pin and independent approval are
required; caller-supplied matching values are not proof of either.

Six synthetic tests and ten deliberate guard alterations are recorded in
[verification](../integrations/tornado-withdrawal-verification.json). This is an
adapter boundary check, not a contract/circuit audit or a live withdrawal.

## Recovery and visibility

Persist authorization before delivery. Treat carrier storage, recipient receipt,
submission and settlement as different states. An expired request does not free
reserved funds. Reconcile ambiguous submission before retrying; never replace a
private path with a public one to clear a queue. Social identities must not be
inserted into public memos or transaction metadata.

The next integration steps are a reviewed pool/prover registry and encrypted note
storage for Tornado, bounded native approval for Zcash, then recipient-specific
encrypted handoff with durable submission/recovery evidence. These are current
integration requirements, not completed product capabilities.
