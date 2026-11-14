const icons={
 light:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
 dim:'<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16Z" fill="currentColor" stroke="none"/>',
 dark:'<path d="M20.5 14a8.5 8.5 0 0 1-10.5-10.5A8.5 8.5 0 1 0 20.5 14Z"/>'
};
const svg=mode=>`<svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${icons[mode]}</svg>`;
export function themeIcon(button){
 if(!button||button.dataset.themePicker)return;
 button.dataset.themePicker='true';button.type='button';
 const modes=['light','dim','dark'],current=()=>document.documentElement.dataset.theme||'light';
 const next=()=>modes[(modes.indexOf(current())+1)%modes.length];
 function paint(){const mode=current(),label='Appearance: '+mode+'. Switch to '+next();button.innerHTML=svg(mode);button.setAttribute('aria-label',label);button.title=label;}
 button.onclick=()=>dispatchEvent(new CustomEvent('lenz-theme-choice',{detail:next()}));
 addEventListener('lenz-theme-changed',paint);paint();
}
themeIcon(document.getElementById('theme-toggle'));
