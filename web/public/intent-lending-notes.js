import {assert,bytes,keysAre} from './peer-crypto.js';
import {LENDING_TESTNET} from './intent-lending-config.js';
import {PRIVATE_SUPPLY_VAULT_CREATION_CODE} from './intent-lending-supply-code.js';
import {checkLendingSupplyReview,checkLendingSupplyAuthorization,sameLendingSupplyValue} from './intent-lending-supply.js';
import {createTornadoProver} from './tornado-prover.js';

const names=['pool','link','usdc','aLink','variableDebt','lendingFactory','privacyPool','supplyFactory','verifier','hasher'];
const hash=value=>typeof value==='string'&&/^0x[0-9a-f]{64}$/.test(value)&&BigInt(value)>0n;
const scalar=value=>hash(value)&&BigInt(value)<21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const secret=value=>typeof value==='string'&&/^(0|[1-9][0-9]{0,74})$/.test(value)&&BigInt(value)<2n**248n;
export function lendingSupplyNoteDeployment(config){return {chainId:config.chainId,chain:config.chain,denomination:config.denomination,...Object.fromEntries(names.map(key=>[key,config[key]])),codeHashes:Object.fromEntries(names.map(key=>[key,config.codeHashes?.[key]])),supplyVaultCreationCode:config.supplyVaultCreationCode??PRIVATE_SUPPLY_VAULT_CREATION_CODE};}
export function checkLendingSupplyNote(note){
 assert(keysAre(note,['version','nullifier','secret','commitment','nullifierHash'])&&note.version===1&&secret(note.nullifier)&&secret(note.secret)&&scalar(note.commitment)&&scalar(note.nullifierHash),'The original private note is invalid.');return structuredClone(note);
}
export function checkLendingSupplyNotes(value,snapshot){
 assert(keysAre(value,['type','deployment','records'])&&value.type==='lenz/lending-supply-notes/v1'&&bytes(value).length<=900000,'The private Supply recovery is invalid or too large.');
 const d=value.deployment,expected=lendingSupplyNoteDeployment(d);
 assert(sameLendingSupplyValue(d,expected)&&d.chainId===11155111&&d.chain===LENDING_TESTNET.chain&&d.denomination===LENDING_TESTNET.denomination&&d.lendingFactory===snapshot.route.factory&&d.chain===snapshot.route.chainId,'The original private Supply route changed.');
 for(const name of names)assert(typeof d[name]==='string'&&/^0x[0-9a-f]{40}$/.test(d[name])&&!/^0x0{40}$/.test(d[name])&&hash(d.codeHashes[name]),'The private Supply route is not pinned.');
 for(const name of names.slice(0,5))assert(d[name]===snapshot.route[name]&&d[name]===LENDING_TESTNET[name]&&d.codeHashes[name]===snapshot.route[name+'CodeHash'],'The original private Supply account route changed.');
 assert(typeof d.supplyVaultCreationCode==='string'&&/^0x(?:[0-9a-f]{2})+$/.test(d.supplyVaultCreationCode)&&d.supplyVaultCreationCode.length<=50000,'The original private Supply vault code is invalid.');
 assert(Array.isArray(value.records)&&value.records.length<=20,'The private Supply note limit was reached.');
 const commitments=new Set(),nullifiers=new Set();
 const records=value.records.map(row=>{
  assert(keysAre(row,['note','createdAt','spendAuthority'])&&Number.isSafeInteger(row.createdAt)&&row.createdAt>0,'The private Supply note record is invalid.');const note=checkLendingSupplyNote(row.note);
  assert(!commitments.has(note.commitment)&&!nullifiers.has(note.nullifierHash),'The original private notes conflict.');commitments.add(note.commitment);nullifiers.add(note.nullifierHash);
  if(row.spendAuthority!==null){
   assert(keysAre(row.spendAuthority,['review','authorization']),'The original private Supply authority is invalid.');
   const review=checkLendingSupplyReview(row.spendAuthority.review,{config:d,allowExpired:true});checkLendingSupplyAuthorization(row.spendAuthority.authorization,review,{config:d});
   assert(review.owner===snapshot.owner&&review.ownerAddress===snapshot.ownerAddress&&review.identity.account===snapshot.account&&sameLendingSupplyValue(review.identity.route,snapshot.route)&&review.source.accountId===snapshot.owner&&review.source.commitment===note.commitment&&review.spend.nullifierHash===note.nullifierHash,'The private Supply authority belongs to another original note or account.');
  }
  return structuredClone(row);
 }).sort((a,b)=>a.note.commitment.localeCompare(b.note.commitment));
 return {type:value.type,deployment:expected,records};
}
export function mergeLendingSupplyNotes(current,incoming,snapshot){
 if(!current&&!incoming)return undefined;
 const a=current?checkLendingSupplyNotes(current,snapshot):null,b=incoming?checkLendingSupplyNotes(incoming,snapshot):null;
 assert(!a||!b||sameLendingSupplyValue(a.deployment,b.deployment),'The original private Supply route conflicts with recovery.');
 const rows=new Map((a?.records??[]).map(row=>[row.note.commitment,row]));
 for(const row of b?.records??[]){const old=rows.get(row.note.commitment);assert(!old||sameLendingSupplyValue(old.note,row.note)&&old.createdAt===row.createdAt&&(!old.spendAuthority||!row.spendAuthority||sameLendingSupplyValue(old.spendAuthority,row.spendAuthority)),'The original private note or spending authority conflicts with recovery.');rows.set(row.note.commitment,old?{...old,spendAuthority:old.spendAuthority??row.spendAuthority}:row);}
 return checkLendingSupplyNotes({...a??b,records:[...rows.values()]},snapshot);
}
export async function validateLendingSupplyNoteIntegrity(value,{prover,signal}={}){
 if(!value?.records.length)return;const local=prover??createTornadoProver();
 try{for(const row of value.records){signal?.throwIfAborted();assert(await local.validateNote(row.note,{signal}),'The original private note failed its cryptographic integrity check.');}}finally{if(!prover)local.dispose();}
}
