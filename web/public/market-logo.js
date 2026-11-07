import {PERP_ICONS} from './perp-icons.js';

const COMMON=Object.freeze({USDC:'/asset-icons/usdc.svg',USDT:'/asset-icons/usdt.svg',DAI:'/asset-icons/dai.svg',WBTC:'/asset-icons/wbtc.svg'});
// Artwork is a display aid. It never decides market identity or trading authority.
export function marketLogo(row){
  const symbol=row.kind==='spot'?row.name.split(' / ')[0]:row.coin.split(':').at(-1),ticker=symbol==='WETH'?'ETH':symbol;
  const source=row.kind==='outcome'?'/market-outcome.svg':Object.hasOwn(PERP_ICONS,ticker)?PERP_ICONS[ticker]:Object.hasOwn(COMMON,ticker)?COMMON[ticker]:null;
  const icon=document.createElement('span');icon.className='market-logo';icon.setAttribute('aria-hidden','true');
  const fallback=symbol.replace(/[^a-z0-9]/gi,'').slice(0,2).toUpperCase()||'?';icon.textContent=fallback;
  if(source){const img=document.createElement('img');img.src=source;img.alt='';img.width=32;img.height=32;img.loading='lazy';img.decoding='async';img.onerror=()=>{icon.textContent=fallback;};icon.replaceChildren(img);}
  return icon;
}
