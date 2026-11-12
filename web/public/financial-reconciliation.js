import {assert,keysAre,bytes,hex,unhex,validateProfile} from './peer-crypto.js';
export const FINANCIAL_REVIEW='lenz/financial-recovery-review/v1';
const ARCHIVE='lenz/encrypted-financial-review/v1',MAX_BYTES=2000000;
export const FINANCIAL_GAPS=Object.freeze(['canonical-funding','canonical-outcomes','executor-journals','other-devices','spending-epochs','financial-keys','zcash','unsupported-venues','bounded-budgets']);
const domains=['private','evm','near','rhea','prototype','hyperliquid'];
const text=value=>typeof value==='string'&&value.length<=512&&!/[\u0000-\u001f\u007f]/.test(value);
const hash=value=>typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
const time=value=>Number.isSafeInteger(value)&&value>0;
const rowFields=['domain','scope','kind','owner','asset','quantity','nonce','input','destination','state','observedAt','bindingDigest','evidenceDigest'];
function canonicalAuthority(row){
 const wallet=/^0x[0-9a-f]{40}$/.test(row.owner)&&!/^0x0{40}$/.test(row.owner),integer=/^(0|[1-9][0-9]{0,77})$/.test(row.nonce);
 if(row.domain==='evm')return wallet&&/^eip155:[1-9][0-9]{0,77}$/.test(row.scope)&&integer&&BigInt(row.nonce)<2n**256n&&row.asset.startsWith(row.scope+'/');
 if(row.domain==='private'){
  let nonce=false;try{nonce=row.nonce.length===44&&atob(row.nonce).length===32&&btoa(atob(row.nonce))===row.nonce;}catch{}
  return wallet&&row.scope==='intents.far'&&nonce&&/^nep141:[a-z0-9._-]{2,128}$/.test(row.asset);
 }
 if(row.domain==='hyperliquid')return wallet&&row.scope==='hyperliquid:mainnet'&&integer&&Number.isSafeInteger(Number(row.nonce))&&Number(row.nonce)>0;
 if(['near','rhea'].includes(row.domain))return /^(02|03)[0-9a-f]{64}$/.test(row.owner)&&/^near:testnet\/[a-z0-9][a-z0-9._-]{0,63}$/.test(row.scope)&&/^[0-9a-f]{32}$/.test(row.nonce)&&row.asset===row.scope+'/tUSD'&&(!row.input||/^(root:[0-9a-f]{64}|[0-9a-f]{64}:[01])$/.test(row.input));
 return /^04[0-9a-f]{128}$/.test(row.owner)&&row.scope==='research-chat-demo-v1'&&hash(row.nonce)&&/^(root:demo-[0-9a-f]{64}|[0-9a-f]{64}:(0|[1-9][0-9]*))$/.test(row.input);
}
export function checkedFinancialReview(input){
 assert(input&&bytes(input).length<=MAX_BYTES,'Financial review exceeds 2 MB.');
 const value=structuredClone(input);
 assert(keysAre(value,['type','identity','createdAt','financialState','executable','rows','gaps'])&&value.type===FINANCIAL_REVIEW&&hash(value.identity)&&time(value.createdAt)&&value.financialState==='unreconciled'&&value.executable===false,'Invalid financial recovery review.');
 assert(Array.isArray(value.rows)&&value.rows.length<=1000,'Too many retained financial records.');
 for(const row of value.rows){
  assert(keysAre(row,rowFields)&&domains.includes(row.domain)&&['scope','kind','owner','asset','nonce','input','destination','state'].every(key=>text(row[key]))&&/^(0|[1-9][0-9]{0,77})(\.[0-9]{1,18})?$/.test(row.quantity)&&(row.domain==='hyperliquid'||!row.quantity.includes('.'))&&row.scope&&row.owner&&row.asset&&row.kind&&row.state&&time(row.observedAt)&&hash(row.bindingDigest)&&hash(row.evidenceDigest),'Invalid retained financial record.');
  assert(canonicalAuthority(row),'Retained authority labels must use canonical owner, scope and nonce forms.');
 }
 assert(new Set(value.rows.map(row=>row.evidenceDigest)).size===value.rows.length,'Duplicate retained evidence.');
 assert(Array.isArray(value.gaps)&&value.gaps.length<=64&&value.gaps.every(gap=>keysAre(gap,['domain','reason'])&&[...domains,...FINANCIAL_GAPS].includes(gap.domain)&&['unavailable','no-retained-records','invalid','excluded'].includes(gap.reason)),'Invalid missing financial evidence.');
 assert(FINANCIAL_GAPS.every(domain=>value.gaps.some(gap=>gap.domain===domain)),'Financial authority evidence remains incomplete.');
 value.rows.sort((a,b)=>a.evidenceDigest.localeCompare(b.evidenceDigest));
 value.gaps.sort((a,b)=>a.domain.localeCompare(b.domain)||a.reason.localeCompare(b.reason));
 return value;
}
export function financialConflicts(input){
 const rows=checkedFinancialReview(input).rows,conflicts=new Set();
 for(let i=0;i<rows.length;i++)for(let j=i+1;j<rows.length;j++){
  const a=rows[i],b=rows[j];
  if(a.scope===b.scope&&a.bindingDigest!==b.bindingDigest&&((a.owner===b.owner&&a.nonce&&a.nonce===b.nonce)||(a.input&&a.input===b.input))){conflicts.add(a.evidenceDigest);conflicts.add(b.evidenceDigest);}
 }
 return [...conflicts];
}
export function mergeFinancialReviews(one,two){
 const a=checkedFinancialReview(one),b=checkedFinancialReview(two);assert(a.identity===b.identity,'Financial review belongs to another Lenz account.');
 const rows=new Map(a.rows.map(row=>[row.evidenceDigest,row]));
 for(const row of b.rows){const previous=rows.get(row.evidenceDigest);assert(!previous||JSON.stringify(previous)===JSON.stringify(row),'Retained evidence digest disagrees.');rows.set(row.evidenceDigest,row);}
 const gaps=new Map([...a.gaps,...b.gaps].map(gap=>[gap.domain+':'+gap.reason,gap]));
 return checkedFinancialReview({...a,createdAt:Math.max(a.createdAt,b.createdAt),rows:[...rows.values()],gaps:[...gaps.values()]});
}
async function archiveKey(identity,archive){
 await validateProfile(identity.profile);
 const publicKey=await crypto.subtle.importKey('raw',unhex(identity.profile.boxPublic),{name:'ECDH',namedCurve:'P-256'},false,[]);
 const shared=new Uint8Array(await crypto.subtle.deriveBits({name:'ECDH',public:publicKey},identity.boxPrivate,256));
 try{
  const material=await crypto.subtle.importKey('raw',shared,'HKDF',false,['deriveKey']);
  return await crypto.subtle.deriveKey({name:'HKDF',hash:'SHA-256',salt:unhex(archive.salt),info:bytes([ARCHIVE,identity.profile.id])},material,{name:'AES-GCM',length:256},false,['encrypt','decrypt']);
 }finally{shared.fill(0);}
}
const aad=archive=>bytes([archive.type,archive.salt,archive.iv]);
export async function sealFinancialReview(identity,input){
 const review=checkedFinancialReview(input);assert(review.identity===identity.profile.id,'Financial review belongs to another Lenz account.');
 const archive={type:ARCHIVE,salt:hex(crypto.getRandomValues(new Uint8Array(32))),iv:hex(crypto.getRandomValues(new Uint8Array(12)))};
 const key=await archiveKey(identity,archive),ciphertext=await crypto.subtle.encrypt({name:'AES-GCM',iv:unhex(archive.iv),additionalData:aad(archive)},key,bytes(review));
 return {...archive,ciphertext:hex(ciphertext)};
}
export async function openFinancialReview(identity,input){
 assert(keysAre(input,['type','salt','iv','ciphertext'])&&input.type===ARCHIVE&&hash(input.salt)&&typeof input.iv==='string'&&/^[0-9a-f]{24}$/.test(input.iv)&&typeof input.ciphertext==='string'&&/^[0-9a-f]+$/.test(input.ciphertext)&&input.ciphertext.length>=32&&input.ciphertext.length<=2*(MAX_BYTES+16)&&input.ciphertext.length%2===0,'Invalid encrypted financial review.');
 const key=await archiveKey(identity,input),plain=new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(input.iv),additionalData:aad(input)},key,unhex(input.ciphertext)));
 try{const review=checkedFinancialReview(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(plain)));assert(review.identity===identity.profile.id,'Financial review belongs to another Lenz account.');return review;}finally{plain.fill(0);}
}
