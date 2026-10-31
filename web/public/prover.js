import { prove } from './protocol.js';
self.onmessage = async ({ data }) => {
  try { self.postMessage({ edge: await prove(data, stage => self.postMessage({ stage })) }); }
  catch (error) { self.postMessage({ error: error.message }); }
};
self.postMessage({ ready: true });
