import {HYPERLIQUID,checkedHyperliquidDomain} from './hyperliquid-environment.js';
import {createWalletSession} from './evm-wallet.js';
import {accountBalances} from './hyperliquid-account.js';
import {marketAccountOverview,marketAccountAmount} from './market-account-overview.js';
import {orderAmount,orderText,orderPosition} from './hyperliquid-order.js';
import {readTradingAccount,reviewTradingOrder} from './hyperliquid-trading.js';
import {readHyperOrders,readLegacyHyperOrders,clearResolvedOrders,resolvedOrder} from './hyperliquid-order-store.js';
import {executeTradingOrder,refreshTradingOrder,cancelTradingOrder} from './hyperliquid-execution.js';
import {readHyperliquidFundingConfiguration,readHyperliquidFundingRequest,requestHyperliquidTestnetFunding,reviewHyperliquidFundingAccount,ensureHyperliquidFundingAccount} from './hyperliquid-testnet-funding.js';
import {HYPERLIQUID_TESTNET_GRANTS,hyperFundingGrants} from './hyperliquid-funding-policy.js';
import {cacheHyperliquidHoldings} from './hyperliquid-holdings.js';
import {featureAvailable,showComingSoon} from './release-availability.js';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
const iconButton=(label,path,fn)=>{const b=button('',fn);b.className='hyper-icon-button';b.setAttribute('aria-label',label);b.title=label;const svg=document.createElementNS('http://www.w3.org/2000/svg','svg'),shape=document.createElementNS('http://www.w3.org/2000/svg','path');svg.setAttribute('viewBox','0 0 24 24');svg.setAttribute('aria-hidden','true');svg.setAttribute('focusable','false');shape.setAttribute('d',path);svg.append(shape);b.append(svg);return b;};
const refreshIcon='M20 7v5h-5M4 17v-5h5M6.1 6.1A8 8 0 0 1 20 12M4 12a8 8 0 0 0 13.9 5.9';
let active=null,session=null,picker=null,providers=[];const drafts=new Map();
function walletSession(){
  if(session)return session;
  session=createWalletSession({changed:()=>queueMicrotask(()=>active?.walletChanged())});
  picker=el('dialog');picker.className='hyper-order-dialog';picker.setAttribute('aria-labelledby','hyper-wallet-title');
  const top=el('div',undefined,'hyper-order-top'),title=el('h2','Connect wallet');title.id='hyper-wallet-title';
  top.append(title,iconButton('Close','M6 6l12 12M6 18L18 6',()=>{if(session.pending)session.disconnect();picker.close();}));
  const options=el('div',undefined,'hyper-wallet-options'),note=el('p','Open Lenz in a browser with your wallet installed.'),message=el('p');message.setAttribute('role','status');
  picker.append(top,el('p','Connect to read your Hyperliquid funds. Your wallet approves each order separately.'),options,note,message);document.body.append(picker);
  function add(provider,name){
    if(providers.length>=12||providers.some(p=>p===provider)||!provider||['request','on','removeListener'].some(k=>typeof provider[k]!=='function'))return;
    providers.push(provider);note.hidden=true;const b=button(name,async()=>{
      if(session.pending)return;for(const n of options.children)n.disabled=true;message.textContent='Check your wallet…';
      try{await session.connect(provider);picker.close();message.textContent='';}catch{message.textContent='Could not connect. Keep the wallet on Ethereum, Arbitrum or Base and try again.';}
      finally{for(const n of options.children)n.disabled=false;}
    });options.append(b);
  }
  addEventListener('eip6963:announceProvider',event=>{const d=event.detail;if(typeof d?.info?.name==='string'&&d.info.name.trim()&&d.info.name.length<=80)add(d.provider,d.info.name);});
  picker.addEventListener('cancel',()=>{if(session.pending)session.disconnect();});picker.addEventListener('close',()=>{if(!picker.open&&session.pending)session.disconnect();});
  walletSession.open=()=>{message.textContent='';dispatchEvent(new Event('eip6963:requestProvider'));if(!providers.length){try{add(window.ethereum,'Browser wallet');}catch{}}picker.showModal();};
  return session;
}
export function clearHyperliquidTrading(target){if(target&&!target.contains(active?.root))return;active?.dispose();active=null;}
export function mountHyperliquidTrading(target,row){
  clearHyperliquidTrading();const root=el('section',undefined,'hyper-action');root.setAttribute('aria-label','Use this market');
  checkedHyperliquidDomain(row);
  const supported=['spot','perp'].includes(row.kind)&&row.quote.index===0&&row.quote.symbol==='USDC'&&featureAvailable(row.kind==='spot'?'spot':'perpetuals');
  const head=el('div',undefined,'hyper-order-top');head.append(el('h4',supported?'Trade '+row.name:'Use '+row.name),el('span','Hyperliquid · Testnet','hyper-action-venue'));root.append(head);target.append(root);
  if(!supported){const trade=button('Trade',()=>showComingSoon(trade));root.append(el('p','Coming soon'),trade);return;}
  const wallet=walletSession();let snapshot=null,review=null,abort=null,generation=0,historyVersion=0,busy=false,disposed=false;const cancelPanels=new Set();
  const current=()=>!disposed&&root.isConnected&&!root.closest('[hidden]');
  const progress=el('ol',undefined,'hyper-order-steps');for(const text of ['Wallet & funds','Order','Review'])progress.append(el('li',text));root.append(progress);
  const account=el('div',undefined,'hyper-order-account'),identity=el('span','Connect your wallet to continue.'),connect=button('Connect wallet',()=>walletSession.open()),disconnect=iconButton('Disconnect wallet','M9 3v6m6-6v6M6 9h12v3a6 6 0 0 1-12 0V9m6 9v3',()=>wallet.disconnect());disconnect.hidden=true;account.append(identity,connect,disconnect);
  const available=el('p','Funds not loaded.','hyper-order-balance'),refresh=iconButton('Refresh funds',refreshIcon,()=>load()),funding=el('details',undefined,'hyper-order-funding');
  let fundingBusy=false,fundingVersion=0,fundingAvailable=null,fundingAmounts={...HYPERLIQUID_TESTNET_GRANTS};
  const testFunds=iconButton('Get test funds','M4 11h4V8h8v3h4v5h-4v-2H4zM12 8V5M8 5h8M18 20c0-1 2-3 2-3s2 2 2 3a2 2 0 0 1-4 0',()=>reviewTestFunding()),fundingStatus=el('p','Connect your receiving wallet first.');fundingStatus.setAttribute('role','status');
  const fundingLabel=label=>{testFunds.setAttribute('aria-label',label);testFunds.title=label;};fundingLabel('Get test funds');
  const faucet=el('a','Official faucet');faucet.href=HYPERLIQUID.faucet;faucet.target='_blank';faucet.rel='noopener noreferrer';
  funding.append(el('summary','Test funds'),el('p','Receive 12 test USDC for spot and 3 for perpetuals from Lenz’s testnet distributor. Test USDC has no monetary value. These transfers are public on Hyperliquid testnet.'),testFunds,fundingStatus,refresh,faucet);
  funding.addEventListener('toggle',()=>{if(funding.open)void checkTestFunding();});
  const positionPanel=el('section',undefined,'hyper-position');positionPanel.setAttribute('aria-label','Your position');
  const positionTop=el('div',undefined,'hyper-order-top'),positionTitle=el('h4','Position · '+row.name),positionRefresh=iconButton('Refresh position',refreshIcon,()=>load());
  const positionSummary=el('p',undefined,'hyper-position-summary'),positionValues=el('dl'),positionTime=el('p',undefined,'hyper-position-time'),closePosition=button('Close with limit',()=>prepareClose());
  positionTop.append(positionTitle,positionRefresh);positionPanel.append(positionTop,positionSummary,positionValues,positionTime,closePosition);
  const form=el('form',undefined,'hyper-order-form'),side=el('select'),size=el('input'),price=el('input'),privacy=el('select'),reduce=el('input');
  side.id='hyper-order-side';side.append(new Option(row.kind==='perp'?'Long / Buy':'Buy','buy'),new Option(row.kind==='perp'?'Short / Sell':'Sell','sell'));
  size.id='hyper-order-size';size.inputMode='decimal';size.autocomplete='off';size.placeholder='0.00';size.maxLength=40;
  price.id='hyper-order-price';price.inputMode='decimal';price.autocomplete='off';price.placeholder='0.00';price.maxLength=40;
  privacy.id='hyper-order-privacy';privacy.append(new Option('Private trade only','private'),new Option('Public trade on Hyperliquid','public'));
  reduce.type='checkbox';reduce.id='hyper-order-reduce';
  const draftKey=`${HYPERLIQUID.chainId}:${row.id}:${row.coin}:${row.quote.index}`,draft=drafts.get(draftKey);
  if(draft){side.value=draft.side;size.value=draft.size;price.value=draft.price;privacy.value=draft.privacy;reduce.checked=draft.reduce;}
  const remember=()=>drafts.set(draftKey,{side:side.value,size:size.value,price:price.value,privacy:privacy.value,reduce:reduce.checked});
  const field=(text,input)=>{const label=el('label',text);label.htmlFor=input.id;const area=el('div',undefined,'hyper-order-field');area.append(label,input);return area;};
  form.append(field('Direction',side),field('Size · '+row.name.split(' / ')[0],size),field('Limit price · USDC',price),field('Execution',privacy));
  if(row.kind==='perp'){const label=el('label',undefined,'hyper-order-reduce');label.append(reduce,document.createTextNode('Only reduce my position'));form.append(label);}
  const submit=el('button','Review order →');submit.type='submit';submit.id='hyper-order-review';form.append(submit);
  const status=el('p',undefined,'hyper-order-status');status.setAttribute('role','status');
  const activity=el('section',undefined,'hyper-order-activity');activity.setAttribute('aria-label','Your orders');
  root.append(account,available,funding,positionPanel,form,status,activity);
  const accountTabs=el('nav',undefined,'hyper-account-tabs');accountTabs.setAttribute('aria-label','Account sections');
  function accountTab(key){root.dataset.accountTab=key;for(const b of accountTabs.children)b.setAttribute('aria-pressed',String(b.dataset.tab===key));}
  for(const [key,label]of [['balances','Balances'],['positions','Positions'],['orders','Open orders'],['history','History']]){const b=button(label,()=>accountTab(key));b.dataset.tab=key;accountTabs.append(b);}
  const balancePanel=el('section',undefined,'hyper-account-balances'),balanceTitle=el('h4','Account balances'),balanceValues=el('dl'),balanceNote=el('p','Connect to read your balances.');balancePanel.append(balanceTitle,balanceValues,balanceNote);
  const accountOverview=marketAccountOverview({wallet,row,current:()=>current()&&root.dataset.tradingPane==='account'});
  accountOverview.historyButton.className='hyper-account-history-load';account.append(accountOverview.historyButton);
  const entry=el('div',undefined,'hyper-order-entry');entry.append(progress,available,form);root.append(entry,accountOverview.element,accountTabs,balancePanel,positionPanel,activity,status);accountTab('balances');
  const scope=el('p','Open orders and history cover orders placed through Lenz on this device.','hyper-account-scope');activity.before(scope);
  function showBalances(){void accountOverview.update(snapshot);balanceValues.replaceChildren();balanceNote.textContent=!wallet.snapshot?'Connect to read your balances.':!snapshot?'Balances unavailable. Refresh to try again.':snapshot.funds.mode!=='disabled'?'This account mode is not supported in Lenz yet.':'Read '+new Date(snapshot.observedAt).toLocaleString();if(!snapshot||snapshot.funds.mode!=='disabled')return;
    const balances=accountBalances(snapshot.funds,snapshot.spotTokens??[]);
    for(const row of balances.spot){const cell=el('div');cell.append(el('dt',row.symbol+' · available'),marketAccountAmount(el('dd'),row.available));balanceValues.append(cell);}
    for(const [label,value]of [['Account value',balances.equity],['Available to withdraw',balances.withdrawable],['Margin used',balances.margin]]){const cell=el('div');cell.append(el('dt',label),marketAccountAmount(el('dd'),value===null?'Unavailable':value+' USDC'));balanceValues.append(cell);}
    if(balances.partial)balanceNote.textContent+=' · Some balances unavailable';
  }
  const dialog=el('dialog');dialog.className='hyper-order-dialog';dialog.id='hyper-order-confirm';dialog.setAttribute('aria-labelledby','hyper-review-title');
  const top=el('div',undefined,'hyper-order-top'),title=el('h2','Review order');title.id='hyper-review-title';const back=iconButton('Back','M19 12H5m7-7-7 7 7 7',()=>{review=null;dialog.close();});top.append(title,back);
  const terms=el('dl'),explain=el('p'),confirm=button('Confirm order in wallet',()=>sign()),feedback=el('p');feedback.setAttribute('role','status');
  dialog.append(top,terms,explain,el('p','This signs one public limit order. It may fill immediately; otherwise it stays open until filled or cancelled. This grants no withdrawal permission.'),confirm,feedback);document.body.append(dialog);
  dialog.addEventListener('cancel',()=>{review=null;});
  root.addEventListener('trading-view-change',()=>{head.querySelector('h4').textContent=(root.dataset.tradingPane==='account'?'Account · ':'Trade ')+row.name;void accountOverview.update(snapshot);review=null;if(dialog.open)dialog.close();for(const panel of cancelPanels){panel.close();panel.remove();}cancelPanels.clear();controls();});
  function controls(){
    showBalances();
    const connected=!!wallet.snapshot;connect.hidden=connected;disconnect.hidden=!connected;refresh.disabled=busy||!connected||!navigator.onLine;
    positionRefresh.disabled=refresh.disabled;closePosition.disabled=busy||!snapshot||!navigator.onLine;
    submit.disabled=busy||!snapshot||!navigator.onLine||privacy.value!=='public'||snapshot.funds.mode!=='disabled';
    identity.textContent=connected?wallet.snapshot.address.slice(0,6)+'…'+wallet.snapshot.address.slice(-4):'Connect your wallet to continue.';
    identity.title=wallet.snapshot?.address??'';progress.children[0].dataset.done=String(!!snapshot);progress.children[1].dataset.done=String(!!review);
    testFunds.disabled=fundingBusy||busy||!connected||!navigator.onLine||fundingAvailable===false;
  }
  async function checkTestFunding(){
    const version=++fundingVersion,address=wallet.snapshot?.address;fundingLabel('Get test funds');if(!address){fundingStatus.textContent='Connect your receiving wallet first.';return;}if(!navigator.onLine){fundingStatus.textContent='Reconnect to request or check test funds.';return;}
    try{
      const retained=await readHyperliquidFundingRequest(address);if(version!==fundingVersion||!current()||wallet.snapshot?.address!==address)return;
      if(retained&&retained.state!=='unavailable'&&(retained.state==='pending'||Date.now()-retained.createdAt<=86400000)){fundingAmounts=hyperFundingGrants(retained.request);fundingAvailable=true;fundingLabel('Check test funds');fundingStatus.textContent='A funding request is retained for this wallet. Check it before starting another.';controls();return;}
      const config=await readHyperliquidFundingConfiguration();if(version!==fundingVersion||!current()||wallet.snapshot?.address!==address)return;
      fundingAmounts={...config.grants};fundingAvailable=config.available;fundingStatus.textContent=config.available?'Ready to receive test USDC into this wallet.':config.reason==='operator_unfunded'?'Lenz’s testnet distributor needs replenishing.':'Lenz’s testnet distributor is unavailable.';controls();
    }catch{if(version===fundingVersion&&current()&&wallet.snapshot?.address===address){fundingAvailable=false;fundingStatus.textContent='Testnet funding is unavailable. Retained requests stay on this device.';controls();}}
  }
  async function reviewTestFunding(){
    if(fundingBusy||!wallet.snapshot||!navigator.onLine)return;const lease=wallet.capture();let accountReview;fundingBusy=true;controls();try{const retained=await readHyperliquidFundingRequest(lease.identity.address);lease.assertCurrent();if(retained)fundingAmounts=hyperFundingGrants(retained.request);accountReview=await reviewHyperliquidFundingAccount(lease.identity.address);lease.assertCurrent();if(!current()||!navigator.onLine)return;}catch(error){if(current())fundingStatus.textContent=error.message;return;}finally{fundingBusy=false;if(current())controls();}const panel=el('dialog');panel.className='hyper-order-dialog';panel.setAttribute('aria-label','Public test funds');cancelPanels.add(panel);
    const reviewedGrants={...fundingAmounts},accept=button('Receive public test funds',()=>{try{lease.assertCurrent();if(!current())throw Error('Funding view changed.');panel.close();panel.remove();cancelPanels.delete(panel);void fundTestWallet(accountReview,reviewedGrants);}catch{panel.close();panel.remove();cancelPanels.delete(panel);}});
    panel.append(el('h2','Public test funds'),el('p',`This route sends ${fundingAmounts.spotUSDC} test USDC for spot and ${fundingAmounts.perpsUSDC} for perpetuals. These transfers are public on Hyperliquid testnet, including the receiving address. The distributor covers any account activation fee. A private funding route is not available here.`),el('p',lease.identity.address),iconButton('Back','M19 12H5m7-7-7 7 7 7',()=>{panel.close();panel.remove();cancelPanels.delete(panel);}),accept);panel.addEventListener('cancel',()=>{panel.remove();cancelPanels.delete(panel);});if(accountReview.setupAction)panel.insertBefore(el('p','For this new empty account, your wallet will first approve Standard mode on Hyperliquid testnet. Spot and perpetual collateral stay separate. This signs one account setting and grants no trading or withdrawal authority.'),accept);document.body.append(panel);panel.showModal();
  }
  async function fundTestWallet(accountReview,reviewedGrants){
    if(fundingBusy||!wallet.snapshot||!navigator.onLine)return;const lease=wallet.capture(),version=++fundingVersion;fundingBusy=true;controls();fundingStatus.textContent='Requesting test USDC…';
    try{
      await ensureHyperliquidFundingAccount(lease,accountReview,{publicConsent:true,assertCurrent:()=>{lease.assertCurrent();if(!current()||!navigator.onLine)throw Error('The funding view changed.');}});
      const result=await requestHyperliquidTestnetFunding(lease.identity.address,{publicConsent:true,reviewedGrants,assertCurrent:()=>{lease.assertCurrent();if(!current())throw Error('The funding view changed. Check the retained request when you return.');}});
      if(version!==fundingVersion||!current())return;
      fundingStatus.textContent=result.state==='confirmed'?'Test USDC received. Refreshing your balances…':result.state==='pending'?'Confirmation pending. Check this retained request again.':result.state==='rejected'?'The testnet transfer was rejected. Check this request before trying again.':result.reason==='operator_unfunded'?'Lenz’s testnet distributor needs replenishing.':'Lenz’s testnet distributor is unavailable.';
      fundingAvailable=result.state!=='unavailable';if(result.state==='pending')fundingLabel('Check test funds');if(result.state==='confirmed')await load();
    }catch(error){if(version===fundingVersion&&current()){fundingStatus.textContent=error.message;fundingLabel('Check test funds');}}
    finally{fundingBusy=false;if(current())controls();}
  }
  function showPosition(message='Position unavailable. Refresh to try again.'){
    positionPanel.hidden=row.kind!=='perp'||!wallet.snapshot;positionValues.replaceChildren();positionTime.textContent='';closePosition.hidden=true;marketAccountAmount(positionSummary,message);
    if(!snapshot||snapshot.funds.mode!=='disabled')return;
    try{
      const held=orderPosition(snapshot.market,snapshot.funds);
      positionTime.textContent='Read '+new Date(snapshot.observedAt).toLocaleString()+' · Refresh for changes';
      if(!held){marketAccountAmount(positionSummary,'No open '+snapshot.market.base+' position.');return;}
      marketAccountAmount(positionSummary,`${held.side==='long'?'Long':'Short'} · ${held.size} ${snapshot.market.base}`);
      for(const [name,value]of [['Entry price',held.entryPrice],['Open-position profit / loss',held.pnl],['Liquidation price',held.liquidationPrice],['Margin used',held.margin]]){
        const cell=el('div');cell.append(el('dt',name),marketAccountAmount(el('dd'),value===null?'Unavailable':value+' USDC'));positionValues.append(cell);
      }
      closePosition.hidden=false;
    }catch{marketAccountAmount(positionSummary,'Position unavailable. Refresh to try again.');}
  }
  async function prepareClose(){
    if(closePosition.disabled||closePosition.hidden)return;
    const lease=wallet.capture();
    try{
      await load();lease.assertCurrent();if(!current()||!snapshot||snapshot.funds.mode!=='disabled')return;
      const held=orderPosition(snapshot.market,snapshot.funds);if(!held){status.textContent='This position is no longer open.';return;}
      side.value=held.side==='long'?'sell':'buy';size.value=held.size;reduce.checked=true;price.value='';review=null;side.dispatchEvent(new Event('input',{bubbles:true}));remember();controls();root.closest('.hyper-workspace')?.querySelector('.hyper-view-nav [data-view=trade]')?.click();
      status.textContent='Set a limit price, then review. This order can only reduce your position.';price.focus();
    }catch(error){if(current())status.textContent=error.message;}
  }
  async function load(){
    abort?.abort();abort=new AbortController();const ticket=++generation;snapshot=null;review=null;controls();showPosition('Reading your position…');
    if(!wallet.snapshot){available.textContent='Funds not loaded.';return;}if(!navigator.onLine){available.textContent='Offline · reconnect to refresh funds.';showPosition('Offline · reconnect to refresh your position.');return;}
    const lease=wallet.capture();available.textContent='Reading your Hyperliquid funds…';
    try{
      const value=await readTradingAccount(row,lease.identity.address,{signal:abort.signal});lease.assertCurrent();if(ticket!==generation||!current())return;snapshot=value;
      try{await cacheHyperliquidHoldings(value,{assertCurrent:()=>{lease.assertCurrent();if(ticket!==generation||!current())throw Error('Account view changed.');}});}catch{}if(ticket!==generation||!current())return;
      if(value.funds.mode!=='disabled'){available.textContent='Trading for this account mode is not connected in Lenz yet.';showPosition('Position unavailable for this account mode.');return;}
      if(row.kind==='spot'){
        const token=value.funds.spot.find(b=>b.token===(side.value==='buy'?value.market.quoteIndex:value.market.baseIndex)),amount=token?orderText(orderAmount(token.total)-orderAmount(token.hold)):'0';
        available.textContent=`Available ${amount} ${side.value==='buy'?value.market.quote:value.market.base} · Hyperliquid`;
      }else available.textContent=`Available margin ${value.funds.perp.withdrawable} USDC · ${value.funds.leverage?.value??'—'}× current leverage`;
      status.textContent=privacy.value==='public'?'':'Choose Public trade on Hyperliquid to use this route.';
      if(row.kind==='perp')showPosition();
    }catch(error){if(ticket===generation&&current()){available.textContent='Funds unavailable.';status.textContent=error.message;showPosition();}}
    finally{if(ticket===generation){controls();void history();}}
  }
  form.oninput=()=>{remember();review=null;controls();};side.onchange=()=>{remember();void load();};privacy.onchange=()=>{remember();review=null;status.textContent=privacy.value==='public'?'Orders and positions are public on Hyperliquid.':'A private trading route is not connected yet.';controls();};
  form.onsubmit=event=>{
    event.preventDefault();if(submit.disabled)return;
    try{
      review=reviewTradingOrder(snapshot,{side:side.value,size:size.value,price:price.value,reduceOnly:reduce.checked});
      terms.replaceChildren();for(const [name,value]of [['Market',row.name],['Action',`${review.side==='buy'?'Buy':'Sell'} ${review.size} ${review.market.base}`],['Limit price',review.price+' USDC'],[row.kind==='perp'?'Collateral needed · estimate':'Funds needed',review.spend+' '+review.spendAsset],['Trading fee',`${Number(review.fee)*100}% current taker rate; maker rate may be lower`],['Wallet',review.account],['Network',HYPERLIQUID.name],...(row.kind==='perp'?[['Position effect',review.reduceOnly?'Reduce only':'May open or increase a position'],['Margin',`${review.marginMode==='cross'?'Cross':'Isolated'} · ${review.leverage}×`],['Mark price',review.markPrice+' USDC'],['Collateral risk',review.marginMode==='cross'?'Other cross-margin funds can cover losses.':'Losses can consume this position’s isolated collateral.']]:[])])terms.append(el('dt',name),el('dd',value));
      explain.textContent='Submit this review within 60 seconds. The price limit remains in force after submission.';feedback.textContent='';confirm.disabled=false;dialog.showModal();controls();
    }catch(error){status.textContent=error.message;}
  };
  async function sign(){
    if(busy||!review)return;const approved=review,lease=wallet.capture();busy=true;confirm.disabled=true;feedback.textContent='Approve the displayed order in your wallet…';controls();
    try{
      const result=await executeTradingOrder(approved,lease,{current:()=>current()&&dialog.open&&review===approved&&privacy.value==='public'});
      dialog.close();review=null;status.textContent=result==='rejected'?'Hyperliquid rejected this order. Refresh funds and review your terms.':'Order sent. Checking its status…';
      const saved=(await readHyperOrders()).find(o=>o.id===approved.action.orders[0].c);if(saved&&result!=='rejected'){try{await refreshTradingOrder(saved);}catch{status.textContent='Status not confirmed. Use Check status below.';}}
    }catch(error){feedback.textContent=error.message;status.textContent='Order not confirmed. Your activity below keeps its status.';}
    finally{busy=false;confirm.disabled=false;controls();void history();}
  }
  async function history(){
    if(!current())return;const ticket=++historyVersion,address=wallet.snapshot?.address;activity.replaceChildren(el('h4','Your orders'));
    try{
      const rows=(await readHyperOrders()).filter(o=>!address||o.review.account===address).reverse();if(ticket!==historyVersion||!current()||wallet.snapshot?.address!==address)return;
      if(!address&&rows.length)activity.append(el('p','Saved on this device. Connect the matching wallet to manage orders.'));
      for(const saved of rows){
        const item=el('article',undefined,'hyper-saved-order'),label=el('strong',`${saved.review.side==='buy'?'Buy':'Sell'} ${saved.review.size} ${saved.review.market.base}`),state=el('span',({awaiting_wallet:'Wallet approval unfinished · check status',submitting:'Confirmation pending',unknown:'Confirmation pending',open:'Open',filled:'Filled',cancelled:'Cancelled',rejected:'Rejected',not_sent:'Not sent'})[saved.state]);
        item.dataset.terminal=String(resolvedOrder(saved));
        item.append(marketAccountAmount(label,label.textContent),state,marketAccountAmount(el('small'),`${saved.review.market.coin} · Limit ${saved.review.price} USDC`));
        item.append(el('small',`${saved.review.account.slice(0,6)}…${saved.review.account.slice(-4)} · Saved ${new Date(saved.updatedAt).toLocaleString()}`));
        if(saved.observation)item.append(marketAccountAmount(el('small'),`Filled ${saved.observation.filled} · Remaining ${saved.observation.remaining}`));
        const check=button('Check status',async()=>{check.disabled=true;try{const result=await refreshTradingOrder(saved);status.textContent=result.state==='unknown'?'No matching order returned yet. Check on Hyperliquid before placing another.':'Order status updated.';}catch(e){status.textContent=e.message;}finally{void history();}});check.disabled=!navigator.onLine;
        if(saved.state!=='not_sent')item.append(check);
        if(saved.state==='open'&&wallet.snapshot?.address===saved.review.account)item.append(button('Cancel order',()=>{
          const cancel=el('dialog');cancelPanels.add(cancel);cancel.className='hyper-order-dialog';cancel.setAttribute('aria-label','Cancel order');let approvedCancel=false;
          const message=el('p');message.setAttribute('role','status');const signCancel=button('Confirm cancellation',async()=>{
            if(approvedCancel)return;approvedCancel=true;signCancel.disabled=true;message.textContent='Check your wallet to approve cancellation…';
            try{await cancelTradingOrder(saved,wallet.capture(),{current:()=>current()&&cancel.open});cancel.close();cancel.remove();status.textContent='Cancellation checked. See the updated order status.';}
            catch(e){message.textContent=e.message;approvedCancel=false;signCancel.disabled=false;}finally{void history();}
          });
          cancel.append(el('h2','Cancel this order?'),el('p',`${saved.review.side==='buy'?'Buy':'Sell'} ${saved.review.size} ${saved.review.market.base} at ${saved.review.price} USDC. Any part already filled stays filled.`),button('Keep order',()=>{cancel.close();cancel.remove();}),signCancel,message);cancel.addEventListener('cancel',()=>cancel.remove());document.body.append(cancel);cancel.showModal();
        }));activity.append(item);
      }
      if(!rows.length)activity.append(el('p','No orders saved on this device.'));
      else if(rows.every(resolvedOrder))activity.append(el('p','No open or pending Lenz orders.','hyper-open-empty'));
      const earlier=(await readLegacyHyperOrders()).filter(row=>!address||row.account===address);
      if(ticket!==historyVersion||!current()||wallet.snapshot?.address!==address)return;
      if(earlier.length){const legacy=el('details');legacy.append(el('summary','Earlier mainnet orders · read only'),el('p','These records remain on this device. Testnet trading cannot check, cancel or resubmit them.'));for(const row of earlier)legacy.append(el('p',`${row.side==='buy'?'Buy':'Sell'} ${row.size} ${row.coin} at ${row.price} USDC · ${row.state}`));activity.append(legacy);}
      if(rows.length){
        const manage=el('details',undefined,'hyper-history-tools');manage.append(el('summary','Manage local history'));
        manage.append(button('Save history',()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(rows,null,2)],{type:'application/json'})),a=el('a');a.href=url;a.download='lenz-order-history.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}));
        if(address&&rows.some(resolvedOrder))manage.append(button('Clear resolved history',()=>{
          const panel=el('dialog');panel.className='hyper-order-dialog';panel.setAttribute('aria-label','Clear resolved order history');cancelPanels.add(panel);
          const message=el('p');message.setAttribute('role','status');const clear=button('Clear resolved records',async()=>{if(clear.disabled)return;clear.disabled=true;message.textContent='Clearing resolved records…';try{await clearResolvedOrders(address);panel.close();panel.remove();void history();}catch(e){message.textContent=e.message;clear.disabled=false;}});
          panel.append(el('h2','Clear resolved history?'),el('p','This removes completed, cancelled, rejected and unsent orders from this device. Open and uncertain orders stay saved. Save a copy first if you need these records.'),button('Keep history',()=>{panel.close();panel.remove();}),clear,message);document.body.append(panel);panel.showModal();
        }));activity.append(manage);
      }
    }catch{activity.append(el('p','Saved order activity could not be read. Trading requires working local storage.'));}
  }
  const closeReviews=()=>{if(dialog.open)dialog.close();for(const panel of cancelPanels){panel.close();panel.remove();}cancelPanels.clear();};
  const connection=()=>{fundingVersion++;fundingAvailable=null;snapshot=null;review=null;closeReviews();controls();if(funding.open)void checkTestFunding();void load();void history();};
  const offline=()=>{fundingVersion++;generation++;abort?.abort();snapshot=null;review=null;closeReviews();controls();if(funding.open)void checkTestFunding();showPosition('Offline · reconnect to refresh your position.');status.textContent='Offline · saved order activity is still available. Orders can continue filling on Hyperliquid.';void history();};
  addEventListener('offline',offline);addEventListener('online',connection);
  active={root,walletChanged:connection,dispose(){remember();disposed=true;generation++;abort?.abort();accountOverview.dispose();review=null;dialog.close();dialog.remove();root.remove();for(const panel of cancelPanels){panel.close();panel.remove();}removeEventListener('offline',offline);removeEventListener('online',connection);}};
  controls();void load();void history();
}
