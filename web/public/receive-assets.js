import {assert,keysAre} from './peer-crypto.js';

const text=(value,max)=>typeof value==='string'&&value.length>0&&value.length<=max&&!/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value);
export function receiveAssets(tokens){
  assert(Array.isArray(tokens)&&tokens.length>0&&tokens.length<=10000,'Invalid asset catalogue.');
  const ids=new Set();
  return tokens.map(t=>{
    assert(text(t.assetId,256)&&text(t.symbol,48)&&typeof t.blockchain==='string'&&/^[a-z0-9_-]{1,40}$/.test(t.blockchain)&&Number.isInteger(t.decimals)&&t.decimals>=0&&t.decimals<=77,'Invalid receiving asset.');
    assert(!ids.has(t.assetId),'Duplicate asset identifier.');ids.add(t.assetId);
    assert(t.contractAddress==null||text(t.contractAddress,256),'Invalid token address.');
    return {assetId:t.assetId,blockchain:t.blockchain,symbol:t.symbol,decimals:t.decimals,contractAddress:t.contractAddress??null};
  });
}
const labels={eth:'Ethereum',sol:'Solana',btc:'Bitcoin',ton:'TON',near:'NEAR',base:'Base',arb:'Arbitrum',op:'Optimism',pol:'Polygon',bsc:'BNB Chain',avax:'Avalanche',zec:'Zcash',stellar:'Stellar',hypercore:'Hyperliquid'};
export const receiveChain=id=>Object.hasOwn(labels,id)?labels[id]:id;
export function filterReceiveAssets(tokens,query){
  const terms=String(query).trim().toLowerCase().split(/\s+/).filter(Boolean);
  return tokens.filter(t=>terms.every(term=>[t.symbol,receiveChain(t.blockchain),t.blockchain,t.contractAddress??'',t.assetId].some(v=>v.toLowerCase().includes(term))));
}
export function receiveAmount(value,decimals){
  assert(Number.isInteger(decimals)&&decimals>=0&&decimals<=77&&typeof value==='string'&&/^(0|[1-9][0-9]*)(\.[0-9]+)?$/.test(value)&&value.length<=80,'Enter an asset amount.');
  const [whole,fraction='']=value.split('.');assert(fraction.length<=decimals,'Too many decimal places.');
  const amount=BigInt(whole+fraction.padEnd(decimals,'0')).toString();assert(/^[1-9][0-9]{0,77}$/.test(amount),'Amount is out of range.');return amount;
}
// A receive selection names an asset, never a wallet address or spending authority.
export function receiveSelection(input,tokens){
  assert(keysAre(input,['assetId','blockchain','amount','refundTo','deadline']),'Invalid receiving request.');
  const token=receiveAssets(tokens).find(t=>t.assetId===input.assetId&&t.blockchain===input.blockchain);assert(token,'Asset and chain are not in the current catalogue.');
  assert(text(input.refundTo,512)&&typeof input.deadline==='string','A refund destination and deadline are required.');
  return {token,amount:receiveAmount(input.amount,token.decimals),refundTo:input.refundTo,deadline:input.deadline};
}
