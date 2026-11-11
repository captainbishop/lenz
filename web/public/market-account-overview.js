import {accountBalances} from './hyperliquid-account.js';
import {loadPerformance,savedPerformance,savePerformance} from './account-performance.js';
import {readState} from './chat-store.js';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const owner=state=>state.identity?.profile.id??'guest';
const hidden=()=>{try{return localStorage.getItem('lenz-wallet-balances-hidden')==='true';}catch{return false;}};
const money=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:2});
const amounts=new WeakMap();
export function marketAccountAmount(node,value){amounts.set(node,value);node.dataset.marketAccountAmount='';node.textContent=hidden()?'••••':value;if(hidden())node.setAttribute('aria-label','Amount hidden');else node.removeAttribute('aria-label');return node;}
function paintAmounts(){for(const node of document.querySelectorAll('[data-market-account-amount]'))if(amounts.has(node)){node.textContent=hidden()?'••••':amounts.get(node);if(hidden())node.setAttribute('aria-label','Amount hidden');else node.removeAttribute('aria-label');}}

export function marketAccountOverview({wallet,row,current}){
 const element=el('section',undefined,'market-account-overview account-overview'),summary=el('section',undefined,'account-summary'),figures=el('dl',undefined,'account-stats'),plot=el('section',undefined,'market-account-plot account-chart'),plotHead=el('div',undefined,'account-chart-heading');
 const historySupported=row.kind==='perp'&&row.quote?.index===0&&row.quote.symbol==='USDC';
 const heading=el('h4','Profit & loss'),scope=el('span','USDC perpetuals · 30 days'),load=el('button','Load trading history');load.type='button';
 plotHead.append(heading,scope);const chart=el('div',undefined,'account-chart-plot'),note=el('p'),status=el('p',undefined,'market-account-status');status.setAttribute('role','status');
 summary.append(figures);plot.append(plotHead,chart,note,status);element.append(summary,plot);
 const values=new Map(),cells=new Map();
 for(const [key,label]of [['equity','Funds'],['withdrawable','Available to withdraw'],['margin','Margin used'],['pnl','Trading P&L'],['volume','Traded volume'],['winRate','Win rate'],['lossRate','Loss rate'],['trades','Filled trades']]){const cell=el('div'),value=el('dd','—');value.dataset.accountValue=key;cell.append(el('dt',label),value);figures.append(cell);cells.set(key,value);}
 let generation=0,abort=null,performance=null,busy=false,disposed=false,modeSupported=false;
 const active=()=>!disposed&&element.isConnected&&current();
 function paint(){
  const masked=hidden();for(const [key,node]of cells)marketAccountAmount(node,values.get(key)??'—');paintAmounts();
  chart.replaceChildren();const p=performance?.performance;
  load.hidden=!historySupported;load.disabled=busy||!wallet.snapshot||!modeSupported||!navigator.onLine;load.textContent=performance?'Refresh trading history':'Load trading history';
  scope.textContent=historySupported?'USDC perpetuals · 30 days':row.kind==='spot'?'Spot account':'Trading account';
  note.textContent=masked?'Amounts hidden.':!historySupported?(row.kind==='spot'?'Spot P&L is unavailable.':'Performance for this venue is unavailable.'):!performance?'Load trading history to see performance. Your address is shared with Hyperliquid.':p.history.length?`${!navigator.onLine?'Saved · ':''}Read ${new Date(performance.observedAt).toLocaleString()} · Fees included; funding and open P&L excluded.${p.limited?' History is partial.':''}`:'No filled USDC perpetual trades in this period.';
  if(masked||!p?.history.length)return;
  const points=[0,...p.history.map(r=>Number(r.cumulative))],low=Math.min(...points),high=Math.max(...points),range=high-low||1,ns='http://www.w3.org/2000/svg';
  const svg=document.createElementNS(ns,'svg'),line=document.createElementNS(ns,'path'),title=document.createElementNS(ns,'title');svg.setAttribute('viewBox','0 0 600 180');svg.setAttribute('role','img');svg.setAttribute('aria-label','Realized USDC perpetual profit and loss over the available 30-day history');title.textContent='Realized P&L: '+money(p.pnl)+' USDC';line.setAttribute('d',points.map((v,i)=>(i?'L':'M')+(12+i*576/(points.length-1))+','+(168-(v-low)*156/range)).join(' '));svg.append(title,line);chart.append(svg);
 }
 function applyHistory(value){
  performance=value;const p=value.performance;
  values.set('pnl',(Number(p.pnl)>0?'+':'')+money(p.pnl)+' USDC');values.set('volume',money(p.volume)+' USDC');values.set('winRate',p.winRate===null?'—':p.winRate.toFixed(1)+'%');values.set('lossRate',p.lossRate===null?'—':p.lossRate.toFixed(1)+'%');values.set('trades',String(p.history.length));paint();
 }
 async function update(snapshot){
  const ticket=++generation;abort?.abort();abort=null;busy=false;performance=null;values.clear();status.textContent='';
  modeSupported=snapshot?.funds?.mode==='disabled';const balances=accountBalances(snapshot?.funds,snapshot?.spotTokens??[]);
  if(balances)for(const key of ['equity','withdrawable','margin'])if(balances[key]!==null)values.set(key,money(balances[key])+' USDC');paint();
  const account=wallet.snapshot?.address;if(!historySupported||!modeSupported||!account||!active())return;
  try{const identity=owner(await readState()),saved=(await savedPerformance()).find(r=>r.account===account);if(ticket!==generation||!active()||wallet.snapshot?.address!==account||owner(await readState())!==identity)return;if(saved)applyHistory(saved);}
  catch{if(ticket===generation&&active())status.textContent='Saved history could not be read.';}
 }
 load.onclick=async()=>{
  if(busy||!historySupported||!modeSupported||!wallet.snapshot||!navigator.onLine||!active())return;
  const ticket=++generation,account=wallet.snapshot.address,identity=owner(await readState());if(ticket!==generation||!active()||wallet.snapshot?.address!==account)return;
  abort=new AbortController();busy=true;paint();status.textContent='Reading trading history…';
  const valid=()=>ticket===generation&&active()&&wallet.snapshot?.address===account;
  try{const value=await loadPerformance(account,{signal:abort.signal});if(!valid())return;await savePerformance(value,identity,valid);if(valid()&&owner(await readState())===identity){applyHistory(value);status.textContent='';}}
  catch{if(valid())status.textContent='History could not refresh. Earlier figures remain saved.';}
  finally{if(ticket===generation){busy=false;abort=null;paint();}}
 };
 const storage=event=>{if(event.key==='lenz-wallet-balances-hidden'||event.key===null)paint();},offline=()=>{generation++;abort?.abort();abort=null;busy=false;paint();};
 const identityChanged=()=>{if(disposed)return;generation++;abort?.abort();abort=null;busy=false;performance=null;modeSupported=false;values.clear();status.textContent='Account changed. Refresh funds to load this account.';paint();};
 let identity=null,identityRun=0;const identityCheck=async()=>{const ticket=++identityRun,value=owner(await readState());if(disposed||ticket!==identityRun)return;if(identity!==null&&value!==identity)identityChanged();identity=value;};
 const checkIdentity=()=>{void identityCheck().catch(identityChanged);};
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('proof-u-chat-refresh'):null;channel?.addEventListener('message',checkIdentity);
 addEventListener('lenz-account-identity',identityChanged);addEventListener('storage',storage);addEventListener('offline',offline);addEventListener('online',paint);checkIdentity();paint();
 return {element,historyButton:load,update,dispose(){disposed=true;generation++;abort?.abort();channel?.close();removeEventListener('lenz-account-identity',identityChanged);removeEventListener('storage',storage);removeEventListener('offline',offline);removeEventListener('online',paint);element.remove();load.remove();}};
}
