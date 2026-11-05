import {assert,keysAre,digest,CHAT_DOMAIN,isPublicKey} from './peer-crypto.js';

export const AI_REQUEST='lenz/ai-request/v1';
export const AI_DISCLOSURE='server-visible-text-v1';
export function aiConversation(value){
  assert(keysAre(value,['messages'])&&Array.isArray(value.messages)&&value.messages.length>0&&value.messages.length<=9,'Use up to four AI replies per conversation.');
  let size=0;
  const messages=value.messages.map((m,i)=>{
    assert(keysAre(m,['role','content'])&&m.role===(i%2?'assistant':'user'),'Invalid AI conversation.');
    assert(typeof m.content==='string'&&m.content.trim().length>0&&m.content.length<=(i%2?8000:2000),'Message is too long.');
    size+=m.content.length;return {role:m.role,content:m.content};
  });
  assert(messages.length%2===1&&size<=16000,'Start a new AI conversation.');
  return {messages};
}
export function aiIdentity(profile){return {id:profile.id,signingPublic:profile.signingPublic,boxPublic:profile.boxPublic};}
export async function checkAIIdentity(value){
  assert(keysAre(value,['id','signingPublic','boxPublic'])&&isPublicKey(value.signingPublic)&&isPublicKey(value.boxPublic),'Invalid AI identity.');
  assert(value.id===await digest([CHAT_DOMAIN,value.signingPublic,value.boxPublic]),'Invalid AI identity.');
  return value;
}
export const aiTerms=async(origin,id,nonce,input)=>[AI_REQUEST,origin,id,nonce,AI_DISCLOSURE,await digest(aiConversation(input))];
