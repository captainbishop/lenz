import { checkLendingPublicRequest } from './intent-lending-service.mjs';
import { checkLendingPermissionReview } from './public/intent-lending-account.js';
import { LENDING_TESTNET } from './public/intent-lending-config.js';
import { LENDING_DEPLOYMENT } from './public/intent-lending-deployment.js';
import { checkLendingSetupRequest } from './intent-lending-setup.mjs';
import { checkLendingSupplyPreparation, checkLendingSupplyPublicRequest } from './public/intent-lending-supply.js';
import { checkLendingFundingRequest } from './intent-lending-funding.mjs';
import { checkLendingRepaymentFundingRequest } from './intent-lending-repayment-funding.mjs';

const operations = {
  config: 'configuration', prepare: 'prepare', submit: 'submit', reconcile: 'reconcile', resume: 'resume', setup: 'setup', 'setup-status': 'setupStatus',
  'supply/config': 'supplyConfiguration', 'supply/prepare': 'supplyPrepare', 'supply/submit': 'supplySubmit', 'supply/reconcile': 'supplyReconcile', 'supply/recover': 'supplyRecover', 'supply/resume': 'supplyResume',
  'funding/config': 'fundingConfiguration', 'funding/submit': 'fundingSubmit', 'funding/reconcile': 'fundingReconcile', 'funding/resume': 'fundingResume',
  'repayment-funding/config': 'repaymentFundingConfiguration', 'repayment-funding/submit': 'repaymentFundingSubmit', 'repayment-funding/reconcile': 'repaymentFundingReconcile', 'repayment-funding/resume': 'repaymentFundingResume',
};
const openLendingService = async options => (await import('./intent-lending-live.mjs')).openLendingService(options);
const maxBytes = 32768;

function abortable(promise, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve(promise).then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

function readBody(request, signal) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const chunks = []; let size = 0, done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      request.removeListener('data', data); request.removeListener('end', end); request.removeListener('error', failed);
      signal.removeEventListener('abort', abort);
      if (error) reject(error); else resolve(value);
    };
    const data = chunk => {
      size += chunk.length;
      if (size > maxBytes) { finish(null, null); request.resume(); } else chunks.push(chunk);
    };
    const end = () => finish(null, Buffer.concat(chunks)), failed = error => finish(error);
    const abort = () => { finish(signal.reason); request.resume(); };
    request.on('data', data); request.once('end', end); request.once('error', failed);
    signal.addEventListener('abort', abort, { once: true });
  });
}

export function createLendingExecutionHttpRoute({ origin = 'http://localhost:4173', service, serviceOptions, openService = openLendingService, now = Date.now, timeoutMs = 60000 } = {}) {
  const allowed = new URL(origin);
  if (allowed.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(allowed.hostname) || allowed.username || allowed.password || allowed.pathname !== '/' || allowed.search || allowed.hash) {
    throw Error('Lending execution requires the local Lenz origin.');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000) throw Error('Invalid lending execution timeout.');
  const config = { ...LENDING_TESTNET, ...LENDING_DEPLOYMENT, ...serviceOptions?.deployment, ...serviceOptions?.config };
  let servicePromise = service ? Promise.resolve(service) : null, active = 0, windowStart = now(), requests = 0, closing = false, closePromise;
  const inFlight = new Set();
  const respond = (response, status, value) => {
    if (response.destroyed || response.writableEnded) return;
    if (!value || Object.getPrototypeOf(value) !== Object.prototype) throw Error('Invalid lending response.');
    const bytes = JSON.stringify(value);
    if (Buffer.byteLength(bytes) > maxBytes) throw Error('The lending response is too large.');
    response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...(status !== 200 ? { Connection: 'close' } : {}) });
    response.end(bytes);
  };
  const route = async (request, response) => {
    const url = new URL(request.url, 'http://localhost'), operation = url.pathname.slice('/api/intents/lending/'.length);
    if (!url.pathname.startsWith('/api/intents/lending/') || !Object.hasOwn(operations, operation)) return false;
    if (closing) { respond(response, 503, { error: 'Lending is shutting down. Keep the original request.' }); return true; }
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(request.socket.remoteAddress) || request.headers.host !== allowed.host ||
      request.headers.origin !== allowed.origin || !['same-origin', 'none', undefined].includes(request.headers['sec-fetch-site'])) {
      respond(response, 403, { error: 'Open lending from the local Lenz app.' }); return true;
    }
    if (url.search) { respond(response, 400, { error: 'Use the original lending request.' }); return true; }
    if (request.method !== 'POST') { respond(response, 405, { error: 'Use a JSON POST request.' }); return true; }
    if (request.headers['content-type']?.split(';')[0].trim() !== 'application/json') { respond(response, 415, { error: 'Use a JSON request.' }); return true; }
    if (now() - windowStart >= 60000) { windowStart = now(); requests = 0; }
    if (++requests > 30) { respond(response, 429, { error: 'Wait before checking lending again.' }); return true; }
    if (active >= 2) { respond(response, 429, { error: 'Wait for the current lending requests to finish.' }); return true; }
    if (Number(request.headers['content-length']) > maxBytes) { request.resume(); respond(response, 413, { error: 'The lending request is too large.' }); return true; }
    const controller = new AbortController(), deadline = AbortSignal.timeout(timeoutMs), signal = AbortSignal.any([controller.signal, deadline]);
    const aborted = () => controller.abort(), closed = () => { if (!response.writableFinished) aborted(); };
    request.once('aborted', aborted); response.once('close', closed);
    active++;
    let body, executing = false, pending, released = false;
    const release = () => { if (!released) { released = true; active--; } };
    try {
      const raw = await readBody(request, signal);
      if (raw === null) { respond(response, 413, { error: 'The lending request is too large.' }); return true; }
      const input = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(raw));
      const configurationRequest = operation === 'config' || operation.endsWith('/config');
      if (configurationRequest) {
        if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).length) throw Error();
        body = input;
      } else if (operation === 'setup' || operation === 'setup-status') {
        body = checkLendingSetupRequest(input);
      } else if (operation.startsWith('repayment-funding/')) {
        body = checkLendingRepaymentFundingRequest(input);
      } else if (operation.startsWith('funding/')) {
        body = checkLendingFundingRequest(input);
      } else if (operation === 'supply/prepare') {
        body = checkLendingSupplyPreparation(input, { config });
      } else if (operation === 'supply/recover') {
        if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).sort().join() !== 'operation,request' || !['recover', 'withdrawRefund'].includes(input.operation)) throw Error();
        body = { operation: input.operation, request: checkLendingSupplyPublicRequest(input.request, { config }) };
      } else if (operation.startsWith('supply/')) {
        body = checkLendingSupplyPublicRequest(input, { config });
      } else if (operation === 'prepare') {
        if (!input || Object.getPrototypeOf(input) !== Object.prototype || Object.keys(input).join() !== 'review') throw Error();
        body = checkLendingPermissionReview(input.review, { now: now(), config });
      } else body = checkLendingPublicRequest(input, config);
      if (closing) { respond(response, 503, { error: 'Lending is shutting down. Keep the original request.' }); return true; }
      if (!service && !serviceOptions) {
        respond(response, configurationRequest ? 200 : 503, configurationRequest ? { available: false, execute: false } : { error: 'Lending execution is not configured.' }); return true;
      }
      executing = true;
      servicePromise ??= Promise.resolve().then(() => openService(serviceOptions)).catch(error => { servicePromise = null; throw error; });
      pending = servicePromise.then(current => { signal.throwIfAborted(); return current[operations[operation]](body, { signal }); });
      // A response timeout does not cancel an already signed transaction or release its work slot.
      inFlight.add(pending);
      const settled = () => { inFlight.delete(pending); release(); };
      pending.then(settled, settled);
      respond(response, 200, await abortable(pending, signal));
    } catch {
      if (deadline.aborted) respond(response, 504, { error: 'Lending timed out. Keep and check the original request.' });
      else if (!executing) respond(response, 400, { error: 'The original lending request cannot be read.' });
      else respond(response, 503, { error: 'Lending is unavailable. Keep and check the original request.' });
    } finally {
      if (!pending) release();
      request.removeListener('aborted', aborted); response.removeListener('close', closed);
    }
    return true;
  };
  route.close = () => {
    closing = true;
    closePromise ??= Promise.allSettled([...inFlight]).then(async () => { if (servicePromise) await (await servicePromise).close?.(); });
    return closePromise;
  };
  return route;
}
