// Decorative action arrows share one transition without changing link or button behavior.
const direction=glyph=>({'→':'right','←':'left','↑':'up','↓':'down','↘':'down-right','↖':'up-left','↙':'down-left'}[glyph]??'up-right');
function decorate(action){
  const walker=document.createTreeWalker(action,NodeFilter.SHOW_TEXT),texts=[];while(walker.nextNode())texts.push(walker.currentNode);
  for(const text of texts){
    if(text.parentElement.closest('.lenz-action-arrow,svg'))continue;
    const match=text.data.match(/[↗↖↘↙→←↑↓]\s*$/);if(!match)continue;
    const arrow=document.createElement('span');arrow.className='lenz-action-arrow';arrow.dataset.lenzDirection=direction(match[0].trim());arrow.textContent=match[0].trim();arrow.setAttribute('aria-hidden','true');
    text.replaceWith(document.createTextNode(text.data.slice(0,match.index)),arrow);
  }
}
for(const action of document.querySelectorAll('a,button'))decorate(action);
new MutationObserver(records=>{
  const actions=new Set();for(const record of records)for(const node of record.addedNodes){const el=node.nodeType===Node.ELEMENT_NODE?node:node.parentElement;if(!el)continue;const owner=el.closest('a,button');if(owner)actions.add(owner);for(const action of el.querySelectorAll?.('a,button')??[])actions.add(action);}
  for(const action of actions)decorate(action);
}).observe(document.body,{childList:true,subtree:true});
