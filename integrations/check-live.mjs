// Read-only service checks. There is no deposit creation or transaction method.
import { readFile, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { rheaQuote, RHEA } from './rhea.mjs';
import { intentsTokens, intentsPreview } from './intents.mjs';
const service = process.argv[2];
if (!['rhea', 'intents', 'intents-auth'].includes(service)) throw new Error('Choose rhea, intents or intents-auth');
let evidence;
try {
  if (service === 'rhea') {
    const discovery = JSON.parse(await readFile(new URL('../research/rhea-testnet-check.json', import.meta.url)));
    const pool = discovery.pools[0];
    evidence = await rheaQuote({ network: 'testnet', contract: RHEA.contract, poolId: 0,
      tokenIn: pool.token_account_ids[0], tokenOut: pool.token_account_ids[1],
      amountIn: '10000000000000000000000', slippageBps: 50 });
  } else if (service === 'intents-auth') {
    const { disposableIntentsSession } = await import('./disposable-intents-session.mjs');
    const { address, expiresIn } = await disposableIntentsSession();
    evidence = { provider: service, checkedAt: new Date().toISOString(), standard: 'raw_ed25519', address,
      emptyIntent: true, ephemeralIdentity: true, expiresIn,
      scope: 'Live authentication of a disposable unfunded identity. No token actions or transaction submission. User-session authentication does not grant partner quote access.' };
  } else {
    const options = { apiKey: process.env.LENZ_INTENTS_API_KEY };
    const tokens = await intentsTokens(options);
    const origin = tokens.find(t => t.assetId === 'nep141:wrap.near');
    const destination = tokens.find(t => t.blockchain === 'near' && t.symbol === 'USDC');
    if (!origin || !destination) throw new Error('The API did not supply the requested NEAR/USDC preview pair');
    const address = randomBytes(32).toString('hex');
    evidence = await intentsPreview({ network: 'mainnet', dry: true, swapType: 'EXACT_INPUT',
      originAsset: origin.assetId, destinationAsset: destination.assetId, amount: (10n ** BigInt(origin.decimals)).toString(),
      slippageTolerance: 50, recipient: address, refundTo: address,
      deadline: new Date(Date.now() + 10 * 60 * 1000).toISOString(), confidentiality: 'basic' }, options);
    evidence.supportedZcashAssets = tokens.filter(t => t.blockchain === 'zec');
  }
  evidence.ok = true;
} catch (error) {
  evidence = { provider: service, ok: false, checkedAt: new Date().toISOString(), error: error.message,
    cause: error.cause?.code, scope: 'Read-only integration check failed; no transaction attempted.' };
  process.exitCode = 1;
}
await writeFile(new URL(`./${service}-results.json`, import.meta.url), `${JSON.stringify(evidence, null, 2)}\n`);
console.log(JSON.stringify(evidence, null, 2));
