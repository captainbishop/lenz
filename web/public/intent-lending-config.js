// Aave address-book b8c801a413c4b934afaf7976d2ddc5fbada6dce6, AaveV3Sepolia.
export const LENDING_TESTNET=Object.freeze({
 network:'Sepolia testnet',chainId:11155111,chainHex:'0xaa36a7',chain:'eip155:11155111',
 rpc:'https://ethereum-sepolia-rpc.publicnode.com',
 pool:'0x6ae43d3271ff6888e7fc43fd7321a503ff738951',
 provider:'0x012bac54348c0e635dcac9d5fb99f06f24136c9a',
 dataProvider:'0x3e9708d80f7b3e43118013075f7e95ce3ab31f31',
 oracle:'0x2da88497588bf89281816106c7259e31af45a663',
 faucet:'0xc959483dba39aa9e78757139af0e9a2edeb3f42d',
 link:'0xf8fb3713d459d7c1018bd0a49d19b4c44290ebe5',linkDecimals:18,
 usdc:'0x94a9d9ac8a22534e3faca9f4e7f2e2cf85d5e4c8',usdcDecimals:6,
 aLink:'0x3ffaf50d4f4e96eb78f2407c090b72e86ecaed24',
 variableDebt:'0x36b5de936ef1710e1d22eabe5231b28581a92ecc',
 denomination:'1000000000000000000',
 lendingFactory:null,privacyPool:null,supplyFactory:null,verifier:null,hasher:null,
 codeHashes:Object.freeze({}),implementationPins:Object.freeze({}),
});
export const LENDING_PRIVACY='The original withdrawal proof hides which pool deposit is spent. The lending account, collateral, debt, amounts and protocol actions are public. Lenz, RPC and network providers may correlate activity; a small pool offers limited anonymity.';
