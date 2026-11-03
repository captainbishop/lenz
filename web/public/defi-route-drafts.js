import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre} from './peer-crypto.js';
import {immutable} from './defi-catalog.js';
import {routeObjective} from './defi-route-plan.js';
import {bindRouteQuote,objectiveInput} from './defi-route-quote.js';

const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const time=n=>Number.isSafeInteger(n)&&n>=0;
const aad=s=>bytes(['lenz/route-drafts/v1',s.identity.profile.id]);
function validate(rows){
  assert(Array.isArray(rows)&&rows.length<=100,'Invalid draft collection');
  const ids=new Set();
  for(const row of rows){
    assert(keysAre(row,['objective','createdAt','revision','estimate']),'Invalid saved draft');
    assert(time(row.createdAt)&&Number.isSafeInteger(row.revision)&&row.revision>=1,'Invalid draft revision');
    const objective=routeObjective(objectiveInput(row.objective),{now:row.createdAt});
    assert(same(objective,row.objective)&&!ids.has(objective.id),'Invalid draft objective');ids.add(objective.id);
    if(row.estimate!==null){
      assert(keysAre(row.estimate,['quote','attachedAt'])&&time(row.estimate.attachedAt)&&row.estimate.attachedAt>=row.createdAt,'Invalid saved estimate');
      bindRouteQuote(objectiveInput(objective),row.estimate.quote,{now:row.estimate.attachedAt});
    }
  }
  return rows;
}
async function read(s){
  assert(s.identity,'Create a Lenz profile first');
  if(!s.routeDraftKey&&!s.routeDraftBox)return [];
  assert(s.routeDraftKey&&keysAre(s.routeDraftBox,['iv','ciphertext']),'Incomplete draft storage');
  const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(s.routeDraftBox.iv),additionalData:aad(s)},s.routeDraftKey,unhex(s.routeDraftBox.ciphertext));
  return validate(JSON.parse(new TextDecoder().decode(plain)));
}
async function save(s,rows){
  validate(rows);
  s.routeDraftKey??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
  const iv=crypto.getRandomValues(new Uint8Array(12));
  const encrypted=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(s)},s.routeDraftKey,bytes(rows));
  s.routeDraftBox={iv:hex(iv),ciphertext:hex(encrypted)};
}
function view(row,now=Date.now()){
  const expired=row.objective.limits.deadline<=now;
  const quoteExpired=row.estimate&&row.estimate.quote.expiresAt<=now;
  const clockChanged=now<row.createdAt||(row.estimate&&now<row.estimate.attachedAt);
  return immutable({...structuredClone(row),executable:false,status:clockChanged?'clock-changed':expired?'objective-expired':!row.estimate?'needs-quote':quoteExpired?'quote-expired':'estimate-saved'});
}
export async function listRouteDrafts(){
  const rows=await read(await readState());return immutable(rows.map(row=>view(row)));
}
export async function saveRouteDraft(input){
  const snapshot=structuredClone(input);
  return updateState(async s=>{
    const rows=await read(s),now=Date.now(),objective=routeObjective(snapshot,{now}),existing=rows.find(r=>r.objective.id===objective.id);
    if(existing){assert(same(existing.objective,objective),'Draft ID already has different terms');return view(existing);}
    assert(rows.length<100,'Draft storage is full');
    const row={objective,createdAt:now,revision:1,estimate:null};rows.push(row);await save(s,rows);
    assert(Date.now()<objective.limits.deadline,'Objective expired before saving');return view(row);
  });
}
export async function attachRouteQuote(id,expectedRevision,value){
  const quote=structuredClone(value);
  return updateState(async s=>{
    const rows=await read(s),row=rows.find(r=>r.objective.id===id);
    assert(row&&row.revision===expectedRevision,'Draft changed; reload before attaching an estimate');
    const now=Date.now(),match=bindRouteQuote(objectiveInput(row.objective),quote,{now});
    assert(row.revision<Number.MAX_SAFE_INTEGER,'Draft revision limit reached');
    row.estimate={quote:match.quote,attachedAt:now};row.revision++;await save(s,rows);
    assert(Date.now()<match.expiresAt,'Estimate expired before saving');return view(row);
  });
}
