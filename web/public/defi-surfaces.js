import {CHAINS} from './defi-catalog.js';
import {mountLendingPosition} from './lending-position-ui.js';
const el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
const actions={
  Supply:{title:'Supply assets',purpose:'Deposit into a lending market to earn variable interest.',state:'Deposits unavailable',missing:'Balances, current rates and deposit execution are not connected.',review:'Asset and amount · Current rate · Fees · Withdrawal terms'},
  Borrow:{title:'Borrow assets',purpose:'Borrow against eligible collateral.',state:'Borrowing unavailable',missing:'Your collateral, borrowing capacity and loan execution are not connected.',review:'Collateral · Available credit · Interest · Liquidation risk'},
  Repay:{title:'Repay a loan',purpose:'Reduce an existing debt.',state:'Repayment unavailable',missing:'Repayments are not available in Lenz yet.',review:'Loan · Outstanding debt · Repayment amount · Fees'},
  Withdraw:{title:'Withdraw assets',purpose:'Return assets from an existing position to your wallet.',state:'Withdrawals unavailable',missing:'Withdrawals are not available in Lenz yet.',review:'Position · Available amount · Exit fees · Receiving wallet'},
  Liquidity:{title:'Add liquidity',purpose:'Put assets into a pool to earn a share of trading fees.',state:'Liquidity deposits unavailable',missing:'Balances, deposit quotes and LP execution are not connected.',review:'Pool assets and amounts · Price range · Fees · Withdrawal terms'},
  Stake:{title:'Stake assets',purpose:'Commit assets to a staking provider for rewards.',state:'Staking unavailable',missing:'Staking rates, positions and execution are not connected.',review:'Asset · Provider · Rewards · Unstaking delay'},
  Farm:{title:'Farm rewards',purpose:'Deposit an eligible position into a rewards program.',state:'Farming unavailable',missing:'Eligible positions, rewards and farm execution are not connected.',review:'Position · Program · Rewards · Exit conditions'},
  Claims:{title:'Claim rewards',purpose:'Collect rewards earned by your positions.',state:'Claims unavailable',missing:'Claimable rewards and claim execution are not connected.',review:'Position · Claimable assets · Fees · Receiving wallet'},
};
export function positionSurface(action,{venue,asset}={}){
  const info=actions[action]??actions.Withdraw;
  const surface=el('section',undefined,'position-surface');surface.dataset.action=action;
  const top=el('div',undefined,'position-heading');top.append(el('h3',info.title),el('span',venue??'Private execution required'));surface.append(top,el('p',info.purpose,'position-purpose'));
  const state=el('div',undefined,'position-unavailable');state.append(el('strong',info.state),el('p',info.missing));surface.append(state);
  const help=el('details',undefined,'position-help');help.append(el('summary','What you’ll review'),el('p',info.review));surface.append(help);
  return surface;
}
export function creditSurface(row){
  const surface=el('section',undefined,'credit-surface'),top=el('div',undefined,'credit-heading');
  top.append(el('div',row.assets[0].symbol,'credit-asset'),el('span','AAVE V3 / '+CHAINS[row.chainId].name.toUpperCase()));surface.append(top);
  const reserve=el('details',undefined,'credit-reserve');reserve.append(el('summary','Collateral limits'));
  const limits=el('div',undefined,'credit-limits');for(const [label,bps]of [['Loan to value',row.ltvBps],['Liquidation threshold',row.liquidationThresholdBps]]){const stat=el('div');stat.append(el('strong',(bps/100)+'%'),el('span',label));limits.append(stat);}reserve.append(limits);
  const ruler=el('div',undefined,'credit-ruler');ruler.setAttribute('role','img');ruler.setAttribute('aria-label',`Reserve limits: ${row.ltvBps/100}% LTV; ${row.liquidationThresholdBps/100}% liquidation threshold. Not account borrowing capacity.`);
  for(const [name,bps]of [['ltv',row.ltvBps],['liquidation',row.liquidationThresholdBps]]){const marker=el('span',undefined,'credit-marker '+name);marker.style.left=bps/100+'%';ruler.append(marker);}reserve.append(ruler);
  const scale=el('div',undefined,'credit-scale');scale.append(el('span','0%'),el('span','Reserve limits'),el('span','100%'));reserve.append(scale,el('p','These reserve limits do not establish your borrowing capacity.','surface-note'));
  const nav=el('nav',undefined,'position-actions');nav.setAttribute('aria-label','Credit actions');const area=el('div');let position;
  for(const action of ['Supply','Borrow','Repay','Withdraw']){const button=el('button',action);button.type='button';button.setAttribute('aria-pressed',String(action==='Supply'));button.onclick=()=>{for(const b of nav.children)b.setAttribute('aria-pressed',String(b===button));area.replaceChildren(positionSurface(action,{venue:'Aave · '+CHAINS[row.chainId].name,asset:row.assets[0].symbol}));position?.selectAction(action);};nav.append(button);}
  area.append(positionSurface('Supply',{venue:'Aave · '+CHAINS[row.chainId].name,asset:row.assets[0].symbol}));surface.append(nav,area);position=mountLendingPosition(surface,row);surface.append(reserve);return surface;
}
export function poolSurface(row){
  const surface=el('section',undefined,'pool-surface'),pair=el('div',undefined,'pool-pair');
  pair.append(el('strong',row.assets[0].symbol),el('span','UNISWAP V3 / '+CHAINS[row.chainId].name.toUpperCase()),el('strong',row.assets[1].symbol));surface.append(pair);
  const fee=el('div',undefined,'pool-fee');fee.append(el('strong',row.feePips/10000+'%'),el('span','Pool fee'),el('small',row.status==='liquidity-observed'?'Liquidity observed':'Liquidity unavailable'));surface.append(fee,positionSurface('Liquidity',{venue:'Range / fees',asset:row.assets.map(a=>a.symbol).join(' / ')}));return surface;
}
