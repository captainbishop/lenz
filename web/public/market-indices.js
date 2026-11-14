export const INDEX_ENDPOINTS=Object.freeze({fearGreed:'/v3/fear-and-greed/latest',altcoinSeason:'/v1/altcoin-season-index/latest'});
const numeric=(n,signed=false)=>typeof n==='number'&&Number.isFinite(n)&&(signed||n>=0)?n:null;
const classification=value=>['Extreme Fear','Fear','Neutral','Greed','Extreme Greed'].includes(value)?value:null;
export function marketIndex(key,response,now=Date.now()){
 if(!Object.hasOwn(INDEX_ENDPOINTS,key)||![0,'0'].includes(response?.status?.error_code))throw Error('Index unavailable');
 const d=response.data,value=numeric(key==='altcoinSeason'?d?.altcoin_index:d?.value),updatedAt=Date.parse(d?.update_time??d?.last_update??d?.snapshot_time);
 if(value===null||key!=='cmc20'&&value>100||!Number.isSafeInteger(updatedAt)||updatedAt>now+5000)throw Error('Invalid index data');
 return {value,classification:key==='fearGreed'?classification(d.value_classification):null,change:key==='cmc20'?numeric(d.value_24h_percentage_change,true):null,updatedAt,observedAt:now};
}
export function checkedIndices(value,now=Date.now()){
 const result={};for(const key of Object.keys(INDEX_ENDPOINTS)){const v=value?.[key];if(v&&numeric(v.value)!==null&&(key==='cmc20'||v.value<=100)&&Number.isSafeInteger(v.updatedAt)&&v.updatedAt>0&&v.updatedAt<=now+5000&&Number.isSafeInteger(v.observedAt)&&v.observedAt>0&&v.observedAt<=now+5000)result[key]={value:v.value,classification:key==='fearGreed'?classification(v.classification):null,change:numeric(v.change,true),updatedAt:v.updatedAt,observedAt:v.observedAt};}return result;
}
