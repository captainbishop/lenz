import {readState,updateState} from './chat-store.js';
import {assert,bytes} from './peer-crypto.js';
import {validateRecoveryLink} from './legacy-recovery.js';
export async function checkContactRecovery(state,input){
  assert(state.identity,'Create or restore your account first.');
  assert(input&&bytes(input).length<=65536,'This account update is too large.');
  const root=state.contacts.find(p=>p.id===input.from?.id);assert(root,'This update has no trusted earlier contact.');
  const link=await validateRecoveryLink(input,root.id);
  assert(link.to.id!==state.identity.profile.id,'This update points to your own account.');
  const previous=(state.contactRecoveries??[]).find(r=>r.from.id===root.id);
  assert(!previous||previous.to.id===link.to.id,'A different update is already saved for this contact. Confirm their ID directly.');
  return {link,previousName:root.name};
}
export async function reviewContactRecovery(input){return checkContactRecovery(await readState(),structuredClone(input));}
export async function acceptContactRecovery(input){
  const captured=structuredClone(input);
  return updateState(async state=>{
    const {link}=await checkContactRecovery(state,captured);
    if(!(state.contactRecoveries??[]).some(r=>r.from.id===link.from.id)){
      assert((state.contactRecoveries??[]).length<500,'Too many account updates.');
      (state.contactRecoveries??=[]).push(link);
    }
    if(!state.contacts.some(p=>p.id===link.to.id)){assert(state.contacts.length<500,'Too many contacts.');state.contacts.push({...link.to,name:state.contacts.find(p=>p.id===link.from.id).name});}
    return link.to.id;
  });
}
