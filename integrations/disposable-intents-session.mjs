// An unfunded identity for dry API tests only. Neither keys nor session tokens are saved.
import { generateKeyPairSync, sign, verify } from 'node:crypto';
import assert from 'node:assert/strict';
import { base58 } from '@scure/base';
import { emptyAuthenticationPayload, fetchAuthenticationSalt } from './intents-auth-payload.mjs';
import { intentsAuthenticate } from './intents.mjs';
export async function disposableIntentsSession({fetcher=fetch,now}={}) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey.export({ type: 'spki', format: 'der' }).subarray(-32);
  const address = raw.toString('hex');
  const salt=await fetchAuthenticationSalt({fetcher});
  const payload=JSON.stringify(emptyAuthenticationPayload({signerId:address,salt,now}));
  assert.deepEqual(JSON.parse(payload).intents, []);
  const signature = sign(null, Buffer.from(payload), privateKey);
  assert(verify(null, Buffer.from(payload), publicKey, signature));
  const auth = await intentsAuthenticate({ standard: 'raw_ed25519', payload,
    public_key: 'ed25519:' + base58.encode(raw), signature: 'ed25519:' + base58.encode(signature) },{fetcher,now});
  return { address, sessionToken: auth.accessToken, expiresIn: auth.expiresIn };
}
