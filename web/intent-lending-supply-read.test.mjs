import test from 'node:test';
import assert from 'node:assert/strict';
import { Interface,keccak256 } from '../aurora/node_modules/ethers/lib.esm/index.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { buildLendingSupplyPreparation,lendingSupplySignals } from './public/intent-lending-supply.js';
import { createLendingSupplyReader } from './intent-lending-supply-read.mjs';

const address = digit => '0x'+digit.repeat(40), hash = digit => '0x'+digit.repeat(64), scalar = digit => '0x'+'0'.repeat(63)+digit;
const now=1800000000000, block={number:'0x64',hash:hash('a'),timestamp:'0x6b49d200'};
const config={...LENDING_TESTNET,lendingFactory:address('1'),privacyPool:address('2'),supplyFactory:address('3'),verifier:address('4'),hasher:address('5'),privacyPoolDeploymentBlock:'99',supplyVaultCreationCode:'0x60006000',codeHashes:Object.fromEntries(['pool','link','usdc','aLink','variableDebt','lendingFactory','privacyPool','supplyFactory','verifier','hasher'].map(key=>[key,hash('9')]))};
const plan={beneficiary:address('6'),refundRecipient:address('6'),minScaledCredit:'900000000000000000',deadline:'1800000300',salt:hash('7')};
const abi=new Interface(['function vaultAddress((address beneficiary,address refundRecipient,uint256 minScaledCredit,uint256 deadline,bytes32 salt)) view returns(address)','function nextIndex() view returns(uint32)','function getLastRoot() view returns(bytes32)','function isKnownRoot(bytes32) view returns(bool)','function isSpent(bytes32) view returns(bool)','function verifyProof(bytes,uint256[6]) view returns(bool)','function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)',...['inputToken','aavePool','aToken','beneficiary','refundRecipient'].map(name=>`function ${name}() view returns(address)`),...['inputAmount','minScaledCredit','deadline','chainId','status'].map(name=>`function ${name}() view returns(uint256)`),...['salt','inputCodeHash','aavePoolCodeHash','aTokenCodeHash'].map(name=>`function ${name}() view returns(bytes32)`),'event Deposit(bytes32 indexed commitment,uint32 leafIndex,uint256 timestamp)','event Withdrawal(address to,bytes32 nullifierHash,address indexed relayer,uint256 fee)']);
function fixture() {
  const prep=buildLendingSupplyPreparation({ownerAddress:address('8'),plan,root:scalar('1'),nullifierHash:scalar('2')},{config}),proof='0x'+'ab'.repeat(256),publicSignals=lendingSupplySignals(prep);
  const request={...prep,proof,publicSignals,artifactId:'lending-supply-proof:'+keccak256(new TextEncoder().encode(JSON.stringify({intentId:prep.id,proof,publicSignals}))).slice(2)};
  const snapshot={chainId:config.chain,observedAt:now,block:{number:'100',hash:block.hash,timestamp:String(BigInt(block.timestamp)),finality:'finalized',requireCanonical:true},routeVerified:true,trust:{executionPinsVerified:true,codePinsVerified:true,implementationPinsVerified:true}};
  const deposit={address:config.privacyPool,removed:false,blockNumber:'0x63',blockHash:hash('b'),transactionHash:hash('c'),logIndex:'0x0',...abi.encodeEventLog(abi.getEvent('Deposit'),[scalar('3'),0,BigInt(block.timestamp)])};
  const state={chain:config.chainHex,deployed:false,spent:false,proofValid:true,knownRoot:true,reorg:false,logs:[deposit],values:{},stall:false},calls=[];
  const terms={inputToken:config.link,aavePool:config.pool,aToken:config.aLink,inputAmount:config.denomination,...plan,chainId:String(config.chainId),inputCodeHash:config.codeHashes.link,aavePoolCodeHash:config.codeHashes.pool,aTokenCodeHash:config.codeHashes.aLink,status:'0'};
  async function fetchImpl(url,options) {
    assert.equal(url,config.rpc);assert.equal(options.redirect,'error');
    const rpc=JSON.parse(options.body);calls.push(rpc);let result;
    if(state.stall)return new Response(new ReadableStream());
    if(rpc.method==='eth_chainId')result=state.chain;
    else if(rpc.method==='eth_getLogs')result=state.logs;
    else if(rpc.method==='eth_getBlockByNumber')result=rpc.params[0]==='0x63'?{...block,number:'0x63',hash:hash('b')}:{...block,...(state.reorg?{hash:hash('d')}:{} )};
    else {
      assert.deepEqual(rpc.params[1],{blockHash:block.hash,requireCanonical:true});
      if(rpc.method==='eth_getCode')result=state.deployed?'0x600001':'0x';
      else if(rpc.method==='eth_call') {
        const call=abi.parseTransaction({data:rpc.params[0].data}), name=call.name;
        let value=state.values[name];
        if(value===undefined) {
          if(name==='nextIndex')value=1;
          else if(name==='getLastRoot')value=scalar('1');
          else if(name==='vaultAddress')value=request.vault;
          else if(name==='isKnownRoot')value=state.knownRoot;
          else if(name==='isSpent')value=state.spent;
          else if(name==='verifyProof')value=state.proofValid;
          else if(name==='balanceOf')value=call.args[0].toLowerCase()===config.privacyPool?config.denomination:'0';
          else if(name==='allowance')value='0';
          else value=terms[name];
        }
        assert.notEqual(value,undefined,name);result=abi.encodeFunctionResult(name,[value]);
      } else assert.fail('Unsupported or mutating RPC '+rpc.method);
    }
    return Response.json({jsonrpc:'2.0',id:rpc.id,result});
  }
  const make=()=>createLendingSupplyReader({deployment:config,fetchImpl,now:()=>now,readSnapshot:async()=>structuredClone(snapshot),timeoutMs:100});
  return {request,prep,state,calls,snapshot,make};
}

test('Supply reads the complete canonical pool and original proof at the same finalized block without sending',async()=>{
  const f=fixture(),result=await f.make().supplySnapshot(f.request);
  assert.equal(result.proofValid,true);assert.equal(result.spent,false);assert.equal(result.vault.deployed,false);assert.deepEqual(result.snapshot.privatePool.commitments,[scalar('3')]);
  assert.ok(f.calls.every(call=>!/^eth_send|^eth_sign/.test(call.method)));
  const proofCall=f.calls.filter(call=>call.method==='eth_call').map(call=>abi.parseTransaction({data:call.params[0].data})).find(call=>call.name==='verifyProof');
  assert.deepEqual(proofCall.args[1].map(String),f.request.publicSignals);
});

test('Supply refuses a changed deterministic vault, immutable beneficiary or contradictory history',async()=>{
  for(const change of [f=>{f.state.values.vaultAddress=address('9');},f=>{f.state.deployed=true;f.state.values.beneficiary=address('9');},f=>{f.state.spent=true;},f=>{f.state.logs=[];},f=>{f.state.logs.push(f.state.logs[0]);},f=>{f.state.reorg=true;},f=>{f.state.chain='0x1';}]) {
    const f=fixture();change(f);await assert.rejects(f.make().supplySnapshot(f.request));assert.ok(f.calls.every(call=>!/^eth_send|^eth_sign/.test(call.method)));
  }
});

test('unverifiable proof results stay false and stalled response bodies stop at the read deadline',async()=>{
  const f=fixture();f.state.proofValid=false;assert.equal((await f.make().supplySnapshot(f.request)).proofValid,false);
  f.state.stall=true;const expiry=new Promise((_,reject)=>setTimeout(()=>reject(Error('reader did not expire')),1000));
  await assert.rejects(Promise.race([f.make().supplySnapshot(f.request),expiry]),error=>error.name==='TimeoutError');
});

test('the default reader keeps Supply metadata outside the fixed lending deployment overlay',()=>{
  assert.doesNotThrow(()=>createLendingSupplyReader({deployment:config}));
});
