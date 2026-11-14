import {PERP_ICONS} from './perp-icons.js';
import {EVM_MARKETS} from './evm-markets.js';
import {tokenImageURL} from './token-market.js';
const local=new Set(['BTC','ETH','USDC','USDT','SOL','LINK','AAVE','UNI','DAI','DOGE','AVAX','BNB','ZEC','WBTC']);
export function assetIcon({symbol='',contract=null,network=null,image=null,trusted=false,venue=null}={}){
 const node=document.createElement('span');node.className='asset-icon';node.setAttribute('aria-hidden','true');
 const known=contract&&Object.entries(EVM_MARKETS).filter(([key,n])=>!network||n.chainId===network||key===network).flatMap(([,n])=>n.tokens).find(t=>t.id===contract);
 const ticker=known?.symbol??(trusted?symbol:null),file=ticker==='WETH'?'ETH':ticker;
 const remote=tokenImageURL(image),source=venue==='hyperliquid'&&Object.hasOwn(PERP_ICONS,symbol)?PERP_ICONS[symbol]:file&&local.has(file)?'/asset-icons/'+file.toLowerCase()+'.svg':file&&['NEAR','HYPE'].includes(file)?PERP_ICONS[file]:remote?'/api/asset-image?url='+encodeURIComponent(remote):null;
 if(source==='/asset-icons/sol.svg')node.classList.add('asset-icon-sol');
 let color=0;for(const c of String(network??'')+String(contract??symbol))color=(color*31+c.charCodeAt(0))>>>0;
 node.style.setProperty('--asset-hue',String(color%360));node.textContent=String(symbol).replace(/[^a-z0-9]/gi,'').slice(0,2).toUpperCase()||'?';node.title='Logo unavailable';
 if(source){const fallback=node.textContent,img=document.createElement('img');img.alt='';img.width=32;img.height=32;img.decoding='async';img.loading='lazy';img.referrerPolicy='no-referrer';img.onload=()=>{node.title=symbol;};img.onerror=()=>{node.textContent=fallback;node.title='Logo unavailable';};img.src=source;node.replaceChildren(img);}
 return node;
}
export function assetLabel(symbol,options={}){const label=document.createElement('span');label.className='asset-label';label.append(assetIcon({symbol,...options}),document.createTextNode(symbol));return label;}
