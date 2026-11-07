const icons={
 light:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 dim:'<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
 dark:'<path d="M20.5 14a8.5 8.5 0 0 1-10.5-10.5A8.5 8.5 0 1 0 20.5 14Z"/>',
 auto:'<rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21h8m-4-4v4"/>'
};
const svg=mode=>`<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[mode]}</svg>`;
export function themeIcon(button){
 if(!button||button.dataset.themePicker)return;
 button.dataset.themePicker='true';button.type='button';button.setAttribute('aria-haspopup','menu');button.setAttribute('aria-controls','theme-menu');button.setAttribute('aria-expanded','false');
 const menu=document.createElement('div');menu.id='theme-menu';menu.popover='auto';menu.setAttribute('role','menu');menu.setAttribute('aria-label','Appearance');
 const heading=document.createElement('p');heading.className='theme-menu-heading';heading.textContent='Appearance';menu.append(heading);
 const options=['light','dim','dark','auto'].map(mode=>{
  const item=document.createElement('button');item.type='button';item.dataset.mode=mode;item.setAttribute('role','menuitemradio');item.tabIndex=-1;
  item.innerHTML=svg(mode)+`<span>${mode[0].toUpperCase()+mode.slice(1)}</span><svg class="theme-check" aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m5 12 4 4L19 6"/></svg>`;
  if(mode==='auto'){item.className='theme-auto';item.title='Follow device appearance';}
  item.onclick=()=>{dispatchEvent(new CustomEvent('lenz-theme-choice',{detail:mode}));menu.hidePopover();button.focus();};menu.append(item);return item;
 });
 const hint=document.createElement('p');hint.className='theme-menu-hint';hint.textContent='Auto follows your device.';menu.append(hint);document.body.append(menu);
 function paint(){const mode=document.documentElement.dataset.themePreference||'auto';button.innerHTML=svg(mode);button.setAttribute('aria-label','Appearance: '+mode[0].toUpperCase()+mode.slice(1));button.title='Appearance';for(const item of options)item.setAttribute('aria-checked',String(item.dataset.mode===mode));}
 function position(){if(!menu.matches(':popover-open'))return;const rect=button.getBoundingClientRect(),width=menu.offsetWidth;menu.style.left=Math.max(8,Math.min(rect.right-width,innerWidth-width-8))+'px';menu.style.top=Math.max(8,Math.min(rect.bottom+10,innerHeight-menu.offsetHeight-8))+'px';}
 button.onclick=()=>{if(menu.matches(':popover-open'))menu.hidePopover();else{paint();menu.showPopover();position();options.find(item=>item.getAttribute('aria-checked')==='true')?.focus();}};
 menu.addEventListener('toggle',()=>{button.setAttribute('aria-expanded',String(menu.matches(':popover-open')));});
 menu.addEventListener('keydown',event=>{let index=options.indexOf(document.activeElement);if(event.key==='ArrowDown')index=(index+1)%options.length;else if(event.key==='ArrowUp')index=(index+options.length-1)%options.length;else if(event.key==='Home')index=0;else if(event.key==='End')index=options.length-1;else if(event.key==='Escape'){event.preventDefault();event.stopPropagation();menu.hidePopover();button.focus();return;}else if(event.key==='Tab'){menu.hidePopover();button.focus();return;}else return;event.preventDefault();options[index].focus();});
 addEventListener('resize',position);addEventListener('scroll',position,{passive:true});addEventListener('lenz-theme-changed',paint);paint();
}
themeIcon(document.getElementById('theme-toggle'));
