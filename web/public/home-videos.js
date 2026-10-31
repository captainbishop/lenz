const root = document.documentElement;
const videos = [...document.querySelectorAll('.video-preview')];
const visible = new WeakSet(), held = new WeakSet(), manual = new WeakSet();
function buttonFor(video) { return document.querySelector(`[data-video="${video.id}"]`); }
function label(video) {
  const button = buttonFor(video); if (!button) return;
  const path = video.paused ? 'M6 3l14 9-14 9z' : 'M5 3h5v18H5zm9 0h5v18h-5z';
  button.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  button.setAttribute('aria-label', `${video.paused ? 'Play' : 'Pause'} ${video.id === 'hero-preview' ? 'conversation' : 'product'} preview`);
}
function update(video) {
  const motionAllowed = !root.classList.contains('motion-off') || manual.has(video);
  if (document.hidden || !visible.has(video) || held.has(video) || !motionAllowed) video.pause();
  else video.play().catch(() => label(video));
  label(video);
}
export function refreshPreviewVideos() {
  for (const video of videos) {
    const view = video.dataset.view ?? (video.id === 'hero-preview' ? 'chat' : 'wallet');
    const path = `/previews/${view}-${root.dataset.theme === 'dark' ? 'dark' : 'light'}`;
    if (video.getAttribute('src') !== path + '.mp4') {
      video.pause(); video.src = path + '.mp4'; video.poster = path + '.webp'; video.load();
    }
    update(video);
  }
}
export function setPreviewView(view, description) {
  const video = document.querySelector('#product-preview');
  video.dataset.view = view; video.setAttribute('aria-label', description); refreshPreviewVideos();
}
export function pausePreviewMotion(paused) {
  for (const video of videos) { if (paused) manual.delete(video); update(video); }
}
const observer = new IntersectionObserver(entries => {
  for (const entry of entries) {
    if (entry.isIntersecting && entry.intersectionRatio >= .25) visible.add(entry.target);
    else visible.delete(entry.target);
    update(entry.target);
  }
}, { threshold: [.0, .25] });
for (const video of videos) {
  observer.observe(video);
  for (const event of ['play', 'pause', 'ended']) video.addEventListener(event, () => label(video));
  video.addEventListener('loadeddata', () => update(video));
  buttonFor(video)?.addEventListener('click', () => {
    if (video.paused) { held.delete(video); manual.add(video); } else { held.add(video); manual.delete(video); }
    update(video);
  });
}
document.addEventListener('visibilitychange', () => videos.forEach(update));
