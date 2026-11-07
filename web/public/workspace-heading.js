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
export function workspaceHeading({title,description='',kind='markets',level='h2'}){
  const root=element('div','lenz-heading'),art=sectionArtwork(kind),copy=element('div','lenz-heading-copy'),heading=element(level,'',title),subtitle=element('p','',description),actions=element('div','lenz-heading-actions');
  subtitle.hidden=!description;copy.append(heading,subtitle);root.append(art,copy,actions);sectionTone(root,kind);
  return {element:root,title:heading,description:subtitle,actions,setKind(value){sectionTone(root,value);art.dataset.lenzArtwork=(kinds[value]??kinds.markets)[0];paintArtwork(art);}};
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
