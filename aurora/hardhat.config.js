import { createRequire } from 'node:module';
import { defineConfig } from 'hardhat/config';
import hardhatEthers from '@nomicfoundation/hardhat-ethers';

const require = createRequire(import.meta.url);

export default defineConfig({
  plugins: [hardhatEthers],
  solidity: {
    version: '0.8.38',
    path: require.resolve('solc/soljson.js'),
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris' },
  },
  networks: {
    local: { type: 'edr-simulated', chainType: 'generic' },
    auroraTestnet: {
      type: 'http',
      chainType: 'generic',
      url: 'https://testnet.aurora.dev',
      chainId: 1313161555,
      accounts: [],
    },
  },
});
