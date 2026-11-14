import test from 'node:test';
import assert from 'node:assert/strict';
import {discoverWalletAssets} from './asset-discovery.mjs';
import {assetDiscoveryRequest,assetDiscoverySnapshot} from '../web/public/asset-discovery.js';
const now=Date.now(),account='0x'+'12'.repeat(20),contract='0x'+'34'.repeat(20),request={network:'ethereum',account,publicConsent:true};
const row=input=>({kind:'token-watch',request:input,name:'Read on chain',symbol:'TEST',decimals:6,balance:'1234500',price:null,nativePrice:null,image:null,blockHash:'0x'+'ab'.repeat(32),blockNumber:'42',observedAt:now,executable:false});
const item=(address=contract,reputation='ok')=>({token:{type:'ERC-20',reputation,address_hash:address,symbol:'IGNORED',decimals:'18'},value:'999999999'});
test('discovery uses an exact address endpoint and on-chain reads, not indexer balance or ticker',async()=>{
 const calls=[];const result=await discoverWalletAssets(request,{clock:()=>now,oracle:async()=>null,fetcher:async(url,options)=>{assert.equal(url,`https://eth.blockscout.com/api/v2/addresses/${account}/tokens?type=ERC-20`);assert.equal(options.redirect,'error');return Response.json({items:[item(),item(),item('0x'+'56'.repeat(20),'scam')],next_page_params:null});},read:async input=>{calls.push(input);return row(input);}});
 assert.equal(calls.length,1);assert.equal(result.rows[0].symbol,'TEST');assert.equal(result.rows[0].balance,'1234500');assert.equal(result.skipped,1);assert.equal(result.partial,false);
});
test('large portfolios are bounded and reported partial, failures retain successful reads',async()=>{
 let active=0,max=0,count=0;const result=await discoverWalletAssets(request,{clock:()=>now,oracle:async()=>null,fetcher:async()=>Response.json({items:Array.from({length:30},(_,i)=>item('0x'+(i+1).toString(16).padStart(40,'0'))),next_page_params:{id:2}}),read:async input=>{count++;active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,1));active--;if(input.contract.endsWith('01'))throw Error('unavailable');return row(input);}});
 assert.equal(count,24);assert.equal(max,3);assert.equal(result.rows.length,23);assert.equal(result.partial,true);assert.equal(result.skipped,1);
});
test('discovery rejects missing consent, arbitrary endpoints, mismatched owners and oversized lists',async()=>{
 for(const input of [{...request,publicConsent:false},{...request,url:'https://evil.invalid'},{...request,network:'constructor'}])assert.throws(()=>assetDiscoveryRequest(input));
 const result={request,rows:[row({...request,contract,account:'0x'+'56'.repeat(20)})],partial:false,skipped:0,observedAt:now};assert.throws(()=>assetDiscoverySnapshot(result,request,{now}));
 await assert.rejects(discoverWalletAssets(request,{fetcher:async()=>new Response(' '.repeat(524289))}));
});
