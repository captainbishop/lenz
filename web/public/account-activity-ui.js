import {readState} from './chat-store.js';
import {readNearVault,nearLedger,displayUnits,compressed} from './near-protocol.js';
import {createWalletSession} from './evm-wallet.js';
import {savedPerformance,loadPerformance,savePerformance,accountPositions,accountOpenOrders} from './account-performance.js';
import {walletAmount,setupBalanceVisibility} from './wallet-visibility.js';
import './form-controls.js';

const $=id=>document.getElementById(id),el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
const short=value=>value.slice(0,6)+'…'+value.slice(-4),money=value=>Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2});
const signed=value=>(Number(value)>0?'+':'')+money(value);
let cache=[],generation=0,sourceRun=0,abort=null,selected='lenz',busy=false,connectedAddress=null;
const heading=document.querySelector('.account-heading'),topbar=el('div'),sourceArea=el('div');topbar.className='account-topbar';sourceArea.className='account-hero-controls';heading.before(topbar);sourceArea.append(document.querySelector('.account-source-bar'));topbar.append(heading,sourceArea);
document.querySelector('.account-source-actions').insertBefore($('account-load-history'),$('toggle-balances'));
document.querySelector('#account-activity>.account-history-heading').remove();
const overview=el('div'),summary=el('section'),plot=el('section'),plotHead=el('div');overview.className='account-overview';summary.className='account-summary';plot.className='account-chart';plotHead.className='account-chart-heading';
plotHead.append(el('h2','Profit & loss'),el('span','30-day history'));const emptyChart=el('p','Load activity to see performance.');emptyChart.id='account-chart-empty';
const stats=document.querySelector('.account-stats');stats.before(overview);summary.append(stats);plot.append(plotHead,$('account-pnl-chart'),emptyChart,$('account-performance-note'));overview.append(summary,plot);$('account-panel-history').querySelector('h3').remove();
const session=createWalletSession({changed(snapshot){
 if(snapshot){connectedAddress=snapshot.address;selectSource(snapshot.address);}else if(connectedAddress){connectedAddress=null;selectSource('lenz');}
 controls();
}});
function controls(){
 $('account-load-history').disabled=busy||selected==='lenz'||!navigator.onLine;
 $('account-connect-wallet').disabled=session.pending||!navigator.onLine;
 $('account-connect-wallet').hidden=!!session.snapshot;
 $('account-disconnect-wallet').hidden=!session.snapshot&&!session.pending;
 $('account-load-history').hidden=selected==='lenz';$('account-read-privacy').hidden=selected==='lenz';
}
function sourceOptions(){
 const addresses=new Set([...cache.map(row=>row.account),...(connectedAddress?[connectedAddress]:[])]);
 $('account-funds-source').replaceChildren(new Option('Lenz wallet','lenz'),...[...addresses].map(value=>new Option('External · '+short(value),value)));
 if(selected!=='lenz'&&!addresses.has(selected))selected='lenz';$('account-funds-source').value=selected;
}
function clear(){
 for(const id of ['account-pnl','account-volume','account-win-rate','account-loss-rate','account-trade-count','account-funds'])walletAmount($(id),'—');
 $('account-pnl').removeAttribute('data-direction');$('account-pnl-chart').replaceChildren();$('account-history-list').replaceChildren();
 $('account-performance-note').textContent='';$('account-history-empty').hidden=false;$('account-chart-empty').hidden=false;$('account-chart-empty').textContent='Load activity to see performance.';
 $('account-balance-details').replaceChildren();$('account-positions-list').replaceChildren();$('account-orders-list').replaceChildren();
 $('account-balances-empty').hidden=false;$('account-balances-empty').textContent='Balances have not been loaded.';
 $('account-positions-empty').hidden=false;$('account-positions-empty').textContent='Positions have not been loaded.';
 $('account-orders-empty').hidden=false;$('account-orders-empty').textContent='Open orders have not been loaded.';$('account-orders-note').textContent='Leveraged orders for the selected account.';
}
function selectSource(value){generation++;abort?.abort();abort=null;busy=false;selected=value;sourceOptions();clear();controls();void render().catch(showError);}
function showError(error){$('account-performance-status').textContent=error.message||'Account details could not be loaded.';}
function table(id,columns){const host=$(id);host.className='account-table-scroll';const table=el('table'),head=el('thead'),heading=el('tr'),body=el('tbody');table.className='account-table';for(const label of columns){const cell=el('th',label);cell.scope='col';heading.append(cell);}head.append(heading);table.append(head,body);host.replaceChildren(table);return body;}
function record(body,values){const row=el('tr');row.dataset.record='';for(const value of values){const cell=el('td');if(typeof value==='string')cell.textContent=value;else walletAmount(cell,value.amount);row.append(cell);}body.append(row);}
function detail(list,label,value){const cell=el('div');cell.append(el('dt',label),walletAmount(el('dd'),value));list.append(cell);}
function showPositionsAndOrders(saved){
 const positions=accountPositions(saved.positions),open=accountOpenOrders(saved.openOrders);
 $('account-positions-empty').textContent=positions===null?'Positions are unavailable. Refresh to try again.':'No open leveraged positions.';$('account-positions-empty').hidden=!!positions?.length;
 const positionsBody=table('account-positions-list',['Market','Side','Size','Entry price','Open P&L','Liquidation price','Margin']);
 for(const row of positions??[])record(positionsBody,[row.coin+' / USDC',row.side==='long'?'Long':'Short',{amount:row.size},{amount:row.entryPrice===null?'Unavailable':row.entryPrice+' USDC'},{amount:row.pnl===null?'Unavailable':signed(row.pnl)+' USDC'},{amount:row.liquidationPrice===null?'Unavailable':row.liquidationPrice+' USDC'},{amount:row.margin===null?'Unavailable':money(row.margin)+' USDC'}]);
 $('account-orders-empty').textContent=open===null?'Open orders are unavailable. Refresh to try again.':'No open leveraged orders.';$('account-orders-empty').hidden=!!open?.length;
 const ordersBody=table('account-orders-list',['Market','Side','Remaining','Limit price','Placed']);
 for(const row of open??[])record(ordersBody,[row.coin+' / USDC',row.side,{amount:row.size},{amount:row.price+' USDC'},new Date(row.time).toLocaleString()]);
}
const tabNames=['balances','positions','orders','history'];
function activateTab(name,focus=false){for(const key of tabNames){const button=$('account-tab-'+key),active=key===name;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;$('account-panel-'+key).hidden=!active;}if(focus)$('account-tab-'+name).focus();}
for(const[nameIndex,name]of tabNames.entries()){const button=$('account-tab-'+name);button.onclick=()=>activateTab(name);button.onkeydown=event=>{const index=event.key==='ArrowRight'?(nameIndex+1)%4:event.key==='ArrowLeft'?(nameIndex+3)%4:event.key==='Home'?0:event.key==='End'?3:null;if(index!==null){event.preventDefault();activateTab(tabNames[index],true);}};}
function chart(history){
 const host=$('account-pnl-chart');host.replaceChildren();
 const masked=$('toggle-balances').getAttribute('aria-pressed')==='true';$('account-chart-empty').hidden=!!history?.length&&!masked;$('account-chart-empty').textContent=masked?'Amounts hidden.':selected==='lenz'?'Lenz swap performance is not available yet.':history?'No filled trades in this period.':'Load activity to see performance.';
 if(!history?.length||masked)return;
 const points=[0,...history.map(row=>Number(row.cumulative))],low=Math.min(...points),high=Math.max(...points),range=high-low||1;
 const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg'),path=document.createElementNS(ns,'path'),title=document.createElementNS(ns,'title');
 svg.setAttribute('viewBox','0 0 800 160');svg.setAttribute('role','img');title.textContent='Trading profit and loss, from '+signed(points[0])+' to '+signed(points.at(-1))+' USDC';svg.append(title);
 path.setAttribute('d',points.map((value,i)=>(i?'L':'M')+(8+i/(points.length-1)*784).toFixed(2)+' '+(148-(value-low)/range*132).toFixed(2)).join(' '));path.setAttribute('vector-effect','non-scaling-stroke');svg.append(path);host.append(svg);
}
async function render(){
 const ticket=++generation,source=selected;clear();controls();$('account-performance-status').textContent='';
 $('account-source-detail').textContent=source==='lenz'?'Lenz wallet · Saved on this device':short(source)+(session.snapshot?.address===source?' · Connected':' · Saved account');$('account-source-detail').title=source==='lenz'?'':source;
 if(source==='lenz'){
  $('account-history-empty').textContent='No saved swaps on this device.';
  $('account-performance-note').textContent='Profit and loss is not available for Lenz swaps yet. Saved requests are not counted as trades.';
  $('account-chart-empty').textContent='Lenz swap performance is not available yet.';
  $('account-positions-empty').textContent='Position tracking for Lenz funds is not available yet.';$('account-orders-note').textContent='Saved Lenz swaps appear in History.';$('account-orders-empty').textContent='Open-order tracking for Lenz funds is not available yet.';
  const state=await readState();if(ticket!==generation||selected!==source)return;
  if(!state.identity){$('account-history-empty').textContent='Create or restore your Lenz account to see its activity.';return;}
  // The same public configuration used by Wallet; no address or balance lookup is sent.
  const response=await caches.match('/near-config.json')??(navigator.onLine?await fetch('/near-config.json',{credentials:'omit'}):null);if(ticket!==generation)return;
  if(!response){$('account-history-empty').textContent='Open your Lenz wallet once to make its saved activity available here.';return;}
  const config=await response.json();if(!config.ready||config.network!=='testnet'||typeof config.contract!=='string')return;
  const vault=await readNearVault(state,config.contract),ledger=await nearLedger(vault);if(ticket!==generation||selected!==source)return;
  const self=compressed(state.identity.profile.signingPublic);
  const available=displayUnits(ledger.available.filter(row=>row.owner===self).reduce((sum,row)=>sum+BigInt(row.amount),0n).toString())+' tUSD';
  walletAmount($('account-funds'),available);detail($('account-balance-details'),'Available',available);$('account-balances-empty').hidden=true;
  $('account-source-detail').textContent='Lenz funds on this device · Test dollars, no cash value.';
  const rows=[...(vault.rheaOrders??[])].reverse();$('account-history-empty').hidden=!!rows.length;
  const history=table('account-history-list',['Market','Status','Amount']);
  for(const row of rows){const stage=row.status?.stage,complete=stage==='complete',status=complete?'Swap complete':stage==='refunded'?'Refunded':row.defi?.storageReceipt?'Received · completion not confirmed':'Saved · money set aside';record(history,['tUSD / wNEAR',status,{amount:displayUnits(row.packet.instruction.amount)+' tUSD'}]);}
  return;
 }
 const saved=cache.find(row=>row.account===source);
 $('account-history-empty').textContent=saved?'No perpetual trades in the available history.':'Load this wallet’s trading history to see its performance.';
 $('account-performance-note').textContent='Perpetual trades · Last 30 days';
 if(session.snapshot?.address===source){const native=session.snapshot.amount+' '+session.snapshot.network.symbol;detail($('account-balance-details'),'Wallet · '+session.snapshot.network.name,native);if(!saved){walletAmount($('account-funds'),native);$('account-balances-empty').textContent='Trading balances have not been loaded.';}}
 if(!saved)return;
 const p=saved.performance;
 detail($('account-balance-details'),'Trading balance',money(saved.equity)+' USDC');detail($('account-balance-details'),'Available to withdraw',money(saved.withdrawable)+' USDC');$('account-balances-empty').hidden=true;
 showPositionsAndOrders(saved);
 walletAmount($('account-funds'),money(saved.equity)+' USDC');walletAmount($('account-pnl'),signed(p.pnl)+' USDC');
 $('account-pnl').dataset.direction=Number(p.pnl)>0?'up':Number(p.pnl)<0?'down':'flat';
 walletAmount($('account-volume'),money(p.volume)+' USDC');walletAmount($('account-win-rate'),p.winRate===null?'—':p.winRate.toFixed(1)+'%');walletAmount($('account-loss-rate'),p.lossRate===null?'—':p.lossRate.toFixed(1)+'%');walletAmount($('account-trade-count'),String(p.history.length));
 const period=new Date(p.start).toLocaleDateString()+' to '+new Date(p.end).toLocaleDateString();
 $('account-performance-note').textContent=(p.limited?'Partial history · ':'')+'Perpetual trades · '+period+(p.excluded?' · Other markets excluded':'')+'. '+(!navigator.onLine?'Offline · Saved '+new Date(saved.observedAt).toLocaleString(): 'Select Refresh history for the latest figures.');
 $('account-load-history').textContent='Refresh history';$('account-history-empty').hidden=!!p.history.length;chart(p.history);
 const history=table('account-history-list',['Market','Action','Price','Size','P&L','Date']);
 for(const row of p.history.slice(-50).reverse())record(history,[row.coin+' / USDC',row.direction,{amount:row.price+' USDC'},{amount:row.size},{amount:signed(row.pnl)+' USDC'},new Date(row.time).toLocaleString()]);
}
async function refreshSources(){
 const ticket=++sourceRun,state=await readState();
 const [result]=await Promise.allSettled([savedPerformance(state)]);
 if(ticket!==sourceRun||(await readState()).identity?.profile.id!==state.identity?.profile.id)return;
 if(ticket!==sourceRun)return;
 cache=result.status==='fulfilled'?result.value:[];
 sourceOptions();await render();if(result.status==='rejected')showError(Error('Some saved account activity could not be opened.'));
}
$('account-funds-source').onchange=event=>selectSource(event.target.value);
$('account-load-history').onclick=async()=>{
 if(busy||selected==='lenz'||!navigator.onLine)return;const source=selected,ticket=++generation,controller=new AbortController();abort=controller;busy=true;controls();$('account-performance-status').textContent='Loading history…';
 try{
  const identity=(await readState()).identity?.profile.id??'guest',current=()=>ticket===generation&&selected===source&&!controller.signal.aborted;
  if(!current())return;const data=await loadPerformance(source,{signal:controller.signal});if(!current())return;
  await savePerformance(data,identity,current);if(!current())return;cache=await savedPerformance();if(!current())return;busy=false;await render();
 }catch(error){if(ticket===generation)showError(error);}finally{if(abort===controller){busy=false;abort=null;controls();}}
};
const picker=$('account-wallet-picker'),providers=[];
function addProvider(provider,name){
 if(providers.length>=12||providers.includes(provider)||!provider||['request','on','removeListener'].some(key=>typeof provider[key]!=='function')||typeof name!=='string'||!name.trim()||name.length>80)return;
 providers.push(provider);const button=el('button',name);button.type='button';button.onclick=async()=>{
  if(session.pending)return;$('account-wallet-feedback').textContent='Check your wallet…';try{await session.connect(provider);picker.close();}catch{$('account-wallet-feedback').textContent='Could not connect. Choose Ethereum, Arbitrum or Base and try again.';}
 };$('account-wallet-options').append(button);$('account-wallet-empty').hidden=true;
}
addEventListener('eip6963:announceProvider',event=>{try{addProvider(event.detail?.provider,event.detail?.info?.name);}catch{}});
$('account-connect-wallet').onclick=()=>{dispatchEvent(new Event('eip6963:requestProvider'));if(!providers.length){try{addProvider(window.ethereum,'Browser wallet');}catch{}}$('account-wallet-feedback').textContent='';picker.showModal();};
$('account-wallet-close').onclick=()=>{if(session.pending)session.disconnect();picker.close();};picker.addEventListener('cancel',()=>{if(session.pending)session.disconnect();});
$('account-disconnect-wallet').onclick=()=>session.disconnect();
setupBalanceVisibility();$('toggle-balances').addEventListener('click',()=>{chart(cache.find(row=>row.account===selected)?.performance.history??null);});
addEventListener('storage',event=>{if(event.key==='lenz-wallet-balances-hidden'||event.key===null)chart(cache.find(row=>row.account===selected)?.performance.history??null);});
addEventListener('offline',()=>{generation++;abort?.abort();abort=null;busy=false;void render().catch(showError);});addEventListener('online',()=>{controls();void render().catch(showError);});
addEventListener('pagehide',()=>{generation++;sourceRun++;abort?.abort();session.disconnect();});
addEventListener('lenz-hyper-orders',()=>{if(!busy)void refreshSources().catch(showError);});
addEventListener('lenz-account-identity',()=>{generation++;sourceRun++;abort?.abort();busy=false;cache=[];selected='lenz';clear();void refreshSources().catch(showError);});
const walletUpdates=typeof BroadcastChannel==='function'?new BroadcastChannel('proof-u-chat-refresh'):null;
walletUpdates?.addEventListener('message',()=>{if(selected==='lenz')void render().catch(showError);});
await refreshSources().catch(showError);
