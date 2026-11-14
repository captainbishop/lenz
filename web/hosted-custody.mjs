const plain=value=>value&&Object.getPrototypeOf(value)===Object.prototype;
const keys=(value,required,optional=[])=>plain(value)&&required.every(key=>Object.hasOwn(value,key))&&Object.keys(value).every(key=>required.includes(key)||optional.includes(key));
const id=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&!/^0x0{40}$/.test(value);
const scalar=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&!/^0x0{64}$/.test(value);
const list=(value,check)=>Array.isArray(value)&&value.length<=64&&new Set(value).size===value.length&&value.every(check);
const empty=value=>plain(value)&&Object.keys(value).length===0;

/** Private configuration binds each authenticated identity to its existing backend owner. */
export function checkHostedCustody(value={}){
 if(!plain(value)||Object.keys(value).length>64)throw Error('Configure the private Lenz identity-to-custody bindings.');
 const checked=structuredClone(value),owners=new Map();
 for(const [identity,entry]of Object.entries(checked)){
  if(!id(identity)||!plain(entry)||!Object.keys(entry).length||Object.keys(entry).some(key=>!['native','lending','aurora','near','ai'].includes(key)))throw Error('Configure exact Lenz custody capabilities.');
  if(Object.hasOwn(entry,'native')){const native=entry.native;if(!keys(native,['accountId','wallet','recipient'])||!['a','b'].includes(native.wallet)||!new RegExp('^native-zcash:'+native.wallet+':[a-f0-9]{64}$').test(native.accountId)||typeof native.recipient!=='string'||!/^utest1[023456789acdefghjklmnpqrstuvwxyz]{50,250}$/.test(native.recipient))throw Error('Configure the original native source.');}
  if(Object.hasOwn(entry,'lending')&&!((keys(entry.lending,['account','ownerAddress']))&&address(entry.lending.account)&&address(entry.lending.ownerAddress)))throw Error('Configure the original lending owner and account.');
  if(Object.hasOwn(entry,'aurora')){const aurora=entry.aurora;if(!keys(aurora,['owner','beneficiary','notes'])||!id(aurora.owner)||!address(aurora.beneficiary)||!Array.isArray(aurora.notes)||!aurora.notes.length||aurora.notes.length>64||aurora.notes.some(note=>!keys(note,['commitment','nullifierHash'])||!scalar(note.commitment)||!scalar(note.nullifierHash))||new Set(aurora.notes.map(note=>note.commitment)).size!==aurora.notes.length||new Set(aurora.notes.map(note=>note.nullifierHash)).size!==aurora.notes.length)throw Error('Configure the original private note and receiving account.');}
  if(Object.hasOwn(entry,'near')&&!((keys(entry.near,['accountId','operations'],['grantIds']))&&id(entry.near.accountId)&&list(entry.near.operations,operation=>['config','status','prepare','submit','reconcile','prepare-funds','add-funds','reconcile-funds'].includes(operation))&&entry.near.operations.length&&(entry.near.grantIds===undefined||list(entry.near.grantIds,value=>typeof value==='string'&&/^grant:[A-Za-z0-9+/]{43}=$/.test(value)))))throw Error('Configure the original NEAR source, allowed operations and grants.');
  if(Object.hasOwn(entry,'ai')&&entry.ai!==true)throw Error('Configure AI access explicitly.');
  for(const owner of [entry.native?.accountId,entry.lending?.account,entry.aurora?.owner,entry.near?.accountId].filter(Boolean)){if(owners.has(owner)&&owners.get(owner)!==identity)throw Error('A custody owner cannot belong to two hosted identities.');owners.set(owner,identity);}
 }
 return checked;
}

export function hostedCustodyFamily(path){
 if(path.startsWith('/api/intent-zcash/')||path.startsWith('/api/zcash/')||path.startsWith('/api/hosted/jobs/'))return 'native';
 if(path.startsWith('/api/intents/lending/'))return 'lending';
 if(path.startsWith('/api/intent-aurora/')||path.startsWith('/api/intent-aurora-funds/')||path.startsWith('/api/intent-aurora-swap/'))return 'aurora';
 if(path.startsWith('/api/intent-near/'))return 'near';
 if(path.startsWith('/api/ai/'))return 'ai';
 return null;
}
export const hasHostedCustody=(custody,identity,policy)=>!policy.privileged||!!custody[identity]?.[hostedCustodyFamily(policy.path)]&&(hostedCustodyFamily(policy.path)!=='near'||custody[identity].near.operations.includes(policy.path.split('/').at(-1)));

/** Checks the exact fields consumed by existing services without rewriting financial bodies. */
export function ownsHostedRequest(custody,identity,policy,raw){
 if(!policy.privileged)return true;
 if(!hasHostedCustody(custody,identity,policy))return false;
 const binding=custody[identity],path=policy.path;
 if(policy.job)return true; // The gateway verifies the persisted job's identity before disclosure.
 let body;try{body=raw.length?JSON.parse(raw.toString('utf8')):{};}catch{return false;}
 if(!plain(body))return false;
 if(path.startsWith('/api/intent-zcash/')){
  const operation=path.split('/').at(-1),native=binding.native;
  if(operation==='config')return empty(body);
  if(operation==='status')return body.owner===native.accountId;
  const review=operation==='prepare'?body:body.review;
  return review?.source?.accountId===native.accountId&&(!review.native||review.native.wallet===native.wallet);
 }
 if(path.startsWith('/api/zcash/'))return body.wallet===binding.native.wallet;
 if(path.startsWith('/api/intents/lending/')){
  const operation=path.slice('/api/intents/lending/'.length),lending=binding.lending;
  if(operation==='config'||operation.endsWith('/config'))return empty(body);
  if(['snapshot','supply/snapshot','setup','setup-status'].includes(operation))return body.owner===lending.ownerAddress&&body.account===lending.account;
  if(operation.startsWith('supply/')){const request=operation==='supply/recover'?body.request:body;return request?.ownerAddress===lending.ownerAddress&&request.plan?.beneficiary===lending.account&&request.plan?.refundRecipient===lending.account;}
  const request=operation.startsWith('funding/')||operation.startsWith('repayment-funding/')?body:body.review;
  return request?.owner===identity&&request.ownerAddress===lending.ownerAddress&&request.account===lending.account;
 }
 if(path.startsWith('/api/intent-aurora')){
  const operation=path.split('/').at(-1),aurora=binding.aurora;
  if(operation==='config')return empty(body);
  if(path.startsWith('/api/intent-aurora/'))return body.owner===aurora.beneficiary&&(body.beneficiary===undefined||body.beneficiary===aurora.beneficiary);
  if(path.startsWith('/api/intent-aurora-funds/')){const review=operation==='prepare'?body:body.review;return review?.owner===aurora.owner&&aurora.notes.some(note=>note.commitment===review.commitment);}
  const request=operation==='recover'?body.request:body;
  return request?.plan?.beneficiary===aurora.beneficiary&&request.plan.refundRecipient===aurora.beneficiary&&aurora.notes.some(note=>note.nullifierHash===request.nullifierHash);
 }
 if(path.startsWith('/api/intent-near/')){
  const operation=path.split('/').at(-1),near=binding.near;
  if(operation==='config')return empty(body);
  if(operation==='status'||operation==='prepare-funds')return body.owner===near.accountId;
  if(operation==='reconcile-funds')return near.grantIds?.includes(body.id)===true;
  if(operation==='add-funds')return body.review?.owner===near.accountId;
  const review=operation==='prepare'?body:body.review;return review?.source?.accountId===near.accountId;
 }
 if(path.startsWith('/api/ai/'))return path.endsWith('/status')||path.endsWith('/challenge')&&body.id===identity||path.endsWith('/chat')&&body.identity?.id===identity;
 return false;
}

export function filterHostedReply(custody,identity,policy,value){
 if(policy.path==='/api/intent-zcash/config'&&Array.isArray(value.sources)){
  const native=custody[identity].native,sources=value.sources.filter(source=>source.accountId===native.accountId&&source.wallet===native.wallet&&source.recipient===native.recipient);
  return {...value,sources,...(!sources.length?{available:false,reason:'The original native source binding changed.'}:{})};
 }
 return value;
}

export async function readHostedNativeConfig(response){
 const reader=response.body.getReader(),chunks=[];let bytes=0;
 try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>65536)throw Error('Native configuration exceeds its limit.');chunks.push(value);}}finally{await reader.cancel();reader.releaseLock();}
 const value=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(!plain(value))throw Error('Native configuration changed.');return value;
}
