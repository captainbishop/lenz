const svg=(tag,attrs={})=>{const node=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const [key,value]of Object.entries(attrs))node.setAttribute(key,value);return node;};
export const priceText=value=>value===null?'—':Number(value).toLocaleString(undefined,{maximumSignificantDigits:6});
export function drawDegenCandles(target,candles,symbol,readout){
  target.replaceChildren();if(!candles.length){const p=document.createElement('p');p.textContent='No candles for this interval';target.append(p);readout.textContent='';return;}
  const width=Math.max(320,target.clientWidth),height=330,left=12,right=100,top=18,bottom=62,step=(width-left-right)/candles.length;
  let low=Math.min(...candles.map(c=>c.low)),high=Math.max(...candles.map(c=>c.high));const pad=(high-low)*.1||high*.01;low-=pad;high+=pad;
  const y=p=>top+(high-p)/(high-low)*(height-top-bottom),x=i=>left+(i+.5)*step;
  const drawing=svg('svg',{viewBox:`0 0 ${width} ${height}`,role:'img',tabindex:0,'aria-label':`${symbol} USD candles. Arrow keys read prices.`});target.append(drawing);
  const mark=svg('g',{transform:`translate(${(width-100-260)/2} 92) scale(.6)`,class:'chart-watermark','aria-hidden':true});
  const lines=svg('g',{fill:'none',stroke:'var(--ink)','stroke-width':14,'stroke-linecap':'round','stroke-linejoin':'round'});lines.append(svg('path',{d:'M30 20 V78 Q30 98 50 98 H74'}),svg('path',{d:'M98 108 V50 Q98 30 78 30 H54'}));
  const word=svg('text',{x:148,y:98,'font-size':82,'letter-spacing':-3});word.textContent='Lenz';mark.append(lines,word);drawing.append(mark);
  for(let i=0;i<5;i++){const p=high-(high-low)*i/4;drawing.append(svg('line',{x1:0,x2:width-right,y1:y(p),y2:y(p),class:'chart-grid'}));const label=svg('text',{x:width-right+10,y:y(p)+4,class:'axis-label'});label.textContent=priceText(p);drawing.append(label);}
  const volume=Math.max(...candles.map(c=>c.volume),1);
  candles.forEach((c,i)=>{const group=svg('g',{class:c.close>=c.open?'candle-up':'candle-down','data-candle':i});group.append(svg('line',{x1:x(i),x2:x(i),y1:y(c.high),y2:y(c.low)}),svg('rect',{x:x(i)-step*.3,y:Math.min(y(c.open),y(c.close)),width:Math.max(1,step*.6),height:Math.max(1,Math.abs(y(c.open)-y(c.close)))}),svg('rect',{x:x(i)-step*.3,y:height-25-c.volume/volume*24,width:step*.6,height:c.volume/volume*24,class:'volume-bar'}));drawing.append(group);});
  for(const i of new Set([0,Math.floor(candles.length/2),candles.length-1])){const label=svg('text',{x:x(i),y:height-4,'text-anchor':i===0?'start':i===candles.length-1?'end':'middle',class:'axis-label'});label.textContent=new Date(candles[i].time).toLocaleString(undefined,{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});drawing.append(label);}
  let cursor=candles.length-1;const cross=svg('line',{class:'chart-crosshair',y1:top,y2:height-bottom,visibility:'hidden'});drawing.append(cross);
  function select(index){cursor=Math.max(0,Math.min(candles.length-1,index));const c=candles[cursor];cross.setAttribute('x1',x(cursor));cross.setAttribute('x2',x(cursor));cross.setAttribute('visibility','visible');readout.textContent=`${new Date(c.time).toLocaleString()} · O ${priceText(c.open)} H ${priceText(c.high)} L ${priceText(c.low)} C ${priceText(c.close)}`;}
  drawing.onpointermove=e=>select(Math.floor(((e.clientX-drawing.getBoundingClientRect().left)/drawing.getBoundingClientRect().width*width-left)/step));
  drawing.onfocus=()=>select(cursor);drawing.onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();select(e.key==='Home'?0:e.key==='End'?candles.length-1:cursor+(e.key==='ArrowLeft'?-1:1));}};select(cursor);
}
