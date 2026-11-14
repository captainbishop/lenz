import {keysAre,bytes,assert} from './peer-crypto.js';
import {snapshotNearIntentRecovery,validateNearIntentRecovery,restoreNearIntentRecovery} from './intent-near-route.js';
import {snapshotIntentActionRecovery,validateIntentActionRecovery,restoreIntentActionRecovery} from './intent-action-store.js';
import {snapshotAuroraNoteRecovery,validateAuroraNoteRecovery,restoreAuroraNoteRecovery} from './intent-aurora-source.js';
import {snapshotAuroraAccountRecovery,validateAuroraAccountRecovery,restoreAuroraAccountRecovery} from './intent-aurora-account.js';
import {snapshotLendingAccountRecovery,validateLendingAccountRecovery,restoreLendingAccountRecovery} from './intent-lending-account.js';
import {validateLendingSupplyNoteIntegrity} from './intent-lending-notes.js';
export async function snapshotIntentRecovery(state){
 const nearSource=await snapshotNearIntentRecovery(state),actions=await snapshotIntentActionRecovery(state),auroraNotes=await snapshotAuroraNoteRecovery(state),auroraAccount=await snapshotAuroraAccountRecovery(state),lendingAccount=await snapshotLendingAccountRecovery(state);if(!nearSource&&!actions.length&&!auroraNotes&&!auroraAccount&&!lendingAccount)return null;
 return validateIntentRecovery({type:'lenz/intent-recovery/v1',owner:state.identity.profile.id,nearSource,actions,...(auroraNotes?{auroraNotes}:{}),...(auroraAccount?{auroraAccount}:{}),...(lendingAccount?{lendingAccount}:{})},state.identity);
}
export async function validateIntentRecovery(input,identity){
 input=structuredClone(input);
 const fields=['type','owner','nearSource','actions'];for(const field of ['auroraNotes','auroraAccount','lendingAccount'])if(Object.hasOwn(input,field))fields.push(field);
 assert(keysAre(input,fields)&&input.type==='lenz/intent-recovery/v1'&&input.owner===identity?.profile.id&&bytes(input).length<=4000000,'Financial recovery belongs to another account or is invalid.');
 const nearSource=input.nearSource===null?null:await validateNearIntentRecovery(input.nearSource,identity);
 const auroraNotes=Object.hasOwn(input,'auroraNotes')?await validateAuroraNoteRecovery(input.auroraNotes,identity,nearSource):null;
 const auroraAccount=Object.hasOwn(input,'auroraAccount')?validateAuroraAccountRecovery(input.auroraAccount,identity):null;
 const lendingAccount=Object.hasOwn(input,'lendingAccount')?validateLendingAccountRecovery(input.lendingAccount,identity):null;
 await validateLendingSupplyNoteIntegrity(lendingAccount?.supplyNotes);
 const actions=await validateIntentActionRecovery(input.actions,identity,nearSource,{auroraNotes,auroraAccount,lendingAccount});
 return {type:input.type,owner:input.owner,nearSource,actions,...(auroraNotes?{auroraNotes}:{}),...(auroraAccount?{auroraAccount}:{}),...(lendingAccount?{lendingAccount}:{})};
}
export async function restoreIntentRecovery(state,input){
 const snapshot=await validateIntentRecovery(input,state.identity),staged=structuredClone(state);
 if(snapshot.nearSource)await restoreNearIntentRecovery(staged,snapshot.nearSource);await restoreIntentActionRecovery(staged,snapshot.actions);
 if(snapshot.auroraNotes)await restoreAuroraNoteRecovery(staged,snapshot.auroraNotes,snapshot.nearSource);
 if(snapshot.auroraAccount)await restoreAuroraAccountRecovery(staged,snapshot.auroraAccount);
 if(snapshot.lendingAccount)await restoreLendingAccountRecovery(staged,snapshot.lendingAccount);
 for(const key of ['nearIntentSource','nearIntentFundingBox','intentActionKey','intentActionBox','auroraIntentNotes','auroraOwnedAccount','lendingOwnedAccount'])if(staged[key]!==undefined)state[key]=staged[key];return snapshot;
}
