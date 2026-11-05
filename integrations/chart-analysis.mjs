import {createHash} from 'node:crypto';
import {checkedCandles} from '../web/public/degen-model.js';
import {checkedTape} from '../web/public/market-tape.js';
import {movingAverage,MA_PERIODS} from '../web/public/chart-indicators.js';

const requireData=(ok,message)=>{if(!ok)throw Error(message);};
export function chartAnalysisInput(input,{now=Date.now()}={}){
  requireData(input&&Object.keys(input).sort().join(',')==='question,request,snapshot','Only a chart and question are accepted');
  requireData(typeof input.question==='string'&&input.question.trim().length>0&&input.question.length<=2000,'Question must contain 1–2,000 characters');
  const isPerp=typeof input.request?.marketId==='string',observed=input.snapshot?.observedAt;
  requireData(Number.isSafeInteger(observed)&&observed>0&&observed<=now+5000,'Invalid chart observation time');
  const data=isPerp?checkedTape(input.snapshot,input.request,{now:observed}):checkedCandles(input.snapshot,input.request,{now,saved:true});
  requireData(data.candles.length>=7,'At least seven candles are required');
  const candles=data.candles.map(c=>({time:c.time,open:Number(c.open),high:Number(c.high),low:Number(c.low),close:Number(c.close),volume:Number(c.volume)}));
  const chart={request:data.request,source:isPerp?'Hyperliquid':'GeckoTerminal',observedAt:data.observedAt,ageMs:Math.max(0,now-data.observedAt),lastCandleAt:candles.at(-1).time,priceUnit:'USD',volumeUnit:isPerp?'base asset':'USD',candles,movingAverages:MA_PERIODS.map(period=>({period,value:movingAverage(candles,period).at(-1)?.value??null})),executable:false};
  return {question:input.question.trim(),chart,chartId:createHash('sha256').update(JSON.stringify(chart)).digest('hex')};
}

export function nearAIOptions({apiKey,model},{nodeVersion=process.versions.node}={}){
  const parts=nodeVersion.split('.').map(Number),minimum=[24,22,1];
  const sufficient=parts.length===3&&parts.every(Number.isInteger)&&parts.some((n,i)=>n>minimum[i]&&parts.slice(0,i).every((p,j)=>p===minimum[j]))||parts.every((n,i)=>n===minimum[i]);
  requireData(sufficient,'NEAR AI requires Node 24.22.1 or later');
  requireData(typeof apiKey==='string'&&apiKey.trim().length>0,'NEAR AI API key is not configured');
  requireData(typeof model==='string'&&/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,159}$/.test(model),'Choose a supported NEAR TEE model');
  return {baseUrl:'https://cloud-api.near.ai/v1',apiKey,e2ee:true,gatewayVerification:{policy:{acceptedTcbStatuses:['UpToDate']}},modelVerification:{policy:{acceptedTcbStatuses:['UpToDate']}}};
}

// The host supplies a configured, supported NEAR TEE model. No HTTP route or
// browser control invokes this adapter until account access is configured.
export async function createChartAnalyst(config,{loadSDK=()=>import('@nearai/inference-sdk/node'),nodeVersion=process.versions.node,clock=Date.now}={}){
  const options=nearAIOptions(config,{nodeVersion}),{InferenceClient}=await loadSDK(),client=new InferenceClient(options),model=config.model;
  let busy=false;
  return async input=>{
    requireData(!busy,'Chart analysis is already running');
    const context=chartAnalysisInput(input,{now:clock()});busy=true;
    try{
      const completion=await client.chat.completions.create({model,stream:false,max_tokens:1200,messages:[{role:'user',content:JSON.stringify({question:context.question,chart:context.chart})}]});
      requireData(typeof completion?.id==='string'&&completion.id.length>0,'Missing response identity');
      await client.verifyResponse(completion.id);
      const message=completion.choices?.[0]?.message;
      requireData(!message?.tool_calls?.length&&!message?.function_call&&typeof message?.content==='string'&&message.content.trim().length>0&&message.content.length<=16000,'Invalid analysis response');
      return {text:message.content,chartId:context.chartId,request:context.chart.request,observedAt:context.chart.observedAt,analyzedAt:clock(),executable:false};
    }catch{throw Error('Chart analysis could not be verified');}finally{busy=false;}
  };
}
