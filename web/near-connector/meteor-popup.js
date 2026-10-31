// Meteor SDK 3.24.0 web popup protocol; see meteor-protocol-evidence.json.
// No extension bridge, delegated key, redirect callback or remote executor.
export const METEOR_ORIGIN = 'https://wallet.meteorwallet.app';
export function createPopupTransport(host = window, { timeoutMs = 120000, pingMs = 500 } = {}) {
  let active;
  return {
    cancel() { active?.(new Error('Approval was cancelled.')); },
    request(actionType, prepareInputs) {
      if (!['login', 'sign'].includes(actionType)) return Promise.reject(new Error('Invalid wallet action.'));
      if (active) return Promise.reject(new Error('A wallet approval is already open.'));
      const uid = host.crypto.randomUUID(), url = new URL(`/connect/testnet/${actionType}`, METEOR_ORIGIN);
      // Do not disclose callback parameters or fragments to another origin.
      url.search = new URLSearchParams({ source: 'wpm', connectionUid: uid,
        pageUri: encodeURIComponent(host.location.origin + host.location.pathname) });
      const popup = host.open(url.href, '_blank', 'popup=1,width=420,height=720');
      if (!popup) return Promise.reject(new Error('Allow popups to open your wallet.'));
      return new Promise((resolve, reject) => {
        const controller = new AbortController();
        let status = 'initializing', inputs, ready = false, done = false;
        const send = () => popup.postMessage({ endTags: [], actionType, status, uid, network: 'testnet',
          ...(status === 'initializing' ? { inputs } : {}) }, METEOR_ORIGIN);
        const finish = (error, payload) => {
          if (done) return;
          done = true; active = null;
          host.clearInterval(ping); host.clearTimeout(deadline);
          host.removeEventListener('message', receive);
          controller.abort();
          if (error) { popup.close(); reject(error); }
          else { host.setTimeout(() => popup.close(), 300); resolve(payload); }
        };
        const receive = event => {
          const data = event.data;
          if (event.origin !== METEOR_ORIGIN || event.source !== popup) return;
          if (!ready || !data || typeof data !== 'object' || data.uid !== uid) return;
          if ((data.network !== undefined && data.network !== 'testnet') ||
              (data.actionType !== undefined && data.actionType !== actionType)) return;
          if (data.status === 'connected') status = 'connected';
          else if (data.status === 'attempting_reconnect') { status = 'initializing'; send(); }
          else if (data.status === 'closed_success') {
            status = 'closed_success'; send(); finish(null, data.payload);
          } else if (['closed_fail', 'closed_window', 'disconnected'].includes(data.status)) {
            finish(new Error('Approval was cancelled or the wallet disconnected.'));
          }
        };
        const ping = host.setInterval(() => {
          if (popup.closed) finish(new Error('Wallet closed before approval completed.'));
          else if (ready) send();
        }, pingMs);
        const deadline = host.setTimeout(() => finish(new Error('Wallet approval timed out.')), timeoutMs);
        active = finish;
        host.addEventListener('message', receive);
        // Open synchronously, then prepare the transaction without losing the popup.
        Promise.resolve().then(() => prepareInputs(controller.signal)).then(value => {
          if (done) return;
          inputs = value; ready = true; send();
        }).catch(error => finish(error));
      });
    },
  };
}
