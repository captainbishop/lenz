// A bounded reader for network identity and height. No signing or write methods.
export const AURORA_TESTNET = 'https://testnet.aurora.dev';
export const MAX_RPC_BYTES = 16 * 1024;
const METHODS = new Set(['eth_chainId', 'eth_blockNumber']);

export async function readAuroraQuantity(method, { fetchImpl = globalThis.fetch, timeoutMs = 20000 } = {}) {
  if (!METHODS.has(method)) throw new Error('Unsupported Aurora read method');
  const signal = AbortSignal.timeout(timeoutMs);
  const response = await fetchImpl(AURORA_TESTNET, {
    method: 'POST', redirect: 'error', signal,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: [] }),
  });
  if (!response.ok) { await response.body?.cancel(); throw new Error(`Aurora HTTP ${response.status}`); }
  if (!response.body) throw new Error('Empty Aurora RPC response');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    while (true) {
      signal.throwIfAborted();
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RPC_BYTES) throw new Error('Aurora RPC response is too large');
      chunks.push(value);
    }
  } finally {
    await reader.cancel(); reader.releaseLock();
  }
  signal.throwIfAborted();
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new Error('Invalid Aurora RPC JSON'); }
  if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || body.id !== 1 ||
      Object.hasOwn(body, 'error') || typeof body.result !== 'string' ||
      !/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(body.result)) {
    throw new Error('Invalid Aurora RPC quantity response');
  }
  return BigInt(body.result);
}
