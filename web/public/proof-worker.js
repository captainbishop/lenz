// A module worker may finish top-level-await imports after its input is ready.
// Send the witness only after the worker explicitly installs its handler.
export function proveInWorker(input, onProgress = () => {}, timeoutMs = 300000) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./prover.js', import.meta.url), { type: 'module' });
    let started = false;
    const finish = (error, edge) => {
      clearTimeout(timer); worker.terminate();
      error ? reject(error) : resolve(edge);
    };
    const timer = setTimeout(() => finish(new Error('Proof creation timed out. No payment was sent.')), timeoutMs);
    worker.onmessage = ({ data }) => {
      if (data.ready) { if (!started) { started = true; worker.postMessage(input); } return; }
      if (data.stage) { onProgress(data.stage); return; }
      if (data.error) finish(new Error(data.error));
      else if (data.edge) finish(null, data.edge);
      else finish(new Error('The proof engine returned an invalid response.'));
    };
    worker.onerror = event => finish(new Error(event.message || 'The proof engine could not start. Prepare the offline demo and retry.'));
    worker.onmessageerror = () => finish(new Error('The proof engine response could not be read.'));
  });
}
