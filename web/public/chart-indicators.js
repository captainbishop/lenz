export const MA_PERIODS=[7,25,99];
export function movingAverage(candles,period){
  if(!Number.isInteger(period)||period<1)throw Error('Invalid moving-average period');
  let sum=0;const values=[];
  for(let i=0;i<candles.length;i++){const close=Number(candles[i].close);if(!Number.isFinite(close)||close<=0)throw Error('Invalid closing price');sum+=close;if(i>=period)sum-=Number(candles[i-period].close);if(i>=period-1)values.push({time:candles[i].time,value:sum/period});}
  return values;
}
