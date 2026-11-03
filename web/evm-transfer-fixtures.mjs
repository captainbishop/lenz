import {prepareTransfer,transferAssets} from './public/evm-transfer.js';
export const from='0x'+'12'.repeat(20),to='0x'+'34'.repeat(20),txHash='0x'+'ab'.repeat(32),blockHash='0x'+'cd'.repeat(32);
export function transferFixture(){
 const calls=[],state={balance:'0x56bc75e2d63100000',nonce:'0x0',gasPrice:'0x3b9aca00',gas:'0x5208',tokenBalance:100000000000000000000n,decimals:6,alive:true,hook:null,sends:0,transaction:null,receipt:null,finalized:true,chainId:'0x1',account:from};
 const lease={identity:{address:from,chainId:'0x1'},assertCurrent(){if(!state.alive)throw Error('Wallet changed.');},async request(method,params){calls.push({method,params});if(state.hook){const result=await state.hook(method,params);if(result!==undefined)return result;}return ({eth_accounts:[state.account],eth_chainId:state.chainId,eth_getBalance:state.balance,eth_getTransactionCount:state.nonce,eth_gasPrice:state.gasPrice,eth_estimateGas:state.gas,eth_getCode:'0x1234',eth_getTransactionByHash:state.transaction,eth_getTransactionReceipt:state.receipt})[method]??(method==='eth_call'?'0x'+(params[0].data==='0x313ce567'?BigInt(state.decimals):state.tokenBalance).toString(16).padStart(64,'0'):method==='eth_getBlockByNumber'?(params[0]==='finalized'?(state.finalized?{number:'0x2b',hash:'0x'+'ee'.repeat(32)}:null):{number:'0x2a',hash:blockHash,transactions:[txHash]}):undefined);},async sendTransaction(tx){state.sends++;mine(tx);return txHash;}};
 function mine(tx,status='0x1'){
  state.transaction={...tx,hash:txHash,input:tx.data,blockNumber:'0x2a',blockHash,transactionIndex:'0x0',type:'0x0'};
  state.receipt={transactionHash:txHash,from:tx.from,to:tx.to,blockNumber:'0x2a',blockHash,transactionIndex:'0x0',status,gasUsed:'0x5208',effectiveGasPrice:tx.gasPrice,logs:tx.data==='0x'?[]:[{address:tx.to,topics:['0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef','0x'+tx.from.slice(2).padStart(64,'0'),'0x'+tx.data.slice(10,74)],data:'0x'+tx.data.slice(74)}]};
 }
 const input={asset:'native',recipient:to,amount:'1.25',publicConsent:true};
 return {lease,state,calls,input,mine,review:()=>prepareTransfer(lease,input),token:()=>transferAssets('0x1').find(a=>a.symbol==='USDC').id};
}
export function memoryJournal(){let rows=[],serial=Promise.resolve();return {read:async()=>structuredClone(rows),update:operation=>{const next=serial.then(async()=>{const draft=structuredClone(rows);const result=await operation(draft);rows=draft;return result;});serial=next.catch(()=>{});return next;}};}
