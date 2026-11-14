import {readState} from './chat-store.js';
import {requirePaymentAccess} from './chat-access.js';
import {createZcashIntentSource,createZcashIntentService} from './intent-zcash-route.js';
import {createIntentActionStore} from './intent-action-store.js';
import {mountIntentAction} from './intent-action-ui.js';
import {zcashTestSelection,formatZcashAmount} from './intent-zcash-plan.js';

const check=(ok,message)=>{if(!ok)throw Error(message);};
export function createZcashSendController(){
 let identity=null,source=null,view=null,generation=0,busy=false,disposed=false,restoreComposer=null;
 function invalidate(){generation++;busy=false;restoreComposer=null;view?.dispose();view=null;source?.dispose();source=null;}
 function render(next){if(next!==identity){identity=next??null;invalidate();}}
 function mountView(owner,ticket){
  if(view)return;
  const mounted=mountIntentAction({source,service:createZcashIntentService(source),store:createIntentActionStore(owner),idPrefix:'zcash-send-action',formatAmount:formatZcashAmount,formatAccount:(account,role)=>role==='source'?'Native testnet wallet '+source.identity().wallet.toUpperCase():'Configured shielded recipient'});view=mounted;
  mounted.dialog.addEventListener('close',()=>{if(!disposed&&ticket===generation&&!mounted.workspace.snapshot().attempts.some(row=>!['declined','executed','refunded','expired'].includes(row.status)))restoreComposer?.();});
 }
 async function openActivity(accountId){
  check(!disposed&&!busy,'Finish the current payment first.');check(identity,'Create or sign in to your Lenz account first.');
  const wallet=/^native-zcash:([ab]):[0-9a-f]{64}$/.exec(accountId)?.[1];check(wallet,'Open the original native source.');
  const ticket=generation,owner=identity;busy=true;restoreComposer=null;
  const current=()=>check(!disposed&&ticket===generation&&identity===owner,'Open the original Lenz account.');
  try{
   const state=await readState();current();check(state.identity?.profile.id===owner,'Open the original Lenz account.');requirePaymentAccess(state.identity);
   if(source?.identity()?.wallet!==wallet){view?.dispose();view=null;source?.dispose();source=null;const opened=createZcashIntentSource(owner);source=opened;try{await opened.connect(wallet);}catch(error){opened.dispose();if(source===opened)source=null;throw error;}}
   current();const native=source.identity();check(native?.accountId===accountId,'Open the original configured native source.');
   mountView(owner,ticket);await view.restore(native);current();
  }catch(error){if(ticket===generation){view?.dispose();view=null;source?.dispose();source=null;}throw error;}
  finally{if(ticket===generation)busy=false;}
 }
 async function open({recipient,amount,isCurrent=()=>true,proceed=()=>{},restore=()=>{}}){
  check(!disposed&&!busy,'Finish the current payment first.');check(identity,'Create or sign in to your Lenz account first.');
  const ticket=generation,owner=identity;let handedOff=false;busy=true;
  const current=()=>check(!disposed&&ticket===generation&&identity===owner,'Open the original Lenz account.');
  try{
   const state=await readState();current();check(state.identity?.profile.id===owner&&isCurrent(),'Payment selection changed. Open Send again.');requirePaymentAccess(state.identity);
   if(source?.identity()?.wallet!=='a'){view?.dispose();view=null;source?.dispose();source=null;const opened=createZcashIntentSource(owner);source=opened;try{await opened.connect('a');}catch(error){opened.dispose();if(source===opened)source=null;throw error;}}
   current();check(isCurrent(),'Payment selection changed. Open Send again.');
   const native=source.identity();check(native?.wallet==='a'&&native.recipient===recipient,'Use the configured shielded testnet recipient.');
   const chosen=zcashTestSelection(native.accountId,recipient,amount),store=createIntentActionStore(owner);
   const retained=await store.read(JSON.stringify([native.chainId,native.accountId]));current();check(isCurrent(),'Payment selection changed. Open Send again.');
   mountView(owner,ticket);
   restoreComposer=restore;
   if(retained.attempts.some(row=>!['declined','executed','refunded','expired'].includes(row.status))){await view.restore(native);current();check(isCurrent(),'Payment selection changed. Open Send again.');proceed();handedOff=true;return;}
   await view.open(chosen);current();check(isCurrent(),'Payment selection changed. Open Send again.');proceed();handedOff=true;
   try{await view.workspace.prepare();}catch{ /* The shared review retains the precise route failure and no approval. */ }
  }catch(error){if(!handedOff&&ticket===generation){restoreComposer=null;view?.dispose();view=null;source?.dispose();source=null;}throw error;}
  finally{if(ticket===generation)busy=false;}
 }
 const changed=()=>{identity=null;invalidate();};addEventListener('lenz-account-identity',changed);addEventListener('pagehide',changed);
 return Object.freeze({render,open,openActivity,dispose(){if(disposed)return;disposed=true;invalidate();removeEventListener('lenz-account-identity',changed);removeEventListener('pagehide',changed);}});
}
