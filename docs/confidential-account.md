# Confidential account reads

The [account adapter](../integrations/intents-account.mjs) authenticates an existing
EVM signing key through 1Click and reads the account's private balances. Wallet
now offers this under **Wallet account / Private balances**, also reachable from
the Tokens tab. Connecting the external wallet still needs no signature.
**Sign in to read** asks separately for the empty ownership message.

An EVM account uses its lowercase address as its Confidential Intents account ID.
`connect()` obtains the current nonce salt, creates a short-lived empty intent,
and asks the supplied wallet to sign that exact string. The adapter independently
recovers the EVM signer before sending an ERC-191 authentication request. The
message contains no token actions. Partner credentials are not used for user
authentication or private balance reads.

The browser and server entry points use the same adapter. The browser contacts
the pinned NEAR salt RPC and 1Click directly; the Lenz server does not receive
user authentication tokens. No new private-account HTTP route is exposed.

The adapter exposes four operations:

| Operation | Result |
| --- | --- |
| `connect()` | Explicit ownership authentication; returns account ID and session expiry. |
| `readBalances()` | Private token quantities as exact integer strings, with observation time and evidence scope. |
| `receivingAccount()` | The authenticated account ID for preparing a confidential receiving quote. |
| `disconnect()` | Clears in-memory credentials, aborts requests and invalidates late results. |

Access and refresh tokens remain in the adapter's closure and are never returned
by these operations. Expired access can refresh during an explicit balance read;
expired refresh authority requires another explicit sign-in. Rejected credentials
are cleared. Requests reject redirects and oversized responses. Concurrent
operations cannot open multiple wallet prompts; delayed signatures and results
cannot revive a disconnected session.

Restoring access to the same external wallet permits fresh authentication to the
same account. A new adapter instance does not import tokens, cached balances or
offline authority. The adapter does not restore a lost wallet key, revoke a stolen
key or an already issued remote session, or resolve competing financial claims.
Disconnect clears the local session only. Production wallet recovery and device
migration remain separate work.

Private balances are authenticated provider observations. They do not prove
settlement independently or create spendable offline funds. The same account can
prepare a `CONFIDENTIAL_INTENTS` receiving dry quote through the
[receiving adapter](../integrations/intents-receive.mjs). Quotes still require the
partner key and exact asset, amount, refund and confidentiality checks. A dry
quote cannot allocate a deposit or execute a transfer.

The November 9 disposable live check authenticated an unfunded EVM account, read
its empty private balance, authenticated again with the same key and a fresh
nonce, and verified an advanced same-asset ETH receiving dry quote. The quote
passed exact terms and provider-signature checks. No funding, wallet transaction,
deposit creation or private settlement was tested. SDK 0.1.26 excludes the
`confidentiality` field from its signature; the separate HTTPS echo check remains
necessary and does not establish the provider's privacy guarantees.

The UI shows exact quantities matched by token ID to the asset catalogue. If
metadata is unavailable, it labels the unformatted integer as base units. These
balances stay separate from wallet totals and offline tUSD. Hide balances also
masks private amounts. Failed reads clear the previous observation. Account or
network changes, sign-out, offline events and page exit clear the session and
discard pending results; reopening requires an explicit sign-in.

Run the local behavioral checks with:

```powershell
node --test integrations/intents-account.test.mjs integrations/intents-auth-payload.test.mjs integrations/intents-receive.test.mjs integrations/quotes.test.mjs web/intents-wallet.test.mjs web/evm-wallet.test.mjs
node web/intents-account-browser.test.cjs
```

The tests use disposable keys, independent ethers signature verification and
local HTTP redirect servers. They cover ownership substitution, malformed and
expired sessions, disconnect races, duplicate requests, balance validation,
credential exposure and same-key reauthentication. Live tests and secret storage
remain outside the product repository. The browser test uses disposable Edge
contexts and fixtures for wallet signing and provider replies; it does not
establish installed-wallet compatibility or a funded private settlement journey.

Interfaces follow the official [user authentication guide](https://docs.near-intents.org/api-reference/user-auth/authenticate-user-with-signed-data),
[OpenAPI specification](https://1click.chaindefuser.com/docs/v0/openapi.yaml) and
[confidential swap guide](https://docs.near-intents.org/integration/distribution-channels/1click-api/quickstart/confidential-swaps).
FAR is a permissioned private NEAR instance; public-chain evidence alone cannot
prove the recipient's private balance or the complete settlement path.
