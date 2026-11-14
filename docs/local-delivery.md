# Local web delivery

`web/local-delivery.mjs` serves the Lenz web app from a nearby laptop or community host. A person can join its local Wi-Fi and receive the app without internet access. The browser needs a normal trusted HTTPS origin for this local-network route.

This is an optional distribution service. The current submission does not depend on it. Android first-use delivery through a real hotspot, certificate and local DNS remains to be demonstrated.

## Operator setup

Use Node.js 24 or newer and an approved `web/public` package. The delivery server copies supported public files into memory at startup. It serves those bytes until restarted, even if files on disk change.

The operator needs an existing controlled domain, a matching browser-trusted TLS certificate with its full chain, and a local DNS answer that points the domain to the host's LAN address. The recipient opens the domain name, rather than replacing it with an IP address. A QR code can carry this address; it cannot configure DNS or browser trust.

Keep the certificate private key outside both the repository and the public package. Each serving origin should be dedicated to Lenz. Use the same origin on return visits so the browser retains the same account. Opening a different distributor's domain creates a separate browser-storage boundary.

From the repository root, configure the supplied operator files:

```powershell
$env:LENZ_DELIVERY_ORIGIN='https://your-controlled-domain.example:8443'
$env:LENZ_DELIVERY_BIND='0.0.0.0'
$env:LENZ_DELIVERY_CERT='C:\Lenz-operator\fullchain.pem'
$env:LENZ_DELIVERY_KEY='C:\Lenz-operator\private-key.pem'
node web/local-delivery.mjs
```

Replace the example domain and paths with existing operator resources. The server checks certificate hostname, validity dates and key matching. The recipient's browser must independently trust the certificate chain. Do not distribute a shared TLS private key, install an extra root CA, or bypass a certificate warning.

`LENZ_DELIVERY_ROOT` can select another approved static public directory. Its default is `web/public`, relative to the server module. HTTP is permitted only for a loopback development check:

```powershell
$env:LENZ_DELIVERY_ORIGIN='http://127.0.0.1:4187'
$env:LENZ_DELIVERY_BIND='127.0.0.1'
$env:LENZ_DELIVERY_CERT=$null
$env:LENZ_DELIVERY_KEY=$null
node web/local-delivery.mjs
```

That loopback check does not establish phone distribution over a LAN.

## Service boundary

Only `GET` and `HEAD` serve public app files. The listener accepts its exact configured host and port, rejects linked directories and traversal paths, and uses a content policy that permits requests only to its own origin. It does not forward requests to an internet server. `/api/*` returns an explicit unavailable response, including financial and account-service requests.

The public NEAR/Rhea configuration describes the existing testnet route. It does not provide a connected backend on this host. The newcomer can create a local identity and receive existing encrypted items; execution and checked results require the separately configured courier/executor path. A stored courier receipt does not confirm settlement.

TLS identifies the domain operator. A hash manifest produced by the server describes the selected package; it does not independently prove that an arbitrary distributor serves the official or newest release. Use an explicitly trusted distributor for this prototype.

## Verification

```powershell
node --test web/local-delivery.test.mjs
```

The tests cover frozen public bytes, exact-origin access, read-only requests, blocked APIs, traversal and link rejection, and actual HTTPS with disposable test certificates. On Windows the TLS fixture uses Git's OpenSSL; `LENZ_TEST_OPENSSL` can select another installed executable. Its certificate is trusted only by the isolated Node test client, so it does not establish ordinary browser trust or physical phone behavior.
