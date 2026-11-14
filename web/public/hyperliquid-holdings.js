import {HYPERLIQUID} from './hyperliquid-environment.js';
import {hyperInfo} from './hyperliquid-trading.js';
import {hyperliquidHoldingsSnapshot} from './hyperliquid-holdings-model.js';
import {readHyperHoldings,saveHyperHoldings} from './hyperliquid-order-store.js';
export async function readHyperliquidHoldings(account){return (await readHyperHoldings()).find(row=>row.account===account)??null;}
export function cacheHyperliquidHoldings(snapshot,options){return saveHyperHoldings(hyperliquidHoldingsSnapshot(snapshot),options);}
export async function refreshHyperliquidHoldings(account,{signal,assertCurrent=()=>{}}={}){
 if(!/^0x[0-9a-f]{40}$/.test(account))throw Error('Connect the Hyperliquid receiving wallet first.');assertCurrent();
 const [spot,perps,mode,spotState,perp]=await Promise.all([hyperInfo({type:'spotMeta'},{signal}),hyperInfo({type:'meta'},{signal}),hyperInfo({type:'userAbstraction',user:account},{signal}),hyperInfo({type:'spotClearinghouseState',user:account},{signal}),hyperInfo({type:'clearinghouseState',user:account},{signal})]);assertCurrent();
 return cacheHyperliquidHoldings({environment:HYPERLIQUID.environment,chainId:HYPERLIQUID.chainId,account,observedAt:Date.now(),collateralToken:perps?.collateralToken,spotTokens:spot?.tokens,funds:{mode,spot:spotState?.balances,perp}},{assertCurrent});
}
