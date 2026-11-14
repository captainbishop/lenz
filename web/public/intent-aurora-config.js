const tokenCode='30d4ac7f4aa6b99c61d9e7e2cc15ad1104f624164ffbf944cd560aae71ad2ce3';
export const AURORA_INTENT_DEPLOYMENT=Object.freeze({
 network:'Aurora testnet',chainId:1313161555,chainHex:'0x4e454153',rpc:'https://testnet.aurora.dev',routeId:'aurora-original-pool-fixed-swap',
 inputToken:'0xafa88fe18a46dda58e79d8f89abda51c13411590',outputToken:'0x68884014da20174e79f9e7b06466f3a7c6085b09',
 pool:'0x0ff2408b29c276f141bfb553f42d0ffadf7ef736',adapter:'0x31c24c2a2ae6e208f2e1dd2bccf82043ac05f172',factory:'0x410b2ba41260520f70f4146150a718569b80e1f9',
 verifier:'0xf6b7f6c0ef8101d0be7fee00dd07a1aeeaee1395',hasher:'0x459fd11110ec8567662424ccbbf7afdd67c15fee',
 decimals:6,denomination:'1000000',outputAmount:'2000000',levels:20,sourceSha256:'c8ef140a2d5804446c2f97f62828ef750683a3b98665e8abde551e476aa21eab',
 codeSha256:Object.freeze({input:tokenCode,output:tokenCode,pool:'0dc72248da9eead2dabf605727010a774b8e3f96bef94f87b9270a0a8fca6aeb',adapter:'53625bcd07861c4a49ab599f449aa0188931f3abb151926f9613cf2dc1a0ae9b',factory:'c8e6878418a1f1eb8d4bf230ef5b76d172308f541f9a552efd97d6ecfb6f9e62',verifier:'01e6d1f75cb4a605cc92182430d4e3c2723b506468644e63bc983b414fb7e5c6',hasher:'e3e417a1bb6c4ef6a507c3bc67422eef85e4e27f7d4451934954bed0f8d1e6b5'}),
});
export const AURORA_INTENT_UNAVAILABLE='Original pool funding needs a verified high-gas submission path. The current browser wallet cannot provide a raw signed transaction for that path.';
export const AURORA_INTENT_PRIVACY='The original proof hides which pool commitment is spent. Beneficiary, refund address, fixed denomination and swap terms are public. Wallet, RPC and network observations can still correlate activity.';
