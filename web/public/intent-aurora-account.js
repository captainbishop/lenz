import {readState,updateState} from './chat-store.js';
import {assert,bytes,hex,unhex,keysAre,digest} from './peer-crypto.js';
import {requirePaymentAccess,RECOVERED_CHAT} from './chat-access.js';
import {SigningKey,computeAddress,keccak256} from './evm-vendor/offline-budget.js';
import {Transaction} from './evm-vendor/aurora-transaction.js';
import {AURORA_INTENT_DEPLOYMENT as deployment} from './intent-aurora-config.js';

const DOMAIN='lenz/aurora-owned-account/v1',CHAIN='eip155:'+deployment.chainId;
const aad=(owner,address)=>bytes([DOMAIN,owner,CHAIN,address]);
const ownerId=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const uint=value=>typeof value==='string'&&/^(?:0|[1-9][0-9]{0,77})$/.test(value)&&BigInt(value)<2n**256n;
const address=value=>typeof value==='string'&&/^0x[0-9a-f]{40}$/.test(value)&&value!=='0x'+'0'.repeat(40);
const TRANSFER='lenz/aurora-transfer-review/v1',SIGNED='lenz/aurora-signed-transfer/v1';
const transferData=review=>'0xa9059cbb'+review.recipient.slice(2).padStart(64,'0')+BigInt(review.amount).toString(16).padStart(64,'0');
function transferCore(value){
 assert(value?.type===TRANSFER&&ownerId(value.owner)&&value.chainId===CHAIN&&address(value.from)&&address(value.recipient)&&value.recipient!==value.from&&value.token===deployment.outputToken,'Choose the owned Aurora account, LTT and receiving address.');
 assert(uint(value.amount)&&BigInt(value.amount)>0n&&Number.isSafeInteger(value.nonce)&&value.nonce>=0&&uint(value.gasLimit)&&BigInt(value.gasLimit)>=21000n&&BigInt(value.gasLimit)<=200000n&&uint(value.gasPrice)&&BigInt(value.gasPrice)>0n&&BigInt(value.gasLimit)*BigInt(value.gasPrice)<=5000000000000000n,'The reviewed transfer amount, nonce or gas authority is invalid.');
 assert(Number.isSafeInteger(value.createdAt)&&value.createdAt>0&&value.expiresAt===value.createdAt+60000,'The Aurora transfer review time changed.');
 return {type:TRANSFER,owner:value.owner,chainId:CHAIN,from:value.from,token:deployment.outputToken,recipient:value.recipient,amount:value.amount,nonce:value.nonce,gasLimit:value.gasLimit,gasPrice:value.gasPrice,createdAt:value.createdAt,expiresAt:value.expiresAt};
}
export function checkAuroraTransferReview(value,{now=Date.now(),allowExpired=false}={}){
 assert(keysAre(value,['type','id','owner','chainId','from','token','recipient','amount','nonce','gasLimit','gasPrice','createdAt','expiresAt']),'The Aurora transfer review changed.');const core=transferCore(value);
 assert(value.id===keccak256(bytes(core)).slice(2),'The Aurora transfer identity changed.');assert(allowExpired||now>=core.createdAt&&now<core.expiresAt,'Review the Aurora transfer again before signing.');return {id:value.id,...core};
}
export function buildAuroraTransferReview(identity,input,{now=Date.now()}={}){
 assert(identity?.chainId===CHAIN&&address(identity.address)&&identity.accountId===identity.address&&ownerId(identity.lenzIdentity)&&keysAre(input,['recipient','amount','nonce','gasLimit','gasPrice']),'Choose the original Aurora transfer account and exact terms.');
 const core=transferCore({type:TRANSFER,owner:identity.lenzIdentity,chainId:CHAIN,from:identity.address,token:deployment.outputToken,...input,createdAt:now,expiresAt:now+60000});return checkAuroraTransferReview({id:keccak256(bytes(core)).slice(2),...core},{now});
}
function checkSigned(value,review){
 assert(keysAre(value,['type','reviewId','transactionHash','bytes','createdAt'])&&value.type===SIGNED&&value.reviewId===review.id&&typeof value.bytes==='string'&&/^0x(?:[0-9a-f]{2}){1,4096}$/.test(value.bytes)&&Number.isSafeInteger(value.createdAt)&&value.createdAt>=review.createdAt&&value.createdAt<review.expiresAt,'The retained Aurora transfer authorization changed.');
 const tx=Transaction.from(value.bytes);assert(tx.isSigned()&&tx.serialized===value.bytes&&tx.type===0&&tx.hash===value.transactionHash&&tx.from?.toLowerCase()===review.from&&tx.to?.toLowerCase()===review.token&&tx.chainId===BigInt(deployment.chainId)&&tx.nonce===review.nonce&&tx.value===0n&&tx.data===transferData(review)&&tx.gasLimit===BigInt(review.gasLimit)&&tx.gasPrice===BigInt(review.gasPrice),'The signed Aurora transaction does not match the reviewed transfer.');return structuredClone(value);
}
function transfers(rows){
 assert(Array.isArray(rows)&&rows.length<=20&&bytes(rows).length<=500000,'The Aurora transfer journal is invalid or too large.');const ids=new Set(),nonces=new Set();
 for(const row of rows){assert(keysAre(row,['id','review','status','signed'])&&['approval-unresolved','signed','submission-unresolved'].includes(row.status),'The saved Aurora transfer state changed.');const review=checkAuroraTransferReview(row.review,{allowExpired:true});assert(row.id===review.id&&!ids.has(row.id)&&!nonces.has(review.nonce),'Original Aurora transfer authorities conflict.');ids.add(row.id);nonces.add(review.nonce);if(row.signed)checkSigned(row.signed,review);else assert(row.status==='approval-unresolved','The original Aurora signature is missing.');}
 return structuredClone(rows);
}
const privateBytes=value=>{assert(typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value),'The recovered Aurora spending key is invalid.');return unhex(value.slice(2));};
function keyAddress(value){const raw=privateBytes(value);try{return computeAddress(new SigningKey(raw).publicKey).toLowerCase();}finally{raw.fill(0);}}
export function requireAuroraAccountAccess(state){
 if(state.identity?.access===undefined){requirePaymentAccess(state.identity);return;}
 const account=state.auroraOwnedAccount;
 assert(state.identity?.access===RECOVERED_CHAT&&account?.owner===state.identity.profile.id&&account.recoveryVerified?.chainId===CHAIN&&account.recoveryVerified.address===account.address,'Recover the original Aurora spending account first.');
}
export function validateAuroraAccountRecovery(input,identity){
 assert(keysAre(input,['type','owner','chainId','address','privateKey','transfers'])&&input.type===DOMAIN&&input.owner===identity?.profile.id&&ownerId(input.owner)&&input.chainId===CHAIN,'Aurora spending recovery belongs to another account or network.');
 assert(typeof input.address==='string'&&/^0x[0-9a-f]{40}$/.test(input.address)&&keyAddress(input.privateKey)===input.address,'The recovered Aurora key does not own the destination.');
 const rows=transfers(input.transfers);assert(rows.every(row=>row.review.owner===input.owner&&row.review.from===input.address),'The Aurora transfers belong to another recovered account.');return {...structuredClone(input),transfers:rows};
}
async function decode(state,owner){
 assert(state.identity?.profile.id===owner,'Open the original Lenz account.');const box=state.auroraOwnedAccount;if(!box)return null;
 assert(box.version===1&&box.owner===owner&&box.chainId===CHAIN&&box.key?.algorithm?.name==='AES-GCM'&&box.key.extractable===false&&/^[0-9a-f]{24}$/.test(box.iv)&&typeof box.ciphertext==='string'&&box.ciphertext.length<=1_000_032,'The encrypted Aurora account is incomplete.');
 const raw=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(box.iv),additionalData:aad(owner,box.address)},box.key,unhex(box.ciphertext)));
 try{const snapshot=validateAuroraAccountRecovery(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),state.identity);assert(snapshot.address===box.address,'The encrypted Aurora address changed.');return snapshot;}finally{raw.fill(0);}
}
async function encode(state,snapshot,key=state.auroraOwnedAccount?.key,{recovered=false}={}){
 const checked=validateAuroraAccountRecovery(snapshot,state.identity),raw=bytes(checked),iv=crypto.getRandomValues(new Uint8Array(12));key??=await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 try{const ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:aad(checked.owner,checked.address)},key,raw);state.auroraOwnedAccount={version:1,owner:checked.owner,chainId:CHAIN,address:checked.address,key,iv:hex(iv),ciphertext:hex(ciphertext),...(recovered||state.auroraOwnedAccount?.recoveryVerified?{recoveryVerified:{chainId:CHAIN,address:checked.address}}:{})};}finally{raw.fill(0);}
 return checked;
}
export async function snapshotAuroraAccountRecovery(state){return decode(state,state.identity?.profile.id);}
export async function restoreAuroraAccountRecovery(state,input){
 const snapshot=validateAuroraAccountRecovery(input,state.identity),current=await decode(state,state.identity.profile.id);
 assert(!current||current.address===snapshot.address&&current.privateKey===snapshot.privateKey,'The existing Aurora spending key conflicts with recovery.');
 const merged=new Map((current?.transfers??[]).map(row=>[row.id,row]));for(const row of snapshot.transfers){const old=merged.get(row.id);assert(!old||JSON.stringify(old.review)===JSON.stringify(row.review)&&(!old.signed||!row.signed||JSON.stringify(old.signed)===JSON.stringify(row.signed)),'The original Aurora transfer conflicts with recovery.');if(!old||['approval-unresolved','signed','submission-unresolved'].indexOf(row.status)>['approval-unresolved','signed','submission-unresolved'].indexOf(old.status))merged.set(row.id,row);}
 return encode(state,{...snapshot,transfers:[...merged.values()]},await crypto.subtle.generateKey({name:'AES-GCM',length:256},false,['encrypt','decrypt']),{recovered:true});
}
export function createAuroraOwnedAccount(lenzIdentity,{read=readState,update=updateState,backupState=async()=>{const {backupNow}=await import('./account-sync.js');await backupNow();},readBackup=async sync=>{const {accountRequest}=await import('./account-sync.js');return accountRequest(sync,'read');},now=Date.now}={}){
 assert(ownerId(lenzIdentity),'Create a recoverable Lenz account before receiving Aurora funds.');let connected=null,generation=0;
 const guard=ticket=>assert(ticket===generation&&connected,'The Aurora spending account changed.');
 function disconnect(){generation++;connected=null;}
 async function connect(){
  const ticket=++generation,account=await update(async state=>{
   assert(state.identity?.profile.id===lenzIdentity,'Open the original Lenz account.');requireAuroraAccountAccess(state);let snapshot=await decode(state,lenzIdentity);
   if(!snapshot){let key,address;for(let attempt=0;attempt<8&&!key;attempt++){const raw=crypto.getRandomValues(new Uint8Array(32));try{address=computeAddress(new SigningKey(raw).publicKey).toLowerCase();key='0x'+hex(raw);}catch{}finally{raw.fill(0);}}assert(key,'Aurora key generation failed. Try again.');snapshot={type:DOMAIN,owner:lenzIdentity,chainId:CHAIN,address,privateKey:key,transfers:[]};await encode(state,snapshot);}
   return {chainId:CHAIN,accountId:snapshot.address,address:snapshot.address,lenzIdentity};
  });assert(ticket===generation,'The Aurora account connection changed.');connected=account;return structuredClone(account);
 }
 async function receivingSource(state){
  const {requireNearIntentAccess}=await import('./intent-near-route.js'),{snapshotIntentRecovery}=await import('./intent-account-recovery.js');
  assert(state.identity?.profile.id===lenzIdentity&&state.identity.access===RECOVERED_CHAT,'Open the original recovered private source.');requireNearIntentAccess(state);
  const recovery=await snapshotIntentRecovery(state);assert(recovery?.nearSource&&recovery.auroraNotes?.records.length>0,'Recover the original private source and notes first.');
  return {recovery,sourceDigest:await digest({owner:lenzIdentity,nearSource:recovery.nearSource,auroraNotes:recovery.auroraNotes})};
 }
 async function certifyReceivingSource(state){
  const original=await receivingSource(state),sync=state.accountSync;
  assert(sync?.deviceKey?.extractable===false&&sync.backupKey?.extractable===false&&sync.status!=='conflict','Unlock the original encrypted account backup first.');
  const {unlockLocalBackup}=await import('./account-keys.js'),{stageIdentityRecovery}=await import('./identity-recovery.js'),{openAccountBackup}=await import('./account-backup.js');let phrase;
  try{
   phrase=await unlockLocalBackup(sync);const identity=await stageIdentityRecovery(phrase,'Lenz account');assert(identity.profile.id===lenzIdentity,'The encrypted backup belongs to another identity.');
   const result=await readBackup(sync);assert(result.revision===sync.revision&&result.digest===sync.digest,'Check the latest original encrypted backup before receiving setup.');const opened=await openAccountBackup({...sync,phrase,identity},result),remote=opened.intentRecovery;
   assert(remote&&await digest({owner:remote.owner,nearSource:remote.nearSource,auroraNotes:remote.auroraNotes})===original.sourceDigest,'The saved archive does not preserve the original private source.');
   assert(!remote.auroraAccount||original.recovery.auroraAccount&&await digest(remote.auroraAccount)===await digest(original.recovery.auroraAccount),'Recover the existing Aurora spending account before creating a destination.');
   return {...original,accountSaved:!!remote.auroraAccount};
  }finally{phrase='';}
 }
 async function connectReceiving(){
  const initial=await read();if(initial.identity?.access===undefined||initial.auroraOwnedAccount&&!initial.auroraOwnedAccount.receivingSetup)return connect();
  const ticket=++generation,check=()=>assert(ticket===generation,'The Aurora receiving setup changed.'),certified=await certifyReceivingSource(initial);check();
  const snapshot=await update(async state=>{
   check();assert((await receivingSource(state)).sourceDigest===certified.sourceDigest,'The original private source changed during receiving setup.');let value=await decode(state,lenzIdentity);
   if(value){assert(state.auroraOwnedAccount.receivingSetup?.sourceDigest===certified.sourceDigest&&!value.transfers.length,'Keep the original pending Aurora receiving account.');}
   else{
    assert(!certified.recovery.auroraAccount,'Recover the original Aurora destination.');let key,address;for(let attempt=0;attempt<8&&!key;attempt++){const raw=crypto.getRandomValues(new Uint8Array(32));try{address=computeAddress(new SigningKey(raw).publicKey).toLowerCase();key='0x'+hex(raw);}catch{}finally{raw.fill(0);}}assert(key,'Aurora key generation failed. Try again.');
    value={type:DOMAIN,owner:lenzIdentity,chainId:CHAIN,address,privateKey:key,transfers:[]};await encode(state,value);state.auroraOwnedAccount.receivingSetup={sourceDigest:certified.sourceDigest};
   }
   check();return value;
  });
  // A pending receiving key cannot sign; only its exact saved archive unlocks it.
  await backupState();check();const current=await read(),saved=await certifyReceivingSource(current);check();
  assert(saved.accountSaved&&saved.sourceDigest===certified.sourceDigest&&await digest(saved.recovery.auroraAccount)===await digest(snapshot),'The original source or receiving key changed during backup.');
  const sync=current.accountSync,coverage=sync?.auroraAccountBackup;assert(coverage?.address===snapshot.address&&coverage.digest===await digest(snapshot)&&coverage.version===sync.version&&sync.savedVersion===sync.version&&!sync.pending&&sync.status==='saved','The new Aurora receiving key is not backed up yet.');
  await update(async state=>{check();const currentSync=state.accountSync;assert((await receivingSource(state)).sourceDigest===certified.sourceDigest&&await digest(await decode(state,lenzIdentity))===await digest(snapshot)&&currentSync.version===sync.version&&currentSync.savedVersion===sync.savedVersion&&currentSync.status==='saved'&&!currentSync.pending&&currentSync.revision===sync.revision&&currentSync.digest===sync.digest&&currentSync.auroraAccountBackup?.version===coverage.version&&currentSync.auroraAccountBackup.address===snapshot.address&&currentSync.auroraAccountBackup.digest===coverage.digest,'The original receiving setup changed.');state.auroraOwnedAccount.recoveryVerified={chainId:CHAIN,address:snapshot.address};delete state.auroraOwnedAccount.receivingSetup;check();},{markBackup:false});
  check();return connect();
 }
 async function requireRecovery(ticket,{latest=false,signal}={}){
  guard(ticket);signal?.throwIfAborted();let state=await read();assert(state.identity?.profile.id===lenzIdentity&&state.auroraOwnedAccount?.address===connected.address,'Open the original Aurora destination.');requireAuroraAccountAccess(state);const snapshot=await decode(state,lenzIdentity),version=state.accountSync?.version;
  assert(Number.isSafeInteger(version)&&version>0,'Set up encrypted account recovery before using Aurora funds.');if(latest)await backupState();guard(ticket);signal?.throwIfAborted();state=await read();assert(state.identity?.profile.id===lenzIdentity&&state.auroraOwnedAccount?.address===snapshot.address,'The Aurora backup account changed.');requireAuroraAccountAccess(state);
  const current=await decode(state,lenzIdentity),sync=state.accountSync,coverage=sync?.auroraAccountBackup;
  assert(JSON.stringify(current)===JSON.stringify(snapshot)&&coverage?.address===snapshot.address&&coverage.digest===await digest(snapshot)&&Number.isSafeInteger(coverage.version)&&coverage.version>0&&sync.savedVersion>=coverage.version&&sync.status!=='conflict'&&(!latest||coverage.version>=version&&sync.savedVersion>=version),'The original Aurora key and current transfer are not backed up yet.');guard(ticket);signal?.throwIfAborted();
 }
 function capture(){
  const ticket=generation,identity=structuredClone(connected);guard(ticket);
  async function signTransfer(value,{signal}={}){
   guard(ticket);signal?.throwIfAborted();const review=checkAuroraTransferReview(value,{now:now()});assert(review.owner===lenzIdentity&&review.from===identity.address,'The Aurora transfer belongs to another account.');
   let retained;await update(async state=>{guard(ticket);signal?.throwIfAborted();requireAuroraAccountAccess(state);const snapshot=await decode(state,lenzIdentity);assert(snapshot?.address===identity.address,'The Aurora spending key changed.');const existing=snapshot.transfers.find(row=>row.id===review.id);if(existing){assert(JSON.stringify(existing.review)===JSON.stringify(review)&&existing.signed,'Check the original unresolved Aurora approval.');retained=existing.signed;return;}
    assert(snapshot.transfers.length===0,'Check the original Aurora transfer before approving another.');snapshot.transfers.push({id:review.id,review,status:'approval-unresolved',signed:null});await encode(state,snapshot);guard(ticket);signal?.throwIfAborted();},{signal});
   await requireRecovery(ticket,{latest:true,signal});if(retained)return checkSigned(retained,review);
   const signed=await update(async state=>{
    guard(ticket);signal?.throwIfAborted();requireAuroraAccountAccess(state);const snapshot=await decode(state,lenzIdentity),row=snapshot?.transfers.find(row=>row.id===review.id);assert(row?.status==='approval-unresolved'&&!row.signed&&JSON.stringify(row.review)===JSON.stringify(review)&&snapshot.address===identity.address,'The saved Aurora transfer review changed.');checkAuroraTransferReview(review,{now:now()});
    const raw=privateBytes(snapshot.privateKey);let artifact;try{const tx=Transaction.from({type:0,chainId:deployment.chainId,to:review.token,nonce:review.nonce,value:0n,data:transferData(review),gasLimit:BigInt(review.gasLimit),gasPrice:BigInt(review.gasPrice)});tx.signature=new SigningKey(raw).sign(tx.unsignedHash);artifact=checkSigned({type:SIGNED,reviewId:review.id,transactionHash:tx.hash,bytes:tx.serialized,createdAt:now()},review);}finally{raw.fill(0);}
    row.signed=artifact;row.status='signed';await encode(state,snapshot);guard(ticket);signal?.throwIfAborted();return artifact;
   },{signal});await requireRecovery(ticket,{latest:true,signal});return signed;
  }
  return Object.freeze({identity,assertCurrent:()=>guard(ticket),requireRecovery:options=>requireRecovery(ticket,options),signTransfer});
 }
 async function originalTransfer(id){const ticket=generation;guard(ticket);const snapshot=await decode(await read(),lenzIdentity);guard(ticket);const row=snapshot?.transfers.find(row=>row.id===id);assert(row?.signed,'Keep or check the original Aurora transfer approval.');return checkSigned(row.signed,row.review);}
 async function beginTransferDispatch(id,{signal}={}){
  const ticket=generation;guard(ticket);await requireRecovery(ticket,{latest:true,signal});
  const signed=await update(async state=>{guard(ticket);signal?.throwIfAborted();requireAuroraAccountAccess(state);const snapshot=await decode(state,lenzIdentity),row=snapshot?.transfers.find(row=>row.id===id);assert(row?.signed&&row.status==='signed','Check the original Aurora transaction status; dispatch is already unresolved.');assert(snapshot.address===connected.address,'The Aurora dispatch account changed.');checkAuroraTransferReview(row.review,{now:now()});row.status='submission-unresolved';await encode(state,snapshot);guard(ticket);signal?.throwIfAborted();return checkSigned(row.signed,row.review);},{signal});
  await requireRecovery(ticket,{latest:true,signal});return signed;
 }
 globalThis.addEventListener?.('lenz-account-identity',disconnect);globalThis.addEventListener?.('pagehide',disconnect);
 return Object.freeze({connect,connectReceiving,capture,originalTransfer,beginTransferDispatch,identity:()=>connected?structuredClone(connected):null,disconnect,dispose(){disconnect();globalThis.removeEventListener?.('lenz-account-identity',disconnect);globalThis.removeEventListener?.('pagehide',disconnect);}});
}
