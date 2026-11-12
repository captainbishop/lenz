import {readState} from './chat-store.js';
import {readFinancialReview} from './financial-reconciliation-read.js';
import {mergeFinancialReviews,financialConflicts} from './financial-reconciliation.js';
import {savedFinancialReview,saveFinancialReview,financialReviewFile,mergeFinancialReviewFile} from './financial-reconciliation-store.js';
import {walletAmount} from './wallet-visibility.js';
const root=document.createElement('section');root.id='financial-review';root.className='financial-review';root.setAttribute('aria-labelledby','financial-review-title');
root.innerHTML='<div class="financial-heading"><div><h2 id="financial-review-title" tabindex="-1">Financial recovery</h2><p>Spending recovery is incomplete. Keep unresolved records.</p></div><span class="financial-state">Review only</span></div><div class="financial-actions"><button id="financial-read" type="button" class="primary">Read retained records</button><button id="financial-reopen" type="button">Open saved review</button><button id="financial-cancel" type="button" hidden>Clear review</button></div><p id="financial-status" role="status" aria-live="polite"></p><details id="financial-error-details" hidden><summary>Details</summary><p id="financial-error"></p></details><div id="financial-content" hidden><div class="financial-saved"><p id="financial-date"></p><button id="financial-save" type="button">Save review</button></div><div id="financial-rows"></div><details class="financial-gaps"><summary id="financial-gap-summary">Missing evidence</summary><ul id="financial-gaps"></ul></details></div><details class="financial-files"><summary>Review files</summary><p class="financial-note">Encrypted files need the same Lenz account keys. Keep your account backup separately.</p><button id="financial-download" type="button" disabled>Download review</button><label class="financial-file" for="financial-file">Open encrypted review<input id="financial-file" type="file" accept=".json,application/json"></label></details>';
document.querySelector('main').append(root);
const $=s=>root.querySelector(s),el=(tag,text)=>{const n=document.createElement(tag);n.textContent=text;return n;};
let review=null,generation=0,controller=null;
const gapNames={'canonical-funding':'Independent funding state','canonical-outcomes':'Independent execution and refund outcomes','executor-journals':'Executor submission history','other-devices':'Other devices and older copies','spending-epochs':'Spending epochs and revocation','financial-keys':'Financial signing key recovery','zcash':'Zcash wallet restore and rescan','unsupported-venues':'Other venues and authorization stores','bounded-budgets':'Bounded offline budget history',private:'Private approvals',evm:'Public wallet journals',near:'Offline test-dollar wallet',rhea:'Reserved test-dollar swaps',prototype:'Earlier prototype reservations',hyperliquid:'Hyperliquid order history'};
const reason={unavailable:'Unavailable',invalid:'Unreadable or invalid',excluded:'Excluded by chat recovery','no-retained-records':'No records retained here'};
function quantity(row){
 const decimals=row.domain==='evm'&&row.asset.endsWith('/native')&&['eip155:1','eip155:42161','eip155:8453'].includes(row.scope)?18:['near','rhea'].includes(row.domain)?6:null;
 if(decimals!==null){const digits=row.quantity.padStart(decimals+1,'0'),part=digits.slice(-decimals).replace(/0+$/,'');return digits.slice(0,-decimals)+(part?'.'+part:'')+(decimals===18?' ETH':' tUSD (test)');}
 return ['hyperliquid','prototype'].includes(row.domain)?row.quantity+' units':'Amount retained';
}
function stateLabel(row){
 if(row.state.startsWith('Conflicting chain observation'))return 'Conflicting spend reported. Input stays unavailable.';
 if(row.domain==='rhea')return 'Input remains reserved.';
 if(row.domain==='prototype')return 'Demo input remains reserved.';
 if(row.kind.includes('funding')||row.kind.includes('Funding'))return 'Funding outcome unverified.';
 if(row.domain==='private')return row.state.startsWith('Provider')?'Provider update retained. Settlement unverified.':'Approval retained. Outcome unverified.';
 if(row.domain==='hyperliquid')return row.kind.includes('cancellation')?'Cancellation outcome unverified.':'Order status unverified.';
 return 'Transfer outcome unverified.';
}
function clear(message=''){
 generation++;controller?.abort();controller=null;review=null;$('#financial-content').hidden=true;$('#financial-rows').replaceChildren();$('#financial-gaps').replaceChildren();$('#financial-file').value='';$('#financial-status').textContent=message;$('#financial-error-details').hidden=true;$('#financial-error').textContent='';buttons(false);
}
function buttons(busy){for(const id of ['read','reopen','save','download'])$('#financial-'+id).disabled=busy||(['save','download'].includes(id)&&!review);$('#financial-file').disabled=busy;$('#financial-cancel').textContent=busy?'Cancel':'Clear review';$('#financial-cancel').hidden=!busy&&!review;}
function render(){
 const conflicts=new Set(financialConflicts(review));$('#financial-content').hidden=false;$('#financial-date').textContent=`Retained review · ${new Date(review.createdAt).toLocaleString()} · ${review.rows.length} records`;
 const list=$('#financial-rows');list.replaceChildren();
 if(!review.rows.length)list.append(el('p','No financial records were found in the readable stores. Missing evidence stays unresolved.'));
 for(const row of review.rows){
  const article=el('article','');article.className='financial-row';
  const heading=el('div','');heading.className='financial-row-heading';heading.append(el('h3',row.kind),walletAmount(el('span',''),quantity(row)));article.append(heading,el('p',(['near','rhea','prototype'].includes(row.domain)?'No cash value. ':'')+(conflicts.has(row.evidenceDigest)?'Conflicting records. Keep every copy.':stateLabel(row))));
  const detail=el('details',''),summary=el('summary','Details'),dl=el('dl','');detail.append(summary,dl);
  for(const [name,value] of [['Asset',row.asset],['Quantity',row.quantity+(['hyperliquid','prototype'].includes(row.domain)?' units':' base units')],['Recorded state',row.state],['Owner',row.owner],['Authority domain',row.scope],['Nonce',row.nonce||'Not retained'],['Reserved input',row.input||'Not applicable'],['Destination',row.destination],['Observed',new Date(row.observedAt).toLocaleString()],['Terms digest',row.bindingDigest],['Evidence digest',row.evidenceDigest]]){const dd=el('dd',value);if(name==='Quantity'||name==='Destination'&&['private','rhea','hyperliquid'].includes(row.domain))walletAmount(dd,value);dl.append(el('dt',name),dd);}
  if(['evm','hyperliquid'].includes(row.domain))detail.append(el('p','Device journal. This wallet owner has no verified binding to the Lenz ID.'));
  article.append(detail);list.append(article);
 }
 $('#financial-gap-summary').textContent=`Missing evidence · ${new Set(review.gaps.map(gap=>gap.domain)).size}`;
 $('#financial-gaps').replaceChildren(...review.gaps.map(gap=>el('li',`${gapNames[gap.domain]}: ${reason[gap.reason]}.`)));
}
async function run(message,operation){
 controller?.abort();controller=new AbortController();const signal=controller.signal,own=++generation;buttons(true);$('#financial-status').textContent=message;$('#financial-error-details').hidden=true;$('#financial-error-details').open=false;$('#financial-error').textContent='';
 try{const result=await operation(signal);signal.throwIfAborted();if(own!==generation)return;review=result;render();}
 catch(error){if(own===generation){$('#financial-status').textContent='This review could not be opened or saved. Keep your existing records.';$('#financial-error').textContent=error.message;$('#financial-error-details').hidden=false;}}
 finally{if(own===generation){buttons(false);controller=null;}}
}
$('#financial-read').onclick=()=>run('Reading retained records…',async signal=>{
 const next=await readFinancialReview({signal}),saved=await savedFinancialReview({signal});let result=saved?mergeFinancialReviews(saved,next):next;if(review)result=mergeFinancialReviews(review,result);$('#financial-status').textContent='Retained evidence read.';return result;
});
$('#financial-reopen').onclick=()=>run('Opening saved review…',async signal=>{const saved=await savedFinancialReview({signal});if(!saved)throw Error('No review is saved for this Lenz account.');$('#financial-status').textContent='Saved review opened.';return review?mergeFinancialReviews(saved,review):saved;});
$('#financial-save').onclick=()=>run('Saving encrypted review…',async signal=>{const result=await saveFinancialReview(review,{signal});$('#financial-status').textContent='Encrypted review saved on this device.';return result;});
$('#financial-download').onclick=()=>run('Encrypting review…',async signal=>{
 const archive=await financialReviewFile(review,{signal});signal.throwIfAborted();const url=URL.createObjectURL(new Blob([JSON.stringify(archive)],{type:'application/json'})),a=el('a','');a.href=url;a.download='lenz-financial-review.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);$('#financial-status').textContent='Download requested. Open the saved file to check it.';return review;
});
$('#financial-file').onchange=()=>{const file=$('#financial-file').files[0];if(file)run('Checking encrypted review…',async signal=>{const result=await mergeFinancialReviewFile(file,review,{signal});$('#financial-file').value='';$('#financial-status').textContent='File merged for review. No spending authority restored.';return result;});};
$('#financial-cancel').onclick=()=>clear();
addEventListener('pagehide',()=>clear());document.addEventListener('visibilitychange',()=>{if(document.hidden)clear();});addEventListener('keydown',event=>{if(event.key==='Escape')clear();});
addEventListener('lenz-account-changed',()=>clear('Account changed. Read the retained records again.'));
const channel=typeof BroadcastChannel==='function'?new BroadcastChannel('proof-u-chat-refresh'):null;
channel?.addEventListener('message',()=>clear('Account data changed. Read the retained records again.'));
addEventListener('focus',async()=>{const own=generation,current=review;if(!current)return;try{if((await readState()).identity?.profile.id!==current.identity&&generation===own)clear('Lenz account changed. Read the retained records again.');}catch{if(generation===own)clear('Could not check the current Lenz account.');}});
if(location.hash==='#financial-review')$('#financial-review-title').focus();
