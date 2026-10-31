import { rheaQuote } from '../integrations/rhea.mjs';
import { intentsPreview, intentsTokens } from '../integrations/intents.mjs';
const origin = 'http://127.0.0.1:4173';
const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); res.end(JSON.stringify(data)); };
// These routes only obtain quotes. They do not sign, reserve, deposit or spend.
export function createDefiRoute(clients = { rheaQuote, intentsPreview, intentsTokens }) {
  return async function defiRoute(req, res) {
    if (!req.url.startsWith('/api/defi/')) return false;
    try {
      if (req.headers.host !== '127.0.0.1:4173' || req.headers.origin !== origin) { send(res, 403, { error: 'Only this local Lenz app can request quotes.' }); return true; }
      if (req.method !== 'POST') { send(res, 405, { error: 'Use POST' }); return true; }
      if (req.headers['content-type'] !== 'application/json') throw new Error('Expected JSON');
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > 5000) throw new Error('Quote request too large'); chunks.push(chunk); }
      const input = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      let result;
      if (req.url === '/api/defi/rhea/quote') result = await clients.rheaQuote(input);
      else if (req.url === '/api/defi/intents/quote') result = await clients.intentsPreview(input, { apiKey: process.env.LENZ_INTENTS_API_KEY });
      else if (req.url === '/api/defi/intents/tokens') result = await clients.intentsTokens({ apiKey: process.env.LENZ_INTENTS_API_KEY });
      else { send(res, 404, { error: 'Unknown quote route' }); return true; }
      send(res, 200, result);
    } catch (error) { send(res, 400, { error: error.message.slice(0, 250) }); }
    return true;
  };
}
export const defiRoute = createDefiRoute();
