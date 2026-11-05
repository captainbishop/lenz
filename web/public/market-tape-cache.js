import {checkedTape,tapeRequest} from './market-tape.js';
export function tapeCache(storage,{clock=Date.now}={}){
  const key='lenz-market-tape-v1',values=new Map();
  const checked=value=>{if(!Number.isSafeInteger(value?.observedAt)||value.observedAt<=0||value.observedAt>clock()+5000)throw Error('Invalid saved chart time');return checkedTape(value,value.request,{now:value.observedAt});};
  try{const raw=storage.getItem(key);if(raw){if(raw.length>2200000)throw Error('Saved charts too large');const data=JSON.parse(raw),list=data.version===2?data.tapes:[data];if(!Array.isArray(list)||list.length>8)throw Error('Too many saved charts');for(const value of list){const v=checked(value);values.set(JSON.stringify(v.request),v);}}}catch{values.clear();}
  return {get(request){return values.get(JSON.stringify(tapeRequest(request)))??null;},put(value){const v=checked(value),id=JSON.stringify(v.request),old=values.get(id);if(old&&old.observedAt>v.observedAt)return;values.delete(id);values.set(id,v);while(values.size>8)values.delete(values.keys().next().value);storage.setItem(key,JSON.stringify({version:2,tapes:[...values.values()]}));}};
}
