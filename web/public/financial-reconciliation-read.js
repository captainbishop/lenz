import {readState} from './chat-store.js';
import {assert,keysAre,bytes,digest,unhex} from './peer-crypto.js';
import {isRecoveredChat} from './chat-access.js';
import {confidentialSpendOutbox} from './intents-spend-outbox.js';
import {readTransfers} from './evm-transfer-store.js';
import {readHyperOrders} from './hyperliquid-order-store.js';
import {FUND,compressed,nearLedger,transferTerms} from './near-protocol.js';
import {checkRheaPacket} from './rhea-protocol.js';
import {readTradeVault} from './trade-service.js';
import {tradeLedger,demoRoots,TRADE_CONTEXT} from './trade-model.js';
import {verifyAgreement} from './peer-exchange.js';
import {FINANCIAL_REVIEW,FINANCIAL_GAPS,checkedFinancialReview} from './financial-reconciliation.js';

export async function assertFinancialAccount(identity,signal){
 signal?.throwIfAborted();const current=(await readState()).identity;
 assert(current?.profile.id===identity.profile.id&&current.profile.boxPublic===identity.profile.boxPublic&&current.profile.signingPublic===identity.profile.signingPublic,'Lenz account changed. Read the retained records again.');signal?.throwIfAborted();
}
export async function readFinancialReview({signal}={}){
 signal?.throwIfAborted();const state=await readState(),identity=state.identity;assert(identity,'Open a Lenz account first.');
 const createdAt=Date.now(),rows=[],gaps=FINANCIAL_GAPS.map(domain=>({domain,reason:'unavailable'}));
 const add=async(fields,binding,evidence)=>{
  const row={...fields,bindingDigest:await digest(binding),evidenceDigest:await digest([fields.domain,evidence,fields])};
  checkedFinancialReview({type:FINANCIAL_REVIEW,identity:identity.profile.id,createdAt,financialState:'unreconciled',executable:false,rows:[row],gaps});
  const retained=rows.find(value=>value.evidenceDigest===row.evidenceDigest);
  assert(!retained||JSON.stringify(retained)===JSON.stringify(row),'Retained evidence digest disagrees.');if(!retained)rows.push(row);
 };
 async function source(domain,operation){const start=rows.length;signal?.throwIfAborted();try{await operation();checkedFinancialReview({type:FINANCIAL_REVIEW,identity:identity.profile.id,createdAt,financialState:'unreconciled',executable:false,rows,gaps});if(rows.length===start)gaps.push({domain,reason:'no-retained-records'});}catch(error){signal?.throwIfAborted();rows.splice(start);gaps.push({domain,reason:'invalid'});}}
 await source('private',async()=>{
  for(const row of (await confidentialSpendOutbox.snapshot(state)).rows){
   const t=row.offer.terms,p=JSON.parse(row.offer.generated.intent.payload);
   await add({domain:'private',scope:p.verifying_contract,kind:'Private approval',owner:t.owner,asset:t.originAsset,quantity:t.amount,nonce:p.nonce,input:'',destination:`${t.destinationAsset} to ${t.recipient}; minimum ${t.minOutput}`,state:row.report?'Provider report retained; settlement unverified':'Approval retained; outcome unresolved',observedAt:row.checkedAt},[row.slot,row.offer.terms,row.offer.generated.intent],row);
  }
 });
 await source('evm',async()=>{
  for(const row of await readTransfers()){
   const r=row.review,t=r.terms;
   await add({domain:'evm',scope:`eip155:${BigInt(t.chainId)}`,kind:r.version===3?'Funding transfer':'Public transfer',owner:t.from,asset:`eip155:${BigInt(t.chainId)}/${t.asset}`,quantity:BigInt(t.units).toString(),nonce:BigInt(r.transaction.nonce).toString(),input:'',destination:t.recipient,state:`Device journal: ${row.state}; financial recovery unverified`,observedAt:row.updatedAt},r,row);
  }
 });
 await source('hyperliquid',async()=>{
  for(const row of await readHyperOrders()){
   const r=row.review;
   await add({domain:'hyperliquid',scope:'hyperliquid:mainnet',kind:'Hyperliquid order',owner:r.account,asset:`hyperliquid:mainnet/${r.market.kind}/${r.market.asset}/${r.market.coin}`,quantity:r.size,nonce:String(r.nonce),input:'',destination:`${r.side} at ${r.price}; ${r.spend} ${r.spendAsset}`,state:`Device journal: ${row.state}; exchange state unverified`,observedAt:row.updatedAt},r,row);
   if(row.cancelRequestedAt!==undefined){assert(Number.isSafeInteger(row.cancelRequestedAt)&&row.cancelRequestedAt>0,'Invalid retained cancellation.');const nonce=String(row.cancelRequestedAt);
    await add({domain:'hyperliquid',scope:'hyperliquid:mainnet',kind:'Hyperliquid cancellation',owner:r.account,asset:`hyperliquid:mainnet/${r.market.kind}/${r.market.asset}/${r.market.coin}`,quantity:r.size,nonce,input:'',destination:`Cancel ${row.id}`,state:'Cancellation attempt retained; exchange outcome unverified',observedAt:row.cancelRequestedAt},[row.id,r.market.asset,nonce],[row.id,nonce]);
   }
  }
 });
 if(isRecoveredChat(identity)){gaps.push({domain:'near',reason:'excluded'},{domain:'rhea',reason:'excluded'},{domain:'prototype',reason:'excluded'});}
 else{
  await source('near',async()=>{
   if(!state.nearBox)return;
   assert(state.nearKey&&bytes(state.nearBox).length<=4000000,'Invalid retained test wallet.');
   const raw=await crypto.subtle.decrypt({name:'AES-GCM',iv:unhex(state.nearBox.iv),additionalData:bytes(['lenz/near-vault/v1',identity.profile.id])},state.nearKey,unhex(state.nearBox.ciphertext));
   const vault=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(raw)),ledger=await nearLedger(vault),scope=`near:testnet/${vault.contract}`;
   for(const spend of vault.spends){const note=ledger.notes.get(spend.input);await add({domain:'near',scope,kind:'Offline test-dollar transfer',owner:note.owner,asset:`${scope}/tUSD`,quantity:spend.amount,nonce:spend.nonce,input:spend.input,destination:spend.recipient,state:ledger.blocked.has(spend.input)?'Conflicting chain observation retained; input stays unavailable':'Signed transfer retained; canonical outcome unverified',observedAt:createdAt},transferTerms(vault.contract,spend),[spend,vault.chainConsumed?.[spend.input]??null]);}
   if(vault.funding){const f=vault.funding,terms=[FUND,'testnet',vault.contract,f.owner,f.amount,f.nonce];assert(keysAre(f,['owner','amount','nonce','signature','id'])&&f.owner===compressed(identity.profile.signingPublic)&&/^[1-9][0-9]{0,8}$/.test(f.amount)&&BigInt(f.amount)<=100000000n&&/^[0-9a-f]{32}$/.test(f.nonce)&&/^[0-9a-f]{128}$/.test(f.signature)&&f.id==='root:'+await digest(terms),'Invalid retained test funding request.');
    const key=await crypto.subtle.importKey('raw',unhex(f.owner),{name:'ECDSA',namedCurve:'P-256'},false,['verify']);assert(await crypto.subtle.verify({name:'ECDSA',hash:'SHA-256'},key,unhex(f.signature),bytes(terms)),'Retained test funding signature rejected.');
    await add({domain:'near',scope,kind:'Test-dollar funding request',owner:f.owner,asset:`${scope}/tUSD`,quantity:f.amount,nonce:f.nonce,input:'',destination:vault.contract,state:'Signed funding request retained; arrival unverified',observedAt:createdAt},terms,f);
   }
   assert(Array.isArray(vault.rheaOrders??[])&&(vault.rheaOrders??[]).length<=64,'Invalid retained swaps.');
   for(const order of vault.rheaOrders??[]){const p=order.packet;assert(p.config?.reserve===vault.contract,'Reserved swap belongs to another test wallet.');await checkRheaPacket(p.config,p);const i=p.instruction;
    await add({domain:'rhea',scope,kind:'Reserved test-dollar swap',owner:i.owner,asset:`${scope}/tUSD`,quantity:i.amount,nonce:i.nonce,input:i.input,destination:`${i.receiver_id}; minimum ${i.min_output} wrap.testnet`,state:'Reservation retained; never released by expiry',observedAt:createdAt},p.instruction,order);
   }
  });
  if(!rows.some(row=>row.domain==='rhea'))gaps.push({domain:'rhea',reason:state.nearBox?'unavailable':'no-retained-records'});
  await source('prototype',async()=>{
   const vault=await readTradeVault(state);if(!vault)return;
   assert(Array.isArray(vault.roots)&&vault.roots.length<=256&&Array.isArray(vault.journal)&&vault.journal.length<=1000,'Invalid demo reservations.');
   for(const root of vault.roots)assert(JSON.stringify(root)===JSON.stringify((await demoRoots(root.owner)).find(r=>r.asset===root.asset)),'Unrecognized demo backing.');
   const notes=new Map((await tradeLedger(vault)).snapshot().notes.map(note=>[note.id,note]));
   for(const row of vault.journal){const a=await verifyAgreement(row.agreement,notes,false),owner=identity.profile.signingPublic;
    assert(a.body.network===TRADE_CONTEXT.network&&a.body.pool===TRADE_CONTEXT.pool&&Array.isArray(row.inputs)&&row.inputs.length>0&&JSON.stringify(row.inputs)===JSON.stringify(a.body.inputs.filter(id=>notes.get(id)?.owner===owner))&&a.signatures.some(s=>s.owner===owner),'Invalid demo reservation owner.');
    for(const input of row.inputs){const note=notes.get(input);await add({domain:'prototype',scope:TRADE_CONTEXT.network,kind:'Prototype reservation',owner:note.owner,asset:`synthetic-only/${note.asset}`,quantity:note.value,nonce:a.id,input,destination:'Synthetic exchange; no cash value',state:'Reserved prototype input retained',observedAt:createdAt},a.body,[row,input]);}
   }
  });
 }
 await assertFinancialAccount(identity,signal);
 return checkedFinancialReview({type:FINANCIAL_REVIEW,identity:identity.profile.id,createdAt,financialState:'unreconciled',executable:false,rows,gaps});
}
