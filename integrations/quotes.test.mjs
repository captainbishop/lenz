import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { rheaQuote, RHEA } from './rhea.mjs';
import { intentsPreview, intentsTokens, intentsAuthenticate } from './intents.mjs';
import { signTestQuote, testPublicKey, verifyTestSignature } from './quote-verifier/test-fixtures.mjs';
import { verifyQuoteSignature } from './quote-verifier/index.mjs';
const ok = result => ({ ok: true, json: async () => result });
const rheaInput = () => ({ network: 'testnet', contract: RHEA.contract, poolId: 0, tokenIn: 'wrap.testnet', tokenOut: 'coin.testnet', amountIn: '1000000000000000000000000', slippageBps: 50 });
function rheaFetch(change = v => v) {
  return async (_, opts) => {
    const q = JSON.parse(opts.body);
    if (q.method === 'status') return ok({ result: change({ chain_id: 'testnet' }) });
    if (q.params.request_type === 'view_account') return ok({ result: { block_hash: 'final-block', code_hash: 'code-hash', block_height: 123 } });
    assert.equal(q.params.block_id, 'final-block');
    const value = q.params.method_name === 'get_pool'
      ? { pool_kind: 'SIMPLE_POOL', token_account_ids: ['wrap.testnet', 'coin.testnet'], amounts: ['100', '200'] } : '20000';
    return ok({ result: change({ block_hash: 'final-block', result: [...Buffer.from(JSON.stringify(change(value)))] }) });
  };
}
const intentInput = () => ({ network: 'mainnet', dry: true, swapType: 'EXACT_INPUT', originAsset: 'nep141:wrap.near', destinationAsset: 'nep141:coin.near',
  amount: '1000000000000000000000000', slippageTolerance: 50, recipient: 'receiver.near', refundTo: 'sender.near',
  deadline: '2030-01-01T00:00:00.000Z', confidentiality: 'basic' });
const intentFetch = (change = v => v) => async (_, options) => {
  const quoteRequest = JSON.parse(options.body);
  assert.equal(quoteRequest.dry, true);
  return ok(change(signTestQuote({ quoteRequest, quote: { amountIn: quoteRequest.amount, amountOut: '10000', minAmountOut: '9950' } })));
};
test('Rhea quote pins all reads to a final block and uses integer slippage', async () => {
  const result = await rheaQuote(rheaInput(), { fetcher: rheaFetch() });
  assert.equal(result.minAmountOut, '19900'); assert.equal(result.blockHash, 'final-block'); assert.equal(result.state, 'quote');
});
test('Rhea rejects wrong network, empty liquidity, swapped assets and mixed blocks', async () => {
  await assert.rejects(rheaQuote(rheaInput(), { fetcher: rheaFetch(v => v?.chain_id ? { chain_id: 'mainnet' } : v) }), /wrong network/);
  await assert.rejects(rheaQuote(rheaInput(), { fetcher: rheaFetch(v => v?.amounts ? { ...v, amounts: ['0', '200'] } : v) }), /liquidity/);
  await assert.rejects(rheaQuote({ ...rheaInput(), tokenOut: 'other.testnet' }, { fetcher: rheaFetch() }), /absent/);
  await assert.rejects(rheaQuote(rheaInput(), { fetcher: rheaFetch(v => v?.result ? { ...v, block_hash: 'other-block' } : v) }), /different blocks/);
});
test('Rhea snapshots caller input before awaiting the network', async () => {
  const input = rheaInput(), fake = rheaFetch();
  const result = await rheaQuote(input, { fetcher: async (...args) => { input.amountIn = '999'; return fake(...args); } });
  assert.equal(result.request.amountIn, '1000000000000000000000000');
});
test('Intents preview preserves recipient, refund, confidentiality and minimum output', async () => {
  const result = await intentsPreview(intentInput(), { fetcher: intentFetch(), verifySignature: verifyTestSignature });
  assert.equal(result.response.quote.minAmountOut, '9950'); assert.equal(result.state, 'quote');
  assert.equal(result.verification.signature, 'verified');
});
test('Intents rejects changed request fields and confidentiality downgrade', async () => {
  for (const key of ['originAsset', 'destinationAsset', 'recipient', 'refundTo', 'amount', 'deadline', 'confidentiality', 'depositType']) {
    await assert.rejects(intentsPreview(intentInput(), { fetcher: intentFetch(v => { v.quoteRequest[key] = 'changed'; return v; }) }), new RegExp(`changed ${key}`));
  }
});
test('Intents rejects allocated deposits, inflated input and weak minimum output', async () => {
  for (const patch of [{ depositAddress: 'unexpected' }, { amountIn: '1' }, { minAmountOut: '1' }, { minAmountOut: '10001' }]) {
    await assert.rejects(intentsPreview(intentInput(), { fetcher: intentFetch(v => { Object.assign(v.quote, patch); return v; }) }));
  }
});
test('Invalid amounts, expired quotes and testnet/mainnet confusion fail before RPC', async () => {
  const noNetwork = async () => { assert.fail('Unexpected network request'); };
  for (const patch of [{ network: 'testnet' }, { dry: false }, { amount: 1 }, { amount: '0' }, { amount: '1e6' }, { deadline: '2020-01-01' }, { confidentiality: undefined }]) {
    await assert.rejects(intentsPreview({ ...intentInput(), ...patch }, { fetcher: noNetwork }));
  }
  for (const patch of [{ network: 'mainnet' }, { amountIn: '1.2' }, { amountIn: '0' }, { slippageBps: 10000 }]) {
    await assert.rejects(rheaQuote({ ...rheaInput(), ...patch }, { fetcher: noNetwork }));
  }
});
test('HTTP failures and malformed token lists do not become quotes', async () => {
  await assert.rejects(intentsTokens({ fetcher: async () => ({ ok: false, status: 401 }) }), /HTTP 401/);
  await assert.rejects(intentsTokens({ fetcher: async () => ok([{ assetId: 'x', blockchain: 'near', decimals: -1 }]) }), /token list/);
});
test('Intents passes partner credentials only as a request header, never into returned evidence', async () => {
  const fake=intentFetch();
  const result=await intentsPreview(intentInput(),{apiKey:'test-partner-secret',verifySignature:verifyTestSignature,fetcher:async(url,options)=>{
    assert.equal(options.headers['X-API-Key'],'test-partner-secret');return fake(url,options);
  }});
  assert(!JSON.stringify(result).includes('test-partner-secret'));
});

test('Intents refuses redirects before partner credentials reach another origin', async () => {
  const leaked = [];
  const destination = createServer((request, response) => {
    leaked.push(request.headers['x-api-key']);
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end('[]');
  });
  const redirect = createServer((request, response) => {
    request.resume();
    response.writeHead(307, { location: `http://127.0.0.1:${destination.address().port}/capture` });
    response.end();
  });
  try {
    destination.listen(0, '127.0.0.1'); await once(destination, 'listening');
    redirect.listen(0, '127.0.0.1'); await once(redirect, 'listening');
    const fetcher = (_, options) => fetch(`http://127.0.0.1:${redirect.address().port}/redirect`, options);
    for (const check of [
      () => intentsTokens({ apiKey: 'disposable-partner-key', fetcher }),
      () => intentsPreview(intentInput(), { apiKey: 'disposable-partner-key', fetcher }),
    ]) {
      const result = await check().then(() => ({ rejected: false }), () => ({ rejected: true }));
      assert.deepEqual(leaked, [], 'A redirected request exposed the partner key');
      assert.equal(result.rejected, true, 'Redirected API responses must be rejected');
    }
  } finally {
    await Promise.all([redirect, destination].map(server => new Promise(resolve => {
      server.closeAllConnections(); server.close(resolve);
    })));
  }
});
test('Intents rejects missing or forged signatures and altered signed output',async()=>{
  for(const change of [v=>{delete v.signature;return v;},v=>({...v,signature:'ed25519:bad'}),v=>({...v,quote:{...v.quote,amountOut:'9999'}})]){
    await assert.rejects(intentsPreview(intentInput(),{fetcher:intentFetch(change),verifySignature:verifyTestSignature}),/Invalid 1Click quote signature/);
  }
  // A valid signature under an attacker-chosen key cannot replace the SDK key.
  await assert.rejects(intentsPreview(intentInput(),{fetcher:intentFetch(v=>({...v,publicKey:testPublicKey,managerPublicKey:testPublicKey}))}),/Invalid 1Click quote signature/);
});
test('signed stale, future and absent timestamps are rejected',async()=>{
  const now=Date.now();
  for(const timestamp of [new Date(now-300001).toISOString(),new Date(now+30001).toISOString(),undefined,'bad']){
    await assert.rejects(intentsPreview(intentInput(),{now,fetcher:intentFetch(v=>{v.timestamp=timestamp;if(timestamp)signTestQuote(v);return v;}),verifySignature:verifyTestSignature}),/timestamp/);
  }
});
test('SDK signature covers signed terms but excludes confidentiality; local echo checks still enforce the request',async()=>{
  const fetcher=intentFetch(),response=await(await fetcher('',{body:JSON.stringify(intentInput())})).json();
  assert.equal(verifyTestSignature(response),true);assert.equal(verifyQuoteSignature(response),false);
  for(const key of ['recipient','refundTo','amount','deadline']){const changed=structuredClone(response);changed.quoteRequest[key]='changed';assert.equal(verifyTestSignature(changed),false);}
  response.quoteRequest.confidentiality='advanced';assert.equal(verifyTestSignature(response),true);
  await assert.rejects(intentsPreview(intentInput(),{fetcher:intentFetch(v=>{v.quoteRequest.confidentiality='advanced';return v;}),verifySignature:verifyTestSignature}),/changed confidentiality/);
});
test('authentication rejects token actions and wrong domains before sending', async () => {
  const now=Date.now(),payload={verifying_contract:'intents.near',signer_id:'a'.repeat(64),deadline:new Date(now+60000).toISOString(),intents:[]};
  const signed=p=>({standard:'raw_ed25519',payload:JSON.stringify(p)});
  const noNetwork=async()=>assert.fail('Invalid authentication must not reach the API');
  for(const patch of[{intents:[{intent:'transfer'}]},{verifying_contract:'evil.near'},{deadline:'2020-01-01'}]){
    await assert.rejects(intentsAuthenticate(signed({...payload,...patch}),{fetcher:noNetwork,now}));
  }
  const auth=await intentsAuthenticate(signed(payload),{now,fetcher:async(url,options)=>{
    assert(url.endsWith('/v0/auth/authenticate'));assert.deepEqual(JSON.parse(JSON.parse(options.body).signedData.payload).intents,[]);
    return ok({accessToken:'session',expiresIn:60});
  }});
  assert.equal(auth.expiresIn,60);
});
