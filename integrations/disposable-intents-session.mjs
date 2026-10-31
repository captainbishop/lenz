// An unfunded identity for dry API tests only. Neither keys nor session tokens are saved.
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { base58 } from '@scure/base';
// SDK 0.93.0's ESM entry has an extensionless near-api-js import. Use its supported CJS entry.
const { IntentsSDK, VersionedNonceBuilder } = createRequire(import.meta.url)('@defuse-protocol/intents-sdk');
import { intentsAuthenticate } from './intents.mjs';
export async function disposableIntentsSession() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const address = raw.toString('hex');
  const sdk = new IntentsSDK({ env: 'production', referral: 'lenz-development' });
  const payload = JSON.stringify(await sdk.intentBuilder().setSigner(address)
    .setDeadline(new Date(Date.now() + 4 * 60000))
    .setNonceRandomBytes(VersionedNonceBuilder.createTimestampedNonceBytes(new Date())).build());
  assert.deepEqual(JSON.parse(payload).intents, []);
  const signature = sign(null, Buffer.from(payload), privateKey);
  assert(verify(null, Buffer.from(payload), publicKey, signature));
  const auth = await intentsAuthenticate({ standard: 'raw_ed25519', payload,
    public_key: 'ed25519:' + base58.encode(raw), signature: 'ed25519:' + base58.encode(signature) });
  return { address, sessionToken: auth.accessToken, expiresIn: auth.expiresIn };
}
