import {prepareOrder,checkedOrderAction,checkedOrderReview,orderAmount,requireOrder as check} from './hyperliquid-order.js';
import {readTradingAccount,readTradingOrder,submitTradingAction} from './hyperliquid-trading.js';
import {reserveOrderAttempt,recordOrderState,updateHyperOrders,recoverExpiredApproval} from './hyperliquid-order-store.js';

export async function executeTradingOrder(review,lease,{current=()=>true,read=readTradingAccount,submit=submitTradingAction}={}){
  review=checkedOrderReview(review);
  lease.assertCurrent();check(current()&&lease.identity.address===review.account,'Wallet or order changed. Review again.');
  async function recheck(){
    const snapshot=await read({...review.market,quote:{index:review.market.quoteIndex,symbol:review.market.quote}},review.account);
    const fresh=prepareOrder(snapshot.market,review.account,{side:review.side,size:review.size,price:review.price,reduceOnly:review.reduceOnly},snapshot.funds,{now:review.nonce,cloid:review.action.orders[0].c});
    check(JSON.stringify(fresh.action)===JSON.stringify(review.action)&&fresh.leverage===review.leverage&&fresh.marginMode===review.marginMode&&fresh.fee===review.fee&&orderAmount(fresh.spend)<=orderAmount(review.spend)&&Date.now()<review.expiresAt,'Market, margin or fees changed. Review again.');
    lease.assertCurrent();check(current(),'Order closed. Review again.');
  }
  await recheck();
  lease.assertCurrent();check(current(),'Order closed. Review again.');
  const attempt=await reserveOrderAttempt(review);let dispatched=false;
  try{
    lease.assertCurrent();check(current()&&Date.now()<review.expiresAt,'Order closed or expired. Nothing sent.');
    const signature=await lease.signHyperliquid(review.action,review.nonce,review.expiresAt);
    await recheck();
    lease.assertCurrent();check(current()&&Date.now()<review.expiresAt,'Order closed or expired. Nothing sent.');
    await recordOrderState(attempt.id,'submitting');lease.assertCurrent();check(current()&&Date.now()<review.expiresAt,'Order closed or expired. Nothing sent.');
    dispatched=true;
    const result=await submit(review.action,review.nonce,review.expiresAt,signature);
    const statuses=result?.response?.data?.statuses;
    if(result?.response?.type==='order'&&Array.isArray(statuses)&&statuses.length===1&&typeof statuses[0]?.error==='string'){
      await recordOrderState(attempt.id,'rejected');return 'rejected';
    }
    await recordOrderState(attempt.id,'unknown');return 'unknown';
  }catch(error){await recordOrderState(attempt.id,dispatched?'unknown':'not_sent');throw error;}
}
export async function refreshTradingOrder(row){
  const saved=await recoverExpiredApproval(row.id);
  if(saved.state==='not_sent')return {state:'not_sent',remaining:row.review.size,filled:'0',oid:null};
  const result=await readTradingOrder(row.review);
  // A missing lookup cannot establish that an interrupted submission never arrived.
  if(result.state!=='unknown'){const current=await recordOrderState(row.id,result.state,result);return current.observation??result;}
  return result;
}
export async function cancelTradingOrder(row,lease,{current=()=>true}={}){
  row={...row,review:checkedOrderReview(row.review)};
  lease.assertCurrent();check(lease.identity.address===row.review.account&&current(),'Reconnect the order wallet.');
  const observed=await refreshTradingOrder(row);check(observed.state==='open','This order is no longer open. Refresh its status.');
  lease.assertCurrent();check(current(),'Cancellation closed.');
  const action=checkedOrderAction({type:'cancelByCloid',cancels:[{asset:row.review.market.asset,cloid:row.id}]}),nonce=Date.now(),expires=nonce+60000;
  await updateHyperOrders((rows,nonces)=>{const saved=rows.find(o=>o.id===row.id);check(saved,'Saved order is missing.');check(nonce>(nonces[row.review.account]??0),'Another request was just prepared. Review this cancellation again.');nonces[row.review.account]=nonce;saved.cancelRequestedAt=nonce;});
  lease.assertCurrent();check(current()&&Date.now()<expires,'Cancellation closed or expired.');
  const signature=await lease.signHyperliquid(action,nonce,expires);lease.assertCurrent();check(current()&&Date.now()<expires,'Cancellation closed or expired.');
  await submitTradingAction(action,nonce,expires,signature);
  return refreshTradingOrder(row);
}
