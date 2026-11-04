import {QUOTE_POOL,marketQuoteRequest,checkedMarketQuote,decimalUnits,formatUnits} from './market-quote.js';
import {openDraftReview} from './route-draft-ui.js';
import {mountPoolPrice} from './pool-price-ui.js';
let active=null;
const el=(tag,text,cls)=>{const node=document.createElement(tag);if(text)node.textContent=text;if(cls)node.className=cls;return node;};
export function clearMarketQuote(){active?.dispose();active=null;}
export function mountMarketQuote(panel,row,snapshot){
  clearMarketQuote();const swap=row.id===QUOTE_POOL;
  if(!swap&&(row.marketId!=='hyperliquid'||row.status!=='listed'||row.sizeDecimals>6))return false;
  const form=el('form',null,swap?'quote-form exchange-composer':'quote-form order-composer'),heading=el('h3',swap?'Swap':'Order estimate'),side=el('select'),amount=el('input'),slippage=el('select');
  form.dataset.marketQuote=row.id;side.id='quote-side';amount.id='quote-amount';slippage.id='quote-slippage';amount.inputMode='decimal';amount.autocomplete='off';amount.placeholder='0.00';amount.maxLength=50;
  for(const [value,label] of swap?[['usdc-to-weth','USDC → WETH'],['weth-to-usdc','WETH → USDC']]:[['buy',`Buy ${row.instrument}`],['sell',`Sell ${row.instrument}`]]){const option=el('option',label);option.value=value;side.append(option);}
  const field=(title,input)=>{const label=el('label',title);label.htmlFor=input.id;const wrap=el('div',null,'quote-field');wrap.append(label,input);return wrap;};
  form.append(heading);
  let receive,priceView;
  if(swap){
    const flow=el('div',null,'exchange-flow'),pay=el('section',null,'exchange-endpoint'),destination=el('section',null,'exchange-endpoint receive-endpoint'),path=el('div',null,'exchange-path');
    const payName=el('strong'),receiveName=el('strong'),payLabel=el('label','Pay');payLabel.htmlFor=amount.id;receive=el('output','—');receive.id='quote-receive';receive.setAttribute('aria-label','Estimated received amount');
    pay.append(payLabel,amount,payName,el('small','Base'));destination.append(el('span','Receive · approx.'),receive,receiveName,el('small','Base'));
    side.setAttribute('aria-label','Swap direction');path.append(el('span','UNISWAP V3'),side,el('small','0.05% pool fee'));flow.append(pay,path,destination);form.append(flow);
    const symbols=()=>{payName.textContent=side.value==='usdc-to-weth'?'USDC':'WETH';receiveName.textContent=side.value==='usdc-to-weth'?'WETH':'USDC';};side.addEventListener('change',symbols);symbols();
  }
  else {const directions=el('div',null,'order-directions');side.className='quote-side-native';side.tabIndex=-1;side.setAttribute('aria-hidden','true');const buttons=[];for(const [value,label]of [['buy','Long / Buy'],['sell','Short / Sell']]){const b=el('button',label);b.type='button';b.dataset.side=value;b.setAttribute('aria-pressed',String(side.value===value));b.onclick=()=>{side.value=value;side.dispatchEvent(new Event('change',{bubbles:true}));};directions.append(b);buttons.push(b);}side.addEventListener('change',()=>{form.dataset.side=side.value;for(const b of buttons)b.setAttribute('aria-pressed',String(b.dataset.side===side.value));});form.dataset.side=side.value;form.append(directions,side);}
  if(!swap)form.append(field(`Size / ${row.instrument}`,amount));
  const command=el('div',null,'quote-command');
  if(swap){for(const [value,label] of [[50,'0.5%'],[100,'1%'],[300,'3%']]){const option=el('option',label);option.value=String(value);slippage.append(option);}command.append(field('Max price change',slippage));}
  const consent=el('input');consent.type='checkbox';consent.id='quote-public';const disclosure=el('label',null,'quote-consent');disclosure.append(consent,el('span',swap?'Share amount to check price':'Share market to check price'));
  const submit=el('button','Check price','primary');submit.type='submit';submit.id='quote-submit';submit.hidden=swap;
  const status=el('p',null,'quote-status');status.id='quote-status';status.setAttribute('role','status');const result=el('div',null,'quote-result');result.id='quote-result';
  command.append(disclosure,submit);form.append(command,status,result);panel.append(form);
  let controller=null,generation=0,current=null,busy=false,estimateTimer=null,nextEstimateAt=0;
  if(swap)priceView=mountPoolPrice(form,row,amount,side,receive,snapshot);
  const invalidate=()=>{generation++;controller?.abort();controller=null;current=null;busy=false;result.replaceChildren();if(receive)receive.textContent='—';status.textContent='';update();};
  const update=()=>{submit.disabled=busy||!consent.checked||!navigator.onLine;if(!navigator.onLine){result.replaceChildren();if(receive)receive.textContent='—';current=null;status.textContent='Connect for a new estimate.';}else if(current&&Date.now()>=current.expiresAt){current=null;result.replaceChildren();if(receive)receive.textContent='—';status.textContent='Estimate expired. Refresh it.';}};
  active={dispose:()=>{generation++;controller?.abort();clearTimeout(estimateTimer);priceView?.dispose();},update:()=>{if(!navigator.onLine)invalidate();else update();priceView?.render();if(swap&&!current&&!busy&&!estimateTimer&&Date.now()>=nextEstimateAt)queueEstimate();}};
  const queueEstimate=()=>{clearTimeout(estimateTimer);estimateTimer=null;if(swap&&consent.checked&&navigator.onLine&&!document.hidden&&amount.value)estimateTimer=setTimeout(()=>{estimateTimer=null;if(form.isConnected&&!document.hidden)form.requestSubmit();},350);};
  const edited=()=>{invalidate();priceView?.render();queueEstimate();};
  form.addEventListener('input',edited);form.addEventListener('change',edited);
  form.onsubmit=async event=>{
    event.preventDefault();clearTimeout(estimateTimer);estimateTimer=null;if(busy||!consent.checked||!navigator.onLine)return;
    invalidate();let request;
    try{request=marketQuoteRequest({provider:swap?'uniswap':'hyperliquid',marketId:row.id,side:side.value,amount:amount.value,privacy:'public',...(swap?{slippageBps:Number(slippage.value)}:{})});decimalUnits(request.amount,swap?(side.value==='usdc-to-weth'?6:18):row.sizeDecimals);}
    catch(error){status.textContent=error.message;return;}
    const ticket=generation;controller=new AbortController();const signal=AbortSignal.any([controller.signal,AbortSignal.timeout(45000)]);busy=true;update();status.textContent='Reading estimate…';
    try{
      const response=await fetch('/api/markets/quote',{method:'POST',headers:{'content-type':'application/json'},credentials:'omit',body:JSON.stringify(request),signal});
      if(!response.ok)throw Error('Quote unavailable.');const text=await response.text();if(text.length>32000)throw Error('Invalid response.');
      const quote=checkedMarketQuote(JSON.parse(text),request);
      if(ticket!==generation||!form.isConnected||!consent.checked||!navigator.onLine)return;
      current=quote;const r=quote.result;const rows=swap?[
        ['Expected',`${formatUnits(r.outputUnits,r.outputDecimals)} ${r.outputSymbol}`],['Minimum',`${formatUnits(r.minOutputUnits,r.outputDecimals)} ${r.outputSymbol}`],['Pool fee','0.05% · included'],
      ]:[['Size',`${formatUnits(r.sizeUnits,r.sizeDecimals)} ${r.instrument}`],[request.side==='buy'?'Estimated cost':'Estimated proceeds',`${formatUnits(r.notionalUnits,6)} USDC`],['Worst book price',`${r.worstPrice} USD`]];
      const list=el('dl',null,'detail-data');for(const [label,value] of rows){const line=el('div');line.append(el('dt',label),el('dd',value));list.append(line);}
      result.replaceChildren(list,el('p',swap?'Network fee excluded. Trading unavailable.':'Fees and margin excluded. Orders unavailable.'),el('small',swap?`Block ${quote.evidence.blockNumber} · Unfinalized`:`Book ${new Date(quote.sourceTime).toLocaleTimeString()}`));
      const save=el('button',swap?'Review swap →':'Review order →');save.type='button';save.id='quote-save-draft';save.onclick=()=>openDraftReview(quote,save,()=>current===quote&&ticket===generation&&consent.checked&&form.isConnected);result.append(save);
      status.textContent=`Expires ${new Date(quote.expiresAt).toLocaleTimeString()}`;
    }catch{if(ticket===generation&&form.isConnected){result.replaceChildren();status.textContent='Estimate unavailable. Check the amount or refresh.';}}
    finally{if(ticket===generation){busy=false;controller=null;nextEstimateAt=Date.now()+10000;update();priceView?.render();}}
  };
  update();return true;
}
addEventListener('online',()=>active?.update());addEventListener('offline',()=>active?.update());
setInterval(()=>active?.update(),1000);
