import {createWalletSession} from './evm-wallet.js';
import {degenPreflightRequest,checkedDegenPreflight,DEGEN_ROUTER} from './degen-preflight.js';
import {formatUnits} from './market-quote.js';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function mountDegenPreflight(target,{quote}){
 const root=el('section');root.className='degen-preflight';root.setAttribute('aria-label','Wallet and fees');
 const heading=el('h3','Wallet & fees'),account=el('p'),connect=el('button','Connect wallet'),disconnect=el('button','Disconnect'),switchBase=el('button','Switch to Base'),providers=el('div'),permission=el('label'),consent=el('input'),check=el('button','Check wallet & fees'),status=el('p'),result=el('div');
 for(const button of [connect,disconnect,switchBase,check])button.type='button';
 consent.type='checkbox';permission.append(consent,el('span','Share wallet address to check funds and fees'));status.setAttribute('role','status');providers.hidden=true;
 const actions=el('div');actions.className='degen-preflight-actions';actions.append(connect,switchBase,disconnect,check);root.append(heading,account,permission,actions,providers,status,result);target.append(root);
 let generation=0,controller=null,busy=false,disposed=false,session,expiryTimer=null;const events=new AbortController(),known=[];
 function controls(){
  const identity=session?.snapshot;account.textContent=identity?identity.address.slice(0,6)+'…'+identity.address.slice(-4)+' · '+identity.network.name:'Connect a wallet to check this swap.';account.title=identity?.address??'';
  connect.hidden=!!identity;connect.disabled=busy||session?.pending||!navigator.onLine;disconnect.hidden=!identity&&!session?.pending;switchBase.hidden=!identity||identity.chainId==='0x2105';switchBase.disabled=busy||!navigator.onLine;
  check.disabled=busy||!consent.checked||!identity||identity.chainId!=='0x2105'||!quote()||!navigator.onLine;check.textContent=busy?'Checking…':'Check wallet & fees';
 }
 function invalidate(){generation++;controller?.abort();controller=null;clearTimeout(expiryTimer);expiryTimer=null;busy=false;result.replaceChildren();status.textContent='';controls();}
 session=createWalletSession({changed:()=>{if(disposed)return;invalidate();if(session?.snapshot)providers.hidden=true;}});
 function add(provider,name){
  if(known.length>=12||known.some(p=>p===provider)||!provider||['request','on','removeListener'].some(k=>typeof provider[k]!=='function'))return;
  known.push(provider);const button=el('button',name);button.type='button';button.onclick=async()=>{if(session.pending||disposed)return;status.textContent='Check your wallet…';try{await session.connect(provider);}catch{if(!disposed)status.textContent='Wallet connection unavailable. Try again.';}finally{if(!disposed)controls();}};providers.append(button);
 }
 addEventListener('eip6963:announceProvider',event=>{const d=event.detail;if(typeof d?.info?.name==='string'&&d.info.name.trim()&&d.info.name.length<=80&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(d.info.name))add(d.provider,d.info.name);},{signal:events.signal});
 connect.onclick=()=>{providers.hidden=false;dispatchEvent(new Event('eip6963:requestProvider'));if(!known.length){try{add(window.ethereum,'Browser wallet');}catch{}}status.textContent=known.length?'Choose a wallet. Connecting gives no spending permission.':'Open Lenz in a browser with your wallet installed.';};
 disconnect.onclick=()=>session.disconnect();switchBase.onclick=async()=>{try{await session.switchNetwork('0x2105');}catch{status.textContent='Base was not selected. Try again in your wallet.';}controls();};
 consent.onchange=invalidate;
 async function identity(lease){
  lease.assertCurrent();const accounts=await lease.request('eth_accounts'),chain=await lease.request('eth_chainId');
  if(!Array.isArray(accounts)||accounts[0]?.toLowerCase()!==lease.identity.address||chain!=='0x2105')throw Error('Wallet changed. Reconnect and check again.');lease.assertCurrent();
 }
 check.onclick=async()=>{
  if(check.disabled)return;invalidate();const selected=quote(),ticket=generation,lease=session.capture();let request;
  try{request=degenPreflightRequest({quote:selected,account:lease.identity.address,privacy:consent.checked?'public':'private'});}catch{status.textContent='Get a fresh quote before checking this wallet.';return;}
  busy=true;controls();status.textContent='Checking the swap and token permission…';controller=new AbortController();
  try{
   await identity(lease);if(ticket!==generation)return;
   const response=await fetch('/api/degen/preflight',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});
   if(!response.ok)throw Error('Simulation unavailable. Refresh the quote and try again.');const text=await response.text();if(text.length>32000)throw Error('Invalid simulation response.');
   const data=JSON.parse(text);await identity(lease);
   if(ticket!==generation||quote()!==selected||!consent.checked||!navigator.onLine||disposed)return;
   const value=checkedDegenPreflight(data,request);
   const list=el('dl'),rows=[['Available '+selected.input.symbol,formatUnits(value.balances.inputUnits,selected.input.decimals)],['Available ETH',formatUnits(value.balances.nativeWei,18)],['Permission to use this token',BigInt(value.allowanceUnits)>=BigInt(selected.inputUnits)?'Already sufficient':'Required for this amount']];
   if(value.simulation.status==='passed')rows.push(['Estimated spend',formatUnits(value.simulation.spentUnits,selected.input.decimals)+' '+selected.input.symbol],['Estimated receive',formatUnits(value.simulation.receivedUnits,selected.output.decimals)+' '+selected.output.symbol]);
   if(value.fees){rows.push(['Estimated network fees',formatUnits(value.fees.totalWei,18)+' ETH']);for(const fee of value.fees.actions)rows.push([fee.kind==='swap'?'Swap':fee.kind==='approve'?'Exact approval':'Reset approval',formatUnits(fee.totalWei,18)+' ETH']);}
   for(const [label,text]of rows){const row=el('div');row.append(el('dt',label),el('dd',text));list.append(row);}
   const details=el('details');details.append(el('summary','Check details'),el('p','Account · '+value.request.account),el('p','Spender · '+DEGEN_ROUTER));
   if(value.fees){details.append(el('p','Includes L2 gas with a 20% gas buffer, estimated L1 data fees and operator fees. Actual charges can change.'));for(const fee of value.fees.actions)details.append(el('p',fee.kind+' · L2 '+formatUnits(fee.l2Wei,18)+' ETH · L1 '+formatUnits(fee.l1Wei,18)+' ETH · Operator '+formatUnits(fee.operatorWei,18)+' ETH'));}
   result.replaceChildren(list,details);status.textContent=value.simulation.status==='insufficient-token'?'Not enough '+selected.input.symbol+' for this amount.':!value.affordable?'Wallet check passed. Add ETH on Base to cover the estimated fees.':'Wallet check passed. Funds cover this estimate.';
   result.append(el('p','This was a check only. No money was sent. Confirming this swap is not available here yet.'));
   expiryTimer=setTimeout(()=>{if(ticket===generation&&!disposed){invalidate();status.textContent='Wallet check expired. Check again.';}},value.expiresAt-Date.now());
  }catch(error){if(ticket===generation&&!disposed){result.replaceChildren();status.textContent=error.message;}}
  finally{if(ticket===generation&&!disposed){busy=false;controller=null;controls();}}
 };
 addEventListener('offline',()=>{invalidate();status.textContent='Connect to check current funds and fees.';},{signal:events.signal});addEventListener('online',controls,{signal:events.signal});
 controls();return {invalidate,dispose(){disposed=true;invalidate();events.abort();session.disconnect();root.remove();}};
}
