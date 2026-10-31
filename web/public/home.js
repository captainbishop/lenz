import './home-interactive.js';
const note = document.querySelector('#home-cache-status');
if ('serviceWorker' in navigator) {
  // An already cached homepage reloads once when its updated shell takes over.
  if (navigator.serviceWorker.controller) navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), { once: true });
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    const worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error('No offline worker');
    if (worker && worker.state !== 'activated') await new Promise((resolve, reject) => {
      const changed = () => {
        if (worker.state === 'activated') { worker.removeEventListener('statechange', changed); resolve(); }
        if (worker.state === 'redundant') { worker.removeEventListener('statechange', changed); reject(new Error('Page saving failed')); }
      }; worker.addEventListener('statechange', changed); changed();
    });
    const messages = new MessageChannel();
    const saved = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { messages.port1.close(); reject(new Error('Page cache could not be checked')); }, 10000);
      messages.port1.onmessage = ({ data }) => { clearTimeout(timer); messages.port1.close(); data.complete ? resolve() : reject(new Error('Page files are missing')); };
    });
    worker.postMessage({ type: 'home-status' }, [messages.port2]); await saved;
    note.textContent = 'Homepage saved on this device. Open conversations to save the chat for offline use.';
  } catch { note.textContent = 'The homepage could not be saved for offline use. It can still be opened while connected.'; }
}
