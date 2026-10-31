// Rhea's published testnet exchange. Quotes are observations, not settlement.
import { TESTNET_RPC } from './near-network.mjs';
export const RHEA = Object.freeze({ network: 'testnet', rpc: TESTNET_RPC, contract: 'ref-finance-101.testnet' });
const require = (ok, message) => { if (!ok) throw new Error(message); };
const amount = value => typeof value === 'string' && /^[1-9][0-9]{0,38}$/.test(value) && BigInt(value) < (1n << 128n);

export async function rheaQuote(input, { fetcher = fetch } = {}) {
  const request = structuredClone(input);
  require(request.network === RHEA.network && request.contract === RHEA.contract, 'Wrong Rhea network or contract');
  require(Number.isSafeInteger(request.poolId) && request.poolId >= 0, 'Invalid pool');
  require(amount(request.amountIn), 'Use a positive integer base-unit amount');
  require(Number.isSafeInteger(request.slippageBps) && request.slippageBps >= 0 && request.slippageBps < 10000, 'Invalid slippage');
  require(typeof request.tokenIn === 'string' && typeof request.tokenOut === 'string' && request.tokenIn !== request.tokenOut, 'Choose two different tokens');
  async function rpc(method, params) {
    const response = await fetcher(RHEA.rpc, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 'lenz-rhea', method, params }), signal: AbortSignal.timeout(20000) });
    require(response.ok, `Rhea RPC HTTP ${response.status}`);
    const body = await response.json();
    require(!body.error && !body.result?.error, 'Rhea RPC rejected the request');
    return body.result;
  }
  require((await rpc('status', [])).chain_id === 'testnet', 'RPC returned the wrong network');
  const account = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: RHEA.contract });
  require(typeof account.block_hash === 'string' && typeof account.code_hash === 'string', 'Missing final block evidence');
  async function view(method_name, args) {
    const result = await rpc('query', { request_type: 'call_function', block_id: account.block_hash,
      account_id: RHEA.contract, method_name, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
    require(result.block_hash === account.block_hash, 'Rhea quote mixed different blocks');
    return JSON.parse(Buffer.from(result.result).toString('utf8'));
  }
  const pool = await view('get_pool', { pool_id: request.poolId });
  require(pool.pool_kind === 'SIMPLE_POOL', 'This adapter requires a simple pool');
  require(Array.isArray(pool.token_account_ids) && Array.isArray(pool.amounts)
    && pool.token_account_ids.length === pool.amounts.length, 'Invalid pool response');
  for (const token of [request.tokenIn, request.tokenOut]) {
    const index = pool.token_account_ids.indexOf(token);
    require(index !== -1 && amount(pool.amounts[index]), 'Token is absent or has no pool liquidity');
  }
  const amountOut = await view('get_return', { pool_id: request.poolId, token_in: request.tokenIn,
    amount_in: request.amountIn, token_out: request.tokenOut });
  require(amount(amountOut), 'Rhea returned no usable output');
  const minimum = BigInt(amountOut) * BigInt(10000 - request.slippageBps) / 10000n;
  require(minimum > 0n, 'Minimum output would round to zero');
  return { provider: 'rhea', state: 'quote', network: 'testnet', request, amountOut, minAmountOut: minimum.toString(),
    blockHash: account.block_hash, blockHeight: account.block_height, codeHash: account.code_hash,
    checkedAt: new Date().toISOString(), scope: 'Final-block RPC quote only; no reserve authorization, swap or refund executed.' };
}
