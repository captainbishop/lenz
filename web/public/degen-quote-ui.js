import {degenQuoteRequest,pairRequest,checkedDegenPair,checkedDegenQuote} from './degen-quote.js';
import {decimalUnits,formatUnits} from './market-quote.js';
import {mountDegenPreflight} from './degen-preflight-ui.js';
import {featureAvailable,showComingSoon} from './release-availability.js';
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(cls)node.className=cls;return node;};
const displayAmount=exact=>exact.length<=12?exact:'≈ '+Number(exact).toLocaleString(undefined,{maximumSignificantDigits:6,notation:Number(exact)>=1e6||Number(exact)<1e-6?'scientific':'standard'});
export function mountDegenQuote(actions,row){
 if(!featureAvailable('degen')){const launch=el('button','Trade','degen-quote-launch');launch.type='button';launch.onclick=()=>showComingSoon(launch);actions.prepend(launch);return ()=>launch.remove();}
 if(row.chain.id!=='eip155:8453'||!/^0x[0-9a-f]{40}$/i.test(row.pool)||!/^0x[0-9a-f]{40}$/i.test(row.address))return ()=>{};
 let request;try{request=pairRequest({network:'base',pool:row.pool.toLowerCase(),token:row.address.toLowerCase(),privacy:'public'});}catch{return ()=>{};}
 const launch=el('button','Quote swap','degen-quote-launch');launch.type='button';actions.prepend(launch);
 const dialog=el('dialog',undefined,'degen-quote-dialog');dialog.setAttribute('aria-label','Swap estimate');
 const top=el('div',undefined,'degen-quote-top'),title=el('h2','Swap quote'),close=el('button','×');close.type='button';close.setAttribute('aria-label','Close swap estimate');top.append(title,close);
 const consent=el('input');consent.type='checkbox';const permission=el('label',undefined,'degen-quote-consent');permission.append(consent,el('span','Share this market and amount for a public price estimate'));
 const form=el('form'),direction=el('div',undefined,'degen-quote-direction'),buy=el('button','Buy'),sell=el('button','Sell');buy.type=sell.type='button';direction.setAttribute('role','group');direction.setAttribute('aria-label','Swap direction');direction.append(buy,sell);
 const pay=el('label',undefined,'degen-quote-endpoint'),amount=el('input'),inputName=el('strong','—'),receive=el('div',undefined,'degen-quote-endpoint'),output=el('output','—'),outputName=el('strong','—');
 amount.inputMode='decimal';amount.autocomplete='off';amount.maxLength=50;amount.placeholder='0.00';amount.setAttribute('aria-label','Amount to pay');output.setAttribute('aria-label','Estimated amount received');
 pay.append(el('span','Pay'),amount,inputName);receive.append(el('span','Receive · estimated'),output,outputName);const flow=el('div',undefined,'degen-quote-flow');flow.append(pay,receive);
 const slippage=el('select');slippage.setAttribute('aria-label','Maximum price change');for(const [value,label]of [[50,'0.5%'],[100,'1%'],[300,'3%']])slippage.append(new Option(label,String(value)));
 const controls=el('div',undefined,'degen-quote-controls'),limit=el('label','Max price change'),submit=el('button','Get quote');limit.append(slippage);submit.type='submit';controls.append(limit,submit);
 const status=el('p',undefined,'degen-quote-status');status.setAttribute('role','status');const result=el('div',undefined,'degen-quote-result'),retry=el('button','Check pair');retry.type='button';
 form.append(direction,flow,controls,result);form.hidden=true;dialog.append(top,el('p','Base · Uniswap V3','degen-quote-network'),permission,status,retry,form);document.body.append(dialog);
 let pair=null,side='buy',current=null,controller=null,generation=0,busy=false,timer=null,wallet=null;const events=new AbortController();
 function paint(){
  buy.setAttribute('aria-pressed',String(side==='buy'));sell.setAttribute('aria-pressed',String(side==='sell'));
  if(pair){const selected=pair.assets.find(a=>a.id===request.token),counter=pair.assets.find(a=>a.id!==request.token);inputName.textContent=(side==='buy'?counter:selected).symbol;outputName.textContent=(side==='buy'?selected:counter).symbol;}
  submit.disabled=busy||!pair||!consent.checked||!navigator.onLine||!amount.value;
  retry.hidden=!!pair||!consent.checked;retry.disabled=busy||!navigator.onLine;
 }
 function invalidate(){generation++;controller?.abort();controller=null;busy=false;current=null;output.textContent='—';output.removeAttribute('title');result.replaceChildren();status.textContent='';wallet?.invalidate();paint();}
 async function read(body){
  controller=new AbortController();const response=await fetch('/api/degen/quote',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(body),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(45000)])});
  if(!response.ok)throw Error(response.status===429?'Quotes are busy. Try again shortly.':'Quote unavailable. Check the pool or try again.');
  const text=await response.text();if(text.length>32000)throw Error('Invalid quote response.');return JSON.parse(text);
 }
 async function loadPair(){
  invalidate();pair=null;form.hidden=true;if(!consent.checked||!navigator.onLine){status.textContent=navigator.onLine?'':'Connect to check a swap quote.';return;}
  const ticket=generation;busy=true;paint();status.textContent='Checking pool…';
  try{const value=checkedDegenPair(await read(request),request);if(ticket!==generation||!dialog.open||!consent.checked)return;pair=value;form.hidden=false;status.textContent='';amount.focus();}
  catch(error){if(ticket===generation)status.textContent=error.message;}
  finally{if(ticket===generation){busy=false;paint();}}
 }
 launch.onclick=()=>{dialog.showModal();status.textContent=navigator.onLine?'':'Connect to check a swap quote.';paint();};close.onclick=()=>dialog.close();
 dialog.addEventListener('close',()=>{invalidate();wallet?.dispose();wallet=null;pair=null;form.hidden=true;consent.checked=false;clearInterval(timer);timer=null;if(launch.isConnected)launch.focus();});
 consent.onchange=()=>void loadPair();retry.onclick=()=>void loadPair();
 for(const [button,value]of [[buy,'buy'],[sell,'sell']])button.onclick=()=>{if(side===value)return;side=value;amount.value='';invalidate();amount.focus();};
 amount.oninput=()=>invalidate();slippage.onchange=()=>invalidate();
 form.onsubmit=async event=>{
  event.preventDefault();if(busy||!pair||!consent.checked||!navigator.onLine)return;invalidate();const ticket=generation,approvedPair=pair;let body;
  try{body=degenQuoteRequest({...request,kind:'quote',side,amount:amount.value,slippageBps:Number(slippage.value)});const input=pair.assets.find(a=>side==='buy'?a.id!==request.token:a.id===request.token);decimalUnits(body.amount,input.decimals);}
  catch(error){status.textContent=error.message;return;}
  busy=true;paint();status.textContent='Checking price…';
  try{
   const quote=checkedDegenQuote(await read(body),body);if(ticket!==generation||!dialog.open||!consent.checked||!navigator.onLine)return;
   if(JSON.stringify(approvedPair.assets)!==JSON.stringify(quote.assets)||approvedPair.feePips!==quote.feePips){pair=null;form.hidden=true;throw Error('Pool details changed. Check the pair again.');}
   current=quote;const exactOutput=formatUnits(quote.outputUnits,quote.output.decimals),exactMinimum=formatUnits(quote.minOutputUnits,quote.output.decimals);output.textContent=displayAmount(exactOutput);output.title=exactOutput+' '+quote.output.symbol;const receipt=el('dl');
   for(const [name,value]of [['Minimum received',displayAmount(exactMinimum)+' '+quote.output.symbol],['Pool fee',(quote.feePips/10000)+'% · included'],['Network fees','Check wallet and fees']]){const line=el('div');line.append(el('dt',name),el('dd',value));receipt.append(line);}
   const details=el('details'),summary=el('summary','Quote details');details.append(summary);for(const [name,value]of [['Exact output',exactOutput+' '+quote.output.symbol],['Minimum you accept',exactMinimum+' '+quote.output.symbol],['Pool',request.pool],[quote.input.symbol,quote.input.id],[quote.output.symbol,quote.output.id]])details.append(el('p',name+' · '+value));
   result.replaceChildren(receipt,el('p','Estimate only. Check your wallet for balances and network fees.','degen-quote-note'),details);status.textContent='';
   if(!wallet)wallet=mountDegenPreflight(dialog,{quote:()=>current});wallet.invalidate();
   clearInterval(timer);timer=setInterval(()=>{if(current&&Date.now()>=current.expiresAt){invalidate();status.textContent='Quote expired. Check again.';clearInterval(timer);timer=null;}},500);
  }catch(error){if(ticket===generation)status.textContent=error.message;}
  finally{if(ticket===generation){busy=false;paint();}}
 };
 addEventListener('offline',()=>{invalidate();if(dialog.open)status.textContent='Connect for a new quote.';},{signal:events.signal});
 addEventListener('online',()=>{if(dialog.open){status.textContent='';paint();}},{signal:events.signal});
 document.addEventListener('visibilitychange',()=>{if(document.hidden&&dialog.open){invalidate();status.textContent='Check the quote again when you return.';}},{signal:events.signal});
 paint();return ()=>{invalidate();wallet?.dispose();wallet=null;events.abort();clearInterval(timer);dialog.close();dialog.remove();launch.remove();};
}
