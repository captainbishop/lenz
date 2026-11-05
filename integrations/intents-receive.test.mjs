import test from 'node:test';
import assert from 'node:assert/strict';
import {receiveAssets,filterReceiveAssets,receiveAmount} from '../web/public/receive-assets.js';
import {readReceiveAssets,confidentialReceiveRequest,previewConfidentialReceive} from './intents-receive.mjs';
import {createReceiveRoute} from '../web/receive-relay.mjs';
import {Readable} from 'node:stream';
const tokens=[{assetId:'nep141:eth.omft.near',blockchain:'eth',symbol:'ETH',decimals:18},{assetId:'nep141:sol.omft.near',blockchain:'sol',symbol:'SOL',decimals:9},{assetId:'nep141:usdc.test.near',blockchain:'eth',symbol:'USDC',decimals:6,contractAddress:'0x'+'12'.repeat(20)}];
const now=Date.now(),account={type:'CONFIDENTIAL_INTENTS',id:'test-confidential-account'},input={assetId:tokens[0].assetId,blockchain:'eth',amount:'0.2',refundTo:'0x'+'34'.repeat(20),deadline:new Date(now+3600000).toISOString()};
const response=body=>new Response(JSON.stringify(body),{headers:{'Content-Type':'application/json'}});
test('catalogue preserves exact asset identity across chains and filters symbol, chain and contract',()=>{
 const list=receiveAssets(tokens);assert.equal(filterReceiveAssets(list,'solana')[0].symbol,'SOL');assert.equal(filterReceiveAssets(list,'Ethereum usdc').length,1);assert.equal(filterReceiveAssets(list,'0x121212')[0].symbol,'USDC');assert.equal(list[0].contractAddress,null);
 for(const list of [[...tokens,tokens[0]],[{...tokens[0],symbol:'\u202eETH'}],[{...tokens[0],blockchain:'__proto__\n'}],[{...tokens[0],decimals:78}]])assert.throws(()=>receiveAssets(list));
});
test('receiving uses exact base units without a float conversion',()=>{assert.equal(receiveAmount('0.000000000000000001',18),'1');assert.equal(receiveAmount('9007199254740993',6),'9007199254740993000000');for(const value of ['1e3','01','1.0000001','-1','0','Infinity'])assert.throws(()=>receiveAmount(value,6));});
test('funding keeps the same asset inside confidential balances with an explicit refund and no public fallback',()=>{
 const body=confidentialReceiveRequest(input,{tokens,account,now});assert.equal(body.destinationAsset,input.assetId);assert.equal(body.recipientType,'CONFIDENTIAL_INTENTS');assert.equal(body.dry,true);assert.equal(body.amount,'200000000000000000');assert.equal(body.confidentiality,'advanced');assert.equal(body.refundTo,input.refundTo);
 for(const patch of [{blockchain:'sol'},{assetId:'unknown'},{deadline:new Date(now-1).toISOString()},{deadline:new Date(now+86400001).toISOString()},{recipientType:'DESTINATION_CHAIN'},{dry:false}])assert.throws(()=>confidentialReceiveRequest({...input,...patch},{tokens,account,now}));
 assert.throws(()=>confidentialReceiveRequest(input,{tokens,account:{...account,type:'INTENTS'},now}));
});
test('EVM refund destinations reject Lenz aliases, wrong-chain formats, zero addresses and invalid checksums before a quote',async()=>{
 let calls=0;const options={tokens,account,now,apiKey:'synthetic',fetcher:async()=>{calls++;throw Error('must not call');}};
 for(const refundTo of ['lenz1example','johnson.lenz','test.near','So11111111111111111111111111111111111111112','0x'+'00'.repeat(20),'0x52908400098527886E0F7030069857D2E4169Ee7'])await assert.rejects(previewConfidentialReceive({...input,refundTo},options));
 await assert.rejects(previewConfidentialReceive({...input,assetId:tokens[1].assetId,blockchain:'sol'},options));assert.equal(calls,0);
 const body=confidentialReceiveRequest({...input,refundTo:'0x52908400098527886E0F7030069857D2E4169EE7'},{tokens,account,now});assert.equal(body.refundTo,'0x52908400098527886e0f7030069857d2e4169ee7');
});
test('dry receiving quote is signed, fee-aware and cannot expose a deposit or claim privacy proof',async()=>{
 let calls=0;const options={tokens,account,now,apiKey:'synthetic',verifySignature:()=>true,fetcher:async(url,o)=>{calls++;assert.equal(url,'https://1click.chaindefuser.com/v0/quote');assert.equal(o.redirect,'error');const b=JSON.parse(o.body);return response({quoteRequest:b,quote:{amountIn:b.amount,amountOut:'190000000000000000',minAmountOut:'190000000000000000'},timestamp:new Date(now).toISOString()});}};
 await assert.rejects(previewConfidentialReceive(input,{...options,apiKey:null}));assert.equal(calls,0);
 const quote=await previewConfidentialReceive(input,options);assert.equal(quote.fees,'10000000000000000');assert.equal(quote.depositAvailable,false);assert.equal(quote.privacyVerified,false);assert.equal(quote.executable,false);
 for(const change of [r=>r.quoteRequest.recipient='other',r=>r.quoteRequest.confidentiality='basic',r=>r.quoteRequest.recipientType='DESTINATION_CHAIN',r=>r.quote.depositAddress='0x'+'99'.repeat(20),r=>r.quote.depositMemo='',r=>r.quote.chainDepositAddresses=[],r=>r.quote.amountOut=190000000000000000,r=>r.quote.minAmountOut='1',r=>r.timestamp=new Date(now-300001).toISOString()]){
  await assert.rejects(previewConfidentialReceive(input,{...options,fetcher:async(...args)=>{const r=await(await options.fetcher(...args)).json();change(r);return response(r);}}));
 }
 await assert.rejects(previewConfidentialReceive(input,{...options,verifySignature:()=>false}));
});
test('asset reads use one fixed host and reject oversized or malformed responses',async()=>{
 const list=await readReceiveAssets({fetcher:async(url,o)=>{assert.equal(url,'https://1click.chaindefuser.com/v0/tokens');assert.equal(o.method,'GET');assert.equal(o.redirect,'error');return response(tokens);}});assert.equal(list.length,3);
 await assert.rejects(readReceiveAssets({fetcher:async()=>new Response(' '.repeat(3000001))}));await assert.rejects(readReceiveAssets({fetcher:async()=>response([{symbol:'ETH'}])}));
});
test('catalogue relay coalesces reads, preserves saved status and backs off after failure',async()=>{
 let time=now,calls=0,fail=false;const route=createReceiveRoute({now:()=>time,read:async()=>{calls++;if(fail)throw Error('upstream');return tokens;}});
 async function call(method='GET'){const req=Readable.from([]);Object.assign(req,{url:'/api/receive/assets',method,headers:{host:'127.0.0.1:4173'}});let code,data;await route(req,{writeHead:s=>code=s,end:s=>data=JSON.parse(s)});return {code,data};}
 const [a,b]=await Promise.all([call(),call()]);assert.equal(calls,1);assert.equal(a.data.depositAvailable,false);assert.equal(b.data.stale,false);assert.equal((await call('POST')).code,405);
 time+=300001;fail=true;assert.equal((await call()).data.stale,true);await call();assert.equal(calls,2);
});
