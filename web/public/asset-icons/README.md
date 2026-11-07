# Asset artwork

Except for Solana, the SVG files directly in this directory are from [Cryptocurrency Icons](https://github.com/spothq/cryptocurrency-icons), distributed under CC0 1.0; see LICENSE.md. Logos identify assets and are not endorsements or token verification.

`sol.svg` is the unmodified gradient logomark from the [Solana Foundation's website source](https://github.com/solana-foundation/solana-com/blob/main/apps/web/public/src/img/branding/solanaLogoMark.svg), retrieved November 5, 2026 (Git blob `ed6f34d95f7e0f951105cbaed72e9bd6587bc509`). It follows the [Solana brand guidelines](https://solana.com/branding), is displayed with clear space on black, and is not covered by the CC0 license above.

Known contract mappings select bundled artwork. Market images use bounded HTTPS source URLs supplied with the exact chain/token listing. Unknown or unavailable images display an identity-derived monogram. A matching ticker alone does not identify an imported contract.

The `perps/` artwork covers the 235 instruments in the checked Hyperliquid catalogue, including delisted entries. Most comes from [Hyperliquid](https://app.hyperliquid.xyz/). Scaled instruments use the underlying token logo. Larger source images are rendered to 96-pixel WebP files for compact offline storage.

Four supplementary project logos come from CoinGecko: [Canto](https://www.coingecko.com/en/coins/canto), [ConstitutionDAO](https://www.coingecko.com/en/coins/constitutiondao), [Myro](https://www.coingecko.com/en/coins/myro) and [Hamster Kombat](https://www.coingecko.com/en/coins/hamster-kombat). These are display mappings for named perpetual instruments; they do not map a migrated token contract or authorize transfers.

The `perps/` artwork is not covered by the CC0 license above; token names and marks belong to their respective projects. Newly listed instruments require a reviewed artwork entry. Unavailable imagery retains a monogram rather than substituting another asset's logo.

The `hyperliquid/` WebP files restore spot and builder-market artwork from the [Hyperliquid app](https://app.hyperliquid.xyz/). The app’s [configuration module](https://app.hyperliquid.xyz/assets/config-BOv79UVk.js) resolves spot artwork by mainnet base-token index and explicit aliases, and builder artwork by the full venue-qualified coin. `hyperliquid-artwork.js` binds each local image to the checked market coin and name. Files were rendered to 96-pixel lossless WebP on November 7, 2026; source SVG markup is not served. These project marks are not covered by the CC0 licence above. Unavailable or unsupported artwork keeps a fallback.
