import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {Readable} from 'node:stream';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {KeyPair,actions,createTransaction,encodeTransaction,SignedTransaction,Signature} from '../contracts/node_modules/near-api-js/lib/index.js';
import {Interface,keccak256,toUtf8Bytes} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {base58,base64} from './public/intents-vendor/codecs.js';
import {nep413Hash} from '../integrations/intent-testnet/swap.mjs';
import {AURORA_INTENT_DEPLOYMENT as deployment} from './public/intent-aurora-config.js';
import {auroraFundingOwner} from './public/intent-aurora-funding-plan.js';
import {createAuroraFundingService,emptyAuroraFundingJournal} from './intent-aurora-funding.mjs';
import {createAuroraFundingHttpRoute} from './intent-aurora-funding-http.mjs';
import {createAuroraIntentHttpRoute} from './intent-aurora-http.mjs';
import {createAuroraIntentReader} from './intent-aurora-read.mjs';
import {createAuroraSwapHttpRoute} from './intent-aurora-swap-http.mjs';
import {createAuroraSwapService,emptyAuroraSwapJournal} from './intent-aurora-swap.mjs';
import {auroraVaultAddress} from './public/intent-aurora-plan.js';
import {createHostedProxy} from './hosted-proxy.mjs';
import {createHostedGateway} from './hosted-gateway.mjs';
import {createHostedSession} from './public/hosted-session.js';
import {createIdentity} from './public/peer-crypto.js';

const origin='https://lenz-test.vercel.app',gatewaySecret='g'.repeat(48),sessionSecret='s'.repeat(48);
const fetchHTTP=(url,options={})=>new Promise((resolve,reject)=>{
 const request=http.request(url,{method:options.method??'GET',headers:options.headers instanceof Headers?Object.fromEntries(options.headers):options.headers,signal:options.signal},response=>resolve(new Response(Readable.toWeb(response),{status:response.statusCode,headers:response.headers})));
 request.on('error',reject);request.end(options.body);
});
async function listen(handler){const server=http.createServer(handler);await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,url:'http://127.0.0.1:'+server.address().port};}
async function close(server){server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
const count=value=>{const bytes=Buffer.alloc(4);bytes.writeUInt32LE(value);return bytes;};
const codeFixture=JSON.parse(await readFile(new URL('./intent-aurora-code.fixture.json',import.meta.url),'utf8'));

// Signatures and codecs are real; balances, chain outcomes and dispatch are fixtures.
function fundingFixture(){
 const user=KeyPair.fromRandom('ed25519'),operator=KeyPair.fromRandom('ed25519'),operatorId='hosted-faucet-fixture.testnet',operatorAddress='0x'+'12'.repeat(20);
 const owner=auroraFundingOwner(user.getPublicKey().toString()),commitment='0x'+'01'.repeat(32),events=new Interface(['event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)']);
 let retained=emptyAuroraFundingJournal(),clock=1794620000000,allowance='0',lost=false,signs=0,sends=0,writes=0,nonce=0;
 function final(){
  const pending=retained.pending,logs=pending.stage===1?[events.encodeEventLog(events.getEvent('Deposit'),[pending.commitment,0n,1n])]:[];
  const execution=Buffer.concat([Buffer.from([7,0]),count(0),Buffer.alloc(8),count(logs.length),...logs.map(log=>Buffer.concat([Buffer.from(deployment.pool.slice(2),'hex'),count(log.topics.length),...log.topics.map(topic=>Buffer.from(topic.slice(2),'hex')),count((log.data.length-2)/2),Buffer.from(log.data.slice(2),'hex')]))]);
  allowance=pending.stage===0?deployment.denomination:'0';
  return {final_execution_status:'FINAL',transaction:{hash:pending.signed.txHash,signer_id:operatorId,receiver_id:'aurora',actions:[{FunctionCall:{method_name:'call',args:pending.call.args,gas:pending.call.gas,deposit:'0'}}]},status:{SuccessValue:execution.toString('base64')},receipts_outcome:[{id:'fixture-stage-'+pending.stage,outcome:{executor_id:'aurora',status:{SuccessValue:''}}}]};
 }
 const rpc={
  async snapshot(){return {network:'testnet',chainId:deployment.chainHex,codes:{...deployment.codeSha256},pool:{address:deployment.pool,denomination:deployment.denomination},source:{owner:operatorAddress,inputBalance:'5000000'},venue:{outputBalance:'8000000'}};},
  async operatorState(){return {accountId:operatorId,address:operatorAddress,engineVerified:true,maxGas:'1000000000000000',gasReady:true,allowance};},
  async send(){sends++;assert(retained.pending?.signed.bytes,'The chain boundary receives only retained signed bytes.');if(lost)throw Error('Fixture response lost');return final();},
  async transaction(){return null;}
 };
 const signer={async signTransaction(call){
  signs++;const transaction=createTransaction(operatorId,operator.getPublicKey(),'aurora',BigInt(signs),[actions.functionCall('call',base64.decode(call.args),BigInt(call.gas),0n)],new Uint8Array(32).fill(3)),digest=createHash('sha256').update(encodeTransaction(transaction)).digest();
  const signed=new SignedTransaction({transaction,signature:new Signature({keyType:0,data:operator.sign(digest).signature})});return {senderId:operatorId,txHash:base58.encode(digest),bytes:base64.encode(signed.encode())};
 }};
 const journal={async read(){return structuredClone(retained);},async write(value){writes++;retained=structuredClone(value);}};
 const service=createAuroraFundingService({rpc,signer,journal,operatorId,operatorAddress,now:()=>clock,random:size=>new Uint8Array(size).fill(++nonce)});
 return {service,owner,commitment,rpc,final,now:()=>clock,advance:duration=>{clock+=duration;},lose:value=>{lost=value;},counts:()=>({signs,sends,writes}),pendingBytes:()=>retained.pending?.signed.bytes,
  sign:review=>({review,signed:{standard:'nep413',payload:structuredClone(review.payload),public_key:user.getPublicKey().toString(),signature:'ed25519:'+base58.encode(user.sign(nep413Hash(review.payload)).signature)}})};
}

function swapFixture(){
 const operator=KeyPair.fromRandom('ed25519'),operatorId='hosted-swap-fixture.testnet',operatorAddress='0x'+'12'.repeat(20),clock=1794620000000;
 const plan={beneficiary:'0x'+'34'.repeat(20),refundRecipient:'0x'+'34'.repeat(20),relayer:'0x'+'00'.repeat(20),relayerFee:'0',minOutput:'2000000',deadline:String(clock/1000+300),salt:'0x'+'56'.repeat(32)};
 const vault=auroraVaultAddress(plan),root='0x'+'01'.repeat(32),nullifierHash='0x'+'02'.repeat(32),proof='0x'+'00'.repeat(256),publicSignals=[root,nullifierHash,vault,'0','0','0'].map(value=>BigInt(value).toString());
 const id='aurora-swap:'+'a'.repeat(64),artifactId='aurora-proof:'+keccak256(toUtf8Bytes(JSON.stringify({intentId:id,proof,publicSignals}))).slice(2),request={id,artifactId,plan,vault,root,nullifierHash,proof,publicSignals};
 const snapshot={routeId:deployment.routeId,network:'testnet',chainId:deployment.chainHex,observedAt:clock,block:{number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:clock},codes:{...deployment.codeSha256},pool:{address:deployment.pool,denomination:deployment.denomination,levels:20,root,nextIndex:1,commitments:[root],deposits:[{index:0,commitment:root}],withdrawals:[],inputBalance:'1000000'},venue:{address:deployment.adapter,inputAmount:deployment.denomination,outputAmount:deployment.outputAmount,outputBalance:'8000000'}};
 let retained=emptyAuroraSwapJournal(),signs=0,sends=0,writes=0,proofValid=false,completeRecovery=false;
 const settings={spent:false,beneficiaryOutputBalance:'0',beneficiaryInputBalance:'0',deployed:false,status:null,inputBalance:'0',outputBalance:'0',allowance:'0'};
 function final(failed=false){
  const stage=retained.pending,events=new Interface(['event Transfer(address indexed from,address indexed to,uint256 value)']);
  const logs=failed?[]:[{address:deployment.inputToken,...events.encodeEventLog(events.getEvent('Transfer'),[vault,deployment.adapter,1000000n])},{address:deployment.outputToken,...events.encodeEventLog(events.getEvent('Transfer'),[deployment.adapter,vault,2000000n])},{address:deployment.outputToken,...events.encodeEventLog(events.getEvent('Transfer'),[vault,plan.beneficiary,2000000n])}];
  const execution=Buffer.concat([Buffer.from([7,0]),count(0),Buffer.alloc(8),count(logs.length),...logs.map(log=>Buffer.concat([Buffer.from(log.address.slice(2),'hex'),count(log.topics.length),...log.topics.map(topic=>Buffer.from(topic.slice(2),'hex')),count((log.data.length-2)/2),Buffer.from(log.data.slice(2),'hex')]))]).toString('base64');
  const engineId=base58.encode(new Uint8Array(32).fill(7)),refundId=base58.encode(new Uint8Array(32).fill(8)),status=failed?{Failure:{ActionError:{kind:'fixture failure'}}}:{SuccessValue:execution};
  if(!failed)Object.assign(settings,{spent:true,deployed:true,status:2,inputBalance:'0',beneficiaryOutputBalance:'2000000'});
  return {final_execution_status:'FINAL',transaction:{hash:stage.signed.txHash,signer_id:operatorId,receiver_id:'aurora',actions:[{FunctionCall:{method_name:'call',args:stage.call.args,gas:stage.call.gas,deposit:'0'}}]},transaction_outcome:{id:stage.signed.txHash,outcome:{executor_id:operatorId,receipt_ids:[engineId],status:{SuccessReceiptId:engineId}}},receipts_outcome:[{id:engineId,outcome:{executor_id:'aurora',receipt_ids:[refundId],status}},{id:refundId,outcome:{executor_id:operatorId,receipt_ids:[],status:{SuccessValue:''}}}],status};
 }
 const rpc={snapshot:async()=>structuredClone(snapshot),operatorState:async()=>({accountId:operatorId,address:operatorAddress,engineVerified:true,maxGas:'1000000000000000',gasReady:true,allowance:'0'}),
  swapState:async incoming=>({snapshot:structuredClone(snapshot),factoryVault:vault,factoryBindingsVerified:true,knownRoot:true,spent:settings.spent,proofValid:proofValid&&incoming.proof===request.proof,simulateValid:true,beneficiaryOutputBalance:settings.beneficiaryOutputBalance,beneficiaryInputBalance:settings.beneficiaryInputBalance,vault:{...settings,bindingsVerified:true,inputToken:deployment.inputToken,outputToken:deployment.outputToken,adapter:deployment.adapter,inputAmount:deployment.denomination,minOutput:plan.minOutput,deadline:plan.deadline,beneficiary:plan.beneficiary,refundRecipient:plan.refundRecipient,chainId:String(deployment.chainId)}}),
  send:async()=>{sends++;assert(retained.pending?.signed.bytes);if(completeRecovery)return final();throw Error('Fixture response lost');},transaction:async()=>null};
 const signer={async signTransaction(call){signs++;const transaction=createTransaction(operatorId,operator.getPublicKey(),'aurora',BigInt(signs),[actions.functionCall('call',base64.decode(call.args),BigInt(call.gas),0n)],new Uint8Array(32).fill(3)),digest=createHash('sha256').update(encodeTransaction(transaction)).digest();const signed=new SignedTransaction({transaction,signature:new Signature({keyType:0,data:operator.sign(digest).signature})});return {senderId:operatorId,txHash:base58.encode(digest),bytes:base64.encode(signed.encode())};}};
 const journal={read:async()=>structuredClone(retained),write:async value=>{writes++;retained=structuredClone(value);}};
 const service=createAuroraSwapService({rpc,signer,journal,operatorId,operatorAddress,now:()=>clock});
 return {service,request,snapshot,rpc,counts:()=>({signs,sends,writes}),allowProof:()=>{proofValid=true;},pendingBytes:()=>retained.pending?.signed.bytes,finalFailure:()=>final(true),completeRecovery:()=>{completeRecovery=true;},
  fundVault(){Object.assign(settings,{spent:true,deployed:true,status:0,inputBalance:deployment.denomination});snapshot.pool.withdrawals.push({recipient:vault,nullifierHash,relayer:plan.relayer,fee:'0'});}};
}

function chainReader(now){
 const abi=new Interface(['function token() view returns(address)','function verifier() view returns(address)','function hasher() view returns(address)','function pool() view returns(address)','function inputToken() view returns(address)','function outputToken() view returns(address)','function adapter() view returns(address)','function denomination() view returns(uint256)','function levels() view returns(uint32)','function nextIndex() view returns(uint32)','function getLastRoot() view returns(bytes32)','function chainId() view returns(uint256)','function numerator() view returns(uint256)','function denominator() view returns(uint256)','function decimals() view returns(uint8)','function balanceOf(address) view returns(uint256)']);
 const targets={input:deployment.inputToken,output:deployment.outputToken,...Object.fromEntries(['pool','adapter','factory','verifier','hasher'].map(name=>[name,deployment[name]]))};
 return createAuroraIntentReader({now,fetchImpl:async(_url,options)=>{
  const {id,method,params}=JSON.parse(options.body);let result;
  if(method==='eth_chainId')result=deployment.chainHex;
  else if(method==='eth_getBlockByNumber')result={number:'0x100',hash:'0x'+'ab'.repeat(32),timestamp:'0x'+(now()/1000).toString(16)};
  else if(method==='eth_getCode')result=codeFixture[Object.keys(targets).find(name=>targets[name]===params[0])];
  else if(method==='eth_getBalance')result='0x0';
  else if(method==='eth_getLogs')result=[];
  else if(method==='eth_call'){
   const parsed=abi.parseTransaction({data:params[0].data}),name=parsed.name;
   const values={token:deployment.inputToken,verifier:deployment.verifier,hasher:deployment.hasher,pool:deployment.pool,inputToken:deployment.inputToken,outputToken:deployment.outputToken,adapter:deployment.adapter,denomination:1000000n,levels:20n,nextIndex:0n,getLastRoot:'0x'+'01'.repeat(32),chainId:BigInt(deployment.chainId),numerator:2n,denominator:1n,decimals:6n};
   const value=name==='balanceOf'?(parsed.args[0].toLowerCase()===deployment.pool?1000000n:parsed.args[0].toLowerCase()===deployment.adapter?8000000n:0n):values[name];result=abi.encodeFunctionResult(name,[value]);
  }else assert.fail('Unexpected fixture chain read: '+method);
  return new Response(JSON.stringify({jsonrpc:'2.0',id,result}),{headers:{'Content-Type':'application/json'}});
 }});
}

async function hostedFunding(f,{swap}={}){
 let route;const backend=await listen((req,res)=>void route(req,res));
 const funding=createAuroraFundingHttpRoute({origin:backend.url,stateDir:'fixture-state',deployerKeyFile:'fixture-key',operatorId:'hosted-faucet-fixture.testnet',engineCodeHash:'fixture-code',now:f.now,openService:async()=>f.service});
 const reads=createAuroraIntentHttpRoute({origin:backend.url,reader:chainReader(f.now),now:f.now}),swaps=swap&&createAuroraSwapHttpRoute({origin:backend.url,stateDir:'fixture-state',deployerKeyFile:'fixture-key',operatorId:'hosted-swap-fixture.testnet',engineCodeHash:'fixture-code',now:f.now,openService:async()=>swap.service});
 route=async(req,res)=>{if(await funding(req,res)||await reads(req,res)||swaps&&await swaps(req,res))return;res.writeHead(404);res.end();};
 const gateway=await listen(await createHostedGateway({origin,gatewaySecret,custody:{},backendURL:backend.url,backendOrigin:backend.url}));
 const site=await listen(createHostedProxy({origin,gatewayURL:'https://gateway.example',gatewaySecret,sessionSecret,custody:{},fetcher:(url,options)=>fetchHTTP(gateway.url+url.pathname+url.search,options)}));
 const identity=await createIdentity('Fresh private test user'),paths=[];
 const wallet=createHostedSession({origin,hosted:true,read:async()=>({identity}),fetcher:(path,options={})=>{paths.push(path);return fetchHTTP(site.url+path,{...options,headers:{...Object.fromEntries(new Headers(options.headers)),host:new URL(origin).host,origin}});}});
 return {paths,identity,wallet,postPath:(path,body,headers={})=>fetchHTTP(site.url+path,{method:'POST',headers:{host:new URL(origin).host,origin,'Content-Type':'application/json',...headers},body:JSON.stringify(body)}),
  post:(operation,body)=>wallet.fetch('/api/intent-aurora-funds/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}),
  async close(){await close(site.server);await close(gateway.server);await close(backend.server);}};
}

test('a new hosted owner receives a signed private grant without operator sign-in',async()=>{
 const f=fundingFixture(),site=await hostedFunding(f);
 try{
  const config=await site.post('config',{});assert.equal(config.status,200);assert.equal((await config.json()).available,true);
  const prepared=await site.post('prepare',{owner:f.owner,commitment:f.commitment});assert.equal(prepared.status,200);
  const request=f.sign(await prepared.json());assert.deepEqual(f.counts(),{signs:0,sends:0,writes:0});
  const result=await site.post('submit',request);assert.equal(result.status,200);const outcome=await result.json();assert.equal(outcome.funded,true);assert.equal(outcome.deposit.commitment,f.commitment);assert.equal(outcome.amount,'1000000');
  const settled=f.counts();assert.equal(settled.signs,3);assert.equal(settled.sends,3);
  for(const operation of ['submit','reconcile','resume']){const repeated=await site.post(operation,request);assert.equal(repeated.status,200);assert.deepEqual(await repeated.json(),outcome);}
  assert.deepEqual(f.counts(),settled);assert(site.paths.every(path=>path.startsWith('/api/intent-aurora-funds/')),'Private funding must not request an operator login.');
 }finally{await site.close();}
});

test('hosted grants reject altered authority and unrelated custody before dispatch',async()=>{
 const f=fundingFixture(),site=await hostedFunding(f);
 try{
  const prepared=await site.post('prepare',{owner:f.owner,commitment:f.commitment});assert.equal(prepared.status,200);const request=f.sign(await prepared.json());
  const invalid=structuredClone(request),signature=base58.decode(invalid.signed.signature.slice(8));signature[0]^=1;invalid.signed.signature='ed25519:'+base58.encode(signature);
  const altered=structuredClone(request);altered.review.commitment='0x'+'02'.repeat(32);
  for(const body of [invalid,altered])for(const operation of ['submit','reconcile','resume','cleanup'])assert.equal((await site.post(operation,body)).status,503);
  assert.equal((await site.post('submit',{...request,secret:'forbidden'})).status,400);
  assert.equal((await site.postPath('/api/intent-aurora-funds/submit?owner='+f.owner,request)).status,404);
  assert.equal((await site.postPath('/api/intent-aurora-funds/submit',{...request,padding:'x'.repeat(16384)})).status,413);
  for(const path of ['/api/intent-near/config','/api/intents/lending/config','/api/intent-zcash/config','/api/private-executor/config','/api/rhea/submit'])assert.equal((await site.postPath(path,{})).status,401);
  assert.equal((await site.postPath('/api/intent-aurora-funds/submit',request,{origin:'https://other.example'})).status,403);
  assert.deepEqual(f.counts(),{signs:0,sends:0,writes:0});
 }finally{await site.close();}
});

test('hosted funding reconciles the original pending signature without rebroadcasting',async()=>{
 const f=fundingFixture(),site=await hostedFunding(f);
 try{
  const request=f.sign(await(await site.post('prepare',{owner:f.owner,commitment:f.commitment})).json());f.lose(true);
  const first=await site.post('submit',request);assert.equal(first.status,200);assert.equal((await first.json()).state,'pending');const originalBytes=f.pendingBytes(),before=f.counts();
  for(const operation of ['submit','reconcile']){const retained=await site.post(operation,request);assert.equal(retained.status,200);assert.equal((await retained.json()).state,'pending');}
  assert.equal((await site.post('resume',request)).status,503);assert.equal((await site.post('cleanup',request)).status,503);assert.equal(f.pendingBytes(),originalBytes);assert.deepEqual(f.counts(),before);
  f.rpc.transaction=async()=>f.final();const reconciled=await site.post('reconcile',request);assert.equal(reconciled.status,200);assert.equal((await reconciled.json()).funded,false);assert.deepEqual(f.counts(),{...before,writes:before.writes+1});
  f.lose(false);const completed=await site.post('resume',request);assert.equal(completed.status,200);assert.equal((await completed.json()).funded,true);assert.equal(f.counts().sends,3);assert.equal(f.pendingBytes(),undefined);
 }finally{await site.close();}
});

test('fresh profiles read verified public Aurora balances without an operator session',async()=>{
 const f=fundingFixture(),site=await hostedFunding(f),options={method:'POST',headers:{'Content-Type':'application/json'}};
 try{
  const config=await site.wallet.fetch('/api/intent-aurora/config',{...options,body:'{}'});assert.equal(config.status,200);assert.equal((await config.json()).deployment.chainId,1313161555);
  const owner='0x'+'34'.repeat(20),snapshot=await site.wallet.fetch('/api/intent-aurora/snapshot',{...options,body:JSON.stringify({owner})});assert.equal(snapshot.status,200);const value=await snapshot.json();assert.equal(value.source.owner,owner);assert.equal(value.source.inputBalance,'0');assert.equal(value.pool.inputBalance,'1000000');
  for(const path of ['/api/intent-aurora/snapshot?owner='+owner,'/api/intent-aurora-swap/unlisted','/api/intent-aurora-funds/prepare/extra'])assert.equal((await site.postPath(path,{})).status,404);
  assert.equal((await site.postPath('/api/intent-aurora/snapshot',{owner:f.owner})).status,400);assert.deepEqual(f.counts(),{signs:0,sends:0,writes:0});
  assert(site.paths.every(path=>['/api/intent-aurora/config','/api/intent-aurora/snapshot'].includes(path)));
 }finally{await site.close();}
});

test('hosted private swaps retain proof and original recovery checks without operator login',async()=>{
 const f=fundingFixture(),swap=swapFixture(),site=await hostedFunding(f,{swap}),post=(operation,body)=>site.wallet.fetch('/api/intent-aurora-swap/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  const configuration=await post('config',{});assert.equal(configuration.status,200);assert.equal((await configuration.json()).available,true);
  const {plan,vault,root,nullifierHash}=swap.request,prepared=await post('prepare',{plan,vault,root,nullifierHash});assert.equal(prepared.status,200);assert.equal((await prepared.json()).vault,vault);
  const altered=structuredClone(swap.request);altered.plan.refundRecipient='0x'+'aa'.repeat(20);assert.equal((await post('submit',altered)).status,400);
  const signals=structuredClone(swap.request);signals.publicSignals[2]='1';assert.equal((await post('submit',signals)).status,400);
  assert.equal((await post('submit',swap.request)).status,503);assert.deepEqual(swap.counts(),{signs:0,sends:0,writes:0});
  const alias=structuredClone(swap.request);alias.id='aurora-swap:'+'b'.repeat(64);alias.artifactId='aurora-proof:'+keccak256(toUtf8Bytes(JSON.stringify({intentId:alias.id,proof:alias.proof,publicSignals:alias.publicSignals}))).slice(2);
  swap.allowProof();const first=await post('submit',alias);assert.equal(first.status,200);const firstOutcome=await first.json();assert.equal(firstOutcome.status,'unknown');assert.equal(firstOutcome.intentId,alias.id);const originalBytes=swap.pendingBytes(),before=swap.counts();
  for(const operation of ['submit','reconcile']){const pending=await post(operation,swap.request);assert.equal(pending.status,200);const outcome=await pending.json();assert.equal(outcome.verified,false);assert.equal(outcome.intentId,swap.request.id);assert.equal(outcome.artifactId,swap.request.artifactId);}
  const invalidProof=structuredClone(swap.request);invalidProof.proof='0x'+'01'.repeat(256);invalidProof.artifactId='aurora-proof:'+keccak256(toUtf8Bytes(JSON.stringify({intentId:invalidProof.id,proof:invalidProof.proof,publicSignals:invalidProof.publicSignals}))).slice(2);assert.equal((await post('submit',invalidProof)).status,503);
  assert.equal((await post('recover',{request:swap.request,operation:'recover'})).status,503);assert.equal(swap.pendingBytes(),originalBytes);assert.deepEqual(swap.counts(),before);
  assert(site.paths.every(path=>path.startsWith('/api/intent-aurora-swap/')),'Proof-authorized swaps must not request an operator login.');
 }finally{await site.close();}
});

test('unknown expired hosted grants cancel without persisting or consuming sponsor capacity',async()=>{
 const f=fundingFixture(),site=await hostedFunding(f);
 try{
  const request=f.sign(await(await site.post('prepare',{owner:f.owner,commitment:f.commitment})).json());assert.equal((await site.post('cleanup',request)).status,503);assert.deepEqual(f.counts(),{signs:0,sends:0,writes:0});
  f.advance(300001);let original;
  for(const operation of ['cleanup','reconcile','cleanup']){const response=await site.post(operation,request);assert.equal(response.status,200);const value=await response.json();assert.equal(value.state,'failed');assert.equal(value.cancelled,true);assert.equal(value.cleanupComplete,true);assert.equal(value.funded,false);original??=value;assert.deepEqual(value,original);}
  assert.deepEqual(f.counts(),{signs:0,sends:0,writes:0});const next=await site.post('prepare',{owner:f.owner,commitment:f.commitment});assert.equal(next.status,200);assert.notEqual((await next.json()).id,request.review.id);
 }finally{await site.close();}
});

test('hosted recovery executes only the original funded vault and verifies its receiving credit',async()=>{
 const f=fundingFixture(),swap=swapFixture(),site=await hostedFunding(f,{swap}),post=(operation,body)=>site.wallet.fetch('/api/intent-aurora-swap/'+operation,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
 try{
  swap.allowProof();assert.equal((await post('submit',swap.request)).status,200);swap.rpc.transaction=async()=>swap.finalFailure();const failed=await post('reconcile',swap.request);assert.equal(failed.status,200);assert.equal((await failed.json()).verified,false);assert.equal(swap.pendingBytes(),undefined);
  swap.fundVault();const checked=await post('reconcile',swap.request);assert.equal(checked.status,200);assert.equal((await checked.json()).recovery.operation,'recover');
  swap.completeRecovery();const recovered=await post('recover',{request:swap.request,operation:'recover'});assert.equal(recovered.status,200);const outcome=await recovered.json();assert.equal(outcome.status,'executed');assert.equal(outcome.verified,true);assert.equal(outcome.evidence.beneficiary,swap.request.plan.beneficiary);assert.equal(outcome.evidence.outputAmount,'2000000');
  const completed=swap.counts();assert.equal(completed.sends,2);assert.equal(completed.signs,2);
  for(const operation of ['recover','reconcile']){const repeated=await post(operation,operation==='recover'?{request:swap.request,operation:'recover'}:swap.request);assert.equal(repeated.status,200);assert.deepEqual(await repeated.json(),outcome);}
  assert.deepEqual(swap.counts(),completed);
 }finally{await site.close();}
});

test('retained signed funding recovery remains available after anonymous configuration reads exhaust their budget',async()=>{
 const f=fundingFixture(),site=await hostedFunding(f);
 try{
  const request=f.sign(await(await site.post('prepare',{owner:f.owner,commitment:f.commitment})).json());f.lose(true);assert.equal((await site.post('submit',request)).status,200);const before=f.counts();
  let throttled=false;for(let index=0;index<31;index++){const response=await site.postPath('/api/intent-aurora-funds/config',{});if(response.status===429)throttled=true;}assert.equal(throttled,true);
  const recovered=await site.post('reconcile',request);assert.equal(recovered.status,200);assert.equal((await recovered.json()).state,'pending');assert.deepEqual(f.counts(),before);
 }finally{await site.close();}
});
