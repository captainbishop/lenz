import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {preflightDegen} from './degen-preflight.mjs';
import {checkedDegenPreflight} from '../web/public/degen-preflight.js';
const {Interface}=createRequire(new URL('../aurora/package.json',import.meta.url))('ethers');
const abi=new Interface(['function decimals() view returns(uint8)','function symbol() view returns(string)','function getPool(address,address,uint24) view returns(address)','function token0() view returns(address)','function token1() view returns(address)','function fee() view returns(uint24)','function liquidity() view returns(uint128)','function slot0() view returns(uint160,int24,uint16,uint16,uint16,uint8,bool)','function factory() view returns(address)','function WETH9() view returns(address)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)','function exactInputSingle((address,address,uint24,address,uint256,uint256,uint160)) payable returns(uint256)','function multicall(uint256,bytes[]) payable returns(bytes[])','function getL1FeeUpperBound(uint256) view returns(uint256)','function getOperatorFee(uint256) view returns(uint256)']);
export const NOW=1800000000000,token='0x'+'11'.repeat(20),pool='0x'+'22'.repeat(20),account='0x'+'33'.repeat(20),weth='0x4200000000000000000000000000000000000006',factory='0x33128a8fc17869897dce68ed026d694621f6fdfd',router='0x2626664c2603336e57b271c5c0b26f421741e481';
const assets=[{id:token,symbol:'DGN',decimals:18},{id:weth,symbol:'WETH',decimals:18}];
export const quote={version:1,kind:'degen-quote',request:{kind:'quote',network:'base',pool,token,privacy:'public',side:'buy',amount:'0.25',slippageBps:50},assets,feePips:3000,input:assets[1],output:assets[0],inputUnits:'250000000000000000',outputUnits:'42000000000000000000',minOutputUnits:'41790000000000000000',gasUnits:'120000',observedAt:NOW,expiresAt:NOW+30000,evidence:{source:'https://mainnet.base.org',blockNumber:'4660',blockHash:'0x'+'ab'.repeat(32),blockTimestamp:NOW-1000},executable:false};
export function fixture(edit=()=>{}){
 const calls=[],state={balance:1000000000000000000n,allowance:0n,native:1000000000000000000n};
 const block={number:'0x1234',hash:quote.evidence.blockHash,timestamp:'0x'+BigInt((NOW-1000)/1000).toString(16)};
 return {state,calls,clock:()=>NOW,fetcher:async(url,options)=>{
  assert.equal(url,'https://mainnet.base.org');const r=JSON.parse(options.body);calls.push(r);let result;
  if(r.method==='eth_chainId')result='0x2105';
  else if(r.method==='eth_getBlockByNumber')result={...block};
  else if(r.method==='eth_getCode')result=r.params[0]===account?'0x':'0x6001';
  else if(r.method==='eth_getBalance')result='0x'+state.native.toString(16);
  else if(r.method==='eth_getTransactionCount')result='0x7';
  else if(r.method==='eth_gasPrice')result='0x3b9aca00';
  else if(r.method==='eth_call'){
   const tx=r.params[0],p=abi.parseTransaction(tx),name=p.name;
   const values={decimals:[tx.to==='0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'?6:18],symbol:[tx.to===token?'DGN':'WETH'],getPool:[pool],token0:[token],token1:[weth],fee:[3000],liquidity:[1000],slot0:[2n**96n,0,0,1,1,0,true],factory:[factory],WETH9:[weth],balanceOf:[tx.to===weth?state.balance:0n],allowance:[state.allowance],getL1FeeUpperBound:[1000n],getOperatorFee:[50n]}[name];
   const value={request:r,name,values};edit(value);result=abi.encodeFunctionResult(name,value.values);
  }else if(r.method==='eth_simulateV1'){
   let input=state.balance,output=0n,allowance=state.allowance;
   const results=r.params[0].blockStateCalls[0].calls.map(tx=>{
    const p=abi.parseTransaction(tx);let values,gas=25000;
    if(p.name==='balanceOf')values=[tx.to===weth?input:output];
    if(p.name==='allowance')values=[allowance];
    if(p.name==='approve'){assert.equal(p.args[0].toLowerCase(),router);allowance=p.args[1];values=[true];gas=50000;}
    if(p.name==='multicall'){
     assert.equal(p.args[0],1800000030n);assert.equal(p.args[1].length,1);const swap=abi.parseTransaction({data:p.args[1][0]}).args[0];
     assert.deepEqual([...swap].map(v=>typeof v==='string'?v.toLowerCase():v),[weth,token,3000n,account,250000000000000000n,41790000000000000000n,0n]);
     assert.equal(tx.from,account);assert.equal(tx.value,'0x0');assert(allowance>=swap[4]);input-=swap[4];output=42000000000000000000n;allowance-=swap[4];values=[['0x'+output.toString(16).padStart(64,'0')]];gas=120000;
    }
    return {status:'0x1',gasUsed:'0x'+gas.toString(16),maxUsedGas:'0x'+gas.toString(16),returnData:abi.encodeFunctionResult(p.name,values),logs:[]};
   });
   result=[{number:'0x1235',parentHash:block.hash,timestamp:'0x'+BigInt(NOW/1000).toString(16),calls:results}];
  }else assert.fail('Unexpected RPC '+r.method);
  const response={jsonrpc:'2.0',id:r.id,result};edit({request:r,response});return Response.json(response);
 }};
}
test('approval and swap are simulated together with exact asset changes and every Base fee',async()=>{
 const f=fixture(),r=await preflightDegen({quote,account,privacy:'public'},f);
 assert.equal(r.executable,false);assert.equal(r.simulation.status,'passed');assert.equal(r.simulation.receivedUnits,'42000000000000000000');assert.equal(r.simulation.spentUnits,'250000000000000000');
 assert.deepEqual(r.fees.actions.map(a=>a.kind),['approve','swap']);assert.equal(r.fees.totalWei,'204000000002100');assert.equal(r.affordable,true);
 assert(f.calls.every(c=>!c.method.includes('send')&&!c.method.includes('sign')));assert.equal(f.calls.filter(c=>c.method==='eth_simulateV1').length,1);
});

test('a next simulated Base block may share its parent timestamp but cannot predate it',async()=>{
 const next=timestamp=>fixture(s=>{if(s.response&&s.request.method==='eth_simulateV1')s.response.result[0].timestamp='0x'+BigInt(timestamp/1000).toString(16);});
 assert.equal((await preflightDegen({quote,account,privacy:'public'},next(NOW-1000))).simulation.status,'passed');
 await assert.rejects(preflightDegen({quote,account,privacy:'public'},next(NOW-2000)),/Simulation block changed/);
});
test('existing allowance skips approvals; nonzero insufficient allowance is reset exactly',async()=>{
 for(const [allowance,kinds]of [[250000000000000000n,['swap']],[1n,['reset-approval','approve','swap']]]){
  const f=fixture();f.state.allowance=allowance;const r=await preflightDegen({quote,account,privacy:'public'},f);assert.deepEqual(r.fees.actions.map(a=>a.kind),kinds);
 }
});
test('insufficient tokens and insufficient native fees remain separate from a successful simulation',async()=>{
 const f=fixture();f.state.balance=1n;const r=await preflightDegen({quote,account,privacy:'public'},f);assert.equal(r.simulation.status,'insufficient-token');assert.equal(r.fees,null);assert.equal(r.affordable,false);assert(!f.calls.some(c=>c.method==='eth_simulateV1'));
 const g=fixture();g.state.native=1n;const result=await preflightDegen({quote,account,privacy:'public'},g);assert.equal(result.simulation.status,'passed');assert.equal(result.affordable,false);
});
test('substituted router, tokens, contract wallet, failed calls and altered token effects cannot pass',async()=>{
 for(const edit of [s=>{if(s.name==='factory'&&s.request.params[0].to===router)s.values=[token];},s=>{if(s.name==='decimals'&&s.request.params[0].to===token)s.values=[6];},s=>{if(s.response&&s.request.method==='eth_getCode'&&s.request.params[0]===account)s.response.result='0x6001';},s=>{if(s.response&&s.request.method==='eth_simulateV1')s.response.result[0].parentHash='0x'+'cd'.repeat(32);},s=>{if(s.response&&s.request.method==='eth_simulateV1')s.response.result[0].calls[2].status='0x0';},s=>{if(s.response&&s.request.method==='eth_simulateV1')s.response.result[0].calls.at(-1).returnData=abi.encodeFunctionResult('balanceOf',[41700000000000000000n]);},s=>{if(s.response&&s.request.method==='eth_simulateV1')s.response.result[0].calls.at(-2).returnData=abi.encodeFunctionResult('balanceOf',[0]);}])await assert.rejects(preflightDegen({quote,account,privacy:'public'},fixture(edit)));
});
test('fees, account binding, fresh quote and explicit disclosure are mandatory',async()=>{
 const f=fixture();for(const request of [{quote,account,privacy:'private'},{quote,account,privacy:'public',transaction:{}},{quote:{...quote,expiresAt:NOW},account,privacy:'public'}])await assert.rejects(preflightDegen(request,f));assert.equal(f.calls.length,0);
 const expected={quote,account,privacy:'public'},r=await preflightDegen(expected,f);
 for(const mutate of [v=>v.request.account=token,v=>v.executable=true,v=>v.fees.totalWei='1',v=>v.fees.actions[0].l1Wei='0',v=>v.simulation.receivedUnits='1',v=>v.affordable=false,v=>v.transaction={to:router}]){const v=structuredClone(r);mutate(v);assert.throws(()=>checkedDegenPreflight(v,expected,{now:NOW}));}
 await assert.rejects(preflightDegen(expected,fixture(s=>{if(s.name==='getOperatorFee')throw Error('Method unavailable.');})),/unavailable/);
});
test('aborted requests stop before RPC and simulation uses no fabricated balances or authority',async()=>{
 const f=fixture(),controller=new AbortController();controller.abort();await assert.rejects(preflightDegen({quote,account,privacy:'public'},{...f,signal:controller.signal}));assert.equal(f.calls.length,0);
 await preflightDegen({quote,account,privacy:'public'},f);const request=f.calls.find(c=>c.method==='eth_simulateV1');assert.deepEqual(Object.keys(request.params[0]).sort(),['blockStateCalls','traceTransfers','validation']);assert.deepEqual(Object.keys(request.params[0].blockStateCalls[0]),['calls']);
});
