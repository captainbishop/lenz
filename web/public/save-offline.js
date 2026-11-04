export async function saveOffline() {
  if (!('serviceWorker' in navigator)) throw new Error('Offline saving needs a browser with service-worker support.');
  let worker;
  const scopes=['/chat.html','/money.html','/swap-tools.html','/recovery.html','/account.html'];
  if(location.pathname==='/wallet-lab.html')scopes.push('/wallet-lab.html');
  for (const scope of scopes) {
    const registration = await navigator.serviceWorker.register('/chat-sw.js', { scope });
    worker = registration.installing ?? registration.waiting ?? registration.active;
    if (!worker) throw new Error('The offline worker could not start.');
    if (worker.state !== 'activated') await new Promise((resolve, reject) => {
      const changed = () => {
        if (worker.state === 'activated' || worker.state === 'redundant') {
          worker.removeEventListener('statechange', changed);
          worker.state === 'activated' ? resolve() : reject(new Error('Offline worker installation failed.'));
        }
      }; worker.addEventListener('statechange', changed); changed();
    });
  }
  const messages = new MessageChannel();
  const result = new Promise((resolve, reject) => {
    const timer = setTimeout(() => { messages.port1.close(); reject(new Error('Offline preparation timed out. Try again when connected.')); }, 30000);
    messages.port1.onmessage = ({ data }) => { clearTimeout(timer); messages.port1.close(); data.ok ? resolve(data) : reject(new Error(data.error)); };
  }); worker.postMessage({ type: 'prepare' }, [messages.port2]); await result;
}
