import {HYPERLIQUID} from './hyperliquid-environment.js';
import {verifyOrderSignature} from './hyperliquid-order.js';

const check=(value,message)=>{if(!value)throw Error(message);};
export function checkedHyperliquidSetupAction(action){
 check(action&&Object.keys(action).sort().join(',')==='abstraction,hyperliquidChain,nonce,signatureChainId,type,user'&&action.type==='userSetAbstraction'&&action.hyperliquidChain==='Testnet'&&action.signatureChainId==='0x66eee'&&action.abstraction==='disabled'&&typeof action.user==='string'&&/^0x[0-9a-f]{40}$/.test(action.user)&&!/^0x0{40}$/.test(action.user)&&Number.isSafeInteger(action.nonce)&&action.nonce>0,'Invalid testnet account setup.');
 return structuredClone(action);
}
export function hyperliquidSetupTypedData(action){
 const a=checkedHyperliquidSetupAction(action),primaryType='HyperliquidTransaction:UserSetAbstraction';
 return {domain:{name:'HyperliquidSignTransaction',version:'1',chainId:421614,verifyingContract:'0x'+'0'.repeat(40)},primaryType,types:{[primaryType]:[{name:'hyperliquidChain',type:'string'},{name:'user',type:'address'},{name:'abstraction',type:'string'},{name:'nonce',type:'uint64'}]},message:{hyperliquidChain:a.hyperliquidChain,user:a.user,abstraction:a.abstraction,nonce:a.nonce}};
}
export function verifyHyperliquidSetupSignature(action,signature){return verifyOrderSignature(hyperliquidSetupTypedData(action),signature,action.user);}
export function newHyperliquidSetupAction(account,nonce=Date.now()){check(HYPERLIQUID.environment==='testnet','Account setup requires testnet.');return checkedHyperliquidSetupAction({type:'userSetAbstraction',hyperliquidChain:'Testnet',signatureChainId:'0x66eee',user:account,abstraction:'disabled',nonce});}
