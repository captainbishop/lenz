# Chart renderer

TradingView Lightweight Charts 5.2.1 is copied without modification from its
pinned npm package. Its standalone module includes fancy-canvas. Package
integrities are locked in [package-lock.json](../../chart-tools/package-lock.json);
output hashes are in [build.json](build.json).

```powershell
cd web/chart-tools
npm ci --ignore-scripts --no-audit --no-fund
node build.mjs
```

The Apache license and upstream attribution notice are retained. The bundled
fancy-canvas MIT license was retrieved from its official repository's master
branch because its npm package omits the license file. Source:
[fancy-canvas license](https://github.com/tradingview/fancy-canvas/blob/master/LICENSE).
The notice comes from [Lightweight Charts v5.2.1](https://github.com/tradingview/lightweight-charts/blob/v5.2.1/NOTICE).
Chart credits and the TradingView link are available in the Markets footer.

The module is served locally and cached for offline use. It does not fetch
market data. Lenz supplies validated prices and public trade observations.
