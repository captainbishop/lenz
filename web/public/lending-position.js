import {EVM_MARKETS} from './evm-markets.js';
import {immutable} from './defi-catalog.js';
import {getAddress} from './evm-vendor/address.js';

const check=(ok,message='Selected lending position is unavailable.')=>{if(!ok)throw Error(message);};
const selectors={provider:'0x0542975c',pool:'0x026b1d5f',marker:'0x21f8a721',configuration:'0xc44b11f7',user:'0x4417a583',reserve:'0x35ea6a75',reserveAsset:'0x52751797',receiptPool:'0x7535d246',underlying:'0xb16a19de',decimals:'0x313ce567',balance:'0x70a08231'};
// bgd-labs/aave-address-book b8c801a413c4b934afaf7976d2ddc5fbada6dce6, src/AaveV3{Ethereum,Base,Arbitrum}.sol.
const deployments={
 'eip155:1':{provider:'0x2f39d218133afab8f2b819b1066c7e434ad94e9e',tokens:[['0x4d5f47fa6a74757f35c14fd3a6ef8e3c9bc514e8','0xea51d7853eefb32b6ee06b1c12e6dcca88be0ffe'],['0x98c23e9d8f34fefb1b7bd6a91b7ff122f4e16f5c','0x72e95b8931767c79ba4eee721354d6e99a61d004']]},
 'eip155:8453':{provider:'0xe20fcbdbffc4dd138ce8b2e6fbb6cb49777ad64d',tokens:[['0xd4a0e0b9149bcee3c920d2e00b5de09138fd8bb7','0x24e6e0795b3c7c71d965fcc4f371803d1c1dca1e'],['0x4e65fe4dba92790696d040ac24aa414708f5c0ab','0x59dca05b6c26dbd64b5381374aaac5cd05644c28']]},
 'eip155:42161':{provider:'0xa97684ead0e402dc232d5a977953df7ecbab3cdb',tokens:[['0xe50fa9b3c56ffb159cb0fca61f5c9d750e8128c8','0x0c84331e39d6658cd6e6b9ba04736cc4c4734351'],['0x724dc807b04555b71ed48a6896b6f41593b8c637','0xf611aeb5013fd2c0511c9cd55c7dc5c1140741a6']]},
};
const zero='0x'+'0'.repeat(40),stableMarker='4d4f434b5f535441424c455f44454254'.padEnd(64,'0');
const uint=v=>typeof v==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(v)&&v.length<=66;
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const address=v=>{check(typeof v==='string'&&/^0x[0-9a-fA-F]{40}$/.test(v)&&v.toLowerCase()!==zero,'Invalid lending address.');return getAddress(v).toLowerCase();};
const word=v=>v.slice(2).padStart(64,'0');
function words(value,count){check(typeof value==='string'&&new RegExp('^0x[0-9a-fA-F]{'+count*64+'}$').test(value),'Invalid lending response.');return value.slice(2).match(/.{64}/g).map(v=>BigInt('0x'+v));}
function contract(value,allowZero=false){const [v]=words(value,1);check(v<2n**160n&&(allowZero||v>0n),'Invalid lending contract.');return '0x'+v.toString(16).padStart(40,'0');}
const decimal=(v,places)=>{const text=BigInt(v).toString().padStart(places+1,'0'),fraction=text.slice(-places).replace(/0+$/,'');return places?text.slice(0,-places)+(fraction?'.'+fraction:''):text;};
function reserve(row){
 const market=Object.values(EVM_MARKETS).find(m=>m.chainId===row?.chainId),asset=market?.tokens.find(t=>t.id===row?.assets?.[0]?.id);
 check(market&&asset&&row.category==='credit'&&row.marketId==='aave'&&row.address===market.aavePool&&row.assets.length===1&&row.assets[0].chainId===asset.chainId&&row.assets[0].decimals===asset.decimals&&row.assets[0].symbol===asset.symbol,'Choose a supported Aave reserve.');const deployment=deployments[market.chainId],receipts=deployment.tokens[market.tokens.indexOf(asset)];return {market,asset,deployment,receipts};
}
export function checkedLendingPosition(value){
 const {market,asset,deployment,receipts}=reserve({marketId:'aave',category:'credit',chainId:value?.chainId,address:value?.pool,assets:[value?.asset]});
 check(value.version===1&&value.kind==='lending-position-observation'&&value.executable===false&&value.finality==='wallet-provider-finalized','Invalid saved lending position.');
 for(const key of ['account','provider','aToken','variableDebtToken'])check(address(value[key])===value[key]);
 check(value.provider===deployment.provider&&value.aToken===receipts[0]&&value.variableDebtToken===receipts[1],'Saved reserve receipt changed.');
 check(new Set([asset.id,value.aToken,value.variableDebtToken]).size===3);
 check(uint(value.block)&&hash(value.blockHash)&&Number.isSafeInteger(value.blockTime)&&value.blockTime>0&&Number.isSafeInteger(value.observedAt)&&value.observedAt>=value.blockTime-60000&&value.observedAt<=Date.now()+5000&&Number.isInteger(value.reserveId)&&value.reserveId>=0&&value.reserveId<128&&typeof value.collateral==='boolean');
 for(const key of ['suppliedUnits','variableDebtUnits'])check(typeof value[key]==='string'&&/^(?:0|[1-9][0-9]{0,77})$/.test(value[key])&&BigInt(value[key])<2n**256n);
 check(value.supplied===decimal(value.suppliedUnits,asset.decimals)&&value.variableDebt===decimal(value.variableDebtUnits,asset.decimals));
 check(['supported','unsupported','unknown'].includes(value.stableDebtStatus));
 if(value.stableDebtStatus==='supported'){
  check(address(value.stableDebtToken)===value.stableDebtToken&&!new Set([asset.id,value.aToken,value.variableDebtToken]).has(value.stableDebtToken));
  check(typeof value.stableDebtUnits==='string'&&/^(?:0|[1-9][0-9]{0,77})$/.test(value.stableDebtUnits)&&BigInt(value.stableDebtUnits)<2n**256n&&value.stableDebt===decimal(value.stableDebtUnits,asset.decimals));
 }else check(value.stableDebt===null&&value.stableDebtUnits===null&&value.stableDebtToken===null);
 return immutable({...structuredClone(value),pool:market.aavePool,asset:{...asset}});
}

// Finality and balances are observations from the selected wallet provider, not chain proofs.
export async function readLendingPosition(lease,row){
 const {market,asset,deployment,receipts}=reserve(row),account=address(lease.identity.address),chain='0x'+BigInt(market.chainId.split(':')[1]).toString(16);
 check(lease.identity.chainId===chain,'Select '+market.chainId+' in your wallet before reading this reserve.');
 async function identity(){lease.assertCurrent();const accounts=await lease.request('eth_accounts');check(Array.isArray(accounts)&&accounts.length&&address(accounts[0])===account,'Wallet account changed.');const id=await lease.request('eth_chainId');check(uint(id)&&BigInt(id)===BigInt(chain),'Wallet network changed.');lease.assertCurrent();}
 await identity();const before=await lease.request('eth_getBlockByNumber',['finalized',false]);
 function block(value){check(value&&uint(value.number)&&hash(value.hash)&&uint(value.timestamp),'Finalized lending block is unavailable.');const at=Number(BigInt(value.timestamp))*1000;check(Number.isSafeInteger(at)&&Date.now()-at>=-60000&&Date.now()-at<=1800000,'Finalized lending block is stale.');return at;}
 const blockTime=block(before),pinned={blockHash:before.hash,requireCanonical:true};
 const call=async(to,data)=>{lease.assertCurrent();const value=await lease.request('eth_call',[{to,data},pinned]);lease.assertCurrent();return value;};
 async function code(to){const value=await lease.request('eth_getCode',[to,pinned]);lease.assertCurrent();check(typeof value==='string'&&/^0x(?:[0-9a-fA-F]{2})+$/.test(value),'Lending contract is unavailable.');}
 await code(market.aavePool);const provider=contract(await call(market.aavePool,selectors.provider));check(provider===deployment.provider,'Lending address provider changed.');await code(provider);check(contract(await call(provider,selectors.pool))===market.aavePool,'Lending pool changed.');
 const [config]=words(await call(market.aavePool,selectors.configuration+word(asset.id)),1),data=words(await call(market.aavePool,selectors.reserve+word(asset.id)),15);
 check(data[0]===config&&Number(config>>48n&255n)===asset.decimals&&(config&1n<<56n)!==0n,'Reserve configuration changed.');
 for(const i of [1,2,3,4,5,12,13,14])check(data[i]<2n**128n,'Invalid reserve response.');check(data[6]<2n**40n&&data[7]<128n);for(const i of [8,9,10,11])check(data[i]<2n**160n);
 const receipt=i=>'0x'+data[i].toString(16).padStart(40,'0'),aToken=address(receipt(8)),variableDebtToken=address(receipt(10)),stable=receipt(9);
 check(aToken===receipts[0]&&variableDebtToken===receipts[1],'Reviewed reserve receipt changed.');check(contract(await call(market.aavePool,selectors.reserveAsset+data[7].toString(16).padStart(64,'0')))===asset.id,'Reserve identifier changed.');
 check(new Set([asset.id,aToken,variableDebtToken]).size===3,'Reserve receipt changed.');
 async function balance(token){await code(token);check(contract(await call(token,selectors.receiptPool))===market.aavePool&&contract(await call(token,selectors.underlying))===asset.id,'Reserve receipt identity changed.');check(words(await call(token,selectors.decimals),1)[0]===BigInt(asset.decimals),'Reserve receipt decimals changed.');return words(await call(token,selectors.balance+word(account)),1)[0].toString();}
 const suppliedUnits=await balance(aToken),variableDebtUnits=await balance(variableDebtToken),[user]=words(await call(market.aavePool,selectors.user+word(account)),1);
 let stableDebtStatus='unknown',stableDebtToken=null,stableDebtUnits=null;
 try{const marker=contract(await call(provider,selectors.marker+stableMarker),true);stableDebtStatus=stable===zero||stable===marker?'unsupported':'supported';}catch(error){lease.assertCurrent();}
 if(stableDebtStatus==='supported'){check(!new Set([asset.id,aToken,variableDebtToken]).has(stable),'Stable debt receipt changed.');stableDebtToken=address(stable);stableDebtUnits=await balance(stableDebtToken);}
 const after=await lease.request('eth_getBlockByNumber',[before.number,false]);check(block(after)===blockTime&&after.number===before.number&&after.hash===before.hash,'Canonical lending block changed.');await identity();
 return checkedLendingPosition({version:1,kind:'lending-position-observation',account,chainId:market.chainId,pool:market.aavePool,provider,asset:{...asset},aToken,variableDebtToken,stableDebtToken,stableDebtStatus,reserveId:Number(data[7]),suppliedUnits,variableDebtUnits,stableDebtUnits,supplied:decimal(suppliedUnits,asset.decimals),variableDebt:decimal(variableDebtUnits,asset.decimals),stableDebt:stableDebtUnits===null?null:decimal(stableDebtUnits,asset.decimals),collateral:(user&1n<<BigInt(2*Number(data[7])+1))!==0n,block:before.number,blockHash:before.hash,blockTime,observedAt:Date.now(),finality:'wallet-provider-finalized',executable:false});
}
export function reviewLendingPosition(snapshot,{action,amount}){
 const value=checkedLendingPosition(snapshot),places=value.asset.decimals;
 check(['Repay','Withdraw'].includes(action),'Choose repayment or withdrawal.');check(typeof amount==='string'&&amount.length<=80&&/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(amount),'Enter a decimal amount.');
 const [whole,fraction='']=amount.split('.');check(fraction.length<=places,'Too many decimal places.');const units=BigInt(whole)*10n**BigInt(places)+BigInt(fraction.padEnd(places,'0')||'0'),bound=action==='Repay'?value.variableDebtUnits:value.suppliedUnits;
 check(units>0n&&units<=BigInt(bound),action==='Repay'?'Amount exceeds observed variable debt.':'Amount exceeds observed supplied assets.');
 return immutable({action,amount:decimal(units,places),units:units.toString(),account:value.account,chainId:value.chainId,pool:value.pool,asset:value.asset.id,block:value.block,blockHash:value.blockHash,bound:decimal(bound,places),executable:false,eligibility:'unavailable',fees:null});
}
