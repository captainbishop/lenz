// Apply appearance before paint. This preference never touches account storage.
(() => {
  const system = matchMedia('(prefers-color-scheme: dark)'), key = 'lenz-home-theme';
  const valid = value => ['auto','light','dim','dark'].includes(value) ? value : 'auto';
  let preference = 'auto';
  try { preference = valid(localStorage.getItem(key)); } catch {}
  function apply() {
    const root = document.documentElement, theme = preference === 'auto' ? (system.matches ? 'dark' : 'light') : preference;
    root.dataset.themePreference = preference;
    root.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = {light:'#f5f5ef',dim:'#14291f',dark:'#080f0c'}[theme];
    dispatchEvent(new Event('lenz-theme-changed'));
  }
  apply(); system.addEventListener('change', apply);
  addEventListener('storage', event => { if (event.key === key || event.key === null) { preference = valid(event.newValue); apply(); } });
  addEventListener('lenz-theme-choice', event => {
    if (!['auto','light','dim','dark'].includes(event.detail)) return;
    preference = event.detail;
    try { localStorage.setItem(key, preference); } catch {}
    apply();
  });
})();
