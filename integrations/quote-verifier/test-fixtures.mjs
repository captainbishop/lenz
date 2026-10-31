// Test-only keys. No account, balance, authentication or network request.
import { generateKeyPairSync, sign } from 'node:crypto';
import { base58 } from '@scure/base';
import { quoteHash, verifyQuoteSignature } from '@defuse-protocol/one-click-sdk-typescript';
const pair = generateKeyPairSync('ed25519');
export const testPublicKey = 'ed25519:' + base58.encode(pair.publicKey.export({type:'spki',format:'der'}).subarray(-32));
export const verifyTestSignature = response => verifyQuoteSignature(response, testPublicKey);
export function signTestQuote(response) {
  response.timestamp ??= new Date().toISOString();
  response.signature = 'ed25519:' + base58.encode(sign(null, Buffer.from(quoteHash(response)), pair.privateKey));
  return response;
}
