// Live 1Click API client. Preview mode cannot create a deposit or send funds.
import { verifyQuoteSignature } from './quote-verifier/index.mjs';
export const INTENTS_API = 'https://1click.chaindefuser.com';
const require = (ok, message) => { if (!ok) throw new Error(message); };
const amount = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value);
async function request(path, options, fetcher, apiKey) {
  const response = await fetcher(INTENTS_API + path, { ...options, headers: { 'content-type': 'application/json',
    ...(apiKey ? { 'X-API-Key': apiKey } : {}) }, signal: AbortSignal.timeout(20000) });
  require(response.ok, `NEAR Intents HTTP ${response.status} at ${path}${response.status === 401 ? ': authentication was rejected; confidential quotes need partner API access' : ''}`);
  return response.json();
}
export async function intentsTokens({ fetcher = fetch, apiKey } = {}) {
  const tokens = await request('/v0/tokens', { method: 'GET' }, fetcher, apiKey);
  require(Array.isArray(tokens) && tokens.every(t => typeof t.assetId === 'string' && typeof t.blockchain === 'string'
    && Number.isInteger(t.decimals) && t.decimals >= 0 && t.decimals <= 77), 'Invalid Intents token list');
  return tokens;
}
export async function intentsPreview(input, { fetcher = fetch, apiKey, now = Date.now(), verifySignature = verifyQuoteSignature } = {}) {
  const data = structuredClone(input);
  require(data.network === 'mainnet', '1Click mainnet quotes cannot spend testnet tUSD');
  require(data.dry === true, 'Only preview quotes are enabled');
  require(data.swapType === 'EXACT_INPUT', 'Only exact-input quotes are supported');
  require(amount(data.amount), 'Use a positive integer base-unit amount');
  require(typeof data.originAsset === 'string' && typeof data.destinationAsset === 'string'
    && data.originAsset !== data.destinationAsset, 'Choose two different supported assets');
  require(Number.isSafeInteger(data.slippageTolerance) && data.slippageTolerance >= 0 && data.slippageTolerance < 10000, 'Invalid slippage');
  require(typeof data.recipient === 'string' && data.recipient.length > 0 && data.recipient.length <= 512
    && typeof data.refundTo === 'string' && data.refundTo.length > 0 && data.refundTo.length <= 512, 'Recipient and refund addresses are required');
  require(typeof data.deadline === 'string' && Number.isFinite(Date.parse(data.deadline)) && Date.parse(data.deadline) > now, 'Quote deadline has expired');
  require(['basic', 'advanced'].includes(data.confidentiality), 'Choose an explicit confidential route; no public fallback');
  const body = { dry: true, swapType: 'EXACT_INPUT', originAsset: data.originAsset, destinationAsset: data.destinationAsset,
    amount: data.amount, slippageTolerance: data.slippageTolerance, recipient: data.recipient, refundTo: data.refundTo,
    depositType: 'ORIGIN_CHAIN', recipientType: 'DESTINATION_CHAIN', refundType: 'ORIGIN_CHAIN',
    deadline: data.deadline, confidentiality: data.confidentiality };
  const result = await request('/v0/quote', { method: 'POST', body: JSON.stringify(body) }, fetcher, apiKey);
  require(result && result.quoteRequest && result.quote, 'Invalid Intents quote response');
  for (const [key, value] of Object.entries(body)) require(result.quoteRequest[key] === value, `Intents changed ${key}`);
  require(!result.quote.depositAddress && !result.quote.depositMemo && !result.quote.chainDepositAddresses?.length, 'Preview unexpectedly allocated a deposit');
  require(result.quote.amountIn === data.amount && amount(result.quote.amountOut) && amount(result.quote.minAmountOut), 'Invalid quoted amounts');
  const quotedMinimum = BigInt(result.quote.minAmountOut), output = BigInt(result.quote.amountOut);
  const floor = output * BigInt(10000 - data.slippageTolerance) / 10000n;
  require(quotedMinimum <= output && quotedMinimum >= floor, 'Quote exceeds the requested slippage');
  const timestamp = typeof result.timestamp === 'string' ? Date.parse(result.timestamp) : NaN;
  require(Number.isFinite(timestamp) && timestamp >= now - 5 * 60000 && timestamp <= now + 30000, 'Quote timestamp is missing, stale or too far in the future');
  require(verifySignature(result) === true, 'Invalid 1Click quote signature');
  return { provider: 'near-intents', state: 'quote', network: 'mainnet', checkedAt: new Date(now).toISOString(), response: result,
    verification: { signature: 'verified', sdk: '0.1.26', confidentiality: 'HTTPS echo only; excluded from the SDK signed fields' },
    scope: 'Signed quote fields verified. Confidential route requested through HTTPS; its confidentiality field is not signed by this SDK. No deposit, execution or independently verified privacy guarantee.' };
}

// Authentication is deliberately limited to a signed empty intent: no token actions.
export async function intentsAuthenticate(signedData, { fetcher = fetch, now = Date.now() } = {}) {
  require(signedData?.standard === 'raw_ed25519', 'Only the tested raw Ed25519 authentication format is supported');
  const payload = JSON.parse(signedData.payload);
  require(payload.verifying_contract === 'intents.near' && /^[0-9a-f]{64}$/.test(payload.signer_id), 'Invalid authentication domain or signer');
  require(Array.isArray(payload.intents) && payload.intents.length === 0, 'Authentication must not contain token actions');
  require(Date.parse(payload.deadline) > now && Date.parse(payload.deadline) <= now + 5 * 60000, 'Authentication deadline must be within five minutes');
  const result = await request('/v0/auth/authenticate', { method: 'POST', body: JSON.stringify({ signedData }) }, fetcher);
  require(typeof result.accessToken === 'string' && result.accessToken.length > 0 && Number.isFinite(result.expiresIn) && result.expiresIn > 0, 'Invalid authentication response');
  return result;
}
