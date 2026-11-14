const released=new Set(['lending','swaps','transfers','chat']);
let dialog=null,returnFocus=null;

export const featureAvailable=feature=>released.has(feature);
export function showComingSoon(trigger=document.activeElement){
  if(!dialog){
    dialog=document.createElement('dialog');dialog.className='lenz-coming-soon';dialog.setAttribute('aria-labelledby','lenz-coming-soon-title');
    const brand=document.createElement('p');brand.className='lenz-coming-soon-brand';brand.textContent='Lenz';
    const title=document.createElement('h2');title.id='lenz-coming-soon-title';title.textContent='Coming soon';
    const close=document.createElement('button');close.type='button';close.setAttribute('aria-label','Close');close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';close.onclick=()=>dialog.close();
    dialog.addEventListener('keydown',event=>{if(event.key==='Tab'){event.preventDefault();close.focus();}});
    dialog.append(brand,title,close);dialog.addEventListener('close',()=>{if(returnFocus?.isConnected)returnFocus.focus({preventScroll:true});returnFocus=null;});
    dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const bounds=dialog.getBoundingClientRect();if(event.clientX<bounds.left||event.clientX>bounds.right||event.clientY<bounds.top||event.clientY>bounds.bottom)dialog.close();});
    document.body.append(dialog);
  }
  if(dialog.open)return;
  returnFocus=trigger;dialog.showModal();dialog.querySelector('button').focus();
}
export function requireFeature(feature,trigger){
  if(featureAvailable(feature))return true;
  showComingSoon(trigger);return false;
}
