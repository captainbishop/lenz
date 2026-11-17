const actions=new Set(['Supply','Borrow','Repay','Withdraw']);
const selected=()=>document.querySelector('.defi-tabs button[aria-pressed="true"]')?.textContent;

export function mountWalletLending(){
 let generation=0,mounted=null,owner=null,disposed=false,pendingSelection=Promise.resolve();
 function clear(){mounted?.dispose();mounted?.element.remove();mounted=null;}
 async function select(action){
  const ticket=++generation;if(!actions.has(action)||disposed){clear();return;}
  // The workspace finishes its synchronous action selection before this view
  // takes over the shared position area.
  await Promise.resolve();
  const target=document.querySelector('#defi-market-state');
  const current=()=>!disposed&&ticket===generation&&selected()===action&&document.querySelector('#defi-market-state')===target;
  if(!target||!current())return;
  if(mounted){target.replaceChildren(mounted.element);mounted.setAction(action);mounted.show(true);target.hidden=false;return;}
  const loading=document.createElement('p');loading.className='quiet';loading.setAttribute('role','status');loading.textContent='Loading lending account…';target.replaceChildren(loading);target.hidden=false;
  try{
   const {mountLendingIntentMarkets}=await import('./intent-lending-markets.js');if(!current())return;
   mounted=mountLendingIntentMarkets(target,{initialAction:action.toLowerCase()});mounted.setAction(action);mounted.show(true);
   // Wallet's compact action menu already controls the selected lending action.
   mounted.element.querySelector('[data-il="actions"]').hidden=true;
   mounted.element.querySelector('.il-wallet').hidden=true;
   const funds=mounted.element.querySelector('.lending-send'),fundsDetails=document.createElement('details');fundsDetails.className='wallet-lending-funds';fundsDetails.innerHTML='<summary>Available to send</summary>';funds.before(fundsDetails);fundsDetails.append(funds);funds.querySelector('h4').hidden=true;
   loading.remove();
  }catch(error){if(current())loading.textContent=error.message||'Lending could not load. Select this action again to retry.';}
 }
 function actionChanged(event){
  const action=event.detail?.action;if(actions.has(action))event.preventDefault();pendingSelection=select(action);
 }
 function accountChanged(){void select(selected());}
 addEventListener('lenz-wallet-position-action',actionChanged);addEventListener('lenz-account-identity',accountChanged);
 const close=()=>{generation++;clear();};addEventListener('pagehide',close);
 async function openFunding(asset){
  if(!['LINK','USDC'].includes(asset)||disposed)return;
  document.querySelector('#wallet-tab-defi')?.click();const positions=document.querySelector('#wallet-defi-positions');if(positions)positions.open=true;
  const action=asset==='LINK'?'Supply':'Repay',button=[...document.querySelectorAll('.defi-tabs button')].find(node=>node.textContent===action);if(!button)return;
  button.click();const ticket=generation;await pendingSelection;if(disposed||ticket!==generation||selected()!==action)return;
  await mounted?.ui.openFunding(asset);
 }
 return Object.freeze({openFunding,render(identity){if(identity===owner)return;owner=identity;clear();void select(selected());},dispose(){disposed=true;close();removeEventListener('lenz-wallet-position-action',actionChanged);removeEventListener('lenz-account-identity',accountChanged);removeEventListener('pagehide',close);}});
}
