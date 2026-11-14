// Sepolia deployment; readers verify these pins at a finalized canonical block.
export const LENDING_DEPLOYMENT=Object.freeze({
  "lendingFactory": "0xb1127e6416ce6a875361b68c838c46ccabf956ff",
  "privacyPool": "0xdf45f28484715decbb66d77ed17c2b24ecf6d178",
  "supplyFactory": "0xf783835738efc0eb399064989f93484b7a0a6bae",
  "verifier": "0x016ceabfe63371b99b3f6ccde6f65aeefda286aa",
  "hasher": "0x29514a0c8c3688fde3f86fbcdba9c84349e164f5",
  "codeHashes": {
    "pool": "0xdfd31513a60cc252ec0bbcf0e7bdb7f9ba35fab80c1bb9ce0543436b8fe92e49",
    "provider": "0x22818496ed85629596372dcbe81fbc48c729489bdf829e198040b0f06fc4f58f",
    "aLink": "0xa8b85381059dc0fc47ae9cfd0d78fd81e0d0ef2fb09c34d3ad6f60a758d8c3e3",
    "variableDebt": "0xa8b85381059dc0fc47ae9cfd0d78fd81e0d0ef2fb09c34d3ad6f60a758d8c3e3",
    "oracle": "0xe740a209b3882eb2fdfc2a9460d6450551263d42fc3e4345edb9f29fc15086b2",
    "usdc": "0xada27a4287f9171a4d23a4d5977c9a583d718906f6aa2d6d7f24739c397306f2",
    "link": "0xada27a4287f9171a4d23a4d5977c9a583d718906f6aa2d6d7f24739c397306f2",
    "dataProvider": "0x5552c8e4891dea570be0b005c748391f31321248f4d178cf0f93d3cc8da49fb1",
    "faucet": "0xdbd77aed04a5a463268b1d9e0c2ba31f6701709204c59b07adfdc8e16356db7a",
    "verifier": "0x43c2be3ed607b3db51ff8fa6f9d8c0e308c61f2c3c2f25747a6314aa5e917576",
    "hasher": "0x2769e338c9d60a078ef05dd9e03f5fa3e1df133f7da4494c5bcc83a71a9a9892",
    "privacyPool": "0x34ebe616fb49b52ee454cb114aa29798f160ef090fd68d079e3316cc3986c796",
    "lendingFactory": "0xa1a97a2116c9d0431d635327bbe04179477aa03f4df9e57d3502ae4f45fda1c3",
    "supplyFactory": "0x4b6362d76f6b51e8554e96f72758d47838dc27bca7570428f73d3832ffe6861c"
  },
  "implementationPins": {
    "aLink": {
      "address": "0x48424f2779be0f03cdf6f02e17a591a9bf7af89f",
      "codeHash": "0x6d4978b4862ad22d5903db41a2f09a1a783053c12d8936fa7a63ed915aef008b"
    },
    "variableDebt": {
      "address": "0x54bde009156053108e73e2401aea755e38f92098",
      "codeHash": "0xff155988f35017b43353df09a63fe7fdd13bfcbdf63fb2e72a7901146e17b98f"
    },
    "pool": {
      "address": "0x0562453c3dafbb5e625483af58f4e6d668c44e19",
      "codeHash": "0xfa3f8bcf3d5586c4d0c75d10df13d423be33194906d140aa048da0f7a72fd30d"
    }
  },
  "privacyPoolDeploymentBlock": "12133481"
});
