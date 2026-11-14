import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface} from '../aurora/node_modules/ethers/lib.esm/index.js';
import {LENDING_TESTNET} from './public/intent-lending-config.js';
import {createLendingFundingReader} from './intent-lending-funding-read.mjs';
const address=d=>'0x'+d.repeat(40),hash=d=>'0x'+d.repeat(64),scalar=d=>'0x'+'0'.repeat(63)+d;
const input={owner:'a'.repeat(64),ownerAddress:address('8'),account:address('6'),commitment:scalar('3')},sponsorAddress=address('9'),now=1800000000000;
const config={...LENDING_TESTNET,privacyPool:address('2'),privacyPoolDeploymentBlock:'99'},block={number:'0x64',hash:hash('a'),timestamp:'0x6b49d200'};
const abi=new Interface(['function nextIndex() view returns(uint32)','function getLastRoot() view returns(bytes32)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function commitments(bytes32) view returns(bool)','event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)']);
function fixture(){
  const calls=[],state={deposited:true,allowance:'0',reorg:false},snapshot={chainId:config.chain,observedAt:now,block:{number:'100',hash:block.hash,timestamp:String(BigInt(block.timestamp)),finality:'finalized',requireCanonical:true},routeVerified:true,trust:{codePinsVerified:true,implementationPinsVerified:true,executionPinsVerified:true}};
  const event={address:config.privacyPool,removed:false,blockNumber:'0x63',blockHash:hash('b'),transactionHash:hash('c'),logIndex:'0x0',...abi.encodeEventLog(abi.getEvent('Deposit'),[input.commitment,0,BigInt(block.timestamp)])};
  const fetchImpl=async(url,options)=>{
    assert.equal(url,config.rpc);assert.equal(options.redirect,'error');const request=JSON.parse(options.body);calls.push(request);let result;
    if(request.method==='eth_chainId')result=config.chainHex;
    else if(request.method==='eth_getLogs')result=[event];
    else if(request.method==='eth_getBlockByNumber')result=request.params[0]==='0x63'?{...block,number:'0x63',hash:hash('b')}:{...block,...(state.reorg?{hash:hash('d')}:{})};
    else if(request.method==='eth_call'){
      assert.deepEqual(request.params[1],{blockHash:block.hash,requireCanonical:true});
      const call=abi.parseTransaction({data:request.params[0].data});let value;
      if(call.name==='nextIndex')value=1;
      else if(call.name==='getLastRoot')value=scalar('1');
      else if(call.name==='balanceOf')value=call.args[0].toLowerCase()===sponsorAddress?'100000000000000000000':config.denomination;
      else if(call.name==='allowance'){assert.equal(call.args[0].toLowerCase(),sponsorAddress);assert.equal(call.args[1].toLowerCase(),config.privacyPool);value=state.allowance;}
      else if(call.name==='commitments'){assert.equal(call.args[0],input.commitment);value=state.deposited;}
      else assert.fail(call.name);result=abi.encodeFunctionResult(call.name,[value]);
    }else assert.fail('Unsupported/mutating RPC '+request.method);
    return Response.json({jsonrpc:'2.0',id:request.id,result});
  };
  const reader=createLendingFundingReader({deployment:config,sponsorAddress,fetchImpl,now:()=>now,readSnapshot:async(_input,options)=>({...structuredClone(snapshot),block:{...snapshot.block,finality:options.blockTag}})});
  return{reader,state,calls};
}
test('the faucet reader binds inventory, exact allowance and original deposit at the chosen canonical block',async()=>{
  const f=fixture(),value=await f.reader.fundingSnapshot(input);
  assert.equal(value.operator.address,sponsorAddress);assert.equal(value.operator.inputBalance,'100000000000000000000');assert.equal(value.operator.allowance,'0');assert.equal(value.deposit.commitment,input.commitment);assert.equal(value.snapshot.block.finality,'finalized');
  assert.equal((await f.reader.fundingSnapshot(input,{blockTag:'latest'})).snapshot.block.finality,'latest');assert.ok(f.calls.every(call=>!/^eth_send|^eth_sign/.test(call.method)));
});
test('mapping/history disagreement and canonical replacement cannot be called a funded note',async()=>{
  for(const change of [f=>{f.state.deposited=false;},f=>{f.state.reorg=true;}]){const f=fixture();change(f);await assert.rejects(f.reader.fundingSnapshot(input));}
});
