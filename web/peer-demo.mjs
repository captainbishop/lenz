import { writeFile } from 'node:fs/promises';
import { runExchangeScenario } from './public/peer-scenario.js';
globalThis.fetch = () => { throw new Error('Unexpected network call'); };
const report = await runExchangeScenario();
await writeFile(new URL('./peer-demo-results.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
