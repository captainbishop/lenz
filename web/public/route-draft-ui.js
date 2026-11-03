import {readState} from './chat-store.js';
import {randomId} from './peer-crypto.js';
import {formatUnits,checkedMarketQuote} from './market-quote.js';
import {draftFromQuote} from './route-draft-form.js';
import {saveRouteDraft} from './defi-route-drafts.js';

const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
export function draftError(error){
  const text=error?.message??'';
  if(/expired|observed yet/i.test(text))return 'Estimate expired. Get a new one.';
  if(/revision|Draft changed|already has different|Saved estimate differs/.test(text))return 'Draft changed in another tab. Reload drafts.';
  if(/address/i.test(text))return 'Enter a valid receiving or trading address.';
  if(/precision|decimal|amount|units/i.test(text))return 'Check the amounts and decimal places.';
  if(/leverage/i.test(text))return 'Use a leverage limit from 1 to 50.';
  if(/price limit|route minimum/.test(text))return 'This estimate misses the saved limits.';
  if(/public route|private route/.test(text))return 'Public-route consent is required.';
  if(/storage is full/.test(text))return 'Draft storage is full. Delete a draft first.';
  return 'Draft could not be saved. Your money is unchanged.';
}
let opening=false;
export async function openDraftReview(value,trigger,isCurrent=()=>true){
  if(opening||document.querySelector('#draft-review'))return;opening=true;
  const quote=structuredClone(value),panel=el('dialog');panel.id='draft-review';panel.className='draft-dialog';panel.setAttribute('aria-labelledby','draft-review-title');
  const top=el('div');top.className='draft-top';const title=el('h2','Order review');title.id='draft-review-title';const close=el('button','Close');close.type='button';top.append(title,close);panel.append(top);
  const status=el('p');status.id='draft-review-status';status.className='draft-status';status.setAttribute('role','status');panel.append(status);document.body.append(panel);
  let saving=false,timer;
  const revealFocus=()=>{if(panel.contains(document.activeElement))document.activeElement.scrollIntoView({block:'nearest'});};
  addEventListener('resize',revealFocus);
  const dispose=()=>{if(saving)return;clearInterval(timer);removeEventListener('resize',revealFocus);panel.close();panel.remove();if(trigger?.isConnected)trigger.focus();};
  close.onclick=dispose;panel.addEventListener('cancel',e=>{e.preventDefault();dispose();});panel.showModal();
  try{
    checkedMarketQuote(quote,quote.request);
    const state=await readState();if(!panel.isConnected)return;
    if(!state.identity){status.textContent='Create a Lenz ID to save drafts.';const link=el('a','Open wallet');link.href='/money.html';panel.append(link);return;}
    const swap=quote.request.provider==='uniswap',r=quote.result,form=el('form');form.id='draft-form';const id=randomId();panel.dataset.side=swap?'swap':quote.request.side;title.textContent=swap?'Swap review':'Order review';
    const layout=el('div');layout.className='draft-layout';const summary=el('section');summary.className='draft-position';
    const caption=el('p',swap?'UNISWAP / BASE':'HYPERLIQUID / PERPETUAL');caption.className='draft-venue';
    const direction=el('p',swap?'SWAP':quote.request.side==='buy'?'LONG / BUY':'SHORT / SELL');direction.className='draft-side';
    const size=el('div');size.className='draft-size';size.append(el('strong',formatUnits(swap?r.inputUnits:r.sizeUnits,swap?r.inputDecimals:r.sizeDecimals)),el('span',swap?r.inputSymbol:r.instrument));
    const subtitle=el('p',swap?`Receive ${r.outputSymbol}`:`${r.instrument} / USD`);subtitle.className='draft-pair';summary.append(caption,direction,size,subtitle);
    const totals=el('dl');totals.className='draft-totals';for(const [label,value]of swap?[
      ['Expected',`${formatUnits(r.outputUnits,r.outputDecimals)} ${r.outputSymbol}`],['Minimum',`${formatUnits(r.minOutputUnits,r.outputDecimals)} ${r.outputSymbol}`],['Pool fee','0.05% · included'],
    ]:[['Notional',`${formatUnits(r.notionalUnits,6)} USDC`],['Worst fill',`${r.worstPrice} USD`],['Book levels',String(r.levelsUsed)]]){const line=el('div');line.append(el('dt',label),el('dd',value));totals.append(line);}summary.append(totals);
    const validity=el('p',`Estimate expires ${new Date(quote.expiresAt).toLocaleTimeString()}`);validity.className='draft-validity';summary.append(validity,el('p',swap?'Network fee & account checks pending.':'Fees & margin checks pending.'));
    layout.append(summary,form);panel.insertBefore(layout,status);
    const field=(name,label,{select,placeholder}={})=>{const wrap=el('label',label);wrap.className='quote-field';const input=el(select?'select':'input');input.id=name;input.name=name;wrap.htmlFor=name;
      if(select)for(const [value,text]of select){const option=el('option',text);option.value=value;input.append(option);}else{input.type='text';input.autocomplete='off';input.required=true;input.maxLength=name==='draft-address'?42:50;input.placeholder=placeholder??'0.00';if(name!=='draft-address')input.inputMode='decimal';}
      wrap.append(input);form.append(wrap);return input;};
    const section=el('p',swap?'ROUTE LIMITS':'ORDER LIMITS');section.className='draft-section';form.append(section);let collateral,limitPrice,leverage,reduceOnly;
    if(!swap){limitPrice=field('draft-limit','Limit price / USD');limitPrice.value=r.worstPrice;collateral=field('draft-collateral','Collateral cap / USDC');
      leverage=field('draft-leverage','Leverage limit',{select:[1,2,3,5,10,20,50].map(n=>[String(n),n+'×'])});
      const label=el('label');label.className='quote-consent draft-reduce';reduceOnly=el('input');reduceOnly.type='checkbox';reduceOnly.id='draft-reduce';reduceOnly.onchange=()=>{direction.textContent=reduceOnly.checked?(quote.request.side==='buy'?'BUY':'SELL')+' / REDUCE ONLY':quote.request.side==='buy'?'LONG / BUY':'SHORT / SELL';};label.append(reduceOnly,el('span','Reduce only'));form.append(label);}
    const fee=field('draft-fee',swap?'Fee cap / ETH':'Fee cap / USDC');
    const duration=field('draft-duration','Review within',{select:[['3600000','1 hour'],['86400000','24 hours']]});
    const address=field('draft-address',swap?'Receiving address':'Trading address',{placeholder:'0x…'});address.parentNode.classList.add('draft-account');
    const disclosure=el('label');disclosure.className='quote-consent draft-disclosure';const consent=el('input');consent.type='checkbox';consent.id='draft-public';disclosure.append(consent,el('span','Allow public route'));form.append(disclosure);
    const save=el('button','Save draft →');save.type='submit';save.id='draft-save';save.className='primary';save.disabled=true;form.append(save);const note=el('p','Private routes unavailable · No funds reserved');note.className='draft-final-note';form.append(note);
    const update=()=>{const expired=Date.now()>=quote.expiresAt||!isCurrent();save.disabled=saving||!consent.checked||expired;if(expired&&!saving&&form.isConnected)status.textContent='Estimate expired or changed. Get a new one.';};consent.onchange=update;timer=setInterval(update,500);
    form.onsubmit=async e=>{e.preventDefault();if(saving||!consent.checked||!isCurrent())return;
      saving=true;close.disabled=true;save.disabled=true;status.textContent='Saving…';
      for(const control of form.elements)control.disabled=true;
      try{
        const objective=draftFromQuote(quote,{id,address:address.value,fee:fee.value,duration:Number(duration.value),publicRoute:consent.checked,collateral:collateral?.value,limitPrice:limitPrice?.value,leverage:Number(leverage?.value),reduceOnly:reduceOnly?.checked});
        await saveRouteDraft(objective,{quote});clearInterval(timer);form.remove();status.textContent='Draft saved. No funds reserved.';
        const link=el('a','Open drafts');link.id='open-saved-drafts';link.className='draft-link';link.href='/routes.html#'+encodeURIComponent(id);panel.append(link);link.focus();
      }catch(error){status.textContent=draftError(error);for(const control of form.elements)control.disabled=false;}
      finally{saving=false;close.disabled=false;update();}
    };address.focus();
  }catch(error){status.textContent=draftError(error);}
  finally{opening=false;}
}
