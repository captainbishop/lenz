import {poolSnapshot} from './degen-quotes.mjs';
import {MARKET_READS} from './market-discovery.mjs';
import {preflightCalldata as encode,preflightResult as decode,unsignedSize} from '../aurora/degen-preflight-codec.mjs';
import {DEGEN_ROUTER,degenPreflightRequest,checkedDegenPreflight} from '../web/public/degen-preflight.js';
const ORACLE='0x420000000000000000000000000000000000000f';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const quantity=value=>{check(typeof value==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(value),'Invalid simulation quantity.');return BigInt(value);};
export async function preflightDegen(input,options={}){
 const clock=options.clock??Date.now,request=degenPreflightRequest(input,{now:clock()}),{quote,account}=request;
 const {snapshot:s,assets,feePips}=await poolSnapshot(quote.request,options);
 check(JSON.stringify(assets)===JSON.stringify(quote.assets)&&feePips===quote.feePips,'Pool details changed. Get a new quote.');
 check(await s.rpc('eth_getCode',[account,s.tag])==='0x','This check supports externally owned wallets only.');
 await Promise.all([s.code(DEGEN_ROUTER),s.code(ORACLE)]);
 const call=async(to,method,args=[])=>decode(method,await s.rpc('eth_call',[{to,data:encode(method,args)},s.tag]));
 check((await call(DEGEN_ROUTER,'factory'))[0].toLowerCase()===MARKET_READS.factory&&(await s.call(DEGEN_ROUTER,'WETH9'))[0].toLowerCase()===MARKET_READS.tokens[0].id,'Router identity changed.');
 const [[balance],[allowance],native]=await Promise.all([call(quote.input.id,'balanceOf',[account]),call(quote.input.id,'allowance',[account,DEGEN_ROUTER]),s.rpc('eth_getBalance',[account,s.tag])]);
 const balances={inputUnits:balance.toString(),nativeWei:quantity(native).toString()};
 let simulation={status:'insufficient-token',spentUnits:null,receivedUnits:null},fees=null,affordable=false;
 if(balance>=BigInt(quote.inputUnits)){
  const actions=[],amount=BigInt(quote.inputUnits),deadline=Math.floor(quote.expiresAt/1000);
  const tx=(to,data)=>({from:account,to,data,value:'0x0',gas:'0x1e8480'});
  if(allowance<amount){
   if(allowance>0n)actions.push({kind:'reset-approval',tx:tx(quote.input.id,encode('approve',[DEGEN_ROUTER,0]))});
   actions.push({kind:'approve',tx:tx(quote.input.id,encode('approve',[DEGEN_ROUTER,amount]))});
  }
  const swap=encode('exactInputSingle',[[quote.input.id,quote.output.id,feePips,account,amount,BigInt(quote.minOutputUnits),0]]);
  actions.push({kind:'swap',tx:tx(DEGEN_ROUTER,encode('multicall',[deadline,[swap]]))});
  const balanceCall=id=>tx(id,encode('balanceOf',[account]));
  const calls=[balanceCall(quote.input.id),balanceCall(quote.output.id),...actions.map(a=>a.tx),balanceCall(quote.input.id),balanceCall(quote.output.id)];
  // No state overrides or supplied signatures: approvals exist only inside this simulation.
  const result=await s.rpc('eth_simulateV1',[{blockStateCalls:[{calls}],validation:false,traceTransfers:false},s.block.number]);
  check(Array.isArray(result)&&result.length===1,'Invalid simulation blocks.');const block=result[0];
  // Base can advance a block within the same whole-second timestamp.
  check(block.parentHash===s.block.hash&&quantity(block.number)===quantity(s.block.number)+1n&&quantity(block.timestamp)>=quantity(s.block.timestamp)&&quantity(block.timestamp)<=BigInt(deadline),'Simulation block changed.');
  check(Array.isArray(block.calls)&&block.calls.length===calls.length&&block.calls.every(c=>c.status==='0x1'),'Approval or swap simulation failed.');
  const beforeIn=decode('balanceOf',block.calls[0].returnData)[0],beforeOut=decode('balanceOf',block.calls[1].returnData)[0],afterIn=decode('balanceOf',block.calls.at(-2).returnData)[0],afterOut=decode('balanceOf',block.calls.at(-1).returnData)[0];
  check(beforeIn===balance&&beforeIn-afterIn===amount&&afterOut>=beforeOut,'Unexpected token balance changes.');
  const received=afterOut-beforeOut,swapResult=decode('multicall',block.calls[actions.length+1].returnData)[0];
  check(swapResult.length===1&&decode('exactInputSingle',swapResult[0])[0]===received&&received>=BigInt(quote.minOutputUnits),'Received tokens differ from the quoted minimum.');
  for(let i=0;i<actions.length-1;i++){const data=block.calls[i+2].returnData;check(data==='0x'||decode('approve',data)[0]===true,'Token approval simulation failed.');}
  const gasPrice=quantity(await s.rpc('eth_gasPrice',[])),nonce=quantity(await s.rpc('eth_getTransactionCount',[account,s.tag]));check(gasPrice>0n&&gasPrice<10n**15n&&nonce<=BigInt(Number.MAX_SAFE_INTEGER)-3n,'Invalid fee or account nonce.');
  const costs=[];
  for(const [i,action]of actions.entries()){
   const gasUsed=quantity(block.calls[i+2].gasUsed),maxGas=quantity(block.calls[i+2].maxUsedGas);check(gasUsed>=21000n&&maxGas>=gasUsed&&maxGas<=2000000n,'Invalid simulated gas.');
   const gas=(maxGas*120n+99n)/100n,size=unsignedSize({to:action.tx.to,data:action.tx.data,value:0n,nonce:Number(nonce)+i,gasLimit:gas,gasPrice});
   const [[l1],[operator]]=await Promise.all([call(ORACLE,'getL1FeeUpperBound',[size]),call(ORACLE,'getOperatorFee',[gas])]);
   const l2=gas*gasPrice,total=l2+l1+operator;costs.push({kind:action.kind,gasUnits:gas.toString(),gasPriceWei:gasPrice.toString(),l2Wei:l2.toString(),l1Wei:l1.toString(),operatorWei:operator.toString(),totalWei:total.toString()});
  }
  const total=costs.reduce((n,c)=>n+BigInt(c.totalWei),0n);fees={actions:costs,totalWei:total.toString()};affordable=BigInt(balances.nativeWei)>=total;
  simulation={status:'passed',spentUnits:amount.toString(),receivedUnits:received.toString()};
 }
 const e=await s.finish(),observedAt=clock();
 return checkedDegenPreflight({version:1,kind:'degen-preflight',request,balances,allowanceUnits:allowance.toString(),simulation,fees,affordable,observedAt,expiresAt:Math.min(quote.expiresAt,observedAt+30000,e.blockTimestamp+60000),evidence:{source:e.source,blockNumber:e.blockNumber,blockHash:e.blockHash.toLowerCase(),blockTimestamp:e.blockTimestamp},executable:false},request,{now:clock()});
}
