# Local QR dependencies

`qrcode-generator` 1.4.4 by Kazuhiko Arase (MIT) generates QR modules.
`jsqr` 1.4.0 by Cozmo (Apache-2.0) reads image pixels.
Their original copyright headers are preserved; the jsQR license is included.

Rebuild from the locked npm packages:

```powershell
cd web/qr-tools
npm ci --ignore-scripts --no-audit --no-fund
node build.mjs
```

The wrapper only isolates CommonJS exports and adds an ES-module default export.
Runtime imports use these local files and work from the offline cache. No CDN,
remote QR service, tracking, or camera frame upload is used.
