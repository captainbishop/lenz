// Independent encoding check against the already pinned NEAR SDK.
import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {encodeBase58} from 'ethers';
import {fixture} from './engine-submission-fixtures.mjs';
import {validateSignedEngineCall} from './engine-signed.mjs';
const require=createRequire(new URL('../contracts/package.json',import.meta.url));
const sdk=require('near-api-js');
test('near-api-js 7.4.0 independently decodes and re-encodes the exact signed Engine call',()=>{
  const f=fixture(),bytes=Buffer.from(f.signedTxBase64,'base64'),decoded=sdk.decodeSignedTransaction(bytes);
  assert.equal(decoded.transaction.signerId,f.reference.sender);
  assert.equal(decoded.transaction.receiverId,'aurora');
  assert.equal(decoded.transaction.actions.length,1);
  assert.equal(decoded.transaction.actions[0].functionCall.methodName,'call');
  assert.equal(decoded.transaction.actions[0].functionCall.gas,BigInt(f.reference.gas));
  assert.deepEqual(Buffer.from(sdk.encodeTransaction(decoded)),bytes);
  const digest=createHash('sha256').update(sdk.encodeTransaction(decoded.transaction)).digest(),hash=encodeBase58(digest);
  assert(decoded.transaction.publicKey.verify(digest,Uint8Array.from(decoded.signature.ed25519Signature.data)));
  const changed=Buffer.from(digest);changed[0]^=1;assert.equal(decoded.transaction.publicKey.verify(changed,Uint8Array.from(decoded.signature.ed25519Signature.data)),false);
  assert.equal(hash,f.reference.txHash);assert.equal(validateSignedEngineCall(f.reference,f.signedTxBase64).reference.txHash,hash);
});
