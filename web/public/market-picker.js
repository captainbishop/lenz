const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
export function mountMarketPicker(button,onSelect){
  button.type='button';button.setAttribute('aria-label','Select market');button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls','market-picker');
  const label=el('span','Select market'),chevron=el('span',undefined,'picker-chevron');chevron.setAttribute('aria-hidden','true');button.replaceChildren(label,chevron);
  const dialog=el('dialog',undefined,'market-picker');dialog.id='market-picker';dialog.setAttribute('aria-labelledby','market-picker-title');
  const head=el('div',undefined,'picker-head'),title=el('h2','Market');title.id='market-picker-title';
  const close=el('button',undefined,'picker-close');close.type='button';close.setAttribute('aria-label','Close market picker');close.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';head.append(title,close);
  const search=el('input');search.id='market-picker-search';search.type='search';search.maxLength=80;search.placeholder='Search token or market';search.setAttribute('aria-label','Find market');search.setAttribute('role','combobox');search.setAttribute('aria-autocomplete','list');search.setAttribute('aria-expanded','true');search.setAttribute('aria-controls','market-picker-options');search.autocomplete='off';search.spellcheck=false;
  const list=el('div',undefined,'picker-options');list.id='market-picker-options';list.setAttribute('role','listbox');list.setAttribute('aria-label','Markets');
  const empty=el('p','No matching markets','picker-empty');empty.setAttribute('role','status');empty.hidden=true;dialog.append(head,search,list,empty);document.body.append(dialog);
  let items=[],selected=null,visible=[],activeId=null,lastKey='';
  function active(id,scroll=true){
    activeId=id;
    for(const option of list.children)option.classList.toggle('is-active',option.dataset.id===id);
    const option=[...list.children].find(node=>node.dataset.id===id);
    if(option){search.setAttribute('aria-activedescendant',option.id);if(scroll)option.scrollIntoView({block:'nearest'});}else search.removeAttribute('aria-activedescendant');
  }
  function dismiss(restore=true){dialog.close();button.setAttribute('aria-expanded','false');if(restore&&button.getClientRects().length)button.focus({preventScroll:true});}
  function choose(id){if(!items.some(item=>item.id===id))return;dismiss();onSelect(id);}
  function paint(){
    const query=search.value.trim().toLowerCase();visible=items.filter(item=>(item.label+' '+item.detail).toLowerCase().includes(query));
    list.replaceChildren(...visible.map((item,index)=>{
      const option=el('button',undefined,'picker-option');option.type='button';option.tabIndex=-1;option.id='market-picker-option-'+index;option.dataset.id=item.id;option.setAttribute('role','option');option.setAttribute('aria-selected',String(item.id===selected));
      const text=el('span');text.append(el('strong',item.label),el('small',item.detail));const marker=el('span',undefined,'picker-selected');marker.setAttribute('aria-hidden','true');option.append(text,marker);option.onclick=()=>choose(item.id);return option;
    }));
    empty.hidden=visible.length>0;active(visible.some(item=>item.id===activeId)?activeId:visible.find(item=>item.id===selected)?.id??visible[0]?.id??null,false);
  }
  button.onclick=()=>{search.value='';activeId=selected;paint();dialog.showModal();button.setAttribute('aria-expanded','true');search.focus();active(activeId);};
  close.onclick=()=>dismiss();dialog.addEventListener('cancel',event=>{event.preventDefault();dismiss();});dialog.addEventListener('close',()=>button.setAttribute('aria-expanded','false'));
  dialog.addEventListener('click',event=>{if(event.target!==dialog)return;const box=dialog.getBoundingClientRect();if(event.clientX<box.left||event.clientX>box.right||event.clientY<box.top||event.clientY>box.bottom)dismiss();});
  search.oninput=()=>{activeId=null;paint();list.scrollTop=0;};
  dialog.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();event.stopPropagation();dismiss();return;}
    if(event.key==='Tab'){event.preventDefault();const controls=[close,search],index=controls.indexOf(document.activeElement);controls[(index+(event.shiftKey?-1:1)+controls.length)%controls.length].focus();return;}
    if(event.target!==search&&!list.contains(event.target))return;
    if(['ArrowDown','ArrowUp'].includes(event.key)){
      event.preventDefault();if(!visible.length)return;const index=visible.findIndex(item=>item.id===activeId),direction=event.key==='ArrowDown'?1:-1;active(visible[Math.max(0,Math.min(visible.length-1,index+direction))].id);search.focus({preventScroll:true});
    }else if(event.key==='Enter'){event.preventDefault();if(activeId)choose(activeId);}
  });
  const desktop=matchMedia('(min-width:761px)');desktop.addEventListener('change',()=>{if(desktop.matches&&dialog.open){dismiss(false);document.querySelector('#market-rows [aria-pressed="true"]')?.focus({preventScroll:true});}});
  return {
    update(next,current){
      items=next;selected=current;label.textContent=items.find(item=>item.id===selected)?.label??'Select market';button.disabled=!items.length;
      const key=JSON.stringify([items,selected]);if(key!==lastKey&&dialog.open)paint();lastKey=key;
    },
    close(){if(dialog.open)dismiss(false);},
  };
}
