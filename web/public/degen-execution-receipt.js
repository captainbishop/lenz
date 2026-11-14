import {validateDegenReview,checkDegenWallet} from './degen-execution.js';
import {DEGEN_ROUTER} from './degen-preflight.js';
import {check,uint,hash,address} from './evm-transfer.js';
const q=value=>{check(uint(value),'Invalid receipt quantity.');return BigInt(value);},topic=a=>'0x'+a.slice(2).padStart(64,'0');
const transfer='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef',approval='0x8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';
function effects(r,logs){
 check(Array.isArray(logs)&&logs.length<=10000,'Invalid transaction logs.');const quote=r.preflight.request.quote,owner=topic(r.transaction.from);
 const amount=data=>{check(typeof data==='string'&&/^0x[0-9a-fA-F]{64}$/.test(data),'Invalid token event.');return BigInt(data);};
 if(r.kind!=='swap'){check(logs.some(l=>l.address?.toLowerCase()===quote.input.id&&l.removed!==true&&l.topics?.length===3&&l.topics[0]===approval&&l.topics[1]===owner&&l.topics[2]===topic(DEGEN_ROUTER)&&amount(l.data)===(r.kind==='approve'?BigInt(quote.inputUnits):0n)),'Exact approval was not reported.');return;}
 const net=id=>logs.filter(l=>l.address?.toLowerCase()===id&&l.removed!==true&&l.topics?.length===3&&l.topics[0]===transfer).reduce((n,l)=>n+(l.topics[2]===owner?amount(l.data):0n)-(l.topics[1]===owner?amount(l.data):0n),0n);
 check(net(quote.input.id)===-BigInt(quote.inputUnits)&&net(quote.output.id)>=BigInt(quote.minOutputUnits),'Swap token events do not match the reviewed amounts.');
}
export async function inspectDegenAction(lease,review,transactionHash){
 const r=validateDegenReview(review),expected=r.transaction;check(hash(transactionHash),'Invalid transaction hash.');await checkDegenWallet(lease,expected.from);const pending=()=>({state:'pending',checkedAt:Date.now()});
 const tx=await lease.request('eth_getTransactionByHash',[transactionHash]);if(!tx)return pending();
 check(tx.hash?.toLowerCase()===transactionHash&&address(tx.from)===expected.from&&address(tx.to)===expected.to&&q(tx.value)===0n&&q(tx.nonce)===q(expected.nonce)&&(tx.input??tx.data)===expected.data,'Transaction does not match this approval or swap.');
 check((tx.chainId===undefined||q(tx.chainId)===8453n)&&q(tx.gas)<=q(expected.gas)&&q(tx.gasPrice??tx.maxFeePerGas)<=q(expected.gasPrice),'Transaction exceeds its reviewed network or fees.');
 const receipt=await lease.request('eth_getTransactionReceipt',[transactionHash]);if(!receipt)return pending();
 check(receipt.transactionHash?.toLowerCase()===transactionHash&&address(receipt.from)===expected.from&&address(receipt.to)===expected.to&&hash(receipt.blockHash)&&receipt.blockHash===tx.blockHash&&q(receipt.blockNumber)===q(tx.blockNumber)&&q(receipt.transactionIndex)===q(tx.transactionIndex),'Receipt does not match the transaction.');
 check(['0x0','0x1'].includes(receipt.status)&&q(receipt.gasUsed)<=q(expected.gas)&&q(receipt.effectiveGasPrice)<=q(expected.gasPrice),'Invalid receipt status or gas.');
 const canonical=await lease.request('eth_getBlockByNumber',[receipt.blockNumber,false]);if(canonical?.hash!==receipt.blockHash)return pending();
 check(q(canonical.number)===q(receipt.blockNumber)&&canonical.transactions?.[Number(q(receipt.transactionIndex))]?.toLowerCase()===transactionHash,'Transaction is absent from its block.');
 if(receipt.status==='0x1')effects(r,receipt.logs);
 // The historical oracle applies the operator-fee rules active in this block.
 check(uint(receipt.l1Fee),'Complete Base receipt fees are unavailable.');
 const operator=await lease.request('eth_call',[{to:'0x420000000000000000000000000000000000000f',data:'0x275aedd2'+q(receipt.gasUsed).toString(16).padStart(64,'0')},{blockHash:receipt.blockHash,requireCanonical:true}]);
 check(typeof operator==='string'&&/^0x[0-9a-fA-F]{64}$/.test(operator),'Operator fee is unavailable.');
 const fee=q(receipt.gasUsed)*q(receipt.effectiveGasPrice)+q(receipt.l1Fee)+BigInt(operator);
 let finalized;try{finalized=await lease.request('eth_getBlockByNumber',['finalized',false]);}catch{lease.assertCurrent();}
 const final=finalized&&hash(finalized.hash)&&uint(finalized.number)&&q(finalized.number)>=q(receipt.blockNumber);if(final){const again=await lease.request('eth_getBlockByNumber',[receipt.blockNumber,false]);if(again?.hash!==receipt.blockHash)return pending();}
 await checkDegenWallet(lease,expected.from);return {state:final?(receipt.status==='0x1'?'confirmed':'failed'):'included',checkedAt:Date.now(),blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,success:receipt.status==='0x1',networkFeeWei:fee.toString()};
}
