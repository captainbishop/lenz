// Keep native form values and validation; present choices in the page's theme.
const controls=new WeakMap();
let nextId=0,opened=null;
const el=(tag,cls)=>{const n=document.createElement(tag);n.className=cls;return n;};
function mount(select){
  if(controls.has(select)||select.multiple||select.hidden||select.getAttribute('aria-hidden')==='true')return;
  const labels=[...select.labels],name=select.getAttribute('aria-label')||labels.map(n=>{const copy=n.cloneNode(true);copy.querySelectorAll('select').forEach(node=>node.remove());return copy.textContent.trim();}).join(' ');
  const wrap=el('span','lenz-choice'),button=el('button','lenz-choice-button'),text=el('span','lenz-choice-value'),chevron=el('span','lenz-choice-chevron'),list=el('div','lenz-choice-list');
  const id=select.id||'lenz-choice-'+(++nextId);button.id=id+'-control';button.type='button';button.setAttribute('role','combobox');button.setAttribute('aria-label',name);button.setAttribute('aria-haspopup','listbox');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',id+'-options');
  chevron.setAttribute('aria-hidden','true');button.append(text,chevron);list.id=id+'-options';list.setAttribute('role','listbox');list.setAttribute('aria-label',name);list.hidden=true;
  if(typeof list.showPopover==='function')list.setAttribute('popover','manual');
  select.before(wrap);wrap.append(select,button,list);select.classList.add('lenz-choice-source');select.tabIndex=-1;select.setAttribute('aria-hidden','true');
  for(const label of labels)label.htmlFor=button.id;
  let active=-1,events=null,typed='',typedAt=0,invalid=false;
  const options=()=>[...select.options];
  const allowed=option=>!option.disabled&&!option.hidden&&!option.parentElement.disabled;
  function sync(){
    text.textContent=select.selectedOptions[0]?.label??'Choose';button.disabled=select.matches(':disabled');if(wrap.hidden!==select.hidden)wrap.hidden=select.hidden;
    button.setAttribute('aria-required',String(select.required));
    for(const attr of ['aria-describedby','aria-invalid']){const value=attr==='aria-invalid'&&invalid&&!select.validity.valid?'true':select.getAttribute(attr);if(value===null)button.removeAttribute(attr);else button.setAttribute(attr,value);}
    if(opened===api&&(button.disabled||wrap.hidden||!button.getClientRects().length))close();
  }
  function point(index){
    active=index;for(const node of list.children)node.classList.toggle('is-active',Number(node.dataset.index)===index);
    const node=list.querySelector('[data-index="'+index+'"]');if(node){button.setAttribute('aria-activedescendant',node.id);node.scrollIntoView({block:'nearest'});}else button.removeAttribute('aria-activedescendant');
  }
  function place(){
    const box=button.getBoundingClientRect(),viewport=window.visualViewport,edge=8,left=viewport?.offsetLeft??0,top=viewport?.offsetTop??0,width=viewport?.width??innerWidth,height=viewport?.height??innerHeight;
    if(!button.getClientRects().length||box.bottom<top||box.top>top+height){close();return;}
    let zoom=list.currentCSSZoom;
    if(!zoom){zoom=1;for(let node=list;node;node=node.parentElement)zoom*=Number.parseFloat(getComputedStyle(node).zoom)||1;}
    const below=top+height-box.bottom-edge,above=box.top-top-edge,up=below<160&&above>below;
    list.style.maxWidth=Math.max(0,width-edge*2)/zoom+'px';list.style.minWidth=Math.min(Math.max(box.width,144*zoom),width-edge*2)/zoom+'px';list.style.maxHeight=Math.max(44,Math.min(280*zoom,up?above:below))/zoom+'px';
    const menu=list.getBoundingClientRect();list.style.left=Math.max(left+edge,Math.min(box.left,left+width-menu.width-edge))/zoom+'px';list.style.top=(up?box.top-menu.height-4:box.bottom+4)/zoom+'px';
  }
  function close(){
    if(opened!==api)return;opened=null;events?.abort();events=null;
    if(list.hasAttribute('popover')&&list.matches(':popover-open'))list.hidePopover();list.hidden=true;button.setAttribute('aria-expanded','false');button.removeAttribute('aria-activedescendant');typed='';
  }
  function choose(index){
    const option=options()[index];if(select.matches(':disabled')||!option||!allowed(option)){close();return;}
    const changed=select.selectedIndex!==index;select.selectedIndex=index;sync();close();button.focus({preventScroll:true});
    if(changed){select.dispatchEvent(new Event('input',{bubbles:true}));select.dispatchEvent(new Event('change',{bubbles:true}));}
  }
  function open(){
    sync();if(button.disabled||!button.getClientRects().length)return;opened?.close();opened=api;
    list.replaceChildren(...options().map((option,index)=>{
      const row=el('div','lenz-choice-option');row.id=id+'-option-'+index;row.dataset.index=index;row.setAttribute('role','option');row.setAttribute('aria-selected',String(option.selected));row.setAttribute('aria-disabled',String(!allowed(option)));row.hidden=option.hidden;
      const label=el('span',''),tick=el('span','lenz-choice-tick');label.textContent=option.label;tick.setAttribute('aria-hidden','true');row.append(label,tick);
      row.onpointerdown=e=>e.preventDefault();row.onclick=e=>{e.preventDefault();e.stopPropagation();choose(index);};return row;
    }));
    list.hidden=false;if(list.hasAttribute('popover'))list.showPopover();place();button.setAttribute('aria-expanded','true');point(select.selectedIndex);button.focus({preventScroll:true});
    events=new AbortController();const listen=(target,event,handler,capture=false)=>target.addEventListener(event,handler,{signal:events.signal,capture});
    listen(document,'pointerdown',e=>{if(!wrap.contains(e.target))close();},true);
    listen(document,'focusin',e=>{if(!wrap.contains(e.target))close();});
    listen(document,'scroll',e=>{if(!list.contains(e.target))place();},true);listen(window,'resize',place);
    if(window.visualViewport){listen(visualViewport,'resize',place);listen(visualViewport,'scroll',place);}
    const dialog=select.closest('dialog');if(dialog)listen(dialog,'close',close);
  }
  button.onclick=e=>{e.preventDefault();opened===api?close():open();};button.onfocus=sync;
  button.onkeydown=e=>{
    if(e.key==='Tab'){close();return;}
    if(e.key==='Escape'&&opened===api){e.preventDefault();e.stopPropagation();close();return;}
    const arrows=['ArrowDown','ArrowUp','Home','End'];
    if(arrows.includes(e.key)){
      e.preventDefault();if(opened!==api){open();return;}
      const enabled=options().map((o,i)=>allowed(o)?i:-1).filter(i=>i>=0),current=enabled.indexOf(active);
      const index=e.key==='Home'?0:e.key==='End'?enabled.length-1:Math.max(0,Math.min(enabled.length-1,current+(e.key==='ArrowDown'?1:-1)));
      if(enabled.length)point(enabled[index]);return;
    }
    if(e.key==='Enter'||e.key===' '){e.preventDefault();opened===api?choose(active):open();return;}
    if(e.key.length===1&&!e.ctrlKey&&!e.metaKey&&!e.altKey){
      e.preventDefault();if(opened!==api)open();const now=Date.now();typed=(now-typedAt>700?'':typed)+e.key.toLowerCase();typedAt=now;
      const choices=options(),start=active+1;for(let i=0;i<choices.length;i++){const index=(start+i)%choices.length;if(allowed(choices[index])&&choices[index].label.toLowerCase().startsWith(typed)){point(index);break;}}
    }
  };
  select.addEventListener('change',sync);select.addEventListener('input',sync);select.addEventListener('focus',()=>button.focus());
  select.addEventListener('invalid',e=>{e.preventDefault();invalid=true;sync();button.focus();});
  const api={sync,close,select,button,reset(){invalid=false;sync();}};controls.set(select,api);sync();
}
function scan(root){
  if(root.nodeType!==1&&root!==document)return;
  if(root.matches?.('select')){const control=controls.get(root);control?control.sync():mount(root);}
  for(const select of root.querySelectorAll('select')){const control=controls.get(select);control?control.sync():mount(select);}
}
document.addEventListener('DOMContentLoaded',()=>{
scan(document);
new MutationObserver(records=>{
  for(const record of records){
    if(record.type==='childList')for(const node of record.addedNodes)scan(node);
    const select=record.target.closest?.('select');if(select){controls.get(select)?.close();controls.get(select)?.sync();}
    if(record.type==='attributes'&&['open','hidden','disabled'].includes(record.attributeName))scan(record.target);
  }
  if(opened&&!opened.button.isConnected)opened.close();
}).observe(document.body,{subtree:true,childList:true,attributes:true,attributeFilter:['open','hidden','disabled','required','selected','label','value','aria-invalid','aria-describedby']});
document.addEventListener('reset',e=>queueMicrotask(()=>{for(const select of e.target.querySelectorAll('select'))controls.get(select)?.reset();}));
},{once:true});
