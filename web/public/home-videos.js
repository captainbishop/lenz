const root = document.documentElement;
const videos = [...document.querySelectorAll('.video-preview')];
const visible = new WeakSet(), held = new WeakSet(), manual = new WeakSet();
const pendingTime = new WeakMap();
let timelines = {};
function buttonFor(video) { return document.querySelector(`[data-video="${video.id}"]`); }
function viewFor(video) { return video.dataset.view ?? (video.id === 'hero-preview' ? 'chat' : 'wallet'); }
function scenesFor(video) { return timelines[viewFor(video)] ?? []; }
function sceneIndex(video) { return Math.max(0, scenesFor(video).findLastIndex(s => s.start <= video.currentTime + .05)); }
function label(video) {
  const button = buttonFor(video);
  if (button) {
    button.textContent = video.paused ? 'Play' : 'Pause';
    button.setAttribute('aria-label', `${video.paused ? 'Play' : 'Pause'} ${video.id === 'hero-preview' ? 'conversation' : 'product'} preview`);
  }
  const wrap = video.closest('.hero-preview-wrap, .product-screen-wrap');
  if (wrap) wrap.dataset.paused = String(video.paused);
  video.setAttribute('aria-pressed', String(!video.paused));
  video.title = video.paused ? 'Click to play. Arrow keys change scene.' : 'Click to pause. Arrow keys change scene.';
  for (const button of document.querySelectorAll(`[data-for="${video.id}"]`)) {
    const next = sceneIndex(video) + Number(button.dataset.scene);
    button.disabled = !scenesFor(video).length || next < 0 || next >= scenesFor(video).length;
  }
}
function update(video) {
  const motionAllowed = !root.classList.contains('motion-off') || manual.has(video);
  if (document.hidden || !visible.has(video) || held.has(video) || !motionAllowed) video.pause();
  else video.play().catch(() => label(video));
  label(video);
}
function toggle(video) {
  if (video.paused) { held.delete(video); manual.add(video); }
  else { held.add(video); manual.delete(video); }
  update(video);
}
function step(video, direction) {
  const scenes = scenesFor(video), next = sceneIndex(video) + direction;
  if (next < 0 || next >= scenes.length) return;
  video.currentTime = scenes[next].start + .05;
  label(video);
}
export function refreshPreviewVideos() {
  for (const video of videos) {
    const view = viewFor(video);
    const path = `/previews/${view}-${root.dataset.theme === 'dark' ? 'dark' : 'light'}`;
    if (video.getAttribute('src') !== path + '.mp4') {
      const sameView = video.getAttribute('src')?.includes(`/previews/${view}-`);
      pendingTime.set(video, sameView ? video.currentTime : 0);
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
}, { threshold: [0, .25] });
for (const video of videos) {
  observer.observe(video);
  video.tabIndex = 0; video.setAttribute('role', 'button');
  video.setAttribute('aria-keyshortcuts', 'Space Enter ArrowLeft ArrowRight');
  for (const event of ['play', 'pause', 'ended', 'timeupdate', 'seeked']) video.addEventListener(event, () => label(video));
  video.addEventListener('loadedmetadata', () => {
    const time = pendingTime.get(video); pendingTime.delete(video);
    if (time > 0 && Number.isFinite(video.duration)) video.currentTime = Math.min(time, video.duration - .1);
  });
  video.addEventListener('loadeddata', () => update(video));
  video.addEventListener('click', () => toggle(video));
  video.addEventListener('keydown', event => {
    if ([' ', 'Enter'].includes(event.key)) { event.preventDefault(); toggle(video); }
    else if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); step(video, event.key === 'ArrowLeft' ? -1 : 1); }
  });
  buttonFor(video)?.addEventListener('click', () => toggle(video));
  for (const button of document.querySelectorAll(`[data-for="${video.id}"]`)) button.addEventListener('click', () => step(video, Number(button.dataset.scene)));
  label(video);
}
void fetch('/previews/timelines.json').then(response => {
  if (!response.ok) throw Error('Preview scenes unavailable');
  return response.json();
}).then(value => {
  for (const view of ['chat', 'wallet', 'profile']) {
    const scenes = value[view];
    if (!Array.isArray(scenes) || scenes.length < 3 || scenes.some((s,i) => !Number.isFinite(s.start) || s.start < 0 || (i && s.start <= scenes[i-1].start))) throw Error('Invalid preview scenes');
  }
  timelines = value; videos.forEach(label);
}).catch(() => { timelines = {}; videos.forEach(label); });
document.addEventListener('visibilitychange', () => videos.forEach(update));
