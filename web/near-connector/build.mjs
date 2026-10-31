import { build } from 'esbuild';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
const here = new URL('./', import.meta.url), dest = new URL('../public/near-vendor/', here);
await mkdir(dest, { recursive: true });
const result = await build({ entryPoints: [fileURLToPath(new URL('entry.js', here))], bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: fileURLToPath(new URL('connector.js', dest)), minify: true, legalComments: 'eof', metafile: true,
  // NEAR's flat entry also imports Contract's Node-only ABI validator. This
  // adapter uses only transaction encoding. Omit that unused import, and fail
  // below if a future change makes any external runtime dependency reachable.
  plugins: [{ name: 'unused-contract-validator', setup(b) {
    b.onResolve({ filter: /^is-my-json-valid$/ }, args => ({ path: args.path, external: true, sideEffects: false }));
  } }],
});
if (Object.values(result.metafile.outputs).some(output => output.imports.length)) throw Error('Browser connector has an unresolved runtime import');
const files = {};
for (const name of ['connector.js']) {
  const data = await readFile(new URL(name, dest));
  files[name] = { bytes: data.length, sha256: createHash('sha256').update(data).digest('hex') };
}
const sources = {};
for (const name of ['entry.js', 'meteor-popup.js', 'package-lock.json']) sources[name] = createHash('sha256').update(await readFile(new URL(name, here))).digest('hex');
const licenses = ['near-api-js/LICENSE', '@noble/curves/LICENSE', '@noble/hashes/LICENSE', '@noble/post-quantum/LICENSE', '@scure/base/LICENSE', 'borsh/LICENSE-MIT.txt', 'borsh/LICENSE-APACHE'];
await writeFile(new URL('NOTICE.txt', dest), (await Promise.all(licenses.map(async name => `--- ${name} ---\n${await readFile(new URL('node_modules/' + name, here), 'utf8')}`))).join('\n\n'));
await writeFile(new URL('build-results.json', here), JSON.stringify({ package: 'near-api-js', version: '7.4.0', protocol: 'Meteor SDK 3.24.0 web popup', sources, files }, null, 2) + '\n');
const walletPage=await readFile(new URL('../public/money.html',here),'utf8');
await writeFile(new URL('../public/wallet-lab.html',here),walletPage.replace('<title>Lenz · Wallet</title>','<title>Lenz · Developer wallet lab</title>').replace('<body class="money-page">','<body class="money-page" data-wallet-tools="true"><p class="wallet-lab-notice">Developer wallet lab · testnet only. Meteor connection is under verification. No real funds.</p>'));
console.log(files);
