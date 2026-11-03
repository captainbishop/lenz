// Actual isolated EVM execution with ephemeral accounts and a synthetic venue.
import assert from 'node:assert/strict';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createCustomCommon,Hardfork,Mainnet} from '@ethereumjs/common';
import {createLegacyTx} from '@ethereumjs/tx';
import {createBlock} from '@ethereumjs/block';
import {createAccount,createAddressFromPrivateKey,createAddressFromString,hexToBytes} from '@ethereumjs/util';
import {createVM,runTx} from '@ethereumjs/vm';
import {Interface,hexlify,keccak256} from 'ethers';
import {compileSource} from './compiler.mjs';
import {PUBLIC_BUDGET_REHEARSAL,offlineSignerAddress,signBudgetOrder,budgetCallHash} from '../web/public/offline-budget.js';
const venueSource=`// SPDX-License-Identifier: MIT
pragma solidity 0.8.38;
contract OutputToken {
 mapping(address=>uint256) public balanceOf;
 function mint(address to,uint256 value) external {balanceOf[to]+=value;}
}
contract BudgetVenue {
 OutputToken public immutable token;
 mapping(address=>uint256) public rewards;
 uint256 public rate=2;
 bool public fail;
 address public attackTarget;
 bytes public attackData;
 bool public reentered;
 constructor(address t){token=OutputToken(t);}
 function configure(uint256 r,bool f)external{rate=r;fail=f;}
 function attack(address target,bytes calldata data)external{attackTarget=target;attackData=data;}
 function exchange(address to)external payable{
  require(!fail,"venue failure");
  if(attackTarget!=address(0)){(bool ok,)=attackTarget.call(attackData);reentered=ok;}
  rewards[msg.sender]+=msg.value;
  token.mint(to,msg.value*rate);
 }
 function claim(address to)external payable{uint256 value=rewards[msg.sender];rewards[msg.sender]=0;token.mint(to,value);}
}
contract NativeVenue {
 function exchange(address payable to,uint256 amount) external payable {require(amount<=msg.value);(bool ok,)=to.call{value:amount}("");require(ok);}
}
contract RejectEther {receive()external payable{revert("no fee");}}
contract RejectingOwner {
 function forward(address target,bytes calldata data)external payable{(bool ok,)=target.call{value:msg.value}(data);require(ok,"owner call failed");}
 receive()external payable{revert("no refund");}
}
`;
let compiled;
async function contracts(){if(!compiled){const source=await readFile(process.env.LENZ_BUDGET_CONTRACT_SOURCE||new URL('./contracts/OfflineBudget.sol',import.meta.url),'utf8');compiled={budget:compileSource('OfflineBudget.sol',source,'OfflineBudget')};for(const name of ['OutputToken','BudgetVenue','NativeVenue','RejectEther','RejectingOwner'])compiled[name]=compileSource('Venue.sol',venueSource,name);}return compiled;}
export async function budgetFixture({chainId=31337}={}){
 const common=createCustomCommon({chainId},Mainnet,{hardfork:Hardfork.Paris}),vm=await createVM({common}),now=Math.floor(Date.now()/1000);
 const actors={};for(const name of ['owner','relayer','attacker']){const key=randomBytes(32),address=createAddressFromPrivateKey(key);actors[name]={key,address};await vm.stateManager.putAccount(address,createAccount({balance:100n*10n**18n}));}
 const secret=new Uint8Array(randomBytes(32)),signer=offlineSignerAddress(secret),c=await contracts(),budgetInterface=new Interface(c.budget.abi);let time=now;
 const block=()=>createBlock({header:{number:1n,timestamp:BigInt(time),gasLimit:30000000n,baseFeePerGas:1n}},{common});
 async function send(actor,to,data,value=0n){const a=actors[actor],account=await vm.stateManager.getAccount(a.address);const tx=createLegacyTx({nonce:account.nonce,gasPrice:1000000000n,gasLimit:12000000n,to:to?createAddressFromString(to):undefined,value,data:hexToBytes(data)},{common}).sign(a.key);return runTx(vm,{tx,block:block()});}
 async function read(to,iface,name,args=[]){await vm.stateManager.checkpoint();try{const r=await vm.evm.runCall({caller:actors.owner.address,to:createAddressFromString(to),data:hexToBytes(iface.encodeFunctionData(name,args)),gasLimit:12000000n,isStatic:true,block:block()});assert(!r.execResult.exceptionError,r.execResult.exceptionError?.error);return iface.decodeFunctionResult(name,hexlify(r.execResult.returnValue));}finally{await vm.stateManager.revert();}}
 async function deploy(name,args=[]){const compiled=c[name],iface=new Interface(compiled.abi),result=await send('owner',null,'0x'+compiled.evm.bytecode.object+iface.encodeDeploy(args).slice(2));assert.equal(result.receipt.status,1,hexlify(result.execResult.returnValue));return {address:result.createdAddress.toString(),iface};}
 const token=await deploy('OutputToken'),venue=await deploy('BudgetVenue',[token.address]),native=await deploy('NativeVenue'),rejector=await deploy('RejectEther'),rejectingOwner=await deploy('RejectingOwner');
 const deployed=await send('owner',null,'0x'+c.budget.evm.bytecode.object);
 if(chainId!==31337)return {deployed};assert.equal(deployed.receipt.status,1,hexlify(deployed.execResult.returnValue));
 const budget={address:deployed.createdAddress.toString(),iface:budgetInterface};
 const codeHash=async address=>keccak256(await vm.stateManager.getCode(createAddressFromString(address)));
 const policy={signer,target:venue.address,targetCodeHash:await codeHash(venue.address),selector:venue.iface.getFunction('exchange').selector,outputToken:token.address,outputCodeHash:await codeHash(token.address),beneficiary:actors.owner.address.toString(),maxDebit:10n**18n,maxFee:10n**16n,minOutputPerEth:10n**18n,expiresAt:BigInt(now+3600),privacyPolicy:PUBLIC_BUDGET_REHEARSAL};
 const domain={name:'LenzOfflineBudget',version:'1',chainId:'31337',verifyingContract:budget.address};
 async function fund(p=policy,value=2n*10n**18n,actor='owner'){const id=(await read(budget.address,budget.iface,'nextBudgetId'))[0];const result=await send(actor,budget.address,budget.iface.encodeFunctionData('fund',[p]),value);return {id,result};}
 async function order(id=1n,overrides={}){const data=venue.iface.encodeFunctionData('exchange',[policy.beneficiary]),value={budgetId:id.toString(),nonce:'0',amount:'400000000000000000',minOutput:'800000000000000000',fee:'1000000000000000',feeRecipient:actors.relayer.address.toString(),deadline:String(now+1800),dataHash:budgetCallHash(data),privacyPolicy:PUBLIC_BUDGET_REHEARSAL,...overrides};return {type:'lenz/offline-budget/v1',domain,order:value,data,signature:signBudgetOrder(secret,domain,value)};}
 const execute=(packet,actor='relayer')=>send(actor,budget.address,budget.iface.encodeFunctionData('execute',[packet.order,packet.data,packet.signature]));
 const state=async(id=1n)=>(await read(budget.address,budget.iface,'getBudget',[id]))[0];
 const balance=async address=>(await vm.stateManager.getAccount(createAddressFromString(address)))?.balance??0n;
 const output=async(address=policy.beneficiary)=>(await read(token.address,token.iface,'balanceOf',[address]))[0];
 const expectFail=(r,error)=>{assert.equal(r.receipt.status,0,'Transaction unexpectedly succeeded');if(error)assert.equal(budget.iface.parseError(hexlify(r.execResult.returnValue))?.name,error);};
 return {vm,actors,secret,signer,now,domain,budget,token,venue,native,rejector,rejectingOwner,policy,codeHash,send,read,fund,order,execute,state,balance,output,expectFail,setTime:n=>time=n,compiled:c.budget};
}
