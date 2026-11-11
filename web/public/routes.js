import {themeIcon} from './theme-icon.js';
import {listRouteDrafts,attachRouteQuote,removeRouteDraft,routeDraftStatus} from './defi-route-drafts.js';
import {checkedMarketQuote} from './market-quote.js';
import {CHAINS,MARKETS} from './defi-catalog.js';
import {QUOTE_ASSETS} from './defi-route-quote.js';
import {draftError} from './route-draft-ui.js';

const $=s=>document.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const labels={'needs-quote':'No estimate saved','estimate-saved':'Estimate saved','quote-expired':'Estimate expired','objective-expired':'Review period ended','clock-changed':'Check device time'};
let rows=[],selected=decodeURIComponent(location.hash.slice(1)),generation=0,loading=0,controller=null,busy=false;
const chosen=()=>rows.find(row=>row.objective.id===selected);
const title=row=>{const o=row.objective,q=row.estimate?.quote,r=q?.result;if(o.destination.marketId==='hyperliquid')return `${o.destination.order?.side==='buy'?'Buy':'Sell'} ${o.destination.order?.instrument??'perpetual'}`;return r?`${r.inputSymbol} → ${r.outputSymbol}`:o.destination.action;};
const chain=row=>`${MARKETS.find(m=>m.id===row.objective.destination.marketId).name} · ${CHAINS[row.objective.destination.chainId].name}`;
// Saved objectives allow 78-digit integers and up to 36 decimals; never round through Number.
function formatUnits(units,decimals){const value=units.padStart(decimals+1,'0');if(!decimals)return value;const fraction=value.slice(-decimals).replace(/0+$/,'');return value.slice(0,-decimals)+(fraction?'.'+fraction:'');}
function assetName(asset){
  if(asset.kind==='native')return asset.chainId.startsWith('near:')?'NEAR':['eip155:1','eip155:8453','eip155:42161','eip155:1313161554'].includes(asset.chainId)?'ETH':asset.chainId==='eip155:999'?'HYPE':'Native';
  return Object.entries(QUOTE_ASSETS).find(([,a])=>a.chainId===asset.chainId&&a.kind===asset.kind&&a.id===asset.id&&a.decimals===asset.decimals)?.[0]??asset.id;
}
function invalidate(){generation++;controller?.abort();controller=null;busy=false;}
function update(){
  for(const node of document.querySelectorAll('[data-route-status]')){const row=rows.find(r=>r.objective.id===node.dataset.routeStatus);if(row)node.textContent=labels[routeDraftStatus(row)];}
  const row=chosen(),button=$('#refresh-draft-quote');if(button)button.disabled=busy||!navigator.onLine||!$('#draft-quote-public').checked||row.objective.limits.deadline<=Date.now()||routeDraftStatus(row)==='clock-changed';
  if($('#delete-draft'))$('#delete-draft').disabled=busy;
}
function details(row){
  const panel=$('#route-detail');panel.replaceChildren(el('p',chain(row)),el('h2',title(row)));const status=el('p',labels[routeDraftStatus(row)]);status.className='route-state';status.dataset.routeStatus=row.objective.id;panel.append(status);
  const o=row.objective,r=row.estimate?.quote.result,swap=o.destination.marketId==='uniswap',dl=el('dl');dl.className='detail-data';
  const pair=(name,value,cls)=>{const line=el('div'),dd=el('dd',value);if(cls)dd.className=cls;line.append(el('dt',name),dd);dl.append(line);};
  if(swap&&r){pair('Amount',`${formatUnits(o.source.amount,o.source.asset.decimals)} ${r.inputSymbol}`);pair('Minimum',`${formatUnits(o.limits.minReceive,o.destination.outputAsset.decimals)} ${r.outputSymbol}`);}
  else if(o.destination.order?.sizeDecimals!==undefined){const order=o.destination.order;pair('Size',`${formatUnits(order.size,order.sizeDecimals)} ${order.instrument}`);pair('Price limit',`${formatUnits(order.limitPrice,order.priceDecimals)} USD`);pair(o.source.asset.chainId===o.destination.chainId?'Collateral limit':'Source limit',`${formatUnits(o.source.amount,o.source.asset.decimals)} ${assetName(o.source.asset)}`);pair('Leverage limit',order.maxLeverage+'×');pair('Reduce only',order.reduceOnly?'Yes':'No');}
  else {pair('Action',o.destination.action);pair('Amount limit',`${formatUnits(o.source.amount,o.source.asset.decimals)} ${assetName(o.source.asset)} · ${CHAINS[o.source.asset.chainId].name}`);if(o.destination.outputAsset)pair('Minimum',`${formatUnits(o.limits.minReceive,o.destination.outputAsset.decimals)} ${assetName(o.destination.outputAsset)}`);if(o.destination.order)pair('Order', 'Precision unavailable');}
  if(o.destination.positionId)pair('Position',o.destination.positionId);
  pair(swap?'Receiving address':o.destination.order?'Trading address':'Recipient',o.recipient.address,'route-address');
  for(const fee of o.limits.maxFees)pair('Fee limit',`${formatUnits(fee.amount,fee.asset.decimals)} ${assetName(fee.asset)} · ${CHAINS[fee.asset.chainId].name}`);
  if(o.returnTo){pair('Return minimum',`${formatUnits(o.returnTo.minAmount,o.returnTo.asset.decimals)} ${assetName(o.returnTo.asset)} · ${CHAINS[o.returnTo.asset.chainId].name}`);pair('Return address',o.returnTo.address,'route-address');}
  pair('Review before',new Date(o.limits.deadline).toLocaleString());pair('Privacy',o.privacy==='transparent'?'Public route':'Private transfer required');panel.append(dl);
  if(row.estimate){const q=row.estimate.quote;panel.append(el('p',`Estimate read ${new Date(q.observedAt).toLocaleString()}`));const text=swap?`${formatUnits(q.result.outputUnits,q.result.outputDecimals)} ${q.result.outputSymbol} expected`:`${formatUnits(q.result.notionalUnits,6)} USDC estimated trade value`;panel.append(el('p',text));}
  panel.append(el('p',o.destination.order?'Fees, margin and account checks pending.':'Network fees and account checks pending.'));
  const controls=el('div');controls.className='route-controls';const message=el('p');message.id='route-action-status';message.className='route-status';message.setAttribute('role','status');const buttons=el('div');buttons.className='route-buttons';
  if(row.estimate&&o.privacy==='transparent'){
    const consent=el('input');consent.type='checkbox';consent.id='draft-quote-public';const label=el('label');label.className='quote-consent';label.append(consent,el('span',swap?'Public estimate · share amount with Base network providers':'Public estimate · share market with Hyperliquid'));controls.append(label);
    const refresh=el('button','Refresh estimate');refresh.id='refresh-draft-quote';refresh.className='primary';buttons.append(refresh);
    consent.onchange=()=>{invalidate();message.textContent='';update();};
    refresh.onclick=async()=>{
      if(busy||!consent.checked||!navigator.onLine||o.limits.deadline<=Date.now())return;
      const ticket=++generation,request=row.estimate.quote.request;controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);busy=true;update();message.textContent='Reading estimate…';
      try{
        const response=await fetch('/api/markets/quote',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal});if(!response.ok)throw Error('Quote unavailable');
        const text=await response.text();if(text.length>16384)throw Error('Invalid quote');const quote=checkedMarketQuote(JSON.parse(text),request);
        if(ticket!==generation||!consent.checked||!navigator.onLine||!controls.isConnected)return;
        await attachRouteQuote(o.id,row.revision,quote);if(ticket!==generation)return;
        await reload();$('#route-action-status').textContent='Estimate saved. No trade confirmed.';
      }catch(error){if(ticket===generation&&controls.isConnected)message.textContent=/Quote unavailable|fetch|Invalid quote/i.test(error.message)?'Refresh failed. Saved draft unchanged.':draftError(error);}
      finally{if(ticket===generation){busy=false;controller=null;update();}}
    };
  }else controls.append(el('p',o.privacy==='private'?'Private quotes unavailable.':'Get an estimate in Markets to create a quoted draft.'));
  const remove=el('button','Delete draft');remove.id='delete-draft';buttons.append(remove);remove.onclick=async()=>{
    if(busy)return;invalidate();busy=true;update();try{await removeRouteDraft(o.id,row.revision);await reload();$('#draft-list-status').textContent='Draft deleted. No funds moved.';}catch(error){message.textContent=draftError(error);}finally{busy=false;update();}
  };controls.append(buttons,message);panel.append(controls);update();
}
function render(){
  const list=$('#draft-list');list.replaceChildren();if(!rows.some(r=>r.objective.id===selected))selected=rows[0]?.objective.id??'';
  for(const row of [...rows].reverse()){
    const b=el('button');b.className='route-row';b.dataset.draftId=row.objective.id;b.setAttribute('aria-pressed',String(row.objective.id===selected));const status=el('span',labels[routeDraftStatus(row)]);status.className='route-state';status.dataset.routeStatus=row.objective.id;b.append(el('small',chain(row)),el('strong',title(row)),status);
    b.onclick=()=>{invalidate();selected=row.objective.id;history.replaceState(null,'','#'+encodeURIComponent(selected));for(const node of list.children)node.setAttribute('aria-pressed',String(node===b));details(row);};list.append(b);
  }
  const row=chosen();if(row)details(row);else $('#route-detail').replaceChildren(el('h2','No saved drafts'),el('p','Save a draft from a market estimate.'));
}
async function reload(){
  invalidate();const ticket=++loading;$('#reload-drafts').disabled=true;
  try{const saved=await listRouteDrafts();if(ticket!==loading)return;rows=saved;$('#draft-list-status').textContent=rows.length?`${rows.length} saved on this device`:'No saved drafts.';render();}
  catch(error){if(ticket!==loading)return;rows=[];$('#draft-list').replaceChildren();$('#route-detail').replaceChildren(el('h2','Drafts unavailable'));$('#draft-list-status').textContent=/Create a Lenz profile/.test(error.message)?'Create a Lenz ID in Wallet to save drafts.':'Drafts could not be read. Stored data was kept.';}
  finally{if(ticket===loading)$('#reload-drafts').disabled=false;}
}
$('#reload-drafts').onclick=reload;
themeIcon(document.querySelector('#theme-toggle'));
addEventListener('offline',()=>{invalidate();if($('#route-action-status'))$('#route-action-status').textContent='Offline · Saved draft retained.';update();});addEventListener('online',update);setInterval(update,1000);
await reload();
if('serviceWorker' in navigator){try{const registration=await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;
  const worker=registration.installing??registration.waiting??registration.active;if(worker?.state!=='activated')await new Promise((resolve,reject)=>{const changed=()=>{if(worker.state==='activated'){worker.removeEventListener('statechange',changed);resolve();}if(worker.state==='redundant')reject(Error('Cache failed'));};worker.addEventListener('statechange',changed);changed();});
  const channel=new MessageChannel();await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('Cache timeout')),10000);channel.port1.onmessage=({data})=>{clearTimeout(timer);channel.port1.close();data.complete?resolve():reject(Error('Cache incomplete'));};worker.postMessage({type:'home-status'},[channel.port2]);});$('#route-cache-status').textContent='Drafts available offline · Quotes need a connection.';
}catch{$('#route-cache-status').textContent='Offline page unavailable';}}
