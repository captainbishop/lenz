// Share the homepage's explicit theme preference without touching account storage.
(() => {
  const system = matchMedia('(prefers-color-scheme: dark)');
  function apply() {
    let saved; try { saved = localStorage.getItem('lenz-home-theme'); } catch {}
    document.documentElement.dataset.theme = saved === 'dark' || (saved !== 'light' && system.matches) ? 'dark' : 'light';
  }
  apply(); system.addEventListener('change', apply);
  addEventListener('storage', event => { if (event.key === 'lenz-home-theme') apply(); });
})();
