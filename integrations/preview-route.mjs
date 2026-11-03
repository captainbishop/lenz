import { readFile } from 'node:fs/promises';
import { previewRoute } from '../web/public/defi-route-plan.js';
import { examples, NOW } from './route-planner-fixtures.mjs';
import {previewWithMarkets} from '../web/public/defi-market-match.js';
import {bindRouteQuote} from '../web/public/defi-route-quote.js';

const [mode, argument, marketFlag, marketFile] = process.argv.slice(2);
if (process.argv.length===4 && mode==='--fixture' && Object.hasOwn(examples,argument)) {
  console.log(JSON.stringify(previewRoute(examples[argument],{now:NOW,observation:{kind:'fixture',observedAt:NOW,expiresAt:NOW+600000,source:'Synthetic local fixture; no live market read'}}),null,2));
} else if (mode==='--file' && argument && (process.argv.length===4 || (process.argv.length===6&&['--markets','--quote'].includes(marketFlag)&&marketFile))) {
  const input=JSON.parse(await readFile(argument,'utf8'));
  const plan=marketFile?(marketFlag==='--quote'?bindRouteQuote:previewWithMarkets)(input,JSON.parse(await readFile(marketFile,'utf8'))):previewRoute(input);
  console.log(JSON.stringify(plan,null,2));
} else {
  console.error('Usage: node integrations/preview-route.mjs --fixture near-evm-return|aave-position|hyperliquid-order\n       node integrations/preview-route.mjs --file objective.json [--markets observations.json | --quote estimate.json]');
  process.exitCode=1;
}
