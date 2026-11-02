import test from 'node:test';
import assert from 'node:assert/strict';
import {Interface,hexlify} from 'ethers';
import {createAddressFromString,hexToBytes} from '@ethereumjs/util';
import {compileSource} from './compiler.mjs';
import {createLocalEvm} from './local-evm.mjs';
import {inspectEngineTransfer} from './engine-transfer.mjs';
import {transferFixture,transferReceipt} from './engine-transfer-fixtures.mjs';
// Small adversarial ERC-20 fixture; no production token, funding or deployment.
const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
contract TransferFixture {
  mapping(address=>uint256) public balanceOf;
  uint256 public mode;
  event Transfer(address indexed from,address indexed to,uint256 amount);
  constructor(address owner,uint256 selected){balanceOf[owner]=10000000;mode=selected;}
  function transfer(address to,uint256 amount) external returns(bool){
    require(mode!=5,"fixture revert");
    if(mode==1)return false;
    if(mode!=4){
      balanceOf[msg.sender]-=amount;
      balanceOf[to]+=mode==3?amount-1:amount;
      if(mode==3){balanceOf[address(0xbeef)]+=1;emit Transfer(msg.sender,address(0xbeef),1);}
    }
    if(mode!=2)emit Transfer(msg.sender,to,mode==3?amount-1:amount);
    return true;
  }
}`;
const compiled=compileSource('TransferFixture.sol',source,'TransferFixture'),iface=new Interface(compiled.abi);
test('actual local EVM transfer state and logs agree; false/no-log/fee/revert paths do not report success',async()=>{
  for(const mode of [0,1,2,3,5]){
    const f=transferFixture(),evm=await createLocalEvm();
    const deploy=await evm.send('0x'+compiled.evm.bytecode.object+iface.encodeDeploy([f.payment.from,mode]).slice(2)),token=deploy.createdAddress;
    assert(token);assert.equal(hexlify(await evm.vm.stateManager.getCode(token)),'0x'+compiled.evm.deployedBytecode.object);
    f.payment.token=token.toString();f.reference.contract=token.toString();
    const balance=async a=>iface.decodeFunctionResult('balanceOf',await evm.call(iface.encodeFunctionData('balanceOf',[a]),token))[0];
    const before=[await balance(f.payment.from),await balance(f.payment.to)];
    // Engine caller derivation is supplied explicitly; this is not a live NEAR receipt.
    const result=await evm.vm.evm.runCall({caller:createAddressFromString(f.payment.from),to:token,data:hexToBytes(f.reference.input),gasLimit:500000n});
    const logs=(result.execResult.logs??[]).map(([address,topics,data])=>({address:hexlify(address),topics:topics.map(hexlify),data:hexlify(data)}));
    const receipt=transferReceipt(f.reference,{logs,output:hexlify(result.execResult.returnValue),tag:result.execResult.exceptionError?1:0});
    const checked=inspectEngineTransfer(f.reference,f.payment,receipt),after=[await balance(f.payment.from),await balance(f.payment.to)];
    if(mode===0){assert.equal(checked.transfer.state,'reported');assert.equal(before[0]-after[0],1000000n);assert.equal(after[1]-before[1],1000000n);}
    else assert.notEqual(checked.transfer.state,'reported');
    if(mode===1||mode===5)assert.deepEqual(after,before);
    if(mode===2)assert.equal(after[1]-before[1],1000000n);
    if(mode===3){assert.equal(after[1]-before[1],999999n);assert.equal(await balance('0x000000000000000000000000000000000000beef'),1n);}
  }
});
test('a lying token can report the event without moving balances; reported is never a settlement proof',async()=>{
  const f=transferFixture(),evm=await createLocalEvm();
  const deploy=await evm.send('0x'+compiled.evm.bytecode.object+iface.encodeDeploy([f.payment.from,4]).slice(2)),token=deploy.createdAddress;
  f.payment.token=token.toString();f.reference.contract=token.toString();
  const read=async()=>hexlify(await evm.call(iface.encodeFunctionData('balanceOf',[f.payment.to]),token));
  const before=await read(),result=await evm.vm.evm.runCall({caller:createAddressFromString(f.payment.from),to:token,data:hexToBytes(f.reference.input),gasLimit:500000n});
  const logs=result.execResult.logs.map(([address,topics,data])=>({address:hexlify(address),topics:topics.map(hexlify),data:hexlify(data)}));
  const checked=inspectEngineTransfer(f.reference,f.payment,transferReceipt(f.reference,{logs,output:hexlify(result.execResult.returnValue)}));
  assert.equal(checked.transfer.state,'reported');assert.equal(await read(),before);assert.equal(checked.transfer.settled,undefined);
});
