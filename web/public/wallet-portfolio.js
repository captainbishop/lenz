import {iconButton,walletIcon} from './wallet-actions.js';

const $=selector=>document.querySelector(selector);

// Reuse the mounted wallet controls so changing views never changes authority or funds.
export function mountWalletPortfolio(walletSession){
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
 $('#wallet-panel-tokens').append($('#wallet-tokens'));
 const offline=document.createElement('section');offline.className='wallet-offline-token';
 offline.innerHTML='<div><strong>tUSD</strong><small>Offline test dollars · Lenz ID</small></div><div id="wallet-offline-controls"></div>';
 $('#wallet-panel-tokens').prepend(offline);
 for(const name of ['send','receive']){
  const original=$('#near-'+name),button=document.createElement('button');button.type='button';button.id='wallet-'+name;button.innerHTML=original.innerHTML;button.setAttribute('aria-label',name==='send'?'Send':'Receive');
  original.before(button);$('#wallet-offline-controls').append(original);
  button.onclick=()=>openAssets(name);
 }
 $('.balance-label>span').textContent='Offline tUSD';
 $('.wallet-receiving>.quiet').textContent='Receives test dollars (tUSD) only. Confirmed payments are public on the NEAR test network. Do not send ETH or SOL here.';
 const picker=document.createElement('dialog');picker.id='wallet-asset-dialog';picker.setAttribute('aria-labelledby','wallet-asset-title');
 picker.innerHTML='<div class="dialog-top"><h2 id="wallet-asset-title">Receive asset</h2><button id="wallet-asset-close" type="button" class="secondary wallet-close"></button></div><div id="wallet-asset-options"></div>';
 document.body.append(picker);iconButton($('#wallet-asset-close'),'Close','m6 6 12 12M18 6 6 18');$('#wallet-asset-close').onclick=()=>picker.close();
 let assetAction='receive',resumeConnection=null;
 function openAssets(name){
  assetAction=name;$('#wallet-asset-title').textContent=name==='send'?'Send asset':'Receive asset';paintAssets();picker.showModal();
 }
 function assetOption(name,detail,target,disclosure){
  const button=document.createElement('button'),info=document.createElement('span'),title=document.createElement('strong'),caption=document.createElement('small'),privacy=document.createElement('small');
  button.type='button';title.textContent=name;caption.textContent=detail;privacy.textContent=disclosure;info.append(title,caption,privacy);button.append(info);button.insertAdjacentHTML('beforeend',walletIcon('m9 5 7 7-7 7'));button.disabled=target.disabled;
  button.onclick=()=>{picker.close();target.click();};$('#wallet-asset-options').append(button);
 }
 function paintAssets(){
  $('#wallet-asset-options').replaceChildren();
  assetOption('tUSD','Lenz ID · Offline test dollars',$('#near-'+assetAction),'Public settlement');
  if(!$('#evm-account').hidden){
   const symbol=$('#evm-balance').nextElementSibling.textContent,network=$('#evm-network').textContent;
   assetOption(symbol,network+' · Wallet address',$('#evm-'+assetAction),'Public network');
  }else{
   const button=document.createElement('button'),label=document.createElement('span');button.type='button';label.textContent='Connect wallet';button.append(label);button.insertAdjacentHTML('beforeend',walletIcon('m9 5 7 7-7 7'));button.disabled=$('#evm-connect').disabled;
   button.onclick=()=>{resumeConnection=assetAction;picker.close();$('#evm-connect').click();};$('#wallet-asset-options').append(button);
  }
 }
 addEventListener('lenz-evm-session',()=>{
  if(picker.open)paintAssets();
  if(resumeConnection&&!$('#evm-account').hidden){const name=resumeConnection;resumeConnection=null;openAssets(name);}
 });
 $('#evm-connect-dialog').addEventListener('close',()=>{if($('#evm-account').hidden)resumeConnection=null;});
 new MutationObserver(()=>{if(picker.open)paintAssets();}).observe($('#wallet-offline-controls'),{subtree:true,attributes:true,attributeFilter:['disabled']});
 $('#wallet-tokens h2').textContent='Watched tokens';
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
  $('.wallet-markets').append(link);
 }
 for(const [id,label,node] of [['wallet-payment-history','Payments',$('.near-activity')],['wallet-contacts','People',$('.wallet-people')]]){
  const fold=document.createElement('details');fold.id=id;fold.className='wallet-fold';
  const summary=document.createElement('summary');summary.textContent=label;
  node.before(fold);fold.append(summary,node);
 }
 $('.near-activity').id='wallet-payments';$('.wallet-people').id='wallet-people-section';
 iconButton($('#near-refresh'),'Refresh payments','M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
 iconButton($('#evm-refresh'),'Refresh balance','M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3');
 const names=['tokens','defi','nfts'];
 function select(name,{focus=false,remember=false}={}){
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
  const folds={'rhea-wallet':'wallet-defi-positions','wallet-payments':'wallet-payment-history','wallet-people-section':'wallet-contacts'},fold=Object.hasOwn(folds,hash)?folds[hash]:null;
  if(fold)$('#'+fold).open=true;
 }
 addEventListener('hashchange',fromLocation);addEventListener('popstate',fromLocation);fromLocation();
 return {render(hasIdentity){
  offline.hidden=!hasIdentity;
  const wallet=$('#connected-wallet');
  // Connecting an external wallet is still available before creating a Lenz profile.
  if(hasIdentity||!!walletSession.snapshot){if(wallet.parentElement!==$('#wallet-panel-tokens'))$('#wallet-panel-tokens').prepend(wallet);}
  else if(wallet.parentElement!==$('#wallet-onboarding').parentElement)$('#wallet-onboarding').before(wallet);
 }};
}
