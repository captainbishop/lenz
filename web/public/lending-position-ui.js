import {createWalletSession} from './evm-wallet.js';
import {CHAINS} from './defi-catalog.js';
import {readState} from './chat-store.js';
import {readLendingPosition,reviewLendingPosition} from './lending-position.js';
import {savedLendingPositions,saveLendingPosition,lendingOwner} from './lending-position-store.js';
import {iconButton} from './wallet-actions.js';

const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const button=(text,fn)=>{const b=el('button',text);b.type='button';b.onclick=fn;return b;};
let wallet=null,picker=null,active=null;
function session(){
 if(wallet)return wallet;
 wallet=createWalletSession({changed:()=>active?.walletChanged()});picker=el('dialog',undefined,'lending-position-dialog');picker.setAttribute('aria-labelledby','lending-wallet-title');
 const title=el('h2','Connect wallet');title.id='lending-wallet-title';const top=el('div',undefined,'lending-wallet-top'),choices=el('div',undefined,'lending-wallet-options'),status=el('p'),close=button('',()=>{if(wallet.pending)wallet.disconnect();picker.close();});status.setAttribute('role','status');status.setAttribute('aria-live','polite');
 iconButton(close,'Close','m6 6 12 12M18 6 6 18');top.append(title,close);const details=el('details'),summary=el('summary','What connecting allows');details.append(summary,el('p','Lenz can read your address and reserve position. Your wallet provider sees the account and asset. Connecting needs no signature and gives no permission to spend.'));
 picker.append(top,el('p','Connect to see your Aave position.'),choices,status,details);document.body.append(picker);
 const providers=[];
 function add(provider,name){
  if(providers.length>=12||providers.includes(provider)||!provider||['request','on','removeListener'].some(k=>typeof provider[k]!=='function'))return;
  providers.push(provider);const choice=button('',async()=>{if(wallet.pending)return;for(const b of choices.children)b.disabled=true;status.textContent='Check your wallet…';try{await wallet.connect(provider);picker.close();}catch{status.textContent='Could not connect. Choose Ethereum, Arbitrum or Base in your wallet and try again.';}finally{for(const b of choices.children)b.disabled=false;}});choice.append(el('span',name));const arrow=el('span',undefined,'lending-wallet-arrow');arrow.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m9 5 7 7-7 7"/></svg>';choice.append(arrow);choices.append(choice);
 }
 addEventListener('eip6963:announceProvider',event=>{const {info,provider}=event.detail??{};if(typeof info?.name==='string'&&info.name.trim()&&info.name.length<=80&&!/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/.test(info.name))add(provider,info.name.trim());});
 picker.addEventListener('cancel',()=>{if(wallet.pending)wallet.disconnect();});picker.addEventListener('close',()=>{if(wallet.pending)wallet.disconnect();});
 const leave=()=>{wallet.disconnect('Reconnect your wallet to read a current position.');if(picker.open)picker.close();};addEventListener('pagehide',leave);addEventListener('pageshow',event=>{if(event.persisted)leave();});
 session.open=()=>{status.textContent='';dispatchEvent(new Event('eip6963:requestProvider'));if(!providers.length){try{add(window.ethereum,'Browser wallet');}catch{}}if(!choices.children.length)status.textContent='Open Lenz in a browser with your wallet installed.';picker.showModal();};return wallet;
}
export function mountLendingPosition(target,row){
 const key=row.chainId+':'+row.assets[0].id;if(active?.key===key){target.append(active.element);return active;}
 active?.dispose();const wallet=session(),root=el('section',undefined,'lending-position');root.setAttribute('aria-label','Your selected reserve position');target.append(root);
 const top=el('div',undefined,'lending-position-heading'),connect=button('Connect wallet',()=>session.open()),disconnect=button('Disconnect',()=>wallet.disconnect());top.append(el('h4','Your '+row.assets[0].symbol+' position'),connect,disconnect);
 const identity=el('p',undefined,'lending-position-identity'),savedLabel=el('label','Saved wallet'),savedSelect=el('select');savedSelect.setAttribute('aria-label','Saved lending wallet');savedLabel.append(savedSelect);
 const figures=el('dl',undefined,'lending-position-values'),time=el('p',undefined,'lending-position-time'),read=button('Load position',()=>load()),status=el('p',undefined,'lending-position-status');status.setAttribute('role','status');
 const source=el('details',undefined,'lending-position-source');source.append(el('summary','Details'));const sourceText=el('div');source.append(sourceText);
 const controls=el('div',undefined,'lending-position-controls');controls.append(read);const reviewForm=el('form',undefined,'lending-position-review'),action=el('select');action.setAttribute('aria-label','Position review action');action.append(new Option('Repay variable debt','Repay'),new Option('Withdraw supplied assets','Withdraw'));
 const amount=el('input');amount.inputMode='decimal';amount.autocomplete='off';amount.maxLength=80;amount.placeholder='Amount';amount.setAttribute('aria-label','Position review amount');const review=el('button','Review amount');review.type='submit';reviewForm.append(action,amount,review);const reviewText=el('p',undefined,'lending-position-review-note');
 root.append(top,identity,savedLabel,figures,time,controls,status,source,reviewForm,reviewText,el('p','Public position. Review only. Repay and Withdraw are unavailable; current availability, fees and health need fresh checks.','lending-position-note'));
 let generation=0,owner=null,value=null,savedRows=[],selected='',busy=false,historical=true,savedObservation=false,disposed=false,saveController=null;
 const current=()=>!disposed&&!document.hidden&&root.isConnected&&!root.closest('[hidden]');
 function paint(){
  const account=wallet.snapshot?.address;connect.hidden=!!account;connect.disabled=wallet.pending||!navigator.onLine;disconnect.hidden=!account&&!wallet.pending;
  const shortAccount=address=>address.slice(0,8)+'…'+address.slice(-4);
  identity.textContent=account?shortAccount(account)+' · '+wallet.snapshot.network.name:value?shortAccount(value.account)+' · '+CHAINS[row.chainId].name:'Connect to read your position, or choose a saved wallet.';
  const options=savedRows.filter(r=>r.chainId===row.chainId&&r.asset.id===row.assets[0].id);savedLabel.hidden=!!account||!options.length;
  savedSelect.replaceChildren(new Option('Choose a saved wallet',''));for(const r of options)savedSelect.append(new Option(r.account,r.account));savedSelect.value=selected;
  const chain=wallet.snapshot&&'eip155:'+BigInt(wallet.snapshot.chainId);read.disabled=busy||!navigator.onLine||!account||chain!==row.chainId;read.classList.toggle('lending-position-refresh',!!value);read.setAttribute('aria-label',value?'Refresh position':'Load position');read.title=value?'Refresh position':'Load position';if(value)read.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M20 7v5h-5M4 17v-5h5M6 6a8 8 0 0 1 13 3M5 15a8 8 0 0 0 13 3"/></svg>';else read.textContent='Load position';review.disabled=!value||busy;amount.disabled=action.disabled=!value||busy;
  figures.replaceChildren();sourceText.replaceChildren();reviewForm.hidden=!value;source.hidden=!value;
  if(!value){time.textContent=account&&chain!==row.chainId?'Choose '+CHAINS[row.chainId].name+' in your wallet to read this reserve.':'Position not loaded.';return;}
  const masked=hiddenAmounts();for(const [label,text,isAmount]of [['Supplied',value.supplied+' '+value.asset.symbol,true],['Collateral enabled',value.collateral?'Yes':'No',false],['Variable debt',value.variableDebt+' '+value.asset.symbol,true],['Stable debt',value.stableDebtStatus==='supported'?value.stableDebt+' '+value.asset.symbol:value.stableDebtStatus==='unsupported'?'Unsupported by this pool':'Unavailable',value.stableDebtStatus==='supported']]){const cell=el('div');cell.append(el('dt',label),el('dd',masked&&isAmount?'••••':text));figures.append(cell);}
  const earlier=historical||!navigator.onLine||Date.now()-value.observedAt>=120000;time.textContent=(savedObservation?'Saved observation · ':earlier?'Earlier observation · ':'Read · ')+new Date(value.blockTime).toLocaleString();
  for(const [label,text]of [['Wallet',value.account],['Network',CHAINS[row.chainId].name],['Finalized block',BigInt(value.block)+' reported by your wallet provider'],['Asset',value.asset.id],['Pool',value.pool],['Address provider',value.provider],['aToken',value.aToken],['Variable debt token',value.variableDebtToken],['Stable debt token',value.stableDebtToken??'Unsupported / unavailable'],['Block hash',value.blockHash]])sourceText.append(el('p',label+': '+text));
 }
 function hiddenAmounts(){try{return localStorage.getItem('lenz-wallet-balances-hidden')==='true';}catch{return false;}}
 async function saved(){const ticket=++generation,state=await readState(),id=lendingOwner(state),rows=await savedLendingPositions(state),currentOwner=lendingOwner(await readState());if(ticket!==generation||disposed||currentOwner!==id)return;owner=id;savedRows=rows;const account=wallet.snapshot?.address??selected;value=account?rows.find(r=>r.account===account&&r.chainId===row.chainId&&r.asset.id===row.assets[0].id)??null:null;historical=true;savedObservation=!!value;paint();}
 async function load(){
  if(read.disabled||!current())return;const ticket=++generation,lease=wallet.capture(),id=lendingOwner(await readState());if(ticket!==generation||!current())return;owner=id;busy=true;reviewText.textContent='';paint();status.textContent='Reading the finalized reserve position…';
  const valid=()=>ticket===generation&&current()&&wallet.snapshot===lease.identity;
  try{
   const next=await readLendingPosition(lease,row),currentOwner=lendingOwner(await readState());if(!valid())return;if(currentOwner!==id){invalidate();return;}value=next;historical=false;savedObservation=false;status.textContent='Saving position on this device…';paint();
   const controller=new AbortController();saveController=controller;
   try{
    await saveLendingPosition(next,id,()=>valid()&&value===next,{signal:controller.signal});
    const savedOwner=lendingOwner(await readState());if(!valid())return;if(savedOwner!==id){invalidate();return;}
    savedRows=savedRows.filter(r=>r.account!==next.account||r.chainId!==next.chainId||r.asset.id!==next.asset.id);savedRows.push(next);savedObservation=true;status.textContent='Position saved encrypted on this device.';
   }catch{if(valid())status.textContent='Could not save this position. This observation is not available offline.';}
   finally{if(saveController===controller)saveController=null;}
  }
  catch(error){if(valid()){historical=true;status.textContent='Position could not refresh. '+(error instanceof Error?error.message:'Try again.');}}
  finally{if(ticket===generation){busy=false;paint();}}
 }
 savedSelect.onchange=async()=>{const ticket=++generation,account=savedSelect.value,id=owner;selected=account;value=null;reviewText.textContent='';amount.value='';paint();try{const currentOwner=lendingOwner(await readState());if(ticket!==generation||disposed)return;if(currentOwner!==id){invalidate();return;}value=savedRows.find(r=>r.account===account&&r.chainId===row.chainId&&r.asset.id===row.assets[0].id)??null;historical=true;savedObservation=!!value;paint();}catch{if(ticket===generation)status.textContent='Saved positions could not be read.';}};
 reviewForm.onsubmit=async event=>{event.preventDefault();reviewText.textContent='';if(!value)return;const snapshot=value,ticket=generation;try{if(lendingOwner(await readState())!==owner){invalidate();return;}if(ticket!==generation||value!==snapshot||!current())return;const r=reviewLendingPosition(snapshot,{action:action.value,amount:amount.value});reviewText.textContent=hiddenAmounts()?'Amounts hidden. Show balances to read the amount review.':`${r.action==='Repay'?'Repay variable debt':'Withdraw'} ${r.amount} ${snapshot.asset.symbol}. Observed limit: ${r.bound} ${snapshot.asset.symbol}.`;}catch(error){if(ticket===generation)reviewText.textContent=error.message;}};
 const invalidate=()=>{if(disposed)return;saveController?.abort(Error('Account changed. Position was not saved.'));saveController=null;generation++;busy=false;value=null;owner=null;savedRows=[];selected='';reviewText.textContent='';amount.value='';status.textContent='Account changed. Load or choose this account again.';paint();void saved().catch(()=>{if(!disposed)status.textContent='Saved positions could not be read.';});};
 const offline=()=>{saveController?.abort(Error('Connection changed. Position was not saved.'));saveController=null;if(wallet.snapshot||wallet.pending)wallet.disconnect('Offline. Reconnect your wallet when online.');else{generation++;busy=false;historical=true;reviewText.textContent='';paint();}if(picker.open)picker.close();},online=()=>paint();
 const visibility=event=>{if(event.key==='lenz-wallet-balances-hidden'||event.key===null){reviewText.textContent='';paint();}};
 const pageVisibility=()=>{if(document.hidden&&busy){saveController?.abort(Error('Position read interrupted.'));saveController=null;generation++;busy=false;historical=true;reviewText.textContent='';status.textContent='Position read interrupted. Refresh to try again.';}paint();};
 const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('proof-u-chat-refresh'):null;let identityRun=0;
 const checkIdentity=async()=>{const run=++identityRun,id=lendingOwner(await readState());if(!disposed&&run===identityRun&&owner!==null&&owner!==id)invalidate();};channel?.addEventListener('message',()=>void checkIdentity().catch(invalidate));
 addEventListener('lenz-account-identity',invalidate);addEventListener('offline',offline);addEventListener('online',online);addEventListener('storage',visibility);document.addEventListener('visibilitychange',pageVisibility);
 active={key,element:root,walletChanged:invalidate,selectAction(name){if(['Repay','Withdraw'].includes(name)){action.value=name;action.dispatchEvent(new Event('change',{bubbles:true}));reviewText.textContent='';}},dispose(){saveController?.abort(Error('Position review closed.'));saveController=null;disposed=true;generation++;channel?.close();removeEventListener('lenz-account-identity',invalidate);removeEventListener('offline',offline);removeEventListener('online',online);removeEventListener('storage',visibility);document.removeEventListener('visibilitychange',pageVisibility);root.remove();}};
 paint();void saved().catch(()=>{if(!disposed)status.textContent='Saved positions could not be read.';});return active;
}
