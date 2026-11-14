import {assert} from './peer-crypto.js';
import {LENDING_TESTNET} from './intent-lending-config.js';
import {createTornadoProver} from './tornado-prover.js';
import {lendingSupplyNoteDeployment} from './intent-lending-notes.js';
import {checkLendingSupplyReview,checkLendingSupplyAuthorization,buildLendingSupplyAuthorization,sameLendingSupplyValue,LENDING_SUPPLY_ZERO} from './intent-lending-supply.js';

export function createLendingIntentSource({account,config=LENDING_TESTNET,prover,now=Date.now}={}){
 assert(account,'Open the recoverable lending account first.');let connected=null,generation=0,local=prover,proving=false;
 const guard=ticket=>{assert(ticket===generation&&connected,'The private Supply source changed.');connected.lease.assertCurrent();};
 const cryptoProver=()=>local??=createTornadoProver({isCurrent:()=>!!connected});
 async function connect(){const ticket=++generation;connected=null;const identity=account.identity()??await account.connect();assert(ticket===generation,'The private Supply source changed.');const lease=account.capture();lease.assertCurrent();assert(identity.chainId===config.chain&&identity.deployed===true,'Verify the original deployed lending account first.');connected={lease,identity:{chainId:config.chain,accountId:identity.lenzIdentity,lenzIdentity:identity.lenzIdentity}};await records(ticket);return structuredClone(connected.identity);}
 async function records(ticket=generation){guard(ticket);const saved=await connected.lease.supplyNoteState();guard(ticket);assert(!saved||sameLendingSupplyValue(saved.deployment,lendingSupplyNoteDeployment(config)),'The original private Supply deployment changed.');return saved?.records??[];}
 async function createNote({signal}={}){
  const ticket=generation;guard(ticket);signal?.throwIfAborted();assert(!proving,'Finish the original local Supply proof first.');const saved=await records(ticket),existing=saved.find(row=>!row.spendAuthority);if(existing){await connected.lease.requireRecovery({latest:true,forSupply:true,signal});guard(ticket);return existing.note.commitment;}
  await connected.lease.requireRecovery({latest:true,forSupply:true,signal});guard(ticket);assert(saved.length<20,'The private Supply note limit was reached.');
  const note=await cryptoProver().generateNote({signal});guard(ticket);const value=await connected.lease.retainSupplyNote(note,{signal,prover:cryptoProver(),createdAt:now()});guard(ticket);await connected.lease.requireRecovery({latest:true,signal});guard(ticket);return value;
 }
 function checkSnapshot(observed,{allowStale=false}={}){
  const identity=connected.lease.identity,pool=observed?.privatePool;
  assert(observed?.chainId===config.chain&&observed.routeVerified===true&&observed.trust?.codePinsVerified===true&&observed.trust.implementationPinsVerified===true&&observed.trust.executionPinsVerified===true&&observed.block?.finality==='finalized'&&observed.block.requireCanonical===true&&/^0x[0-9a-f]{64}$/.test(observed.block.hash)&&Number.isSafeInteger(observed.observedAt)&&(allowStale||Math.abs(now()-observed.observedAt)<=120000),'Read the finalized pinned private Supply pool first.');
  assert(observed.account?.status==='verified'&&observed.account.address===identity.account&&observed.account.owner===identity.ownerAddress&&sameLendingSupplyValue(observed.account.route,identity.route),'The private Supply lending account changed.');
  assert(pool?.address===config.privacyPool&&Number.isSafeInteger(pool.nextIndex)&&pool.nextIndex>=0&&pool.nextIndex<=4096&&Array.isArray(pool.commitments)&&pool.commitments.length===pool.nextIndex&&new Set(pool.commitments).size===pool.nextIndex&&pool.commitments.every(value=>/^0x[0-9a-f]{64}$/.test(value))&&Array.isArray(pool.withdrawals)&&pool.withdrawals.length<=4096&&pool.withdrawals.every(row=>/^0x[0-9a-f]{64}$/.test(row.nullifierHash)),'The complete finalized private pool history is unavailable.');return pool;
 }
 async function prepareSpend(source,observed,options={}){
  const ticket=generation;guard(ticket);options.signal?.throwIfAborted();const pool=checkSnapshot(observed,options);
  assert(source?.chainId===config.chain&&source.asset===config.link&&source.accountId===connected.identity.accountId&&(source.amount??source.units)===config.denomination,'Choose the original private LINK note.');
  const row=(await records(ticket)).find(row=>row.note.commitment===source.commitment),index=pool.commitments.indexOf(source.commitment);assert(row&&index>=0&&!pool.withdrawals.some(value=>value.nullifierHash===row.note.nullifierHash),'The original private note is absent or already spent.');
  assert(await cryptoProver().validateNote(row.note,options),'The private note failed its integrity check.');guard(ticket);const path=await cryptoProver().buildMerklePath(pool.commitments,index,options);guard(ticket);assert(path.root===pool.root,'The original private pool history does not match its finalized root.');
  return {commitment:source.commitment,nullifierHash:row.note.nullifierHash,root:path.root,pathElements:path.pathElements,pathIndices:path.pathIndices};
 }
 async function holdings(observed,options={}){
  const ticket=generation;guard(ticket);const pool=checkSnapshot(observed),saved=await records(ticket),result=[];
  for(const row of saved){if(!pool.commitments.includes(row.note.commitment)||pool.withdrawals.some(value=>value.nullifierHash===row.note.nullifierHash))continue;const holding={chainId:config.chain,asset:config.link,accountId:connected.identity.accountId,amount:config.denomination,units:config.denomination,commitment:row.note.commitment,symbol:'LINK',decimals:18};await prepareSpend(holding,observed,options);result.push({...holding,available:row.spendAuthority?null:config.denomination,pending:!!row.spendAuthority,observedAt:observed.observedAt,block:structuredClone(observed.block)});}
  guard(ticket);return result;
 }
 async function originalSpendAuthority(review){const ticket=generation;guard(ticket);checkLendingSupplyReview(review,{config,allowExpired:true});const row=(await records(ticket)).find(value=>value.note.commitment===review.source.commitment);guard(ticket);if(!row?.spendAuthority)return null;assert(sameLendingSupplyValue(row.spendAuthority.review,review),'Keep and check the original private Supply request.');return checkLendingSupplyAuthorization(row.spendAuthority.authorization,review,{config});}
 async function retainSpendAuthority(review,authorization,options={}){const ticket=generation;guard(ticket);checkLendingSupplyReview(review,{config,allowExpired:true});checkLendingSupplyAuthorization(authorization,review,{config});const value=await connected.lease.retainSupplySpendAuthority(review,authorization,options);guard(ticket);return value;}
 async function prove(review,options={}){
  const ticket=generation;guard(ticket);assert(!proving,'Finish the original local Supply proof first.');checkLendingSupplyReview(review,{config,now:now()});assert(!await originalSpendAuthority(review),'Use the retained original private Supply proof.');const row=(await records(ticket)).find(value=>value.note.commitment===review.source.commitment);assert(row&&review.owner===connected.identity.lenzIdentity&&review.spend.nullifierHash===row.note.nullifierHash,'The private Supply note owner changed.');
  const spend=await prepareSpend(review.source,review.snapshot,{...options,allowStale:true});assert(sameLendingSupplyValue(spend,review.spend),'The reviewed original proof path changed.');proving=true;
  try{const result=await cryptoProver().prove({note:row.note,root:review.spend.root,pathElements:review.spend.pathElements,pathIndices:review.spend.pathIndices,recipient:review.vault,relayer:LENDING_SUPPLY_ZERO,fee:'0',refund:'0'},options);guard(ticket);assert(await cryptoProver().verify({...result.proof,publicSignals:result.publicSignals},options),'The original Supply proof did not verify.');guard(ticket);buildLendingSupplyAuthorization(review,result,{config});return result;}finally{proving=false;}
 }
 function capture(){const ticket=generation;guard(ticket);return Object.freeze({identity:structuredClone(connected.identity),assertCurrent:()=>guard(ticket),requireRecovery:options=>{guard(ticket);return connected.lease.requireRecovery({latest:true,...options});},prepareSpend:(...args)=>{guard(ticket);return prepareSpend(...args);},prove:(...args)=>{guard(ticket);return prove(...args);},retainSpendAuthority:(...args)=>{guard(ticket);return retainSpendAuthority(...args);},originalSpendAuthority:(...args)=>{guard(ticket);return originalSpendAuthority(...args);}});}
 function disconnect(){generation++;connected=null;local?.cancel();}
 globalThis.addEventListener?.('lenz-account-identity',disconnect);globalThis.addEventListener?.('pagehide',disconnect);
 return Object.freeze({connect,capture,createNote,holdings,identity:()=>connected?structuredClone(connected.identity):null,disconnect,dispose(){disconnect();local?.dispose();globalThis.removeEventListener?.('lenz-account-identity',disconnect);globalThis.removeEventListener?.('pagehide',disconnect);}});
}
