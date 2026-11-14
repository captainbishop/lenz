import test from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {createDefiRoute} from './defi-relay.mjs';
import * as status from './defi-status.mjs';
import {createDefiExecutorClients} from '../contracts/defi-executor-client.mjs';
import {createIdentity} from './public/peer-crypto.js';
import {emptyNearVault,fundingRequest} from './public/near-protocol.js';
import {prepareRheaSwap} from './public/rhea-protocol.js';
import {prepareRefundReturn} from './public/near-deposit.js';
import {createDefiRequest,PUBLIC_TESTNET_DISCLOSURE} from './public/defi-request.js';
async function fixture(){
  const logical={network:'testnet',adapter:'adapter.lenz.testnet',reserve:'reserve.lenz.testnet',exchange:'ref-finance-101.testnet',poolId:2870,tokenOut:'wrap.testnet'};
  const config={...logical,ready:true,codeHash:'2'.repeat(32),exchangeCodeHash:'3'.repeat(32)},owner=await createIdentity('Owner'),executor=await createIdentity('Executor'),now=Date.now();
  const vault=emptyNearVault(config.reserve),funding=await fundingRequest(owner,config.reserve,'10');vault.roots.push({id:funding.id,owner:funding.owner,amount:funding.amount});
  const prepared=await prepareRheaSwap(vault,owner,config,{text:'4',minOutput:'100',receiver:'receiver.testnet',deadlineMs:now+1000},now),packet=prepared.packet;
  const request=await createDefiRequest(owner,executor.profile,config,{kind:'rhea-swap',packet},{disclosure:PUBLIC_TESTNET_DISCLOSURE,expiresAt:now+1000},now);
  const order={id:packet.id,instruction:packet.instruction,stage:'refunded',output:'0',reason:''},deposit=await prepareRefundReturn(vault,owner,{packet,status:order});
  const state={order,root:null,spent:null,chain:'testnet',hash:'4'.repeat(32),age:0,code:true},queries=[];
  const rpc={
    async sendJsonRpc(){return {chain_id:state.chain};},
    async viewBlock(){return {header:{hash:state.hash,height:20,timestamp_nanosec:String(BigInt(now+2000-state.age)*1000000n)}};},
    async viewAccount({accountId,blockQuery}){queries.push(blockQuery);return {code_hash:!state.code?'9'.repeat(32):accountId===config.adapter?config.codeHash:accountId===config.exchange?config.exchangeCodeHash:'1'.repeat(32)};},
    async callFunction({method,args,blockQuery}){
      queries.push(blockQuery);
      if(method==='configuration')return logical;
      if(method==='get_root')return args.id===packet.root.id?packet.root:state.root;
      if(method==='get_order')return state.order;
      if(method==='spent_by')return state.spent;
      if(method==='capabilities')return ['deposit_offline_v1'];
      if(method==='ft_balance_of')return deposit.amount;
      assert.fail('Unexpected method '+method);
    },
    sendTransactionUntil(){assert.fail('Read cannot dispatch');},
  };
  const options={configuration:async()=>config,createClients:async(c,controls)=>{assert.throws(controls.getSigner,/cannot sign/);return createDefiExecutorClients(c,{...controls,rpc,now:()=>now+2000,reserveConfig:async()=>({network:'testnet',ready:true,contract:c.reserve,wasmSha256:'0'.repeat(64)})});}};
  return {input:{sender:owner.profile,executor:executor.profile,request,deposit},options,state,queries};
}
test('refund reader checks pinned final reserve evidence after approval expiry and exposes no dispatch action',async()=>{
  const f=await fixture();
  const pending=await status.readDefiRefund(f.input,f.options);assert.equal(pending.state,'ready');assert.equal(pending.observation.deposit,null);assert.equal(pending.observation.call,undefined);
  const d=f.input.deposit;f.state.root={id:d.id,owner:d.owner,amount:'4000000'};
  const backed=await status.readDefiRefund(f.input,f.options);assert.equal(backed.state,'observed');assert.deepEqual(backed.observation.deposit,{root:f.state.root,spent:null});
  f.state.spent='a'.repeat(64);assert.equal((await status.readDefiRefund(f.input,f.options)).observation.deposit.spent,'a'.repeat(64));
  assert(f.queries.length>0);assert(f.queries.every(q=>q.blockId==='4'.repeat(32)));
  for(const change of [()=>f.state.chain='mainnet',()=>f.state.age=180000,()=>f.state.code=false,()=>f.state.root.amount='4000001',()=>f.state.spent=undefined,()=>f.state.order.stage='refund_available']){
    const before=structuredClone(f.state);change();await assert.rejects(status.readDefiRefund(f.input,f.options));Object.assign(f.state,before);
  }
  for(const change of [d=>d.payer='other.testnet',d=>d.owner='02'+'a'.repeat(64),d=>d.source='a'.repeat(64),d=>d.contract='other.testnet']){
    const bad=structuredClone(f.input);change(bad.deposit);await assert.rejects(status.readDefiRefund(bad,f.options));
  }
});
test('local refund HTTP route bounds input, rejects foreign origins and only invokes its read service',async()=>{
  let reads=0;const route=createDefiRoute({readDefiRefund:async()=>{reads++;return {state:'ready'};}});
  const request=(body,changes={})=>Object.assign(Readable.from([Buffer.from(JSON.stringify(body))]),{url:'/api/defi/rhea/refund-status',method:'POST',headers:{host:'127.0.0.1:4173',origin:'http://127.0.0.1:4173','content-type':'application/json'},...changes});
  const response=()=>({writeHead(status,headers){this.status=status;this.headers=headers;},end(body){this.body=JSON.parse(body);}});
  const good=response();await route(request({request:'x'.repeat(6000)}),good);assert.equal(good.status,200);assert.equal(good.body.state,'ready');assert.equal(good.headers['Cache-Control'],'no-store');
  for(const req of [request({data:'x'.repeat(65536)}),request({},{headers:{host:'127.0.0.1:4173',origin:'https://foreign.example'}}),request({},{method:'GET'}),request({},{headers:{host:'foreign.example:4173',origin:'http://127.0.0.1:4173'}})]){
    const res=response();await route(req,res);assert([400,403,405].includes(res.status));
  }assert.equal(reads,1);
});
