import { createLendingReader } from './intent-lending-read.mjs';

function selection(value) {
  if (!value || Object.getPrototypeOf(value) !== Object.prototype || !Object.keys(value).every(key => ['owner', 'account'].includes(key)) ||
    !Object.values(value).every(item => typeof item === 'string' && /^0x[0-9a-fA-F]{40}$/.test(item) && !/^0x0{40}$/.test(item))) {
    throw Error('Invalid lending account selection.');
  }
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, item.toLowerCase()]));
}

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason), cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function readBody(request, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0;
    const finish = (error, value) => {
      request.removeListener('data', data); request.removeListener('end', end); request.removeListener('error', failed);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const data = chunk => {
      size += chunk.length;
      if (size > 4096) { finish(null, null); request.resume(); } else chunks.push(chunk);
    };
    const end = () => finish(null, Buffer.concat(chunks));
    const failed = error => finish(error);
    const abort = () => { finish(signal.reason); request.resume(); };
    request.on('data', data); request.once('end', end); request.once('error', failed);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function createLendingHttpRoute({ origin = 'http://localhost:4173', reader = createLendingReader(), supplyReader, now = Date.now, timeoutMs = 60000 } = {}) {
  const allowed = new URL(origin);
  if (allowed.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(allowed.hostname) || allowed.username || allowed.password || allowed.pathname !== '/' || allowed.search || allowed.hash) {
    throw Error('The lending reader requires the local Lenz origin.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('Invalid lending read timeout.');
  const hosts = new Set(['localhost', '127.0.0.1'].map(host => host + (allowed.port ? ':' + allowed.port : '')));
  let windowStart = now(), requests = 0, active = 0;
  const respond = (response, status, value, close = status !== 200) => {
    if (response.destroyed || response.writableEnded) return;
    const body = JSON.stringify(value);
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(close ? { Connection: 'close' } : {}) });
    response.end(body);
  };
  return async function route(request, response) {
    const url = new URL(request.url, 'http://localhost');
    if (!url.pathname.startsWith('/api/intents/lending/')) return false;
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) || !hosts.has(request.headers.host) ||
      request.headers.origin !== 'http://' + request.headers.host || !['same-origin', 'none', undefined].includes(request.headers['sec-fetch-site'])) {
      respond(response, 403, { error: 'Open lending from the local Lenz app.' }); return true;
    }
    if (!['/api/intents/lending/snapshot', '/api/intents/lending/supply/snapshot'].includes(url.pathname)) { respond(response, 404, { error: 'Unknown lending read.' }); return true; }
    const selectedReader = url.pathname === '/api/intents/lending/supply/snapshot' ? supplyReader : reader;
    if (url.search) { respond(response, 400, { error: 'Choose lending accounts in the JSON request.' }); return true; }
    if (request.method !== 'POST') { respond(response, 405, { error: 'Use a JSON POST request.' }); return true; }
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { respond(response, 415, { error: 'Use a JSON request.' }); return true; }
    if (now() - windowStart >= 60000) { windowStart = now(); requests = 0; }
    if (++requests > 30) { respond(response, 429, { error: 'Wait before checking lending again.' }); return true; }
    if (active >= 2) { respond(response, 429, { error: 'Wait for the current lending reads to finish.' }); return true; }
    if (Number(request.headers['content-length']) > 4096) { request.resume(); respond(response, 413, { error: 'The lending read request is too large.' }, true); return true; }
    const controller = new AbortController(), deadline = AbortSignal.timeout(timeoutMs), signal = AbortSignal.any([controller.signal, deadline]);
    const aborted = () => controller.abort(), closed = () => { if (!response.writableFinished) aborted(); };
    request.once('aborted', aborted); response.once('close', closed);
    active++;
    let reading = false;
    try {
      const raw = await readBody(request, signal);
      if (raw === null) { respond(response, 413, { error: 'The lending read request is too large.' }, true); return true; }
      const body = selection(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw)));
      reading = true;
      const value = await abortable(selectedReader.snapshot(body, { signal }), signal);
      if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw Error('Invalid lending snapshot.');
      respond(response, 200, { ...value, execute: false });
    } catch {
      if (deadline.aborted) respond(response, 504, { error: 'The lending read timed out. Check again.' }, true);
      else if (!reading) respond(response, 400, { error: 'The lending read request cannot be read.' }, true);
      else respond(response, 503, { error: 'The verified lending snapshot is unavailable.' });
    } finally {
      active--;
      request.removeListener('aborted', aborted); response.removeListener('close', closed);
    }
    return true;
  };
}
