import {QUOTE_POOL,marketQuoteRequest,checkedMarketQuote,decimalUnits,formatUnits} from './market-quote.js';
let active=null;
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
export function clearMarketQuote(){active?.dispose();active=null;}
export function mountMarketQuote(panel,row){
  clearMarketQuote();const swap=row.id===QUOTE_POOL;
  if(!swap&&(row.marketId!=='hyperliquid'||row.status!=='listed'||row.sizeDecimals>6))return false;
  const form=el('form',null,'quote-form'),heading=el('h3',swap?'Swap estimate':'Order estimate'),side=el('select'),amount=el('input'),slippage=el('select');
  form.dataset.marketQuote=row.id;side.id='quote-side';amount.id='quote-amount';slippage.id='quote-slippage';amount.inputMode='decimal';amount.autocomplete='off';amount.placeholder='0.00';amount.maxLength=50;
  for(const [value,label] of swap?[['usdc-to-weth','USDC → WETH'],['weth-to-usdc','WETH → USDC']]:[['buy',`Buy ${row.instrument}`],['sell',`Sell ${row.instrument}`]]){const option=el('option',label);option.value=value;side.append(option);}
  const field=(title,input)=>{const label=el('label',title);label.htmlFor=input.id;const wrap=el('div',null,'quote-field');wrap.append(label,input);return wrap;};
  form.append(heading,field('Direction',side),field(swap?'Amount':`Size · ${row.instrument}`,amount));
  if(swap){for(const [value,label] of [[50,'0.5%'],[100,'1%'],[300,'3%']]){const option=el('option',label);option.value=String(value);slippage.append(option);}form.append(field('Slippage',slippage));}
  const consent=el('input');consent.type='checkbox';consent.id='quote-public';const disclosure=el('label',null,'quote-consent');disclosure.append(consent,el('span',swap?'Allow public quote · Amount sent to Base RPC':'Allow public estimate · Market sent to Hyperliquid'));
  const submit=el('button','Get estimate ↗','primary');submit.type='submit';submit.id='quote-submit';
  const status=el('p',null,'quote-status');status.id='quote-status';status.setAttribute('role','status');const result=el('div',null,'quote-result');result.id='quote-result';
  form.append(disclosure,submit,status,result);panel.append(form);
  let controller=null,generation=0,current=null,busy=false;
  const invalidate=()=>{generation++;controller?.abort();controller=null;current=null;busy=false;result.replaceChildren();status.textContent='';update();};
  const update=()=>{submit.disabled=busy||!consent.checked||!navigator.onLine;if(!navigator.onLine){result.replaceChildren();current=null;status.textContent='Connect for a new estimate.';}else if(current&&Date.now()>=current.expiresAt){current=null;result.replaceChildren();status.textContent='Estimate expired. Refresh it.';}};
  active={dispose:()=>{generation++;controller?.abort();},update:()=>{if(!navigator.onLine)invalidate();else update();}};
  form.addEventListener('input',invalidate);form.addEventListener('change',invalidate);
  form.onsubmit=async event=>{
    event.preventDefault();if(busy||!consent.checked||!navigator.onLine)return;
    invalidate();let request;
    try{request=marketQuoteRequest({provider:swap?'uniswap':'hyperliquid',marketId:row.id,side:side.value,amount:amount.value,privacy:'public',...(swap?{slippageBps:Number(slippage.value)}:{})});decimalUnits(request.amount,swap?(side.value==='usdc-to-weth'?6:18):row.sizeDecimals);}
    catch(error){status.textContent=error.message;return;}
    const ticket=generation;controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);busy=true;update();status.textContent='Reading estimate…';
    try{
      const response=await fetch('/api/markets/quote',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal});
      if(!response.ok)throw Error('Quote unavailable.');const text=await response.text();if(text.length>32000)throw Error('Invalid response.');
      const quote=checkedMarketQuote(JSON.parse(text),request);
      if(ticket!==generation||!form.isConnected||!consent.checked||!navigator.onLine)return;
      current=quote;const r=quote.result,rows=swap?[
        ['Expected',`${formatUnits(r.outputUnits,r.outputDecimals)} ${r.outputSymbol}`],['Minimum',`${formatUnits(r.minOutputUnits,r.outputDecimals)} ${r.outputSymbol}`],['Pool fee','0.05% · included'],
      ]:[['Size',`${formatUnits(r.sizeUnits,r.sizeDecimals)} ${r.instrument}`],[request.side==='buy'?'Estimated cost':'Estimated proceeds',`${formatUnits(r.notionalUnits,6)} USDC`],['Worst book price',`${r.worstPrice} USD`]];
      const list=el('dl',null,'detail-data');for(const [label,value] of rows){const line=el('div');line.append(el('dt',label),el('dd',value));list.append(line);}
      result.replaceChildren(list,el('p',swap?'Network fee excluded. Trading unavailable.':'Fees and margin excluded. Orders unavailable.'),el('small',swap?`Block ${quote.evidence.blockNumber} · Unfinalized`:`Book ${new Date(quote.sourceTime).toLocaleTimeString()}`));
      status.textContent=`Expires ${new Date(quote.expiresAt).toLocaleTimeString()}`;
    }catch{if(ticket===generation&&form.isConnected){result.replaceChildren();status.textContent='Estimate unavailable. Check the amount or refresh.';}}
    finally{if(ticket===generation){busy=false;controller=null;update();}}
  };
  update();return true;
}
addEventListener('online',()=>active?.update());addEventListener('offline',()=>active?.update());
setInterval(()=>active?.update(),1000);
