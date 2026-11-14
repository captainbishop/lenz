import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,digest} from './peer-crypto.js';
import {requirePaymentAccess,RECOVERED_CHAT} from './chat-access.js';
import {SigningKey,computeAddress,keccak256,TypedDataEncoder,recoverAddress} from './evm-vendor/offline-budget.js';
import {LENDING_TESTNET} from './intent-lending-config.js';
import {checkLendingSupplyNotes,mergeLendingSupplyNotes,lendingSupplyNoteDeployment,validateLendingSupplyNoteIntegrity} from './intent-lending-notes.js';

const DOMAIN='lenz/lending-owned-account/v1',REVIEW='lenz/lending-permission-review/v1',SIGNED='lenz/lending-signed-permission/v1',CHAIN='eip155:11155111';
const ownerId=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const uint=value=>typeof value==='string'&&/^(?:0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n;
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&value!=='0x'+'0'.repeat(40);
const codeHash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&value!=='0x'+'0'.repeat(64);
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const routeFields=['chainId','factory','pool','link','usdc','aLink','variableDebt','poolCodeHash','linkCodeHash','usdcCodeHash','aLinkCodeHash','variableDebtCodeHash'];
const accountIdentity=snapshot=>({lenzIdentity:snapshot.owner,chainId:CHAIN,ownerAddress:snapshot.ownerAddress,accountId:snapshot.account,account:snapshot.account,factory:snapshot.route.factory,route:structuredClone(snapshot.route),nonce:snapshot.observation.nonce,deployed:snapshot.observation.deployed});
const aad=(owner,ownerAddress,account)=>bytes([DOMAIN,owner,CHAIN,ownerAddress,account]);

function checkConfig(config){
 assert(config?.chainId===11155111&&config.chain===CHAIN,'Lending is restricted to Sepolia testnet.');
 for(const field of ['pool','link','usdc','aLink','variableDebt'])assert(address(config[field])&&config[field]===LENDING_TESTNET[field],'The fixed Aave testnet assets changed.');
 assert(config.lendingFactory===null||address(config.lendingFactory),'The lending account factory is invalid.');return config;
}
function checkRoute(value,config=LENDING_TESTNET){
 checkConfig(config);assert(keysAre(value,routeFields)&&value.chainId===CHAIN&&address(value.factory),'The original lending route is invalid.');
 assert(config.lendingFactory===null||value.factory===config.lendingFactory,'The original lending account factory changed.');
 const route={};for(const field of routeFields){route[field]=value[field];if(['pool','link','usdc','aLink','variableDebt'].includes(field))assert(value[field]===config[field],'The original Aave asset or pool changed.');if(field.endsWith('CodeHash'))assert(codeHash(value[field]),'The original lending code identity is missing.');}
 for(const field of ['pool','link','usdc','aLink','variableDebt'])if(config.codeHashes?.[field])assert(route[field+'CodeHash']===config.codeHashes[field],'The pinned Aave code changed.');return route;
}
export function checkLendingAccountObservation(value,{ownerAddress,account=null,route=null,config=LENDING_TESTNET}={}){
 assert(keysAre(value,['chainId','ownerAddress','factory','account','deployed','nonce','route','blockNumber','blockHash','accountCodeHash'])&&value.chainId===CHAIN&&address(value.ownerAddress)&&value.ownerAddress===ownerAddress&&address(value.account)&&address(value.factory),'The observed lending account identity changed.');
 const checkedRoute=checkRoute(value.route,config);
 assert(value.factory===checkedRoute.factory&&(!account||value.account===account)&&(!route||same(checkedRoute,checkRoute(route,config))),'The observed account or original route changed.');
 assert(typeof value.deployed==='boolean'&&uint(value.nonce)&&uint(value.blockNumber)&&codeHash(value.blockHash),'Finalized lending account evidence is incomplete.');
 assert(value.deployed?codeHash(value.accountCodeHash):value.accountCodeHash===null&&value.nonce==='0','The lending account deployment evidence changed.');
 return {chainId:CHAIN,ownerAddress:value.ownerAddress,factory:value.factory,account:value.account,deployed:value.deployed,nonce:value.nonce,route:checkedRoute,blockNumber:value.blockNumber,blockHash:value.blockHash,accountCodeHash:value.accountCodeHash};
}

const types={Order:[['action','uint8'],['nonce','uint256'],['deadline','uint256'],['amount','uint256'],['recipient','address'],['minResult','uint256'],['maxDebt','uint256'],['minHealthFactor','uint256'],['maxBorrowRateRay','uint256']],Cancel:[['nonce','uint256'],['deadline','uint256']],Transfer:[['asset','uint8'],['nonce','uint256'],['deadline','uint256'],['amount','uint256'],['recipient','address']]};
const typedTypes=kind=>({[kind]:types[kind].map(([name,type])=>({name,type}))});
const typedDomain=account=>({name:'LenzLendingAccount',version:'1',chainId:11155111,verifyingContract:account});
function checkTerms(kind,value,account){
 assert(Object.hasOwn(types,kind)&&keysAre(value,types[kind].map(([name])=>name)),'The lending permission terms changed.');
 const terms={};for(const [name,type] of types[kind]){const item=value[name];assert(type==='uint256'?uint(item):type==='address'?address(item):Number.isSafeInteger(item)&&item>=0&&item<=255,'The exact lending permission amount or address is invalid.');terms[name]=item;}
 assert(BigInt(terms.deadline)>0n,'The lending permission deadline is invalid.');
 if(kind==='Order'){
  assert(terms.action<=2&&BigInt(terms.amount)>0n&&BigInt(terms.amount)<2n**256n-1n,'The lending action or amount is invalid.');
  if(terms.action===1)assert(terms.recipient===account&&BigInt(terms.minResult)>0n&&BigInt(terms.minResult)<=BigInt(terms.amount)&&terms.minHealthFactor==='0'&&terms.maxBorrowRateRay==='0','The exact repayment bounds are invalid.');
  else assert(terms.minResult===terms.amount&&BigInt(terms.minHealthFactor)>=10n**18n&&(terms.action===0?BigInt(terms.maxBorrowRateRay)>0n:terms.maxBorrowRateRay==='0'),'The lending result, health or rate bounds are invalid.');
 }else if(kind==='Transfer')assert(terms.asset<=1&&BigInt(terms.amount)>0n&&terms.recipient!==account,'The free-fund transfer is invalid.');
 return terms;
}
function reviewCore(value,config){
 assert(value.type===REVIEW&&ownerId(value.owner)&&value.chainId===CHAIN&&address(value.ownerAddress)&&address(value.account),'The lending permission owner or contract changed.');
 const route=checkRoute(value.route,config),terms=checkTerms(value.kind,value.terms,value.account);
 assert(value.cancels===null||value.kind==='Cancel'&&ownerId(value.cancels),'The original cancellation reference changed.');
 assert(Number.isSafeInteger(value.createdAt)&&value.createdAt>0&&Number.isSafeInteger(value.expiresAt)&&value.expiresAt===Math.min(value.createdAt+60000,Number(BigInt(terms.deadline)*1000n))&&value.expiresAt>value.createdAt,'The lending permission review time changed.');
 assert(BigInt(terms.deadline)<=BigInt(Math.floor(value.createdAt/1000)+3600),'The lending permission deadline exceeds its one-hour authority limit.');
 return {type:REVIEW,owner:value.owner,chainId:CHAIN,ownerAddress:value.ownerAddress,account:value.account,route,kind:value.kind,terms,cancels:value.cancels,createdAt:value.createdAt,expiresAt:value.expiresAt};
}
export function checkLendingPermissionReview(value,{now=Date.now(),allowExpired=false,config=LENDING_TESTNET}={}){
 assert(keysAre(value,['type','id','owner','chainId','ownerAddress','account','route','kind','terms','cancels','createdAt','expiresAt']),'The saved lending review changed.');
 const core=reviewCore(value,config);assert(value.id===keccak256(bytes(core)).slice(2),'The exact lending review identity changed.');
 assert(allowExpired||now>=core.createdAt&&now<core.expiresAt,'Review the original lending permission again before approval.');return {id:value.id,...core};
}
export function buildLendingPermissionReview(identity,input,{now=Date.now(),config=LENDING_TESTNET}={}){
 const fields=['kind','terms'];if(Object.hasOwn(input,'cancels'))fields.push('cancels');
 assert(keysAre(input,fields)&&identity?.chainId===CHAIN&&identity.accountId===identity.account&&identity.deployed===true&&input.terms?.nonce===identity.nonce,'Choose the verified lending account and its current nonce.');
 const core=reviewCore({type:REVIEW,owner:identity.lenzIdentity,chainId:CHAIN,ownerAddress:identity.ownerAddress,account:identity.account,route:identity.route,kind:input.kind,terms:input.terms,cancels:input.cancels??null,createdAt:now,expiresAt:Math.min(now+60000,Number(BigInt(input.terms.deadline)*1000n))},config);
 return checkLendingPermissionReview({id:keccak256(bytes(core)).slice(2),...core},{now,config});
}
export function lendingPermissionDigest(review){const checked=checkLendingPermissionReview(review,{allowExpired:true});return TypedDataEncoder.hash(typedDomain(checked.account),typedTypes(checked.kind),checked.terms);}
function checkSigned(value,review){
 assert(keysAre(value,['type','reviewId','digest','signature','createdAt'])&&value.type===SIGNED&&value.reviewId===review.id&&Number.isSafeInteger(value.createdAt)&&value.createdAt>=review.createdAt&&value.createdAt<review.expiresAt&&typeof value.signature==='string'&&/^0x[0-9a-f]{130}$/.test(value.signature),'The retained lending signature changed.');
 const s=BigInt('0x'+value.signature.slice(66,130)),v=value.signature.slice(130);
 assert(s>0n&&s<=0x7fffffffffffffffffffffffffffffff5d576e7357a4501ddfe92f46681b20a0n&&['1b','1c'].includes(v),'The lending signature is noncanonical.');
 assert(value.digest===lendingPermissionDigest(review)&&recoverAddress(value.digest,value.signature).toLowerCase()===review.ownerAddress,'The signed lending permission does not match its original owner or terms.');return structuredClone(value);
}
export {checkSigned as checkLendingSignedPermission};
function checkPermissions(rows,snapshot){
 assert(Array.isArray(rows)&&rows.length<=20&&bytes(rows).length<=500000,'The lending permission journal is invalid or too large.');
 assert(!rows.length||snapshot.observation.deployed,'A lending permission requires the original deployed account.');
 const checked=[],ids=new Set(),authorities=new Set();
 for(const row of rows){
  assert(keysAre(row,['id','review','status','signed'])&&['approval-unresolved','signed','submission-unresolved'].includes(row.status),'The retained lending permission state changed.');
  const review=checkLendingPermissionReview(row.review,{allowExpired:true});
  assert(row.id===review.id&&!ids.has(row.id)&&review.owner===snapshot.owner&&review.ownerAddress===snapshot.ownerAddress&&review.account===snapshot.account&&same(review.route,snapshot.route),'The lending journal belongs to another owner, account or route.');
  assert(BigInt(review.terms.nonce)<=BigInt(snapshot.observation.nonce),'A retained lending permission has no observed account nonce.');
  const authority=review.terms.nonce+':'+(review.kind==='Cancel'?'cancel':'operation');assert(!authorities.has(authority),'Conflicting lending authorities share the same nonce.');
  ids.add(row.id);authorities.add(authority);if(row.signed){assert(row.status!=='approval-unresolved','A signed lending permission cannot return to unresolved approval.');checkSigned(row.signed,review);}else assert(row.status==='approval-unresolved','The original lending signature is missing.');checked.push({id:review.id,review,status:row.status,signed:row.signed?structuredClone(row.signed):null});
 }
 for(const row of checked)if(row.review.cancels){const original=checked.find(item=>item.id===row.review.cancels);assert(original&&original.review.kind!=='Cancel'&&original.review.terms.nonce===row.review.terms.nonce,'The original lending cancellation authority is missing or changed.');}
 return checked.sort((a,b)=>a.id.localeCompare(b.id));
}
const privateBytes=value=>{assert(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value),'The recovered lending owner key is invalid.');return unhex(value.slice(2));};
function keyAddress(value){const raw=privateBytes(value);try{return computeAddress(new SigningKey(raw).publicKey).toLowerCase();}finally{raw.fill(0);}}
export function validateLendingAccountRecovery(input,identity){
 const fields=['type','owner','chainId','ownerAddress','privateKey','route','account','observation','permissions'];if(Object.hasOwn(input,'supplyNotes'))fields.push('supplyNotes');
 assert(keysAre(input,fields)&&bytes(input).length<=1000000&&input.type===DOMAIN&&input.owner===identity?.profile.id&&ownerId(input.owner)&&input.chainId===CHAIN,'Lending recovery belongs to another Lenz account or network.');
 assert(address(input.ownerAddress)&&keyAddress(input.privateKey)===input.ownerAddress&&address(input.account),'The recovered key does not own the original lending account.');
 const route=checkRoute(input.route),observation=checkLendingAccountObservation(input.observation,{ownerAddress:input.ownerAddress,account:input.account,route});
 const snapshot={type:DOMAIN,owner:input.owner,chainId:CHAIN,ownerAddress:input.ownerAddress,privateKey:input.privateKey,route,account:input.account,observation,permissions:[]};snapshot.permissions=checkPermissions(input.permissions,snapshot);if(Object.hasOwn(input,'supplyNotes'))snapshot.supplyNotes=checkLendingSupplyNotes(input.supplyNotes,snapshot);return snapshot;
}
export function requireLendingAccountAccess(state){
 if(state.identity?.access===undefined){requirePaymentAccess(state.identity);return;}
 const box=state.lendingOwnedAccount;assert(state.identity.access===RECOVERED_CHAT&&box?.owner===state.identity.profile.id&&box.recoveryVerified?.chainId===CHAIN&&box.recoveryVerified.ownerAddress===box.ownerAddress&&box.recoveryVerified.account===box.account,'Recover the original lending owner and account first.');
}
async function decode(state,owner){
 assert(state.identity?.profile.id===owner,'Open the original Lenz lending account.');const box=state.lendingOwnedAccount;if(!box)return null;
 assert(box.version===1&&box.owner===owner&&box.chainId===CHAIN&&box.key?.algorithm?.name==='AES-GCM'&&box.key.extractable===false&&typeof box.iv==='string'&&/^[0-9a-f]{24}$/.test(box.iv)&&typeof box.ciphertext==='string'&&/^(?:[0-9a-f]{2})+$/.test(box.ciphertext)&&box.ciphertext.length<=2000032,'The encrypted lending account is incomplete.');
 const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(box.iv),additionalData:aad(owner,box.ownerAddress,box.account)},box.key,unhex(box.ciphertext)));
 try{const snapshot=validateLendingAccountRecovery(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),state.identity);assert(snapshot.ownerAddress===box.ownerAddress&&snapshot.account===box.account,'The encrypted lending account identity changed.');return snapshot;}finally{raw.fill(0);}
}
async function encode(state,input,key=state.lendingOwnedAccount?.key,{recovered=false}={}){
 const snapshot=validateLendingAccountRecovery(input,state.identity),raw=bytes(snapshot),iv=crypto.getRandomValues(new Uint8Array(12));key??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 try{const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(snapshot.owner,snapshot.ownerAddress,snapshot.account)},key,raw);state.lendingOwnedAccount={version:1,owner:snapshot.owner,chainId:CHAIN,ownerAddress:snapshot.ownerAddress,account:snapshot.account,key,iv:hex(iv),ciphertext:hex(ciphertext),...(recovered||state.lendingOwnedAccount?.recoveryVerified?{recoveryVerified:{chainId:CHAIN,ownerAddress:snapshot.ownerAddress,account:snapshot.account}}:{})};}finally{raw.fill(0);}return snapshot;
}
export async function snapshotLendingAccountRecovery(state){return decode(state,state.identity?.profile.id);}
function newerObservation(current,incoming){
 if(current.blockNumber===incoming.blockNumber)assert(current.blockHash===incoming.blockHash&&current.nonce===incoming.nonce&&current.deployed===incoming.deployed,'Conflicting finalized lending observations share one block.');
 const lower=BigInt(current.blockNumber)<=BigInt(incoming.blockNumber)?current:incoming,higher=lower===current?incoming:current;
 assert(!lower.deployed||higher.deployed,'A deployed lending account cannot disappear during recovery.');
 assert(!lower.accountCodeHash||lower.accountCodeHash===higher.accountCodeHash,'The original lending account code changed.');
 assert(BigInt(higher.nonce)>=BigInt(lower.nonce),'The lending account nonce regressed.');return structuredClone(higher);
}
export async function restoreLendingAccountRecovery(state,input,options={}){
 const snapshot=validateLendingAccountRecovery(input,state.identity),current=await decode(state,state.identity.profile.id);
 assert(!current||current.ownerAddress===snapshot.ownerAddress&&current.privateKey===snapshot.privateKey&&current.account===snapshot.account&&same(current.route,snapshot.route),'The existing lending owner, account or route conflicts with recovery.');
 const merged=new Map((current?.permissions??[]).map(row=>[row.id,row])),rank=['approval-unresolved','signed','submission-unresolved'];
 for(const row of snapshot.permissions){const old=merged.get(row.id);assert(!old||same(old.review,row.review)&&(!old.signed||!row.signed||same(old.signed,row.signed)),'The original lending review or signature conflicts with recovery.');if(!old)merged.set(row.id,row);else merged.set(row.id,{...old,status:rank[Math.max(rank.indexOf(old.status),rank.indexOf(row.status))],signed:old.signed??row.signed});}
 const supplyNotes=mergeLendingSupplyNotes(current?.supplyNotes,snapshot.supplyNotes,snapshot);await validateLendingSupplyNoteIntegrity(supplyNotes,options);
 return encode(state,{...snapshot,observation:current?newerObservation(current.observation,snapshot.observation):snapshot.observation,permissions:[...merged.values()],...(supplyNotes?{supplyNotes}:{})},await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),{recovered:true});
}

export function createLendingOwnedAccount(lenzIdentity,{read=readState,update=updateState,backupState=async()=>{const {backupNow}=await import('./account-sync.js');await backupNow();},now=Date.now,config=LENDING_TESTNET,observeAccount}={}){
 assert(ownerId(lenzIdentity),'Create the original recoverable Lenz account first.');checkConfig(config);let connected=null,generation=0,connectionController=null;
 const guard=ticket=>assert(ticket===generation&&connected,'The lending account connection changed.');
 const activeSignal=(ticket,external)=>{guard(ticket);return external?AbortSignal.any([connectionController.signal,external]):connectionController.signal;};
 function disconnect(){connectionController?.abort(Error('The lending account connection changed.'));generation++;connected=null;}
 async function inspect(ownerAddress,account=null,route=null,{signal}={}){
  assert(address(config.lendingFactory)&&typeof observeAccount==='function','The Sepolia lending account deployment is unavailable.');signal?.throwIfAborted();
  const result=await observeAccount({ownerAddress,factory:config.lendingFactory,account,chainId:CHAIN},{signal});signal?.throwIfAborted();
  return checkLendingAccountObservation(result,{ownerAddress,account,route,config});
 }
 async function connect({signal:externalSignal}={}){
  connectionController?.abort(Error('The lending account connection changed.'));connectionController=new AbortController();
  const ticket=++generation,signal=externalSignal?AbortSignal.any([connectionController.signal,externalSignal]):connectionController.signal;
  const check=()=>{assert(ticket===generation,'The lending account connection changed.');signal.throwIfAborted();};check();
  const result=await update(async state=>{
   check();assert(state.identity?.profile.id===lenzIdentity,'Open the original Lenz account.');requireLendingAccountAccess(state);let snapshot=await decode(state,lenzIdentity);check();
   if(!snapshot){assert(address(config.lendingFactory)&&typeof observeAccount==='function','The Sepolia lending account deployment is unavailable.');let privateKey,ownerAddress;
    for(let attempt=0;attempt<8&&!privateKey;attempt++){const raw=crypto.getRandomValues(new Uint8Array(32));try{ownerAddress=computeAddress(new SigningKey(raw).publicKey).toLowerCase();privateKey='0x'+hex(raw);}catch{}finally{raw.fill(0);}}
    assert(privateKey,'Lending owner key generation failed.');check();const observation=await inspect(ownerAddress,null,null,{signal});check();
    snapshot={type:DOMAIN,owner:lenzIdentity,chainId:CHAIN,ownerAddress,privateKey,route:observation.route,account:observation.account,observation,permissions:[]};check();await encode(state,snapshot);check();
   }
   check();return accountIdentity(snapshot);
  },{signal});check();connected=result;return structuredClone(result);
 }
 async function refreshAccount({signal}={}){
  const ticket=generation;signal=activeSignal(ticket,signal);signal.throwIfAborted();const identity=structuredClone(connected),observation=await inspect(identity.ownerAddress,identity.account,identity.route,{signal});guard(ticket);
  const result=await update(async state=>{guard(ticket);signal?.throwIfAborted();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity);assert(snapshot?.account===identity.account&&snapshot.ownerAddress===identity.ownerAddress,'The lending account owner changed.');assert(BigInt(observation.blockNumber)>=BigInt(snapshot.observation.blockNumber),'The latest finalized lending observation is stale.');const merged=newerObservation(snapshot.observation,observation);if(!same(merged,snapshot.observation)){snapshot.observation=merged;await encode(state,snapshot);}return accountIdentity(snapshot);},{signal});guard(ticket);connected=result;return structuredClone(result);
 }
 async function requireRecovery(ticket,{latest=false,forSupply=false,signal}={}){
  signal=activeSignal(ticket,signal);signal.throwIfAborted();if(forSupply)await refreshAccount({signal});guard(ticket);
  let state=await read();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity),version=state.accountSync?.version;
  assert(snapshot?.account===connected.account&&snapshot.ownerAddress===connected.ownerAddress,'Open the original lending account.');
  assert(!forSupply||snapshot.observation.deployed,'Deploy and verify the original lending account before private Supply.');
  assert(Number.isSafeInteger(version)&&version>0,'Set up encrypted account recovery before using lending funds.');if(latest)await backupState();guard(ticket);signal?.throwIfAborted();state=await read();requireLendingAccountAccess(state);
  const current=await decode(state,lenzIdentity),sync=state.accountSync,coverage=sync?.lendingAccountBackup;
  assert(same(current,snapshot)&&coverage?.ownerAddress===snapshot.ownerAddress&&coverage.account===snapshot.account&&coverage.digest===await digest(snapshot)&&Number.isSafeInteger(coverage.version)&&coverage.version>0&&sync.savedVersion>=coverage.version&&sync.status!=='conflict'&&(!latest||coverage.version>=version&&sync.savedVersion>=version),'The exact lending owner, account and pending permissions are not backed up yet.');guard(ticket);signal?.throwIfAborted();
 }
 async function signPermission(ticket,value,kind,{signal}={}){
  signal=activeSignal(ticket,signal);signal.throwIfAborted();const identity=structuredClone(connected),review=checkLendingPermissionReview(value,{now:now(),config});
  assert(review.kind===kind&&review.owner===lenzIdentity&&review.account===identity.account&&review.ownerAddress===identity.ownerAddress&&same(review.route,identity.route),'The permission belongs to another lending owner, account or action.');
  let retained;
  await update(async state=>{
   guard(ticket);signal?.throwIfAborted();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity);
   assert(snapshot?.account===identity.account&&snapshot.ownerAddress===identity.ownerAddress&&snapshot.observation.deployed&&snapshot.observation.nonce===review.terms.nonce,'The lending account deployment or current nonce changed.');
   const row=snapshot.permissions.find(item=>item.id===review.id);
   if(row){assert(same(row.review,review)&&row.signed&&row.status==='signed','Check the original unresolved lending approval or transaction status.');retained=row.signed;return;}
   snapshot.permissions.push({id:review.id,review,status:'approval-unresolved',signed:null});await encode(state,snapshot);guard(ticket);signal?.throwIfAborted();
  },{signal});
  await refreshAccount({signal});guard(ticket);await requireRecovery(ticket,{latest:true,signal});
  if(retained)return checkSigned(retained,review);
  const signed=await update(async state=>{
   guard(ticket);signal?.throwIfAborted();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity),row=snapshot?.permissions.find(item=>item.id===review.id);
   assert(snapshot?.account===identity.account&&snapshot.ownerAddress===identity.ownerAddress&&snapshot.observation.deployed&&snapshot.observation.nonce===review.terms.nonce&&row?.status==='approval-unresolved'&&!row.signed&&same(row.review,review),'The saved lending approval or nonce changed.');
   checkLendingPermissionReview(review,{now:now(),config});const raw=privateBytes(snapshot.privateKey);let artifact;
   try{const digest=lendingPermissionDigest(review),signature=new SigningKey(raw).sign(digest).serialized.toLowerCase();artifact=checkSigned({type:SIGNED,reviewId:review.id,digest,signature,createdAt:now()},review);}finally{raw.fill(0);}
   row.signed=artifact;row.status='signed';await encode(state,snapshot);guard(ticket);signal?.throwIfAborted();return artifact;
  },{signal});await requireRecovery(ticket,{latest:true,signal});return signed;
 }
 async function supplyNoteState(ticket){guard(ticket);const state=await read();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity);guard(ticket);assert(snapshot?.account===connected.account&&snapshot.ownerAddress===connected.ownerAddress,'The original lending note owner changed.');return structuredClone(snapshot.supplyNotes??null);}
 async function retainSupplyNote(ticket,note,{signal,prover,createdAt=now()}={}){
  signal=activeSignal(ticket,signal);signal.throwIfAborted();await validateLendingSupplyNoteIntegrity({records:[{note}]},{signal,prover});guard(ticket);
  return update(async state=>{guard(ticket);signal.throwIfAborted();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity);assert(snapshot?.account===connected.account&&snapshot.ownerAddress===connected.ownerAddress&&snapshot.observation.deployed,'Verify the original deployed lending account before funding a note.');
   const incoming={type:'lenz/lending-supply-notes/v1',deployment:lendingSupplyNoteDeployment(config),records:[{note,createdAt,spendAuthority:null}]};snapshot.supplyNotes=mergeLendingSupplyNotes(snapshot.supplyNotes,incoming,snapshot);await encode(state,snapshot);guard(ticket);signal.throwIfAborted();return note.commitment;
  },{signal});
 }
 async function retainSupplySpendAuthority(ticket,review,authorization,{signal}={}){
  signal=activeSignal(ticket,signal);signal.throwIfAborted();return update(async state=>{guard(ticket);signal.throwIfAborted();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity);assert(snapshot?.account===connected.account&&snapshot.ownerAddress===connected.ownerAddress,'The original lending note owner changed.');
   const notes=snapshot.supplyNotes,row=notes?.records.find(value=>value.note.commitment===review.source?.commitment);assert(row,'Keep the original private Supply note.');const incoming=structuredClone(notes);incoming.records=[{...row,spendAuthority:{review,authorization}}];snapshot.supplyNotes=mergeLendingSupplyNotes(notes,incoming,snapshot);await encode(state,snapshot);guard(ticket);signal.throwIfAborted();return structuredClone(authorization);
  },{signal});
 }
 function capture(){const ticket=generation;guard(ticket);return Object.freeze({identity:structuredClone(connected),assertCurrent:()=>guard(ticket),requireRecovery:options=>requireRecovery(ticket,options),supplyNoteState:()=>supplyNoteState(ticket),retainSupplyNote:(note,options)=>retainSupplyNote(ticket,note,options),retainSupplySpendAuthority:(review,authorization,options)=>retainSupplySpendAuthority(ticket,review,authorization,options),signOrder:(review,options)=>signPermission(ticket,review,'Order',options),signCancel:(review,options)=>signPermission(ticket,review,'Cancel',options),signTransfer:(review,options)=>signPermission(ticket,review,'Transfer',options)});}
 async function originalOrder(id){const ticket=generation;guard(ticket);const state=await read();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity);guard(ticket);assert(snapshot?.account===connected.account&&snapshot.ownerAddress===connected.ownerAddress,'The original lending account changed.');const row=snapshot.permissions.find(item=>item.id===id);assert(row?.signed,'Keep or check the original lending approval.');return checkSigned(row.signed,row.review);}
 async function pendingOrders(){const ticket=generation;guard(ticket);const state=await read();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity);guard(ticket);assert(snapshot?.account===connected.account&&snapshot.ownerAddress===connected.ownerAddress,'The original lending account changed.');return structuredClone(snapshot.permissions);}
 async function beginOrderDispatch(id,{signal}={}){
  const ticket=generation;signal=activeSignal(ticket,signal);signal.throwIfAborted();await refreshAccount({signal});guard(ticket);await requireRecovery(ticket,{latest:true,signal});
  const signed=await update(async state=>{guard(ticket);signal?.throwIfAborted();requireLendingAccountAccess(state);const snapshot=await decode(state,lenzIdentity),row=snapshot?.permissions.find(item=>item.id===id);
   assert(row?.signed&&row.status==='signed','Check the original lending transaction status; dispatch is already unresolved.');
   assert(snapshot.account===connected.account&&snapshot.ownerAddress===connected.ownerAddress&&snapshot.observation.deployed&&snapshot.observation.nonce===row.review.terms.nonce,'The original lending nonce or account changed.');
   checkLendingPermissionReview(row.review,{allowExpired:true,config});assert(BigInt(row.review.terms.deadline)*1000n>BigInt(now()),'The original lending permission expired. Check its status.');const artifact=checkSigned(row.signed,row.review);row.status='submission-unresolved';await encode(state,snapshot);guard(ticket);signal?.throwIfAborted();return artifact;
  },{signal});await requireRecovery(ticket,{latest:true,signal});return signed;
 }
 globalThis.addEventListener?.('lenz-account-identity',disconnect);globalThis.addEventListener?.('pagehide',disconnect);
 return Object.freeze({connect,capture,refreshAccount,originalOrder,pendingOrders,beginOrderDispatch,identity:()=>connected?structuredClone(connected):null,disconnect,dispose(){disconnect();globalThis.removeEventListener?.('lenz-account-identity',disconnect);globalThis.removeEventListener?.('pagehide',disconnect);}});
}
