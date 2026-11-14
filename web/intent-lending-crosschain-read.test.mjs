import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {Interface,Transaction,Wallet} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {LENDING_TESTNET} from './public/intent-lending-config.js';
import {buildLendingCrosschainFundingPlan,relayLendingOrderId} from './public/intent-lending-crosschain.js';
import {LENDING_CROSSCHAIN_PINS as pins,createLendingCrosschainFundingService} from './public/intent-lending-crosschain-route.js';
import {createLendingCrosschainReader} from './intent-lending-crosschain-read.mjs';
const quoteFixture=JSON.parse(readFileSync(new URL('./intent-lending-crosschain.fixture.json',import.meta.url),'utf8'));
const codes=JSON.parse(readFileSync(new URL('./intent-lending-crosschain-code.fixture.json',import.meta.url),'utf8'));
const now=Date.parse(quoteFixture.observedAt),wallet=new Wallet('0x'+'21'.repeat(32)),sender=wallet.address.toLowerCase(),word=value=>BigInt(value).toString(16).padStart(64,'0');
const config={...LENDING_TESTNET,lendingFactory:'0x'+'11'.repeat(20),privacyPool:quoteFixture.input.privacyPool,privacyPoolDeploymentBlock:'99'};
const block={number:'0x64',hash:'0x'+'aa'.repeat(32),timestamp:'0x'+Math.floor(now/1000).toString(16)};
const abi=new Interface(['function nextIndex() view returns(uint32)','function getLastRoot() view returns(bytes32)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function commitments(bytes32) view returns(bool)']);
function fixture(){
 const state={wrongCode:false,reorg:false,wrongChain:false,transaction:null,malformed:false,stall:false},calls=[];
 const plan=buildLendingCrosschainFundingPlan({...quoteFixture.input,sender},{now}),quote=structuredClone(quoteFixture.quote);quote.details.sender=quote.details.recipient=sender;quote.steps[0].items[0].data.from=sender;for(const refund of quote.protocol.v2.orderData.inputs[0].refunds)refund.recipient=sender;
 const id=relayLendingOrderId(quote.protocol.v2.orderData);quote.protocol.v2.orderId=id;quote.steps[0].items[0].data.data='0x49290c1c'+word(sender)+id.slice(2);
 const input={owner:'ab'.repeat(32),ownerAddress:'0x'+'22'.repeat(20),account:'0x'+'33'.repeat(20),plan,quote};
 const snapshot={chainId:config.chain,observedAt:now,block:{number:'100',hash:block.hash,timestamp:String(BigInt(block.timestamp)),finality:'finalized',requireCanonical:true},routeVerified:true,trust:{codePinsVerified:true,implementationPinsVerified:true,executionPinsVerified:true},account:{status:'verified',address:input.account,owner:input.ownerAddress,route:{factory:config.lendingFactory}}};
 async function fetchImpl(url,options){
  assert.ok([pins.sourceRpc,config.rpc].includes(url));assert.equal(options.redirect,'error');const request=JSON.parse(options.body),source=url===pins.sourceRpc;calls.push({source,...request});let result;
  if(state.stall)return new Response(new ReadableStream());
  if(request.method==='eth_chainId')result=state.wrongChain?'0x1':source?pins.sourceChainHex:config.chainHex;
  else if(request.method==='eth_getCode'){assert.deepEqual(request.params[1],{blockHash:block.hash,requireCanonical:true});const target=request.params[0];result=state.wrongCode?'0x6000':target===sender?'0x':target===pins.depository?codes.depository:target===pins.sourceRouter?codes.sourceRouter:codes.destinationRouter;}
  else if(request.method==='eth_getBalance')result='0xde0b6b3a7640000';
  else if(request.method==='eth_getTransactionCount')result=state.transaction&&request.params[1]==='latest'?'0x6':'0x5';
  else if(request.method==='eth_estimateGas')result='0x7000';
  else if(request.method==='eth_getTransactionByHash')result=state.transaction;
  else if(request.method==='eth_getTransactionReceipt')result=null;
  else if(request.method==='eth_getBlockByNumber')result={...block,...(request.params[0]==='0x64'&&state.reorg?{hash:'0x'+'bb'.repeat(32)}:{}),...(request.params[1]?{transactions:state.transaction?[state.transaction]:[]}:{} )};
  else if(request.method==='eth_getLogs')result=[];
  else if(request.method==='eth_call'){
   assert.deepEqual(request.params[1],{blockHash:block.hash,requireCanonical:true});
   if(source)result='0x';else{const call=abi.parseTransaction({data:request.params[0].data}),value=call.name==='getLastRoot'?'0x'+word(1):call.name==='commitments'?false:0;result=abi.encodeFunctionResult(call.name,[value]);}
  }else assert.fail('Unsupported/mutating call '+request.method);
  return Response.json({jsonrpc:'2.0',id:request.id+(state.malformed?1:0),result});
 }
 const reader=createLendingCrosschainReader({deployment:config,fetchImpl,readSnapshot:async()=>structuredClone(snapshot),now:()=>now,timeoutMs:100});let retained={draft:null,review:null,attempts:[]};
 const service=createLendingCrosschainFundingService({source:{capture:()=>({identity:{chainId:pins.sourceChainHex,address:sender},assertCurrent(){}})},store:{async read(){return structuredClone(retained);},async update(_owner,fn){await fn(retained);return structuredClone(retained);}},reader,requireRecovery:async()=>{},config,now:()=>now});
 async function sign(review,overrides={}){const raw=await wallet.signTransaction({...review.transaction,gasLimit:review.transaction.gas,type:2,nonce:5,...overrides}),tx=Transaction.from(raw);state.transaction={hash:tx.hash,type:'0x2',chainId:'0x14a34',nonce:'0x5',gas:'0x'+tx.gasLimit.toString(16),maxFeePerGas:'0x'+tx.maxFeePerGas.toString(16),maxPriorityFeePerGas:'0x'+tx.maxPriorityFeePerGas.toString(16),from:sender,to:tx.to.toLowerCase(),input:tx.data,value:'0x'+tx.value.toString(16),accessList:[],r:tx.signature.r,s:tx.signature.s,v:'0x'+tx.signature.yParity.toString(16)};return tx.hash;}
 return{reader,service,input,calls,state,sign};
}
test('cross-chain preflight pins both routes and simulates only the exact source payment',async()=>{
 const f=fixture(),observed=await f.reader.preflight(f.input);assert.equal(observed.source.nonce,'5');assert.equal(observed.source.simulated,true);assert.equal(observed.destination.crosschain.commitmentExists,false);
 assert.ok(f.calls.every(call=>!/^eth_send|^eth_sign/.test(call.method)));assert.ok(f.calls.filter(call=>call.method==='eth_getCode').every(call=>call.params[1].requireCanonical===true));
});
test('source hash lookup and bounded sender nonce lookup recover only the exact signed payment',async()=>{
 const f=fixture(),review=await f.service.prepare(f.input),hash=await f.sign(review);const observed=await f.reader.observe({review,transactionHash:hash});assert.equal(observed.source.transaction.hash,hash);assert.equal(observed.source.receipt,null);
 assert.equal((await f.reader.observe({review,transactionHash:null})).source.transaction.hash,hash);
 await f.sign(review,{value:1n});await assert.rejects(f.reader.observe({review,transactionHash:f.state.transaction.hash}),/another transaction/);
});
test('wrong network, changed runtime, noncanonical block and invalid response envelope fail closed',async()=>{
 for(const key of ['wrongChain','wrongCode','reorg','malformed']){const f=fixture();f.state[key]=true;await assert.rejects(f.reader.preflight(f.input));assert.ok(f.calls.every(call=>!/^eth_send|^eth_sign/.test(call.method)));}
});
test('stalled cross-chain response bodies stop at the bounded read deadline',async()=>{
 const f=fixture();f.state.stall=true;await assert.rejects(f.reader.preflight(f.input),error=>error.name==='TimeoutError');
});
