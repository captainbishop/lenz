import {WALLET_NETWORKS} from './evm-networks.js';
import {EVM_MARKETS} from './evm-markets.js';
import {getAddress} from './evm-vendor/address.js';
import {checkFundingTransfer} from './private-funding.js';
export const check=(ok,message)=>{if(!ok)throw Error(message);};
export const uint=value=>typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)&&value.length<=66;
export const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value);
const exact=(value,keys)=>value&&Object.getPrototypeOf(value)===Object.prototype&&Object.keys(value).sort().join(',')===[...keys].sort().join(',');
const hex=value=>'0x'+BigInt(value).toString(16);
const q=value=>{check(uint(value),'Invalid wallet quantity.');return BigInt(value);};
export function address(value){check(typeof value==='string'&&/^0x[0-9a-fA-F]{40}$/.test(value)&&!/^0x0{40}$/.test(value),'Enter a wallet address.');return getAddress(value).toLowerCase();}
export function units(text,decimals){
 check(typeof text==='string'&&text.length<=80&&/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(text),'Enter a decimal amount.');
 const [whole,fraction='']=text.split('.');check(fraction.length<=decimals,'Too many decimal places.');
 const value=BigInt(whole)*10n**BigInt(decimals)+BigInt(fraction.padEnd(decimals,'0')||'0');check(value>0n&&value<2n**256n,'Enter an amount greater than zero.');return hex(value);
}
export function amount(value,decimals=18){const text=q(value).toString().padStart(decimals+1,'0');if(!decimals)return text;const fraction=text.slice(-decimals).replace(/0+$/,'');return text.slice(0,-decimals)+(fraction?'.'+fraction:'');}
export function transferAssets(chainId){
 check(Object.hasOwn(WALLET_NETWORKS,chainId),'Unsupported sending network.');
 return [{id:'native',symbol:'ETH',decimals:18},...EVM_MARKETS[WALLET_NETWORKS[chainId].key].tokens.map(token=>({id:token.id,symbol:token.symbol,decimals:token.decimals}))];
}
const word=value=>BigInt(value).toString(16).padStart(64,'0');
const accountWord=value=>value.slice(2).padStart(64,'0');
const abiUint=value=>{check(typeof value==='string'&&/^0x[0-9a-fA-F]{64}$/.test(value),'Invalid token response.');return BigInt(value);};
export function importedTransferToken(token){
 check(exact(token,['id','symbol','decimals'])&&address(token.id)===token.id,'Invalid token contract.');
 check(typeof token.symbol==='string'&&token.symbol.trim().length>0&&token.symbol.length<=24&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(token.symbol),'Invalid token symbol.');
 check(Number.isInteger(token.decimals)&&token.decimals>=0&&token.decimals<=36,'Invalid token decimals.');
 return {...token};
}
function sendingToken(chainId,id,custom){
 const known=transferAssets(chainId).find(a=>a.id===id);
 if(custom){const token=importedTransferToken(custom);check(!known&&token.id===id,'Token contract changed.');return token;}
 check(known,'Import this token before sending.');return known;
}
export const reviewToken=review=>sendingToken(review.terms.chainId,review.terms.asset,review.token);
export function transferTerms(identity,input){
 check(exact(input,['asset','recipient','amount','publicConsent',...(Object.hasOwn(input,'token')?['token']:[])])&&input.publicConsent===true,'Allow this public transfer first.');
 const asset=sendingToken(identity.chainId,input.asset,input.token);
 const recipient=address(input.recipient),from=address(identity.address),value=units(input.amount,asset.decimals);
 check(recipient!==from,'Choose another receiving address.');
 return {chainId:identity.chainId,from,recipient,asset:asset.id,units:value,to:asset.id==='native'?recipient:asset.id,value:asset.id==='native'?value:'0x0',data:asset.id==='native'?'0x':'0xa9059cbb'+accountWord(recipient)+word(value)};
}
async function identityCheck(lease,terms){
 lease.assertCurrent();const accounts=await lease.request('eth_accounts');
 check(Array.isArray(accounts)&&accounts.length>0&&address(accounts[0])===terms.from,'Wallet account changed.');
 check(hex(q(await lease.request('eth_chainId')))===terms.chainId,'Wallet network changed.');lease.assertCurrent();
}
async function tokenCheck(lease,terms,custom){
 if(terms.asset==='native')return;
 const asset=sendingToken(terms.chainId,terms.asset,custom);
 const code=await lease.request('eth_getCode',[terms.asset,'latest']);check(typeof code==='string'&&/^0x[0-9a-fA-F]+$/.test(code),'Token contract unavailable.');
 check(abiUint(await lease.request('eth_call',[{to:terms.asset,data:'0x313ce567'},'latest']))===BigInt(asset.decimals),'Token decimals changed.');
 check(abiUint(await lease.request('eth_call',[{to:terms.asset,data:'0x70a08231'+accountWord(terms.from)},'latest']))>=q(terms.units),'Insufficient token balance.');
}
export function validateReview(value){
 check(exact(value,['version','terms','transaction','createdAt','expiresAt',...(value?.version===2?['token']:[]),...(value?.version===3?['funding']:[])])&&[1,2,3].includes(value.version),'Invalid transfer review.');
 const t=value.terms;check(exact(t,['chainId','from','recipient','asset','units','to','value','data']),'Invalid transfer terms.');
 const asset=reviewToken(value);
 const rebuilt=transferTerms({chainId:t.chainId,address:t.from},{asset:t.asset,recipient:t.recipient,amount:amount(t.units,asset.decimals),publicConsent:true,...(value.version===2?{token:value.token}:{})});
 check(JSON.stringify(rebuilt)===JSON.stringify(t),'Transfer terms changed.');
 const tx=value.transaction;check(exact(tx,['chainId','from','to','value','data','nonce','gas','gasPrice']),'Invalid wallet transaction.');
 for(const field of ['chainId','from','to','value','data'])check(tx[field]===t[field],'Transaction changed: '+field);
 for(const field of ['nonce','gas','gasPrice'])check(uint(tx[field]),'Invalid transaction '+field);
 check(q(tx.gas)>=21000n&&q(tx.gas)<=2000000n&&q(tx.gasPrice)>0n,'Invalid gas budget.');
 check(Number.isSafeInteger(value.createdAt)&&value.createdAt>0&&value.expiresAt===value.createdAt+60000,'Invalid review expiry.');
 if(value.version===3)checkFundingTransfer(value);
 return structuredClone(value);
}
export async function prepareTransfer(lease,input,{now=Date.now()}={}){
 const terms=transferTerms(lease.identity,input),token=input.token?importedTransferToken(input.token):null;await identityCheck(lease,terms);await tokenCheck(lease,terms,token);
 const nonce=hex(q(await lease.request('eth_getTransactionCount',[terms.from,'pending'])));
 const gasPrice=hex(q(await lease.request('eth_gasPrice')));check(q(gasPrice)>0n,'Gas price unavailable.');
 const basic={chainId:terms.chainId,from:terms.from,to:terms.to,value:terms.value,data:terms.data,nonce};
 const estimate=q(await lease.request('eth_estimateGas',[basic]));check(estimate>=21000n&&estimate<=1600000n,'Transfer gas estimate is outside the supported range.');
 const gas=hex((estimate*120n+99n)/100n);
 check(q(await lease.request('eth_getBalance',[terms.from,'pending']))>=q(terms.value)+q(gas)*q(gasPrice),'Insufficient ETH for amount and gas.');
 await identityCheck(lease,terms);
 return validateReview({version:token?2:1,...(token?{token}:{}),terms,transaction:{...basic,gas,gasPrice},createdAt:now,expiresAt:now+60000});
}
export async function recheckTransfer(lease,review,{now=Date.now()}={}){
 const r=validateReview(review);check(now>=r.createdAt&&now<r.expiresAt,'Review expired. Check the transfer again.');await identityCheck(lease,r.terms);
 if(r.version===3)checkFundingTransfer(r,{now});
 await tokenCheck(lease,r.terms,r.token);
 check(q(await lease.request('eth_getTransactionCount',[r.terms.from,'pending']))===q(r.transaction.nonce),'Wallet activity changed. Review again.');
 check(q(await lease.request('eth_gasPrice'))<=q(r.transaction.gasPrice),'Gas price changed. Review again.');
 const gas=q(await lease.request('eth_estimateGas',[r.transaction]));check(gas>=21000n&&gas<=q(r.transaction.gas),'Gas estimate changed. Review again.');
 check(q(await lease.request('eth_getBalance',[r.terms.from,'pending']))>=q(r.transaction.value)+q(r.transaction.gas)*q(r.transaction.gasPrice),'Insufficient ETH for amount and gas.');
 await identityCheck(lease,r.terms);check(Date.now()<r.expiresAt,'Review expired. Check the transfer again.');return r;
}
export async function inspectTransfer(lease,review,transactionHash){
 const r=validateReview(review),expected=r.transaction;check(hash(transactionHash),'Enter the transaction hash from your wallet.');await identityCheck(lease,r.terms);
 const tx=await lease.request('eth_getTransactionByHash',[transactionHash]);
 if(!tx)return {state:'pending',checkedAt:Date.now()};
 check(tx.hash?.toLowerCase()===transactionHash,'Transaction hash mismatch.');
 check(address(tx.from)===expected.from&&address(tx.to)===expected.to&&q(tx.value)===q(expected.value)&&q(tx.nonce)===q(expected.nonce)&&(tx.input??tx.data)===(expected.data),'Transaction does not match this transfer.');
 check(tx.chainId===undefined||q(tx.chainId)===q(expected.chainId),'Transaction network mismatch.');
 check(q(tx.gas)<=q(expected.gas)&&q(tx.gasPrice??tx.maxFeePerGas)<=q(expected.gasPrice),'Transaction fee exceeds the reviewed gas budget.');
 const receipt=await lease.request('eth_getTransactionReceipt',[transactionHash]);
 if(!receipt)return {state:'pending',checkedAt:Date.now()};
 check(receipt.transactionHash?.toLowerCase()===transactionHash&&address(receipt.from)===expected.from&&address(receipt.to)===expected.to,'Receipt does not match this transfer.');
 check(hash(receipt.blockHash)&&receipt.blockHash===tx.blockHash&&q(receipt.blockNumber)===q(tx.blockNumber)&&q(receipt.transactionIndex)===q(tx.transactionIndex),'Receipt block mismatch.');
 check(['0x0','0x1'].includes(receipt.status)&&q(receipt.gasUsed)<=q(expected.gas)&&q(receipt.effectiveGasPrice)<=q(expected.gasPrice),'Invalid receipt result or fee.');
 if(r.terms.asset!=='native'&&receipt.status==='0x1')check(Array.isArray(receipt.logs)&&receipt.logs.some(log=>log.address?.toLowerCase()===r.terms.asset&&log.removed!==true&&log.topics?.length===3&&log.topics[0]==='0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'&&log.topics[1]==='0x'+accountWord(r.terms.from)&&log.topics[2]==='0x'+accountWord(r.terms.recipient)&&log.data==='0x'+word(r.terms.units)),'Token transfer was not reported with the reviewed amount.');
 const canonical=await lease.request('eth_getBlockByNumber',[receipt.blockNumber,false]);
 if(canonical?.hash!==receipt.blockHash)return {state:'pending',checkedAt:Date.now()};
 check(q(canonical.number)===q(receipt.blockNumber)&&Array.isArray(canonical.transactions)&&canonical.transactions[Number(q(receipt.transactionIndex))]?.toLowerCase()===transactionHash,'Transaction missing from its block.');
 let finalBlock;try{finalBlock=await lease.request('eth_getBlockByNumber',['finalized',false]);}catch{lease.assertCurrent();}
 await identityCheck(lease,r.terms);
 const finalized=finalBlock&&hash(finalBlock.hash)&&uint(finalBlock.number)&&q(finalBlock.number)>=q(receipt.blockNumber);
 if(finalized){const again=await lease.request('eth_getBlockByNumber',[receipt.blockNumber,false]);if(again?.hash!==receipt.blockHash)return {state:'pending',checkedAt:Date.now()};await identityCheck(lease,r.terms);}
 return {state:finalized?(receipt.status==='0x1'?'confirmed':'failed'):'included',checkedAt:Date.now(),blockNumber:receipt.blockNumber,blockHash:receipt.blockHash,executionFee:hex(q(receipt.gasUsed)*q(receipt.effectiveGasPrice))};
}
