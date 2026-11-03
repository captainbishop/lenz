import {readCalldata,readResult} from '../aurora/market-read-codec.mjs';
import {marketJson} from './market-discovery.mjs';
import {ORACLE_NETWORKS,ORACLE_FEEDS,oracleRequest,oracleSnapshot} from '../web/public/oracle-feeds.js';
const check=(ok,message)=>{if(!ok)throw Error(message);};
const quantity=v=>typeof v==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(v)&&v.length<=66;
const millis=v=>{const n=Number(v)*1000;check(Number.isSafeInteger(n),'Invalid time');return n;};
export async function readOraclePrices(input,{fetcher,clock=Date.now}={}){
  const {network}=oracleRequest(input),config=ORACLE_NETWORKS[network],signal=AbortSignal.timeout(45000);let id=0;
  async function rpc(method,params){
    const request={jsonrpc:'2.0',id:++id,method,params};
    const result=await marketJson(config.rpc,request,{fetcher,signal,maxBytes:64000});
    check(result?.jsonrpc==='2.0'&&result.id===request.id&&!result.error&&Object.hasOwn(result,'result'),'Invalid oracle RPC response');return result.result;
  }
  check(await rpc('eth_chainId',[])==='0x'+config.chainId.toString(16),'Wrong oracle chain');
  const block=await rpc('eth_getBlockByNumber',['latest',false]);
  check(block&&quantity(block.number)&&quantity(block.timestamp)&&/^0x[0-9a-f]{64}$/.test(block.hash),'Invalid oracle block');
  const blockTime=millis(BigInt(block.timestamp));check(clock()-blockTime<60000&&blockTime<=clock()+5000,'Stale oracle block');
  const tag={blockHash:block.hash,requireCanonical:true};
  async function call(address,method){const bytes=await rpc('eth_call',[{to:address,data:readCalldata(method)},tag]);check(typeof bytes==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(bytes),'Empty oracle answer');return readResult(method,bytes);}
  async function code(address){const bytes=await rpc('eth_getCode',[address,tag]);check(typeof bytes==='string'&&/^0x(?:[0-9a-f]{2})+$/i.test(bytes),'Oracle code missing');}
  let sequencer=null;
  if(config.sequencer){
    await code(config.sequencer);const [,answer,startedAt,updatedAt]=await call(config.sequencer,'latestRoundData');
    sequencer={address:config.sequencer,answer:answer.toString(),startedAt:millis(startedAt),updatedAt:millis(updatedAt)};
    check(answer===0n&&sequencer.startedAt>0&&blockTime-sequencer.startedAt>3600000&&sequencer.updatedAt>=sequencer.startedAt&&sequencer.updatedAt<=blockTime+5000,'Sequencer unavailable or recovering');
  }
  const feeds=[];
  // Bound upstream concurrency; a failed individual feed must not hide other prices.
  for(const f of ORACLE_FEEDS.filter(f=>f.network===network)){
    try{
      await code(f.address);
      const [[decimals],[description],round]=await Promise.all(['decimals','description','latestRoundData'].map(m=>call(f.address,m)));
      const [roundId,answer,startedAt,updatedAt,answeredInRound]=round;
      check(Number(decimals)===f.decimals&&description===f.description&&answer>0n&&roundId>0n&&answeredInRound>=roundId,'Invalid oracle identity or round');
      const row={id:f.id,status:'current',address:f.address,decimals:Number(decimals),description,answer:answer.toString(),roundId:roundId.toString(),answeredInRound:answeredInRound.toString(),startedAt:millis(startedAt),updatedAt:millis(updatedAt)};
      check(row.startedAt>0&&row.startedAt<=row.updatedAt&&row.updatedAt<=blockTime+5000&&row.updatedAt<=clock()+5000&&clock()-row.updatedAt<=f.heartbeat*1000,'Stale oracle round');feeds.push(row);
    }catch{signal.throwIfAborted();feeds.push({id:f.id,status:'unavailable'});}
  }
  const current=await rpc('eth_getBlockByNumber',[block.number,false]);check(current?.hash===block.hash,'Oracle block changed');
  return oracleSnapshot({version:1,kind:'oracle-prices',network,chainId:config.chainId,source:config.rpc,observedAt:clock(),blockNumber:BigInt(block.number).toString(),blockHash:block.hash,blockTime,sequencer,feeds,executable:false},{now:clock()});
}
