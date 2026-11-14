import { refreshPreviewVideos, setPreviewView, pausePreviewMotion } from './home-videos.js';
import './home-defi.js';
import {themeIcon} from './theme-icon.js';
const $ = selector => document.querySelector(selector), root = document.documentElement;
const reduced = matchMedia('(prefers-reduced-motion: reduce)');
let paused = reduced.matches;
function motionState() {
 root.classList.toggle('motion-off', paused);pausePreviewMotion(paused);
 if (paused) { for (const animation of document.getAnimations()) animation.finish(); for(const target of document.querySelectorAll('[data-tilt-surface]')) { target.style.setProperty('--rx','0deg'); target.style.setProperty('--ry','0deg'); } }
}
themeIcon($('#theme-toggle'));refreshPreviewVideos();motionState();
addEventListener('lenz-theme-changed',refreshPreviewVideos);
reduced.addEventListener('change',()=>{paused=reduced.matches;motionState();});
const reveal=new IntersectionObserver(entries=>{for(const entry of entries) if(entry.isIntersecting){entry.target.classList.add('seen');reveal.unobserve(entry.target);if(!paused)entry.target.animate([{opacity:.35,transform:'translateY(22px)'},{opacity:1,transform:'translateY(0)'}],{duration:650,easing:'cubic-bezier(.2,.65,.3,1)'});}}, {threshold:.12});
for(const target of document.querySelectorAll('[data-reveal]'))reveal.observe(target);
for(const target of document.querySelectorAll('[data-tilt]')){
 const surface=target.querySelector('[data-tilt-surface]');
 const reset=()=>{surface.style.setProperty('--rx','0deg');surface.style.setProperty('--ry','0deg');};
 target.addEventListener('pointermove',event=>{if(paused||reduced.matches||event.pointerType==='touch')return;const rect=target.getBoundingClientRect();surface.style.setProperty('--rx',`${((event.clientY-rect.top)/rect.height-.5)*-5}deg`);surface.style.setProperty('--ry',`${((event.clientX-rect.left)/rect.width-.5)*7}deg`);});
 target.addEventListener('pointerleave',reset); target.addEventListener('pointercancel',reset);
}
const views={
 wallet:{alt:'Illustrated testnet flow: Amina pays Bola, Bola pays Chidi offline, Chidi reconnects and confirms',label:'Receive it. Pass it onward.',text:'Amina sends 1 tUSD to Bola. Bola passes that same value to Chidi while all three are offline. Chidi reconnects to confirm on NEAR.',link:'/money.html',action:'Open wallet'},
 chat:{alt:'Illustrated offline message: encrypted by Amina, shared by file, opened by Bola',label:'A private message can travel offline.',text:'Amina saves an encrypted message and shares its file. Bola opens it offline. The message stays encrypted in storage; routing identities and timing remain visible.',link:'/chat.html',action:'Open conversations'},
 profile:{alt:'Lenz ID walkthrough: copy your address, verify a contact and start a private conversation',label:'One ID for your conversations.',text:'Share your Lenz ID. Add someone you know and start a private conversation.',link:'/money.html',action:'Share your Lenz ID'}
};
const tabs=[...document.querySelectorAll('#product-tabs [role=tab]')];
function activate(tab){
 for(const item of tabs){item.setAttribute('aria-selected',String(item===tab));item.tabIndex=item===tab?0:-1;}
 const view=views[tab.dataset.view];setPreviewView(tab.dataset.view,view.alt);
 $('.product-screen .preview-top span:last-child').textContent=tab.dataset.view==='wallet'?'THE OFFLINE FLOW':tab.dataset.view==='chat'?'PRIVATE CONVERSATIONS':'YOUR LENZ ID';
 $('#product-preview-caption').textContent=tab.dataset.view==='wallet'?'Testnet payment replay':tab.dataset.view==='chat'?'Private message replay':'Lenz ID walkthrough';
 $('#product-preview-scope').textContent=tab.dataset.view==='wallet'?'Offline payments await confirmation.':tab.dataset.view==='chat'?'Opened by its recipient while offline.':'Public address · not an account backup';
 $('#product-title').textContent=view.label;$('#product-copy').textContent=view.text;$('#product-link').href=view.link;$('#product-link').textContent=`${view.action} ↗`;$('#product-panel').setAttribute('aria-labelledby',tab.id);
 if(!paused)$('#product-panel').animate([{opacity:.4,transform:'translateY(10px)'},{opacity:1,transform:'translateY(0)'}],{duration:300,easing:'ease-out'});
}
for(const tab of tabs){tab.onclick=()=>activate(tab);tab.onkeydown=event=>{let index=tabs.indexOf(tab);if(['ArrowRight','ArrowDown'].includes(event.key))index=(index+1)%tabs.length;else if(['ArrowLeft','ArrowUp'].includes(event.key))index=(index-1+tabs.length)%tabs.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=tabs.length-1;else return;event.preventDefault();tabs[index].focus();activate(tabs[index]);};}
for(const detail of document.querySelectorAll('.how-steps details'))detail.addEventListener('toggle',()=>{if(detail.open)for(const sibling of document.querySelectorAll('.how-steps details'))if(sibling!==detail)sibling.open=false;});
let scheduled=false;
function scrollState(){scheduled=false;const max=root.scrollHeight-innerHeight;root.style.setProperty('--page-progress',String(max>0?Math.min(1,Math.max(0,scrollY/max)):0));$('.home-nav').classList.toggle('scrolled',scrollY>10);let active='';for(const section of document.querySelectorAll('section[id]'))if(section.getBoundingClientRect().top<innerHeight*.45)active=section.id;for(const link of document.querySelectorAll('.section-nav a')){if(link.getAttribute('href')==='#'+active)link.setAttribute('aria-current','location');else link.removeAttribute('aria-current');}}
addEventListener('scroll',()=>{if(!scheduled){scheduled=true;requestAnimationFrame(scrollState);}},{passive:true});addEventListener('resize',scrollState);scrollState();
