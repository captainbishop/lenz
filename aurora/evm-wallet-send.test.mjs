import test from 'node:test';
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {createCustomCommon,Hardfork,Mainnet} from '@ethereumjs/common';
import {createLegacyTx} from '@ethereumjs/tx';
import {createAccount,createAddressFromPrivateKey,createAddressFromString,hexToBytes} from '@ethereumjs/util';
import {createVM,runTx} from '@ethereumjs/vm';
import {Interface,hexlify} from 'ethers';
import {compileSource} from './compiler.mjs';
import {prepareTransfer,transferAssets} from '../web/public/evm-transfer.js';
import {createTransferService} from '../web/public/evm-transfer-service.js';
import {memoryJournal} from '../web/evm-transfer-fixtures.mjs';
const source=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
contract SendFixture {
 uint8 public constant decimals=6;
 mapping(address=>uint256) public balanceOf;
 event Transfer(address indexed from,address indexed to,uint256 value);
 function mint(address to,uint256 value) external {balanceOf[to]+=value;}
 function transfer(address to,uint256 value) external returns(bool){balanceOf[msg.sender]-=value;balanceOf[to]+=value;emit Transfer(msg.sender,to,value);return true;}
}`;
const compiled=compileSource('SendFixture.sol',source,'SendFixture'),iface=new Interface(compiled.abi),hex=n=>'0x'+n.toString(16);
test('real isolated EVM executes reviewed native and ERC20 transactions; recovery only reads their receipts',async()=>{
 const common=createCustomCommon({chainId:1},Mainnet,{hardfork:Hardfork.Paris}),vm=await createVM({common}),key=randomBytes(32),sender=createAddressFromPrivateKey(key),recipient=createAddressFromString('0x'+'34'.repeat(20));
 await vm.stateManager.putAccount(sender,createAccount({balance:10n**20n}));
 const token=transferAssets('0x1').find(a=>a.symbol==='USDC'),contract=createAddressFromString(token.id);await vm.stateManager.putCode(contract,hexToBytes('0x'+compiled.evm.deployedBytecode.object));
 await vm.evm.runCall({caller:sender,to:contract,data:hexToBytes(iface.encodeFunctionData('mint',[sender.toString(),10000000n])),gasLimit:500000n});
 async function call(data){await vm.stateManager.checkpoint();try{return hexlify((await vm.evm.runCall({caller:sender,to:contract,data:hexToBytes(data),isStatic:true,gasLimit:500000n})).execResult.returnValue);}finally{await vm.stateManager.revert();}}
 const transactions=new Map(),receipts=new Map(),blocks=new Map();let block=40n,sends=0;
 const lease={identity:{address:sender.toString(),chainId:'0x1'},assertCurrent(){},async request(method,params){
  if(method==='eth_accounts')return [sender.toString()];if(method==='eth_chainId')return '0x1';
  if(method==='eth_getBalance')return hex((await vm.stateManager.getAccount(createAddressFromString(params[0])))?.balance??0n);
  if(method==='eth_getTransactionCount')return hex((await vm.stateManager.getAccount(sender)).nonce);
  if(method==='eth_gasPrice')return '0x3b9aca00';if(method==='eth_estimateGas')return params[0].data==='0x'?'0x5208':'0x186a0';
  if(method==='eth_getCode')return hexlify(await vm.stateManager.getCode(contract));if(method==='eth_call')return call(params[0].data);
  if(method==='eth_getTransactionByHash')return transactions.get(params[0])??null;if(method==='eth_getTransactionReceipt')return receipts.get(params[0])??null;
  if(method==='eth_getBlockByNumber')return params[0]==='finalized'?{number:hex(block),hash:'0x'+block.toString(16).padStart(64,'0')}:blocks.get(params[0]);throw Error(method);
 },async sendTransaction(tx){
  sends++;const signed=createLegacyTx({nonce:BigInt(tx.nonce),gasPrice:BigInt(tx.gasPrice),gasLimit:BigInt(tx.gas),value:BigInt(tx.value),to:createAddressFromString(tx.to),data:hexToBytes(tx.data)},{common}).sign(key);
  const result=await runTx(vm,{tx:signed});assert.equal(result.receipt.status,1);assert(!result.execResult.exceptionError);
  const id=hexlify(signed.hash()),blockNumber=hex(++block),blockHash='0x'+block.toString(16).padStart(64,'0');
  transactions.set(id,{...tx,input:tx.data,hash:id,blockNumber,blockHash,transactionIndex:'0x0'});
  receipts.set(id,{transactionHash:id,from:tx.from,to:tx.to,blockNumber,blockHash,transactionIndex:'0x0',status:'0x1',gasUsed:hex(result.totalGasSpent),effectiveGasPrice:tx.gasPrice,logs:(result.execResult.logs??[]).map(([a,topics,data])=>({address:hexlify(a),topics:topics.map(hexlify),data:hexlify(data)}))});
  blocks.set(blockNumber,{number:blockNumber,hash:blockHash,transactions:[id]});return id;
 }};
 const service=createTransferService(memoryJournal()),native=await prepareTransfer(lease,{asset:'native',recipient:recipient.toString(),amount:'1.25',publicConsent:true});
 const nativeSent=await service.send(lease,native);assert.equal((await vm.stateManager.getAccount(recipient)).balance,1250000000000000000n);assert.equal((await service.reconcile(lease,nativeSent.id)).state,'confirmed');
 const tokenReview=await prepareTransfer(lease,{asset:token.id,recipient:recipient.toString(),amount:'2.500001',publicConsent:true}),tokenSent=await service.send(lease,tokenReview);
 assert.equal(iface.decodeFunctionResult('balanceOf',await call(iface.encodeFunctionData('balanceOf',[recipient.toString()])))[0],2500001n);
 assert.equal(iface.decodeFunctionResult('balanceOf',await call(iface.encodeFunctionData('balanceOf',[sender.toString()])))[0],7499999n);
 assert.equal((await service.reconcile(lease,tokenSent.id)).state,'confirmed');await service.reconcile(lease,tokenSent.id);assert.equal(sends,2);
});
