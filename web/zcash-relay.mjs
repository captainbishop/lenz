import { companionSnapshot } from '../zcash/companion.mjs';
import { paymentReview } from '../zcash/payment-review.mjs';
const send = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(body)); };
export function createZcashRoute(snapshot = companionSnapshot, review = paymentReview) {
  let busy = false;
  return async (req, res) => {
    if (!req.url.startsWith('/api/zcash/')) return false;
    if (req.headers.host !== '127.0.0.1:4173' || req.headers.origin !== 'http://127.0.0.1:4173') { send(res, 403, { error: 'Open this tool from the local Lenz app.' }); return true; }
    if (req.method !== 'POST') { send(res, 405, { error: 'Use POST.' }); return true; }
    const reviewAction = ({'/api/zcash/review':'prepare','/api/zcash/review-status':'status','/api/zcash/review-discard':'discard','/api/zcash/review-check':'check','/api/zcash/review-effects':'effects','/api/zcash/review-memos':'memos','/api/zcash/review-memo-confirm':'memo-confirm'})[req.url];
    if (!reviewAction && !['/api/zcash/status', '/api/zcash/refresh'].includes(req.url)) { send(res, 404, { error: 'Unknown Zcash action.' }); return true; }
    let input;
    try {
      if (req.headers['content-type'] !== 'application/json') throw Error();
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 256) throw Error(); chunks.push(Buffer.from(chunk)); }
      input = JSON.parse(Buffer.concat(chunks));
      const keys = reviewAction === 'prepare' ? 'amount,wallet' : reviewAction === 'memo-confirm' ? 'binding,id,wallet' : ['discard','check','effects','memos'].includes(reviewAction) ? 'id,wallet' : 'wallet';
      if (!input || Array.isArray(input) || Object.keys(input).sort().join(',') !== keys || !['a', 'b'].includes(input.wallet)) throw Error();
      if (reviewAction === 'prepare' && (typeof input.amount !== 'string' || input.amount.length > 10)) throw Error();
      if (['discard','check','effects','memos','memo-confirm'].includes(reviewAction) && (typeof input.id !== 'string' || !/^[0-9a-f-]{36}$/.test(input.id))) throw Error();
      if (reviewAction === 'memo-confirm' && (typeof input.binding !== 'string' || !/^[0-9a-f]{64}$/.test(input.binding))) throw Error();
    } catch { send(res, 400, { error: 'Choose test wallet A or B.' }); return true; }
    if (busy) { send(res, 409, { error: 'A Zcash wallet check is already running. Wait for it to finish.' }); return true; }
    busy = true;
    const controller = new AbortController();
    const cancel = () => { if (!res.writableEnded) controller.abort(); };
    if (['memos','memo-confirm'].includes(reviewAction)) res.once?.('close',cancel);
    try { send(res, 200, reviewAction ? await review(reviewAction, input,...(['memos','memo-confirm'].includes(reviewAction)?[{signal:controller.signal}]:[])) : await snapshot(input.wallet, req.url.endsWith('/refresh'))); }
    catch (error) {
      if (reviewAction && [400,409,422].includes(error.status)) { send(res, error.status, { error: error.message }); return true; }
      const failedStep = ['info', 'sync', 'balance', 'address'].includes(error.operation) ? error.operation : 'validation';
      const code = error.code === 'ZCASH_TIMEOUT' ? 'ZCASH_TIMEOUT' : 'ZCASH_UNAVAILABLE';
      send(res, 503, { error: 'The local Zcash test wallet is unavailable or could not finish. Any earlier balance may be out of date.', failedStep, code });
    }
    finally { busy = false; res.removeListener?.('close',cancel); }
    return true;
  };
}
export const zcashRoute = createZcashRoute();
