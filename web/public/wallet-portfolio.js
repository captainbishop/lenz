import {assetIcon} from './asset-icon.js';
import {iconButton,walletIcon} from './wallet-actions.js';
import {transferAssets} from './evm-transfer.js';
import {WALLET_NETWORKS} from './evm-networks.js';
import {mountLendingAccount} from './lending-account-ui.js';
import {showComingSoon} from './release-availability.js';
import {readState} from './chat-store.js';
import {snapshotIntentActionRecovery,validateIntentActionRecovery} from './intent-action-store.js';
import {ZCASH_INTENT_CHAIN,formatZcashAmount} from './intent-zcash-plan.js';
import {walletAmount} from './wallet-visibility.js';

const $=selector=>document.querySelector(selector);

// Reuse the mounted wallet controls so changing views never changes authority or funds.
export function mountWalletPortfolio(wallet,{intentController,fundingController=intentController,zcashController}={}){
 iconButton($('#show-profile'),'Edit profile','m16 3 5 5-12 12-6 1 1-6zM14 5l5 5');
 const portfolio=document.createElement('section');portfolio.id='wallet-portfolio';
 portfolio.innerHTML=`<div class="wallet-tab-bar" role="tablist" aria-label="Wallet sections">
  <button id="wallet-tab-tokens" type="button" role="tab" aria-controls="wallet-panel-tokens" aria-selected="true">Tokens</button>
  <button id="wallet-tab-defi" type="button" role="tab" aria-controls="wallet-panel-defi" aria-selected="false" tabindex="-1">DeFi</button>
  <button id="wallet-tab-nfts" type="button" role="tab" aria-controls="wallet-panel-nfts" aria-selected="false" tabindex="-1">NFTs</button>
 </div>
 <div id="wallet-panel-tokens" role="tabpanel" aria-labelledby="wallet-tab-tokens" tabindex="0"></div>
 <div id="wallet-panel-defi" role="tabpanel" aria-labelledby="wallet-tab-defi" tabindex="0" hidden>
  <nav class="wallet-markets" aria-label="Explore DeFi"></nav>
  <details id="wallet-defi-positions" class="wallet-fold"><summary>Positions &amp; offline approvals</summary></details>
 </div>
 <div id="wallet-panel-nfts" role="tabpanel" aria-labelledby="wallet-tab-nfts" tabindex="0" hidden>
  <div class="wallet-nft-state">${walletIcon('M4 4h12v12H4zM9 20h11V9M7 12l3-3 3 3')}<div><h2>NFT collections</h2><p>NFT ownership isn’t connected yet.</p><p class="quiet">Use your external wallet to view collections.</p></div></div>
 </div>`;
 $('.wallet-lower').before(portfolio);
 mountLendingAccount(wallet,$('#wallet-panel-defi'));
 $('#wallet-panel-tokens').append($('#wallet-tokens'));
 const offline=document.createElement('details');offline.className='wallet-offline-token';
 offline.innerHTML='<summary><span class="token-identity"><img src="/brand/mark.svg" width="36" height="36" alt=""><span><strong>tUSD</strong><small>Offline · Testnet</small></span></span><span class="token-amount"><strong id="wallet-offline-amount"></strong><small id="wallet-offline-state">Test dollars · No cash value</small></span></summary><div id="wallet-offline-controls"></div>';
 $('#wallet-panel-tokens').append(offline);
 for(const name of ['send','receive']){
  const original=$('#near-'+name),button=document.createElement('button');button.type='button';button.id='wallet-'+name;button.innerHTML=original.innerHTML;button.setAttribute('aria-label',name==='send'?'Send':'Receive');
  original.before(button);$('#wallet-offline-controls').append(original);
  button.onclick=()=>name==='send'?wallet.openSend():openAssets(name);
 }
 const actions=$('.near-actions');actions.className='wallet-primary-actions';
 if(intentController){
  const funds=document.createElement('button');funds.id='wallet-test-funds';funds.type='button';iconButton(funds,'Get test funds','M4 11h4V8h8v3h4v5h-4v-2H4zM12 8V5M8 5h8M18 20c0-1 2-3 2-3s2 2 2 3a2 2 0 0 1-4 0');funds.onclick=()=>void fundingController.openFunding().catch(()=>{});actions.append(funds);
  fundingController.subscribe(snapshot=>{funds.disabled=snapshot.busy||!snapshot.identity;});
 }
 const heroSummary=document.createElement('div');heroSummary.id='wallet-hero-summary';heroSummary.hidden=$('#wallet-content').hidden;
 heroSummary.append($('#wallet-holdings-total'),actions);$('.wallet-heading').append(heroSummary);
 new MutationObserver(()=>{heroSummary.hidden=$('#wallet-content').hidden;}).observe($('#wallet-content'),{attributes:true,attributeFilter:['hidden']});
 $('#wallet-offline-controls').append($('#near-fund'));
 if(intentController)$('#near-fund').hidden=true;
 actions.append($('#toggle-balances'));
 offline.append($('.near-balance'),$('.near-journey'));
 const paintOffline=()=>{$('#wallet-offline-amount').textContent=$('#near-total').textContent;const label=$('#wallet-balance-detail-label').textContent;$('#wallet-offline-state').textContent=label==='Details'?'Test dollars · No cash value':label;};
 new MutationObserver(paintOffline).observe($('.near-balance'),{subtree:true,childList:true,characterData:true,attributes:true,attributeFilter:['data-wallet-amount']});paintOffline();
 $('.balance-label>span').textContent='Offline tUSD';
 $('.wallet-receiving>.quiet').textContent='Receives test dollars (tUSD) only. Confirmed payments are public on the NEAR test network. Do not send ETH or SOL here.';
 const picker=document.createElement('dialog');picker.id='wallet-asset-dialog';picker.setAttribute('aria-labelledby','wallet-asset-title');
 picker.innerHTML='<div class="dialog-top"><h2 id="wallet-asset-title">Receive asset</h2><button id="wallet-asset-close" type="button" class="secondary wallet-close"></button></div><div id="wallet-asset-options"></div>';
 document.body.append(picker);iconButton($('#wallet-asset-close'),'Close','m6 6 12 12M18 6 6 18');$('#wallet-asset-close').onclick=()=>picker.close();
 let assetAction='receive',resumeConnection=null;
 function openAssets(name){
  assetAction=name;$('#wallet-asset-title').textContent=name==='send'?'Send asset':'Receive asset';paintAssets();picker.showModal();
 }
 function assetOption(name,detail,disabled,open){
  const button=document.createElement('button'),info=document.createElement('span'),title=document.createElement('strong'),caption=document.createElement('small');
  button.type='button';title.textContent=name;title.className='asset-label';title.prepend(name==='tUSD'?Object.assign(document.createElement('img'),{src:'/brand/mark.svg',width:26,height:26,alt:''}):assetIcon({symbol:name,trusted:!!wallet.snapshot&&Object.hasOwn(WALLET_NETWORKS,wallet.snapshot.chainId)}));caption.textContent=detail;info.append(title,caption);button.append(info);button.insertAdjacentHTML('beforeend',walletIcon('m9 5 7 7-7 7'));button.disabled=disabled;
  button.onclick=()=>{picker.close();open();};$('#wallet-asset-options').append(button);
 }
 function paintAssets(){
  $('#wallet-asset-options').replaceChildren();
  const snapshot=wallet.snapshot;
  if(snapshot){
   const supported=Object.hasOwn(WALLET_NETWORKS,snapshot.chainId),tokens=supported?transferAssets(snapshot.chainId):[{id:'native',symbol:snapshot.network.symbol}];
   for(const token of tokens){
    const disabled=$('#evm-'+assetAction).disabled||(assetAction==='send'&&!supported);
    assetOption(token.symbol,snapshot.network.name+' · Wallet address',disabled,()=>{
     if(wallet.snapshot!==snapshot)return;
     if(assetAction==='send')wallet.openSend(token.id);else wallet.openReceive(token.id);
    });
   }
   const note=document.createElement('p');note.className='quiet';note.textContent=assetAction==='send'&&$('#evm-send').disabled?$('#evm-history-status').textContent:'Public transfer · '+snapshot.network.name;$('#wallet-asset-options').append(note);
  }else{
   const button=document.createElement('button'),label=document.createElement('span');button.type='button';label.textContent='Connect wallet';button.append(label);button.insertAdjacentHTML('beforeend',walletIcon('m9 5 7 7-7 7'));button.disabled=$('#evm-connect').disabled;
   button.onclick=()=>{resumeConnection=assetAction;picker.close();$('#evm-connect').click();};$('#wallet-asset-options').append(button);
  }
  const testLabel=document.createElement('p');testLabel.className='wallet-asset-group';testLabel.textContent='Test wallet';$('#wallet-asset-options').append(testLabel);
  const target=$('#near-'+assetAction);
  assetOption('tUSD','Lenz ID · Test dollars · Payments confirmed publicly',target.disabled,()=>target.click());
 }
 addEventListener('lenz-evm-session',()=>{
  if(picker.open)paintAssets();
  if(resumeConnection&&!$('#evm-account').hidden){const name=resumeConnection;resumeConnection=null;openAssets(name);}
 });
 $('#evm-connect-dialog').addEventListener('close',()=>{if($('#evm-account').hidden)resumeConnection=null;});
 new MutationObserver(()=>{if(picker.open)paintAssets();}).observe($('#wallet-offline-controls'),{subtree:true,attributes:true,attributeFilter:['disabled']});
 new MutationObserver(()=>{if(picker.open)paintAssets();}).observe($('#evm-send'),{attributes:true,attributeFilter:['disabled']});
 $('#wallet-tokens h2').textContent='Your tokens';
 $('#wallet-defi-positions').append($('#rhea-wallet'));
 $('#rhea-wallet h2').textContent='Positions & requests';
 for(const [label,detail,href,icon] of [
  ['Swap','Compare markets','/markets.html','M4 8h16m-4-4 4 4-4 4M20 16H4m4-4-4 4 4 4'],
  ['Perpetuals','Hyperliquid','/markets.html?view=perpetuals','M6 3v18M3 8h6v7H3zm12-12v18m-3-15h6v6h-6z'],
  ['Lend & borrow','Credit markets','/markets.html?view=credit','M4 20h16M6 16V9m6 7V9m6 7V9M3 6l9-4 9 4H3z'],
  ['Liquidity','Pools & fees','/markets.html?view=liquidity','M5 5h5v14H5zM14 9h5v10h-5z'],
  ['Degen','Tokens & live trades','/markets.html?view=degen','m3 17 6-6 4 3 8-10M15 4h6v6'],
 ]){
  const link=document.createElement('a');link.href=href;
  link.innerHTML=`${walletIcon(icon)}<span><strong>${label}</strong><small>${detail}</small></span>${walletIcon('M6 18 18 6M6 6h12v12')}`;
  if(label==='Swap'&&intentController){link.href='#rhea-wallet';link.querySelector('small').textContent='Use your funds';link.onclick=event=>{event.preventDefault();openSwap();};}
  $('.wallet-markets').append(link);
 }
 function utilityDialog(id,title,nodes){
  const dialog=document.createElement('dialog');dialog.id=id;dialog.setAttribute('aria-labelledby',id+'-title');
  dialog.innerHTML=`<div class="dialog-top"><h2 id="${id}-title">${title}</h2><button type="button" class="secondary wallet-close"></button></div>`;
  const close=dialog.querySelector('button');iconButton(close,'Close','m6 6 12 12M18 6 6 18');close.onclick=()=>dialog.close();dialog.append(...nodes);document.body.append(dialog);return dialog;
 }
 const activity=utilityDialog('wallet-activity-dialog','Activity',[$('#evm-transfers'),$('.near-activity')]);
 const nativeHistory=document.createElement('section');nativeHistory.id='wallet-zcash-activity';nativeHistory.hidden=true;
 nativeHistory.innerHTML='<h3>Shielded payments</h3><p class="quiet">Native wallet keys and signed transactions stay local. Lenz backup preserves the request record.</p><ul id="wallet-zcash-history"></ul><p id="wallet-zcash-history-status" class="quiet" role="status"></p>';activity.append(nativeHistory);
 let nativeHistoryGeneration=0;
 async function paintNativeHistory(){
  const ticket=++nativeHistoryGeneration;nativeHistory.hidden=true;$('#wallet-zcash-history').replaceChildren();$('#wallet-zcash-history-status').textContent='';
  try{
   const state=await readState();if(!state.identity||ticket!==nativeHistoryGeneration)return;
   const records=(await snapshotIntentActionRecovery(state)).filter(record=>[record.journal.draft,record.journal.review,...record.journal.attempts.map(attempt=>attempt.review)].some(selection=>selection?.source.chainId===ZCASH_INTENT_CHAIN));
   await validateIntentActionRecovery(records,state.identity);if(ticket!==nativeHistoryGeneration)return;
   const statuses={draft:'Awaiting approval','approval-unresolved':'Approval unknown · Check your native wallet',declined:'Approval declined',authorized:'Approved · Not submitted','submission-unresolved':'Completion unknown · Check status',executed:'Shielded payment confirmed',expired:'Payment expired unused'};
   const rows=records.flatMap(record=>{const {draft,review,attempts}=record.journal;return draft&&!attempts.some(attempt=>attempt.id===draft.requestId)?[...attempts,{review:review??draft,createdAt:review?.reviewedAt??0,status:'draft'}]:attempts;});
   for(const attempt of rows.sort((a,b)=>b.createdAt-a.createdAt)){
    const item=document.createElement('li'),heading=document.createElement('strong'),status=document.createElement('p'),amount=document.createElement('span');heading.append('Shielded payment · ',walletAmount(amount,formatZcashAmount(attempt.review.source.amount)));status.textContent=statuses[attempt.status];item.append(heading,status);
    const details=document.createElement('details'),summary=document.createElement('summary'),recipient=document.createElement('p'),transaction=document.createElement('code');details.className='wallet-native-payment-details';summary.textContent='Payment details';recipient.textContent='Recipient: '+attempt.review.destination.accountId;transaction.textContent=attempt.review.native?.txid??attempt.review.requestId;details.append(summary,recipient,transaction);item.append(details);
    if(zcashController){const open=document.createElement('button');open.type='button';open.className='secondary';open.textContent='Open original payment';open.onclick=async()=>{open.disabled=true;try{activity.close();await zcashController.openActivity(attempt.review.source.accountId);}catch(error){if(ticket===nativeHistoryGeneration){$('#wallet-zcash-history-status').textContent=error.message;if(!activity.open)activity.showModal();}}finally{open.disabled=false;}};item.append(open);}
    $('#wallet-zcash-history').append(item);
   }
   nativeHistory.hidden=records.length===0;
  }catch{if(ticket===nativeHistoryGeneration){nativeHistory.hidden=false;$('#wallet-zcash-history-status').textContent='Saved shielded payments could not be verified. Open the original local wallet before trying again.';}}
 }
 addEventListener('lenz-account-identity',()=>{nativeHistoryGeneration++;nativeHistory.hidden=true;$('#wallet-zcash-history').replaceChildren();});
 $('.wallet-heading').after($('#evm-incoming-link'));
 const account=utilityDialog('wallet-account-dialog','Wallet account',[$('#connected-wallet')]);
 // Cancel in the dismissal task; the later close event can follow a completed reply.
 account.querySelector('.wallet-close').onclick=()=>{wallet.cancelPrivateRead();account.close();};
 account.addEventListener('cancel',()=>wallet.cancelPrivateRead());
 account.addEventListener('close',()=>wallet.cancelPrivateRead());
 const privateBalances=document.createElement('button');privateBalances.type='button';privateBalances.id='wallet-private-open';privateBalances.className='secondary';privateBalances.textContent='Lenz funds';
 $('#wallet-panel-tokens').append(privateBalances);
 privateBalances.onclick=()=>{account.showModal();$('#wallet-private-balances').scrollIntoView({block:'start'});($('#private-connect').hidden?$('#private-refresh'):$('#private-connect')).focus();};
 $('#evm-connect-dialog').addEventListener('close',()=>{if(wallet.snapshot&&account.open){wallet.cancelPrivateRead();account.close();}});
 const contacts=utilityDialog('wallet-contacts','People',[$('.wallet-people')]);
 const utilities=document.createElement('div');utilities.className='wallet-utilities';heroSummary.before(utilities);
 for(const [id,label,path,dialog] of [['wallet-activity','Activity','M3 12a9 9 0 1 0 3-6M3 3v5h5M12 7v5l3 2',activity],['wallet-account','Wallet account','M4 6h15v14H4zM4 6V4h13M15 11h6v5h-6z',account]]){
  const button=document.createElement('button');button.id=id;button.type='button';iconButton(button,label,path);utilities.append(button);button.onclick=()=>{dialog.showModal();if(dialog===activity)void paintNativeHistory();};
 }
 const peopleButton=document.createElement('button');peopleButton.id='wallet-send-contacts';peopleButton.type='button';iconButton(peopleButton,'People','M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8M17 4a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87');
 $('.send-address').append(peopleButton);peopleButton.onclick=()=>contacts.showModal();
 $('#wallet-settings-actions').append($('#show-card'),$('.account-settings'));
 $('.wallet-lower').hidden=true;
 $('.near-activity').id='wallet-payments';$('.wallet-people').id='wallet-people-section';
 iconButton($('#near-refresh'),'Refresh payments','M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
 iconButton($('#evm-refresh'),'Refresh balance','M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
 const names=['tokens','defi','nfts'];
 function select(name,{focus=false,remember=false}={}){
  if(name==='nfts'){showComingSoon($('#wallet-tab-nfts'));return;}
  for(const item of names){
   const button=$('#wallet-tab-'+item),active=item===name;
   button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;
   $('#wallet-panel-'+item).hidden=!active;
  }
  if(remember&&location.hash!=='#'+name)history.pushState(history.state,'','#'+name);
  if(focus)$('#wallet-tab-'+name).focus();
 }
 for(const [index,name] of names.entries()){
  const button=$('#wallet-tab-'+name);
  button.onclick=()=>select(name,{remember:true});
  button.onkeydown=event=>{
   const next={ArrowRight:(index+1)%3,ArrowLeft:(index+2)%3,Home:0,End:2}[event.key];
   if(next===undefined)return;
   event.preventDefault();select(names[next],{focus:true,remember:true});
  };
 }
 function fromLocation(){
  const hash=location.hash.slice(1),aliases={'wallet-tokens':'tokens','rhea-wallet':'defi','wallet-payments':'tokens','wallet-people-section':'tokens'};
  select(names.includes(hash)?hash:Object.hasOwn(aliases,hash)?aliases[hash]:'tokens');
  if(hash!=='wallet-payments'&&activity.open)activity.close();
  if(hash!=='wallet-people-section'&&contacts.open)contacts.close();
  if(hash==='rhea-wallet')$('#wallet-defi-positions').open=true;
  if(hash==='wallet-payments'&&!activity.open){activity.showModal();void paintNativeHistory();}
  if(hash==='wallet-people-section'&&!contacts.open)contacts.showModal();
 }
 addEventListener('hashchange',fromLocation);addEventListener('popstate',fromLocation);fromLocation();
 function openSwap(){select('defi',{remember:true});$('#wallet-defi-positions').open=true;[...document.querySelectorAll('.defi-tabs button')].find(button=>button.textContent==='Swap')?.click();$('#rhea-open').click();}
 return {openSwap,render(hasIdentity,{offlineOwned=null}={}){offline.hidden=!hasIdentity||offlineOwned===null||BigInt(offlineOwned)<=0n;}};
}
