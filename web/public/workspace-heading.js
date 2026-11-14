import './card-motion.js';
const kinds=Object.freeze({
  markets:['markets','green'],spot:['spot','green'],perpetuals:['perpetuals','blue'],predictions:['predictions','purple'],
  credit:['credit','gold'],funding:['funding','clay'],liquidity:['routes','blue'],degen:['spot','purple'],prices:['perpetuals','blue'],
  wallet:['spot','green'],chat:['chat','purple'],routes:['routes','gold'],account:['chat','purple'],recovery:['routes','clay']
});
const element=(tag,className,text)=>{const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;};
const appearance=()=>['dim','dark'].includes(document.documentElement.dataset.theme)?document.documentElement.dataset.theme:'light';
function paintArtwork(img){const mode=appearance(),name=img.dataset.lenzArtwork;img.src=`/overview-art/${name}${mode==='light'?'':'-'+mode}.svg`;}
export function sectionArtwork(kind){
  const img=element('img','lenz-artwork');img.dataset.lenzArtwork=(kinds[kind]??kinds.markets)[0];img.alt='';img.setAttribute('aria-hidden','true');img.width=128;img.height=128;img.decoding='async';paintArtwork(img);return img;
}
export function sectionTone(target,kind){target.dataset.lenzTone=(kinds[kind]??kinds.markets)[1];}
function metricTrend(delta){
  const trend=element('span','lenz-metric-trend'+(delta>0?' is-up':delta<0?' is-down':''));
  trend.setAttribute('role','img');trend.setAttribute('aria-label',delta>0?'Increased since the previous reading':delta<0?'Decreased since the previous reading':'No change observed yet');
  trend.title=delta?('Last change: '+(delta>0?'+':'')+delta.toLocaleString(undefined,{maximumFractionDigits:2})):'Awaiting a change';
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');
  const heights=delta>0?[4,7,10]:delta<0?[10,7,4]:[5,5,5];
  for(const [i,height]of heights.entries()){const bar=document.createElementNS(ns,'rect');bar.setAttribute('x',String(4+i*6));bar.setAttribute('y',String(22-height));bar.setAttribute('width','3');bar.setAttribute('height',String(height));bar.setAttribute('rx','.6');svg.append(bar);}
  const path=document.createElementNS(ns,'path');path.setAttribute('d',delta>0?'M3 12 9 6 14 9 21 2M16 2h5v5':delta<0?'M3 2 9 8 14 5 21 12M16 12h5V7':'M3 9h18');svg.append(path);trend.append(svg);return trend;
}
function workspaceTools(actions){
  const host=document.querySelector('.market-toolbar');if(!host)return null;
  const tools=element('details','workspace-tools'),toggle=element('summary');tools.hidden=true;toggle.setAttribute('aria-label','Market tools');toggle.title='Market tools';
  toggle.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>';
  actions.className='workspace-tools-actions';tools.append(toggle,actions);host.append(tools);
  tools.addEventListener('keydown',event=>{if(event.key==='Escape'&&tools.open){event.preventDefault();tools.open=false;toggle.focus();}});
  document.addEventListener('click',event=>{if(tools.open&&!tools.contains(event.target))tools.open=false;});
  queueMicrotask(()=>{for(const button of actions.querySelectorAll('button')){const text=button.getAttribute('aria-label')||button.title||button.textContent,icon=button.querySelector('svg');button.replaceChildren(...(icon?[icon]:[]),element('span','',text));}});
  return tools;
}
export function workspaceHeading({title,description='',kind='markets',level='h2'}){
  const root=element('div','lenz-heading'),art=sectionArtwork(kind),copy=element('div','lenz-heading-copy'),heading=element(level,'',title),subtitle=element('p','',description),actions=element('div','lenz-heading-actions');
  subtitle.hidden=!description;copy.append(heading,subtitle);root.append(art,copy,actions);sectionTone(root,kind);
  const tools=workspaceTools(actions);
  const previous=new Map();let previousScope;
  const metrics=element('dl','lenz-hero-metrics'),note=element('p','lenz-hero-note');metrics.hidden=true;note.hidden=true;root.append(metrics,note);
  return {element:root,title:heading,description:subtitle,actions,tools,showTools(value){if(tools){tools.hidden=!value||!actions.children.length;if(!value)tools.open=false;}},setMetrics(values,caption='',scope=''){if(scope!==previousScope){previous.clear();previousScope=scope;}metrics.replaceChildren(...values.map(value=>{const cell=element('div'),label=element('dt','',value.label),number=element('dd','',value.value??'—');const raw=Object.hasOwn(value,'raw')?value.raw:Number(String(value.value).replaceAll(',','')),before=previous.get(value.label);let delta=before?.delta??0;if(typeof raw==='number'&&Number.isFinite(raw)){if(before&&raw!==before.raw)delta=raw-before.raw;previous.set(value.label,{raw,delta});}else{previous.delete(value.label);delta=0;}const trend=metricTrend(delta);number.append(trend);cell.append(label,number);if(value.detail)cell.append(element('small','',value.detail));return cell;}));metrics.hidden=!values.length;note.textContent=caption;note.hidden=!caption;},setKind(value){sectionTone(root,value);art.dataset.lenzArtwork=(kinds[value]??kinds.markets)[0];paintArtwork(art);}};
}

// Attribute observation also supports pages using the earlier appearance toggle.
new MutationObserver(()=>{for(const img of document.querySelectorAll('img[data-lenz-artwork]'))paintArtwork(img);}).observe(document.documentElement,{attributes:true,attributeFilter:['data-theme']});
for(const target of document.querySelectorAll('[data-lenz-heading]')){
  const title=target.querySelector('h1,h2');if(!title)continue;
  const kind=target.dataset.lenzHeading,art=sectionArtwork(kind),copy=title.parentElement===target?element('div'):title.parentElement;
  copy.classList.add('lenz-heading-copy');if(title.parentElement===target)copy.append(title);
  target.prepend(art,copy);target.classList.add('lenz-heading');sectionTone(target,kind);
}

for(const target of document.querySelectorAll("[data-lenz-illustration]"))target.prepend(sectionArtwork(target.dataset.lenzIllustration));
