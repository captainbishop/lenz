# External testnet signing

The normal wallet uses plain actions and outcomes. Raw packet import and deposit-action export live at `/swap-tools.html`, outside product navigation. `/wallet-lab.html` is a separate developer entry point for the current external signer experiment. Both retain the same browser identity and encrypted vault; neither creates a new Lenz account.

## Provider decision

The actual [MyNearWallet testnet site](https://testnet.mynearwallet.com) displayed its retirement notice: planned deprecation **October 31, 2026**. The lab now uses a Lenz-owned Meteor popup adapter. External wallet controls remain hidden from `/money.html` until a supported provider completes real testnet approval and final-backing verification. See [provider-status.json](provider-status.json).

The real Meteor testnet connection page returned **HTTP 403**, with “Sorry, you have been blocked” from its security service, in a fresh Edge context. [Read-only result](meteor-page-results.json). No account was created, key imported or transaction approved. Do not bypass the block or treat fixture success as provider availability.

## Pinned lab implementation

- `near-api-js` **7.4.0** provides official NEAR transaction encoding; npm integrity and transitive versions are pinned in `package-lock.json`.
- The current [npm audit](dependency-audit.json) reports zero vulnerabilities. It covers installed package advisories, not a security review of Lenz or Meteor's hosted application.
- `esbuild` **0.28.2**, development only. Install with `npm ci --ignore-scripts` from this directory, then run `node web/near-connector/build.mjs` from the repository root.
- `meteor-popup.js` implements the inspected web protocol from **@meteorwallet/sdk 3.24.0**. [Source excerpts, package integrity and source hash](meteor-protocol-evidence.json) are provided. The inspected **upstream Meteor SDK** Git revision is `e0a7d48a07d1a02e69921aa6624f0f7a1f3f3ddf`; its correspondence to the npm package revision is unverified.
- No generic connector, extension/mobile bridge, remote manifest, executor or automatic connection runs. The full Meteor SDK was inspected and then removed, along with NEAR Connect. Its historical [dependency audit](meteor-dependency-audit.json) had 13 package findings, including two high. It is not shipped by this adapter.
- Only `https://wallet.meteorwallet.app/connect/testnet/login` and `/sign` open. Login sends `{methods:[]}` without a delegated key or contract permission. Every reply must match the expected origin, popup WindowProxy and random request UID. Mismatching network/action fields are ignored when present. Timeout, closure, cancellation and preparation failures clean up listeners and pending work.
- The popup opens before awaiting the block lookup. Sign inputs use one base64 Borsh transaction, a fresh unsigned placeholder public key, nonce zero and a final block hash; Meteor is expected to fill its key and nonce, as the inspected SDK does. This compatibility still needs live approval. Page query strings/fragments are not forwarded.
- Selection is only an account label, not authentication. Only named `.testnet` accounts are accepted. Storage uses `lenz-meteor-testnet-v1:accountId`; disconnect removes this label and cancels pending connection work. It does not erase the Lenz identity/vault or old provider metadata.
- `build.mjs` records [bundle hashes](build-results.json). NEAR's flat entry imports an unused Node-only Contract ABI validator; the build marks only that unused import as removable and rejects any remaining external runtime import. The browser suite decodes the actual produced transaction using the official SDK. Bundled license notices are retained.

## Money boundary

`near-signer.js` binds a request to the original Lenz owner, the refunded order, exact amount, payer, source, reserve and testnet. It emits one `deposit_offline` call with 50 Tgas and 0.03 test NEAR. A mismatching connected account cannot reach signing. The encrypted request commits before the wallet opens. No private NEAR wallet key is imported into Lenz.

The popup result is only a hint to check the chain. A callback query, transaction hash or wallet success message cannot add balance. `/api/rhea/deposit-check` and `acceptDepositResult` verify the exact final root and its consumed state. Cancellation, a lost response, disconnect and reload retain the request. Repeated confirmation cannot add another root or revive an already spent note. The existing public RPC/relay and upgradable test contracts remain trust boundaries.

## Verification

Run `node --test web/meteor-popup.test.mjs web/near-signer.test.mjs web/near-deposit.test.mjs` from the repository root. Also run `node web/meteor-popup-mutations.mjs` and `node web/near-signer-mutations.mjs`. Three removed message checks and three removed monetary checks are detected in independent copies. Tests cover forged origins/sources/UIDs, stale replies, timeout/closure, reconnect, failed preparation, invalid accounts, bounded actions and disconnect preservation.

`web/near-signer-browser.test.cjs` runs the **actual Meteor adapter bundle, popup bridge and Borsh serialization** in isolated Edge. Eight checks cover callback forgery, permission-free testnet login, storage failure, cancellation, wrong account, false/mismatched success, one-credit final confirmation and offline reload. Wallet, RPC and chain responses are **fixtures**. There is no live external-wallet signature or transaction claim. The normal wallet and developer file tools have separate browser checks in `web/rhea-wallet-browser.test.cjs`.

Use locally installed Playwright through `NODE_PATH` and an installed Edge browser. Do not run the live suites merely as health checks; they spend disposable test funds. No mainnet funds or user browser identity may be used.

[Latest verification record](verification-results.json): 41 Node tests, 26 browser checks across four suites, six detected guard mutations, 39 static cache routes and matching source/bundle hashes. Current cache is `proof-u-chat-v15-meteor-lab`. The read-only `check-provider.cjs` records website availability with bounded navigation timeouts; non-OK HTTP status is a failed check, even when an error page renders.
