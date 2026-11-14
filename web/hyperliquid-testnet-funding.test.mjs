import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,readFile,rm} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {createRequire} from 'node:module';
import {createHyperliquidTestnetFunding,fundingTypedData} from './hyperliquid-testnet-funding.mjs';
const {Wallet,verifyTypedData}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const owner=new Wallet('0x'+'0'.repeat(63)+'1'),account='0x1111111111111111111111111111111111111111';
const request={version:1,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account,chainId:'hypercore:testnet'};
const currentRequest={...request,version:2,grants:{spotUSDC:'12',perpsUSDC:'3'}};
async function fixture(t){
 const dir=await mkdtemp(join(tmpdir(),'lenz-testnet-funding-'));t.after(()=>{assert(resolve(dir).startsWith(resolve(tmpdir())+'\\'));return rm(dir,{recursive:true,force:true});});
 const operatorKeyFile=join(dir,'operator.json'),journalFile=join(dir,'journal.json');await writeFile(operatorKeyFile,JSON.stringify({version:1,environment:'testnet',purpose:'lenz-hyperliquid-testnet-funding-only',privateKey:owner.privateKey}));
 let time=1700000000000,rich=true,visible=true,loseAck=false;const balances={spot:'1000',perps:'1000'},transactions=[];
 const transport=async(kind,body)=>{
  if(kind==='exchange'){
   const action=body.action,name=action.type==='usdSend'?'HyperliquidTransaction:UsdSend':'HyperliquidTransaction:SpotSend';
   const types={[name]:[{name:'hyperliquidChain',type:'string'},{name:'destination',type:'string'},...(action.type==='spotSend'?[{name:'token',type:'string'}]:[]),{name:'amount',type:'string'},{name:'time',type:'uint64'}]};
   const message={hyperliquidChain:'Testnet',destination:account,...(action.type==='spotSend'?{token:'USDC:0x'+'2'.repeat(32)}:{}),amount:action.amount,time:body.nonce};
   assert.equal(action.signatureChainId,'0x66eee');assert.equal(verifyTypedData({name:'HyperliquidSignTransaction',version:'1',chainId:421614,verifyingContract:'0x'+'0'.repeat(40)},types,message,body.signature),owner.address);
   const hash='0x'+String(transactions.length+1).padStart(64,'0');transactions.push({user:owner.address.toLowerCase(),action,hash,time:body.nonce,error:null});if(loseAck)throw Error('Lost acknowledgement');return {status:'ok',response:{type:'default'}};
  }
  if(kind==='explorer')return {type:'txDetails',tx:visible?transactions.find(tx=>tx.hash===body.hash):undefined};
  if(body.type==='userAbstraction')return 'disabled';
  if(body.type==='spotClearinghouseState')return {balances:[{token:0,total:rich?balances.spot:'0',hold:'0'}]};
  if(body.type==='clearinghouseState')return {assetPositions:[],withdrawable:rich?balances.perps:'0'};
  if(body.type==='spotMeta')return {tokens:[{index:0,name:'USDC',tokenId:'0x'+'2'.repeat(32)}]};
  if(body.type==='userNonFundingLedgerUpdates')return visible?transactions.map(tx=>({time:tx.time,hash:tx.hash,delta:{type:tx.action.type==='usdSend'?'internalTransfer':'spotTransfer',user:tx.user.toUpperCase().replace('0X','0x'),destination:account,fee:'1',...(tx.action.type==='usdSend'?{usdc:tx.action.amount}:{token:'USDC',amount:tx.action.amount,nativeTokenFee:'0'})}})):[];
  throw Error('Unexpected upstream');
 };
 const options={operatorKeyFile,journalFile,transport,now:()=>time};return {options,transactions,journalFile,advance:n=>time+=n,deplete:()=>rich=false,replenish:()=>rich=true,setBalances:(spot,perps)=>{balances.spot=spot;balances.perps=perps;},hide:()=>visible=false,reveal:()=>visible=true,loseAck:()=>loseAck=true};
}

test('an unconfigured distributor cannot show invented funds or make a network write',async()=>{
  const service=createHyperliquidTestnetFunding({operatorKeyFile:'',transport(){assert.fail('Unconfigured funding requested an upstream');}});
  const status=await service.configuration();
  assert.equal(status.available,false);
  assert.equal(status.reason,'operator_unconfigured');
  assert.equal(status.chainId,'hypercore:testnet');
  const result=await service.request({version:1,id:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',account:'0x1111111111111111111111111111111111111111',chainId:'hypercore:testnet'});
  assert.equal(result.state,'unavailable');
  await assert.rejects(async()=>service.request({...request,chainId:'hypercore:mainnet'}));
});

test('a new wallet receives two receipt-bound testnet grants and retains them across concurrent retry and restart',async t=>{
 const f=await fixture(t),service=createHyperliquidTestnetFunding(f.options);const results=await Promise.all([service.request(request),service.request(request)]);
 assert(results.every(row=>row.state==='confirmed'));assert.deepEqual(results[0].receipts.map(row=>row.bucket),['perps','spot']);assert.equal(f.transactions.length,2);
 f.deplete();assert.equal((await createHyperliquidTestnetFunding(f.options).request(request)).state,'confirmed');assert.equal(f.transactions.length,2);
});

test('version two funds a useful spot and perps grant with bounded inventory while legacy authority keeps its original amounts',async t=>{
 const f=await fixture(t),service=createHyperliquidTestnetFunding(f.options);f.setBalances('13','4');assert.equal((await service.configuration()).available,true);
 assert.equal((await service.request(request)).state,'unavailable');assert.equal(f.transactions.length,0);
 const result=await service.request(currentRequest);assert.equal(result.version,2);assert.equal(result.state,'confirmed');assert.deepEqual(result.receipts.map(row=>[row.bucket,row.amount]),[['perps','3'],['spot','12']]);
 const original=f.transactions.map(row=>structuredClone(row.action));f.deplete();const resumed=await createHyperliquidTestnetFunding(f.options).request(currentRequest);assert.equal(resumed.state,'confirmed');assert.deepEqual(f.transactions.map(row=>row.action),original);
});

test('version two refuses changed review amounts and does not rewrite a retained version one signature',async t=>{
 const f=await fixture(t),service=createHyperliquidTestnetFunding(f.options);await assert.rejects(async()=>service.request({...currentRequest,grants:{spotUSDC:'11',perpsUSDC:'3'}}));assert.equal(f.transactions.length,0);
 f.hide();await service.request(request);const before=JSON.parse(await readFile(f.journalFile,'utf8')).grants[0].transfers[0];
 await assert.rejects(async()=>service.request(currentRequest),/changed/);f.reveal();await service.request(request);const after=JSON.parse(await readFile(f.journalFile,'utf8')).grants[0].transfers[0];assert.deepEqual(after.action,before.action);assert.deepEqual(after.signature,before.signature);assert.equal(after.action.amount,'100');
});

test('version two keeps the one USDC activation fee budget and cannot report readiness below it',async t=>{
 const f=await fixture(t),service=createHyperliquidTestnetFunding(f.options);for(const amounts of [['12','4'],['13','3']]){f.setBalances(...amounts);assert.equal((await service.configuration()).available,false);assert.equal((await service.request(currentRequest)).state,'unavailable');}assert.equal(f.transactions.length,0);
});

test('account recovery returns the retained request and public receipts without granting funds or changing the journal',async t=>{
 const f=await fixture(t),service=createHyperliquidTestnetFunding(f.options),recovery={version:1,account,chainId:'hypercore:testnet'};
 assert.equal((await service.recover(recovery)).state,'not_found');assert.equal(f.transactions.length,0);
 f.hide();await service.request(request);const before=await readFile(f.journalFile,'utf8'),pending=await createHyperliquidTestnetFunding(f.options).recover(recovery);
 assert.deepEqual(pending.request,request);assert.equal(pending.state,'pending');assert.deepEqual(pending.receipts,[]);assert.equal(f.transactions.length,1);assert.equal(await readFile(f.journalFile,'utf8'),before);
 f.reveal();await service.request(request);f.deplete();const confirmed=await service.recover(recovery);assert.deepEqual(confirmed.request,request);assert.equal(confirmed.state,'confirmed');assert.deepEqual(confirmed.receipts.map(row=>row.bucket),['perps','spot']);assert.equal(f.transactions.length,2);
 assert.equal((await service.recover({...recovery,account:'0x'+'3'.repeat(40)})).state,'not_found');
 for(const changed of [{...recovery,chainId:'hypercore:mainnet'},{...recovery,id:request.id},{...recovery,amount:'1000'}])await assert.rejects(service.recover(changed),/Invalid testnet funding recovery/);
 assert.equal(f.transactions.length,2);
});

test('lost acknowledgement reconciles the original nonce without a duplicate transfer when the operator is depleted',async t=>{
 const f=await fixture(t);f.hide();f.loseAck();const first=await createHyperliquidTestnetFunding(f.options).request(request);assert.equal(first.state,'pending');assert.equal(first.receipts.length,0);assert.equal(f.transactions.length,1);
 f.reveal();f.deplete();const recovered=await createHyperliquidTestnetFunding(f.options).request(request);assert.equal(recovered.state,'pending');assert.equal(recovered.receipts.length,1);assert.equal(f.transactions.length,1);
 f.replenish();const done=await createHyperliquidTestnetFunding(f.options).request(request);assert.equal(done.state,'confirmed');assert.equal(f.transactions.length,2);
});

test('an exchange acknowledgement without matching ledger and action proof stays pending across restart',async t=>{
 const f=await fixture(t);f.hide();const first=await createHyperliquidTestnetFunding(f.options).request(request);assert.equal(first.state,'pending');assert.equal(first.receipts.length,0);
 for(let i=0;i<3;i++)assert.equal((await createHyperliquidTestnetFunding(f.options).request(request)).state,'pending');assert.equal(f.transactions.length,1);
 f.reveal();f.transactions[0].action={...f.transactions[0].action,destination:'0x'+'3'.repeat(40)};assert.equal((await createHyperliquidTestnetFunding(f.options).request(request)).state,'pending');assert.equal(f.transactions.length,1);
});

test('a wallet cooldown expires after a day while changed retained requests and caller-selected funding terms stay rejected',async t=>{
 const f=await fixture(t),service=createHyperliquidTestnetFunding(f.options);assert.equal((await service.request(request)).state,'confirmed');const next={...request,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'};
 await assert.rejects(service.request(next),/already requested/);await assert.rejects(service.request({...request,account:'0x'+'3'.repeat(40)}),/request changed/);
 for(const altered of [{...request,amount:'1000'},{...request,source:'mainnet'},{...request,chainId:'hypercore:mainnet'}])await assert.rejects(async()=>service.request(altered),/Invalid testnet funding request/);
 assert.equal(f.transactions.length,2);f.advance(86400001);assert.equal((await service.request(next)).state,'confirmed');assert.equal(f.transactions.length,4);
});

test('journal corruption cannot authorize a replacement transfer or invent a completed receipt',async t=>{
 const f=await fixture(t);f.hide();await createHyperliquidTestnetFunding(f.options).request(request);const value=JSON.parse(await readFile(f.journalFile,'utf8'));value.grants[0].transfers[0].action.amount='1000';await writeFile(f.journalFile,JSON.stringify(value));
 const restarted=createHyperliquidTestnetFunding(f.options);assert.equal((await restarted.configuration()).reason,'operator_unavailable');await assert.rejects(restarted.request(request),/journal unavailable/);assert.equal(f.transactions.length,1);
});

test('sponsored transfer signatures bind the official Testnet domain and cannot substitute mainnet, amounts, expiresAfter or arbitrary tokens',()=>{
 const action={type:'usdSend',signatureChainId:'0x66eee',hyperliquidChain:'Testnet',destination:account,amount:'100',time:1700000000000};
 assert.deepEqual(fundingTypedData(action).domain,{name:'HyperliquidSignTransaction',version:'1',chainId:421614,verifyingContract:'0x'+'0'.repeat(40)});
 for(const altered of [{...action,hyperliquidChain:'Mainnet'},{...action,signatureChainId:'0xa4b1'},{...action,amount:'101'},{...action,expiresAfter:1700000000001},{...action,type:'spotSend',token:'HYPE'}])assert.throws(()=>fundingTypedData(altered),/Invalid sponsored testnet transfer/);
});

test('private funding files cannot enter a repository directory whose name starts with two dots',async t=>{
 const f=await fixture(t);for(const path of ['operator-secrets/journal.json','..operator-secrets/journal.json']){
  const service=createHyperliquidTestnetFunding({...f.options,journalFile:resolve(path)});assert.equal((await service.configuration()).reason,'operator_unavailable');
 }assert.equal(f.transactions.length,0);
});
