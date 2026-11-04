export const RECOVERED_CHAT='lenz/recovered-chat/v1';
export const isRecoveredChat=identity=>identity?.access===RECOVERED_CHAT;
export const isRecoveredContact=(state,id)=>(state.contactRecoveries??[]).some(link=>link.to.id===id);
export function requirePaymentAccess(identity){
  if(identity?.access!==undefined)throw Error('This recovered account is open for chat. Offline funds are not restored.');
}
export function checkSigningAccess(identity,value){
  if(identity?.access===undefined)return;
  const domains=['proof-u/private-conversation/v1','lenz/carrier/v1','lenz/nostr-envelope/v1','lenz/nearby/v1','lenz/chat-recovery-link/v1'];
  const archiveDigest=typeof value==='string'&&/^[0-9a-f]{64}$/.test(value);
  if(!isRecoveredChat(identity)||(!archiveDigest&&(!Array.isArray(value)||!domains.includes(value[0]))))requirePaymentAccess(identity);
}
