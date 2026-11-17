import {paintAvatar} from './profile-display.js';
import {resolveContactRequest} from './contact-requests.js';
import {prepareChatDelivery,requestAutomaticDelivery} from './delivery-mode.js';

const element=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
export const pendingContactRequests=state=>(state.contactRequests??[]).filter(r=>r.direction==='incoming'&&r.status==='pending'&&!state.contacts.some(c=>c.id===r.peerId));
export const contactRequestState=(state,peerId)=>(state.contactRequests??[]).findLast(r=>r.peerId===peerId);

export function renderContactRequests(state,active,select){
 const section=document.querySelector('#message-requests'),list=document.querySelector('#request-list'),requests=pendingContactRequests(state);
 list.replaceChildren();section.hidden=!requests.length;document.querySelector('#request-count').textContent=String(requests.length);
 const query=document.querySelector('#contact-search').value.toLocaleLowerCase();
 for(const request of requests){
  const profile=request.profile;if(!profile.name.toLocaleLowerCase().includes(query))continue;
  const button=element('button');button.type='button';button.setAttribute('aria-pressed',String(profile.id===active));
  const avatar=element('span',undefined,'avatar');avatar.setAttribute('aria-hidden','true');paintAvatar(avatar,profile);
  const copy=element('span',undefined,'contact-copy');copy.append(element('strong',profile.name),element('small','Message request'));
  button.append(avatar,copy);button.onclick=()=>select(profile.id);list.append(button);
 }
 return requests;
}

export function renderRequestReview(state,request,{action,status,select}){
 const section=document.querySelector('#contact-request-review');section.replaceChildren();
 section.hidden=!request||request.direction!=='incoming'||request.status!=='pending';if(section.hidden)return;
 section.append(element('strong','Message request'),element('p',`Accept to reply to ${request.profile.name}. Declining hides this request.`));
 const details=element('details'),summary=element('summary','Check Lenz ID');details.append(summary,element('p','Names and photos are chosen by the sender. Confirm this ID with them.'),element('code',request.profile.id.match(/.{8}/g).join(' ')));section.append(details);
 const buttons=element('div',undefined,'request-actions'),owner=state.identity.profile.id;
 for(const [decision,label]of [['accepted','Accept'],['declined','Decline']]){
  const button=element('button',label,decision==='declined'?'secondary':undefined);button.type='button';button.id=decision==='accepted'?'accept-contact-request':'decline-contact-request';
  button.onclick=()=>action(async()=>{
   await prepareChatDelivery(owner);const packet=await resolveContactRequest(request.requestId,decision,{owner});
   if(packet&&!await requestAutomaticDelivery(packet))throw Error('Your account changed. The original response stays saved.');
   select(decision==='accepted'?request.peerId:null);status(decision==='accepted'?'Request accepted. You can reply.':'Request declined.');
  });buttons.append(button);
 }
 section.append(buttons);
}
