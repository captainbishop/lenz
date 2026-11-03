import { previewTime, seekPreview } from './home-videos.js';

const video = document.querySelector('#defi-preview');
const chapters = [...document.querySelectorAll('[data-defi-time]')];
const details = [
  ['Markets', 'Spot, credit and perpetuals.', 'Uniswap · Aave · Hyperliquid · Rhea'],
  ['Cross-chain routes', 'Starting asset → destination action.', 'Bridge only when the route needs it.'],
  ['Hyperliquid', 'Orders, collateral and position exits.', 'Funding and liquidation continue offline.'],
  ['Yield', 'Staking, farming, LP ranges and claims.', 'Positions stay on their original chain.'],
  ['Offline approval', 'A connected executor submits approved actions.', 'Encrypted requests do not hide public execution.'],
];
function sync() {
  const index = Math.max(0, Math.min(4, Math.floor(previewTime(video) / 6)));
  chapters.forEach((button, i) => button.setAttribute('aria-current', String(i === index)));
  document.querySelector('#chapter-number').textContent = String(index + 1).padStart(2, '0');
  ['chapter-title', 'chapter-description', 'chapter-context'].forEach((id, i) => {
    document.getElementById(id).textContent = details[index][i];
  });
}
for (const button of chapters) button.addEventListener('click', () => {
  seekPreview(video, Number(button.dataset.defiTime) + .05);
  if (matchMedia('(max-width:760px)').matches) video.scrollIntoView({ block: 'center', behavior: 'auto' });
});
for (const event of ['timeupdate', 'seeked', 'loadedmetadata', 'previewseek']) video.addEventListener(event, sync);
sync();
